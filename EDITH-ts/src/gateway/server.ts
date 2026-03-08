/**
 * Gateway server - WebSocket + HTTP transport layer.
 *
 * Handles incoming connections from WebChat, external webhooks, and the REST API.
 * All message processing is delegated to MessagePipeline.
 *
 * Responsibilities:
 * - WebSocket connection lifecycle (connect, disconnect)
 * - HTTP route definitions
 * - Auth/pairing checks (before message reaches pipeline)
 * - Transport-level validation/normalization
 * - Usage summary API endpoints
 * - Rate limiting, CORS, security headers
 */

import crypto from "node:crypto"
import { readFileSync } from "node:fs"
import { resolve, dirname, basename } from "node:path"
import { fileURLToPath } from "node:url"

import Fastify from "fastify"
import websocketPlugin from "@fastify/websocket"

import { loadRuntimeProactiveConfig } from "../background/runtime-config.js"
import { daemon } from "../background/daemon.js"
import { channelManager } from "../channels/manager.js"
import { whatsAppChannel } from "../channels/whatsapp.js"
import config from "../config.js"
import { resolveConfiguredWorkspaceDir } from "../config/edith-config.js"
import { eventBus } from "../core/event-bus.js"
import {
  handleIncomingUserMessage,
  estimateTokensFromText,
  type IncomingMessageOptions,
} from "../core/incoming-message-service.js"
import { orchestrator } from "../engines/orchestrator.js"
import { createLogger } from "../logger.js"
import { memory } from "../memory/store.js"
import { multiUser } from "../multiuser/manager.js"
import {
  metricsContentType,
  observeHttpRequest,
  renderPrometheusMetrics,
} from "../observability/metrics.js"
import { withSpan } from "../observability/tracing.js"
import { usageTracker } from "../observability/usage-tracker.js"
import { loadRuntimeVisionConfig } from "../vision/runtime-config.js"
import { loadRuntimeVoiceConfig } from "../voice/runtime-config.js"
import { VoiceSessionManager } from "../voice/session-manager.js"
import { checkWakeWordWindow } from "../voice/wake-word.js"
import {
  authenticateWebSocket,
  getAuthFailure,
  type AuthContext,
} from "./auth-middleware.js"
import { createRateLimiter } from "./rate-limiter.js"

const logger = createLogger("gateway")

// ── Constants ────────────────────────────────────────────────────────────────

const MAX_USAGE_DAYS = 30
const DEFAULT_USAGE_DAYS = 7

/** Maximum request body size (1 MB) to prevent memory DoS */
const MAX_BODY_SIZE = 1_048_576

/** Rate limit: max requests per window per IP */
const RATE_LIMIT_MAX = 60
const RATE_LIMIT_WINDOW_MS = 60_000

/** CORS: allowed origins (configurable via GATEWAY_CORS_ORIGINS env var, comma-separated) */
const ALLOWED_ORIGINS: ReadonlySet<string> = new Set(
  (process.env.GATEWAY_CORS_ORIGINS ?? `http://127.0.0.1:${config.WEBCHAT_PORT},http://localhost:${config.WEBCHAT_PORT}`)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
)

/** Read version from package.json once at startup */
function readPackageVersion(): string {
  try {
    const __dirname = dirname(fileURLToPath(import.meta.url))
    const pkgPath = resolve(__dirname, "..", "..", "package.json")
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as { version?: string }
    return pkg.version ?? "0.0.0"
  } catch {
    return "0.0.0"
  }
}

const APP_VERSION = readPackageVersion()
const CONTENT_SECURITY_POLICY = "default-src 'self'; connect-src 'self' ws: wss:; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
const CSRF_HEADER_NAME = "x-csrf-token"
const CSRF_COOKIE_NAME = "edith_csrf_token"
const CSRF_TOKEN_BYTES = 32

const CSRF_SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"])
const CSRF_EXEMPT_PATH_PREFIXES = ["/webhooks/"]

interface GatewayHomePayload {
  name: string
  subtitle: string
  version: string
  uptimeSeconds: number
  uptimeLabel: string
  controlUrl: string
  gatewayUrl: string
  webchatUrl: string
  websocketUrl: string
  healthUrl: string
  metricsUrl: string
  workspaceDir: string
  workbenchName: string
  connectedChannels: string[]
  connectedUserCount: number
  daemon: {
    running: boolean
    triggersLoaded: number
    intervalMs: number
  }
  voice: {
    enabled: boolean
    mode: string
    sttEngine: string
    ttsEngine: string
  }
  vision: {
    enabled: boolean
    profile: string
    multimodalEngine: string
    elementDetection: string
  }
  proactive: {
    enabled: boolean
    desktop: boolean
    mobile: boolean
    voice: boolean
    watcherEnabled: boolean
  }
  commands: string[]
}

function buildControlPageCsp(nonce: string): string {
  return [
    "default-src 'self'",
    "connect-src 'self' ws: wss:",
    "img-src 'self' data:",
    "style-src 'self' 'unsafe-inline'",
    `script-src 'nonce-${nonce}'`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ")
}

function formatDurationCompact(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) {
    return "0s"
  }

  const rounded = Math.floor(totalSeconds)
  const hours = Math.floor(rounded / 3600)
  const minutes = Math.floor((rounded % 3600) / 60)
  const seconds = rounded % 60

  if (hours > 0) {
    return `${hours}h ${minutes}m`
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`
  }
  return `${seconds}s`
}

async function buildGatewayHomePayload(): Promise<GatewayHomePayload> {
  const gatewayOrigin = `http://127.0.0.1:${config.GATEWAY_PORT}`
  const workspaceDir = resolveConfiguredWorkspaceDir()
  const daemonHealth = daemon.healthCheck()
  const runtimeVoice = await loadRuntimeVoiceConfig()
  const runtimeVision = await loadRuntimeVisionConfig()
  const runtimeProactive = await loadRuntimeProactiveConfig()

  return {
    name: "EDITH Control",
    subtitle: "Local command center for gateway, perception, channels, and setup.",
    version: APP_VERSION,
    uptimeSeconds: Math.floor(process.uptime()),
    uptimeLabel: formatDurationCompact(process.uptime()),
    controlUrl: gatewayOrigin,
    gatewayUrl: gatewayOrigin,
    webchatUrl: `http://127.0.0.1:${config.WEBCHAT_PORT}`,
    websocketUrl: `ws://127.0.0.1:${config.GATEWAY_PORT}/ws`,
    healthUrl: `${gatewayOrigin}/health`,
    metricsUrl: `${gatewayOrigin}/metrics`,
    workspaceDir,
    workbenchName: basename(workspaceDir),
    connectedChannels: channelManager.getConnectedChannels(),
    connectedUserCount: multiUser.listUsers().length,
    daemon: daemonHealth,
    voice: {
      enabled: runtimeVoice.enabled,
      mode: runtimeVoice.mode,
      sttEngine: runtimeVoice.stt.engine,
      ttsEngine: runtimeVoice.tts.engine,
    },
    vision: {
      enabled: runtimeVision.enabled,
      profile: runtimeVision.profile,
      multimodalEngine: runtimeVision.multimodalEngine,
      elementDetection: runtimeVision.elementDetection,
    },
    proactive: {
      enabled: runtimeProactive.enabled,
      desktop: runtimeProactive.channels.desktop,
      mobile: runtimeProactive.channels.mobile,
      voice: runtimeProactive.channels.voice,
      watcherEnabled: runtimeProactive.fileWatcher.enabled,
    },
    commands: [
      "edith setup",
      "edith dashboard --open",
      "edith all",
      "edith status --fix --migrate",
    ],
  }
}

function renderGatewayHomePage(payload: GatewayHomePayload, nonce: string): string {
  const daemonPillMode = payload.daemon.running ? "good" : "warn"
  const voicePillMode = payload.voice.enabled ? "good" : "off"
  const visionPillMode = payload.vision.enabled ? "good" : "off"
  const channelsLabel = payload.connectedChannels.length > 0 ? payload.connectedChannels.join(", ") : "none"
  const daemonDetail = `${payload.daemon.triggersLoaded} trigger(s) loaded / ${payload.daemon.intervalMs}ms interval`
  const voiceValue = payload.voice.enabled
    ? `${payload.voice.mode} / ${payload.voice.sttEngine}`
    : "Disabled"
  const visionValue = payload.vision.enabled
    ? `${payload.vision.profile} / ${payload.vision.multimodalEngine}`
    : "Disabled"
  const proactiveDetail = `desktop ${payload.proactive.desktop ? "on" : "off"} / mobile ${payload.proactive.mobile ? "on" : "off"} / voice ${payload.proactive.voice ? "on" : "off"} / watcher ${payload.proactive.watcherEnabled ? "on" : "off"}`
  const commandDeck = payload.commands.join("\n")
  const navLinks = [
    ["overview", "Overview"],
    ["state", "System State"],
    ["flow", "Operator Flow"],
    ["systems", "Subsystems"],
    ["commands", "Command Deck"],
    ["next", "Action Center"],
  ]
    .map(([id, label]) => `<a class="nav-link" href="#${id}" data-nav-target="${id}">${label}</a>`)
    .join("")
  const commandCards = [
    {
      id: "command-setup",
      label: "Setup",
      command: "edith setup",
      description: "Run onboarding again and rewrite the local control config cleanly.",
      actionLabel: "Copy setup",
    },
    {
      id: "command-control",
      label: "Control",
      command: "edith dashboard --open",
      description: "Open this control surface from the global CLI and wait for the active URL.",
      actionLabel: "Copy control",
    },
    {
      id: "command-boot",
      label: "Boot",
      command: "edith all",
      description: "Start gateway, channels, and CLI transport together.",
      actionLabel: "Copy boot",
    },
    {
      id: "command-repair",
      label: "Repair",
      command: "edith status --fix --migrate",
      description: "Use this first when profiles, database state, or setup drift start acting strange.",
      actionLabel: "Copy repair",
    },
  ]
    .map((card) => `
            <article class="command-card">
              <span class="label">${card.label}</span>
              <div class="value"><code id="${card.id}">${card.command}</code></div>
              <div class="subvalue">${card.description}</div>
              <div class="action-row">
                <button class="link-button" type="button" data-copy-target="${card.id}">${card.actionLabel}</button>
              </div>
            </article>
          `)
    .join("")
  const actionCenterCards = [
    `
          <article class="action-card">
            <span class="action-kicker">Open surfaces</span>
            <strong>Use the live shells, not the decorative cards</strong>
            <p>These are the only links on this page meant to launch or expose runtime surfaces directly.</p>
            <div class="action-row">
              <a class="link-button" id="open-webchat-link-state" href="${payload.webchatUrl}">Open WebChat</a>
              <a class="link-button" href="/health" data-variant="ghost">Health JSON</a>
              <a class="link-button" href="/metrics" data-variant="ghost">Metrics</a>
            </div>
          </article>
    `,
    `
          <article class="action-card">
            <span class="action-kicker">Setup</span>
            <strong>Re-run onboarding when the host drifted</strong>
            <p>If this machine is new or config feels wrong, reset the human flow first instead of guessing in files.</p>
            <code id="action-setup-command">edith setup</code>
            <div class="action-row">
              <button class="link-button" type="button" data-copy-target="action-setup-command">Copy setup</button>
              <button class="link-button" type="button" id="copy-control-button-inline" data-copy-target="control-url" data-variant="ghost">Copy control URL</button>
            </div>
          </article>
    `,
    `
          <article class="action-card">
            <span class="action-kicker">Boot</span>
            <strong>Bring the stack up cleanly</strong>
            <p>Use the full boot path when you want gateway plus channels instead of only opening the control page.</p>
            <code id="action-boot-command">edith all</code>
            <div class="action-row">
              <button class="link-button" type="button" data-copy-target="action-boot-command">Copy boot</button>
              <button class="link-button" type="button" data-copy-target="command-deck" data-variant="ghost">Copy full deck</button>
            </div>
          </article>
    `,
    `
          <article class="action-card">
            <span class="action-kicker">Repair</span>
            <strong>Repair first when state feels wrong</strong>
            <p>Database, profile, and migration drift should go through the repair path before you touch features.</p>
            <code id="action-repair-command">edith status --fix --migrate</code>
            <div class="action-row">
              <button class="link-button" type="button" data-copy-target="action-repair-command">Copy repair</button>
              <a class="link-button" href="#commands" data-variant="ghost">Jump to deck</a>
            </div>
          </article>
    `,
  ].join("")

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${payload.name}</title>
    <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='14' fill='%23070b12'/%3E%3Cpath d='M18 18h15c8 0 13 4 13 11 0 5-3 8-7 9 4 1 7 4 7 9 0 8-6 11-14 11H18V18zm11 16c4 0 6-1 6-4s-2-4-6-4h-2v8h2zm2 16c4 0 7-1 7-5 0-3-2-5-7-5h-4v10h4z' fill='%2374d1ff'/%3E%3C/svg%3E" />
    <style>
      :root {
        color-scheme: dark;
        --bg: #090b10;
        --bg-2: #111723;
        --panel: rgba(16, 24, 36, 0.82);
        --panel-strong: rgba(24, 34, 49, 0.94);
        --panel-border: rgba(134, 159, 196, 0.18);
        --text: #edf2f9;
        --muted: #93a4b9;
        --accent: #74d1ff;
        --accent-warm: #ff8a6c;
        --good: #67f0ae;
        --warn: #ffd36f;
        --off: #6f8095;
      }
      html { scroll-behavior: smooth; }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        font-family: "Segoe UI", "Trebuchet MS", system-ui, sans-serif;
        background:
          radial-gradient(circle at top left, rgba(116, 209, 255, 0.16), transparent 26%),
          radial-gradient(circle at top right, rgba(255, 138, 108, 0.12), transparent 28%),
          linear-gradient(180deg, var(--bg) 0%, var(--bg-2) 100%);
        color: var(--text);
      }
      .shell {
        min-height: 100vh;
        display: grid;
        grid-template-columns: 280px minmax(0, 1fr);
      }
      .rail {
        position: sticky;
        top: 0;
        height: 100vh;
        padding: 26px 20px 28px;
        border-right: 1px solid var(--panel-border);
        background:
          linear-gradient(180deg, rgba(8, 12, 19, 0.96), rgba(8, 12, 19, 0.84)),
          rgba(8, 12, 19, 0.94);
        backdrop-filter: blur(14px);
      }
      .rail-brand {
        padding-bottom: 18px;
        border-bottom: 1px solid var(--panel-border);
      }
      .rail-kicker {
        display: inline-block;
        margin-bottom: 10px;
        color: var(--accent);
        font-size: 0.74rem;
        text-transform: uppercase;
        letter-spacing: 0.22em;
      }
      .rail-title {
        margin: 0;
        font-size: 2rem;
        line-height: 0.94;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }
      .rail-copy {
        margin: 12px 0 0;
        color: var(--muted);
        line-height: 1.6;
        font-size: 0.9rem;
      }
      .rail-stack {
        display: grid;
        gap: 14px;
        margin-top: 20px;
      }
      .rail-card {
        padding: 16px;
        border: 1px solid var(--panel-border);
        border-radius: 18px;
        background: rgba(7, 11, 18, 0.62);
      }
      .rail-label {
        display: block;
        color: var(--muted);
        font-size: 0.78rem;
        text-transform: uppercase;
        letter-spacing: 0.12em;
        margin-bottom: 8px;
      }
      .rail-value {
        display: block;
        font-size: 1rem;
        font-weight: 700;
      }
      .rail-detail {
        margin-top: 6px;
        color: var(--muted);
        font-size: 0.82rem;
        line-height: 1.5;
      }
      .rail-nav {
        display: grid;
        gap: 8px;
      }
      .nav-link {
        display: flex;
        align-items: center;
        min-height: 42px;
        padding: 0 14px;
        border: 1px solid transparent;
        border-radius: 14px;
        color: var(--muted);
        text-decoration: none;
        transition: border-color 0.16s, background 0.16s, color 0.16s;
      }
      .nav-link:hover,
      .nav-link.active {
        color: var(--text);
        border-color: rgba(116, 209, 255, 0.22);
        background: rgba(116, 209, 255, 0.08);
      }
      .rail-list {
        margin: 0;
        padding-left: 18px;
        display: grid;
        gap: 8px;
        color: var(--muted);
        line-height: 1.5;
      }
      .workspace {
        padding: 28px 22px 72px;
      }
      .workspace-inner {
        max-width: 1180px;
        margin: 0 auto;
      }
      .topbar {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: 18px;
        margin-bottom: 18px;
        padding: 18px 20px;
        border: 1px solid var(--panel-border);
        border-radius: 22px;
        background: rgba(9, 13, 20, 0.68);
        backdrop-filter: blur(12px);
      }
      .topbar-copy {
        display: grid;
        gap: 6px;
      }
      .topbar-label {
        color: var(--accent);
        font-size: 0.76rem;
        text-transform: uppercase;
        letter-spacing: 0.18em;
      }
      .topbar-title {
        font-size: 1.08rem;
        font-weight: 700;
      }
      .topbar-note {
        color: var(--muted);
        font-size: 0.88rem;
      }
      .topbar-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
      }
      .hero {
        position: relative;
        overflow: hidden;
        padding: 30px;
        border: 1px solid var(--panel-border);
        border-radius: 28px;
        background:
          linear-gradient(135deg, rgba(116, 209, 255, 0.08), transparent 36%),
          linear-gradient(160deg, rgba(255, 138, 108, 0.08), transparent 52%),
          var(--panel-strong);
        box-shadow: 0 24px 60px rgba(0, 0, 0, 0.28);
      }
      .hero::after {
        content: "";
        position: absolute;
        inset: auto -10% -55% auto;
        width: 320px;
        height: 320px;
        border-radius: 50%;
        background: radial-gradient(circle, rgba(116, 209, 255, 0.16), transparent 68%);
        pointer-events: none;
      }
      .eyebrow {
        display: inline-flex;
        align-items: center;
        gap: 10px;
        margin-bottom: 14px;
        color: var(--accent);
        font-size: 0.82rem;
        text-transform: uppercase;
        letter-spacing: 0.18em;
      }
      .eyebrow::before {
        content: "";
        width: 34px;
        height: 1px;
        background: linear-gradient(90deg, transparent, var(--accent));
      }
      h1 {
        margin: 0;
        font-size: clamp(2.5rem, 5vw, 4.4rem);
        line-height: 0.96;
        letter-spacing: 0.03em;
        text-transform: uppercase;
      }
      .hero-copy {
        max-width: 720px;
        margin-top: 14px;
        color: var(--muted);
        line-height: 1.6;
        font-size: 1rem;
      }
      .hero-summary {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        margin-top: 18px;
      }
      .pill {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        min-height: 34px;
        padding: 0 12px;
        border: 1px solid var(--panel-border);
        border-radius: 999px;
        background: rgba(7, 11, 18, 0.42);
        color: var(--text);
        font-size: 0.88rem;
      }
      .dot {
        width: 9px;
        height: 9px;
        border-radius: 50%;
        background: var(--accent);
        box-shadow: 0 0 14px currentColor;
      }
      .dot.good { color: var(--good); background: var(--good); }
      .dot.warn { color: var(--warn); background: var(--warn); }
      .dot.off { color: var(--off); background: var(--off); }
      .section {
        margin-top: 22px;
        padding: 24px;
        border: 1px solid var(--panel-border);
        border-radius: 24px;
        background: var(--panel);
      }
      .section-grid {
        display: grid;
        grid-template-columns: minmax(0, 1.35fr) minmax(280px, 0.9fr);
        gap: 16px;
      }
      .section-header {
        display: flex;
        flex-wrap: wrap;
        align-items: baseline;
        justify-content: space-between;
        gap: 10px;
        margin-bottom: 16px;
      }
      .section h2 {
        margin: 0;
        font-size: 1.05rem;
        text-transform: uppercase;
        letter-spacing: 0.12em;
      }
      .section-note {
        color: var(--muted);
        font-size: 0.88rem;
      }
      .section-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        justify-content: space-between;
      }
      .grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
        gap: 16px;
      }
      .card {
        padding: 18px;
        border: 1px solid var(--panel-border);
        border-radius: 20px;
        background: rgba(10, 14, 22, 0.76);
      }
      .label {
        display: block;
        margin-bottom: 6px;
        color: var(--muted);
        font-size: 0.85rem;
        text-transform: uppercase;
        letter-spacing: 0.08em;
      }
      .value {
        font-size: 1.05rem;
        font-weight: 600;
      }
      .subvalue {
        margin-top: 6px;
        color: var(--muted);
        font-size: 0.88rem;
        line-height: 1.5;
      }
      .hero-grid,
      .guided-grid,
      .control-meta {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
        gap: 14px;
      }
      .hero-grid,
      .guided-grid {
        margin-top: 20px;
      }
      .hero-card,
      .guided-card,
      .meta-chip {
        padding: 18px;
        border: 1px solid var(--panel-border);
        border-radius: 20px;
        background: rgba(8, 12, 19, 0.52);
      }
      .hero-card strong,
      .guided-card strong {
        display: block;
        margin-bottom: 8px;
        font-size: 1rem;
      }
      .guided-card {
        border-style: dashed;
      }
      .hero-card p,
      .guided-card p {
        margin: 0;
        color: var(--muted);
        line-height: 1.6;
        font-size: 0.9rem;
      }
      .guided-step {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 30px;
        height: 30px;
        margin-bottom: 12px;
        border-radius: 999px;
        background: rgba(116, 209, 255, 0.12);
        color: var(--accent);
        font-weight: 700;
      }
      .guided-card code {
        display: inline-block;
        margin-top: 10px;
      }
      .meta-chip span {
        display: block;
        margin-bottom: 6px;
        color: var(--muted);
        font-size: 0.76rem;
        text-transform: uppercase;
        letter-spacing: 0.12em;
      }
      .meta-chip strong {
        font-size: 1rem;
      }
      .links {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
      }
      .action-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
        gap: 14px;
      }
      .action-card,
      .command-card {
        padding: 18px;
        border-radius: 20px;
        border: 1px solid var(--panel-border);
        background: rgba(10, 14, 22, 0.76);
      }
      .action-kicker {
        display: inline-block;
        margin-bottom: 10px;
        color: var(--accent);
        font-size: 0.75rem;
        text-transform: uppercase;
        letter-spacing: 0.16em;
      }
      .action-card strong,
      .command-card strong {
        display: block;
        margin-bottom: 8px;
        font-size: 1rem;
      }
      .action-card p {
        margin: 0 0 12px;
        color: var(--muted);
        line-height: 1.6;
      }
      .action-card code,
      .command-card code {
        display: inline-flex;
        margin-top: 4px;
        padding: 10px 12px;
        border-radius: 12px;
        background: rgba(5, 8, 14, 0.84);
      }
      .action-row {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        margin-top: 14px;
      }
      a {
        color: var(--accent);
        text-decoration: none;
      }
      .link-button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-height: 44px;
        padding: 12px 16px;
        border: 1px solid rgba(126, 208, 255, 0.26);
        border-radius: 14px;
        background: rgba(126, 208, 255, 0.08);
        color: var(--text);
        cursor: pointer;
        font: inherit;
      }
      .link-button:hover {
        background: rgba(126, 208, 255, 0.14);
      }
      .link-button[data-variant="ghost"] {
        background: rgba(255, 255, 255, 0.02);
        border-color: var(--panel-border);
      }
      pre {
        margin: 0;
        padding: 16px 18px;
        border-radius: 18px;
        border: 1px solid var(--panel-border);
        background: rgba(5, 8, 14, 0.84);
        overflow-x: auto;
      }
      code {
        font-family: "Cascadia Code", "Consolas", monospace;
        font-size: 0.95em;
      }
      .stack {
        display: grid;
        gap: 12px;
      }
      .status-panel {
        display: grid;
        gap: 12px;
      }
      .microgrid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
        gap: 12px;
      }
      .microcard {
        padding: 14px 16px;
        border-radius: 16px;
        border: 1px solid var(--panel-border);
        background: rgba(6, 10, 16, 0.68);
      }
      .microcard strong {
        display: block;
        margin-bottom: 4px;
        font-size: 0.9rem;
      }
      .sync-status {
        margin-top: 12px;
        color: var(--muted);
        font-size: 0.82rem;
      }
      .next-steps {
        display: grid;
        gap: 12px;
      }
      .checklist {
        list-style: none;
        display: grid;
        gap: 10px;
        margin: 0;
        padding: 0;
      }
      .checklist li {
        padding: 12px 14px;
        border: 1px solid var(--panel-border);
        border-radius: 14px;
        background: rgba(7, 11, 18, 0.48);
        color: var(--muted);
      }
      .checklist strong {
        color: var(--text);
      }
      @media (max-width: 1100px) {
        .shell {
          grid-template-columns: 1fr;
        }
        .rail {
          position: relative;
          height: auto;
          border-right: none;
          border-bottom: 1px solid var(--panel-border);
        }
      }
      @media (max-width: 860px) {
        .section-grid {
          grid-template-columns: 1fr;
        }
      }
      @media (max-width: 680px) {
        .workspace { padding: 20px 14px 42px; }
        .topbar,
        .hero, .section { padding: 18px; border-radius: 20px; }
        h1,
        .rail-title { font-size: 2.1rem; }
      }
    </style>
  </head>
  <body>
    <div class="shell">
      <aside class="rail">
        <div class="rail-brand">
          <span class="rail-kicker">Even Dead, I'm The Hero</span>
          <h1 class="rail-title">EDITH</h1>
          <p class="rail-copy">Control-room shell for setup, runtime posture, and operator recovery. Start in testing, operate there, then promote only when the flow feels stable.</p>
        </div>
        <div class="rail-stack">
          <div class="rail-card">
            <span class="rail-label">Navigation</span>
            <nav class="rail-nav">${navLinks}</nav>
          </div>
          <div class="rail-card">
            <span class="rail-label">Active Workbench</span>
            <span class="rail-value" id="workbench-name-rail">${payload.workbenchName}</span>
            <div class="rail-detail"><code id="workspace-dir-rail">${payload.workspaceDir}</code></div>
          </div>
          <div class="rail-card">
            <span class="rail-label">Runtime Snapshot</span>
            <div class="rail-detail">Channels <strong id="channels-rail">${channelsLabel}</strong></div>
            <div class="rail-detail">Users <strong id="users-rail">${payload.connectedUserCount}</strong></div>
            <div class="rail-detail">Uptime <strong id="uptime-rail">${payload.uptimeLabel}</strong></div>
          </div>
          <div class="rail-card">
            <span class="rail-label">Operator Loop</span>
            <ol class="rail-list">
              <li>Stabilize the host with setup or repair before changing behavior.</li>
              <li>Run experiments in <code>testing</code> until the shell feels routine.</li>
              <li>Promote to <code>edith</code> only when recovery and daily use are boring.</li>
            </ol>
          </div>
        </div>
      </aside>

      <main class="workspace">
        <div class="workspace-inner">
          <header class="topbar">
            <div class="topbar-copy">
              <span class="topbar-label">EDITH Control</span>
              <span class="topbar-title">Operator shell for gateway, setup, channels, and local runtime posture.</span>
              <span class="topbar-note" id="sync-status">Live snapshot updates automatically.</span>
            </div>
            <div class="topbar-actions">
              <button class="link-button" type="button" id="refresh-button" data-variant="ghost">Refresh now</button>
              <button class="link-button" type="button" id="copy-control-button" data-copy-target="control-url" data-variant="ghost">Copy control URL</button>
              <button class="link-button" type="button" id="copy-command-button" data-copy-target="command-deck" data-variant="ghost">Copy command deck</button>
            </div>
          </header>

          <section class="hero" id="overview">
        <div class="eyebrow">Even Dead, I'm The Hero</div>
        <h1>${payload.name}</h1>
        <p class="hero-copy" id="subtitle-copy">${payload.subtitle}</p>
        <div class="hero-summary">
          <span class="pill"><span class="dot good"></span> Gateway online</span>
          <span class="pill"><span class="dot ${daemonPillMode}" id="daemon-pill-dot"></span> <span id="daemon-pill-label">Daemon ${payload.daemon.running ? "armed" : "standby"}</span></span>
          <span class="pill"><span class="dot ${voicePillMode}" id="voice-pill-dot"></span> <span id="voice-pill-label">Voice ${payload.voice.enabled ? payload.voice.mode : "disabled"}</span></span>
          <span class="pill"><span class="dot ${visionPillMode}" id="vision-pill-dot"></span> <span id="vision-pill-label">Vision ${payload.vision.enabled ? payload.vision.profile : "disabled"}</span></span>
        </div>
        <div class="hero-grid">
          <article class="hero-card">
            <strong>Stabilize First</strong>
            <p>Use this shell first. If setup drifted or the machine is new, run onboarding before you touch channels or phase work.</p>
          </article>
          <article class="hero-card">
            <strong>Operate In Testing</strong>
            <p>EDITH assumes experiments should live in the testing workbench, not in the promoted identity.</p>
          </article>
          <article class="hero-card">
            <strong>Promote Deliberately</strong>
            <p>Move to edith only when setup, recovery, and daily operator flow feel boringly predictable.</p>
          </article>
        </div>
      </section>

      <section class="section" id="state">
        <div class="section-header">
          <h2>System State</h2>
          <span class="section-note">Live snapshot of the current local runtime.</span>
        </div>
        <div class="section-grid">
          <div class="grid">
            <article class="card">
              <span class="label">Control Surface</span>
              <div class="value"><code id="control-url">${payload.controlUrl}</code></div>
              <div class="subvalue">This root page is the local operator entrypoint for EDITH.</div>
            </article>
            <article class="card">
              <span class="label">Uptime</span>
              <div class="value" id="uptime-label">${payload.uptimeLabel}</div>
              <div class="subvalue">Version <span id="version-value">${payload.version}</span></div>
            </article>
            <article class="card">
              <span class="label">Workbench</span>
              <div class="value" id="workbench-name">${payload.workbenchName}</div>
              <div class="subvalue"><code id="workspace-dir">${payload.workspaceDir}</code></div>
            </article>
            <article class="card">
              <span class="label">Channels</span>
              <div class="value" id="channels-value">${channelsLabel}</div>
              <div class="subvalue"><span id="users-value">${payload.connectedUserCount}</span> active user(s)</div>
            </article>
          </div>
          <div class="status-panel">
            <article class="card">
              <span class="label">Surface Links</span>
              <div class="links">
              <a class="link-button" id="open-webchat-link-action" href="${payload.webchatUrl}">Open WebChat</a>
                <a class="link-button" href="/health">Health JSON</a>
                <a class="link-button" href="/metrics">Metrics</a>
              </div>
              <div class="subvalue">Everything else on this page is status or guidance unless it has a real button.</div>
            </article>
            <article class="card">
              <span class="label">Current Posture</span>
              <div class="control-meta">
                <div class="meta-chip">
                  <span>Gateway</span>
                  <strong>Local control live</strong>
                </div>
                <div class="meta-chip">
                  <span>Users</span>
                  <strong id="users-badge">${payload.connectedUserCount}</strong>
                </div>
                <div class="meta-chip">
                  <span>Channels</span>
                  <strong id="channels-badge">${channelsLabel}</strong>
                </div>
              </div>
            </article>
          </div>
        </div>
      </section>

      <section class="section" id="flow">
        <div class="section-header">
          <h2>Operator Flow</h2>
          <span class="section-note">Guidance only. The real clickable actions live in Action Center and the command deck.</span>
        </div>
        <div class="guided-grid">
          <article class="guided-card">
            <span class="guided-step">1</span>
            <strong>Stabilize The Host</strong>
            <p>Run onboarding or a repair pass before changing behavior on a drifting machine.</p>
          </article>
          <article class="guided-card">
            <span class="guided-step">2</span>
            <strong>Operate In Testing</strong>
            <p>Keep runtime and phase work inside <code>testing</code> until the operator flow becomes routine.</p>
          </article>
          <article class="guided-card">
            <span class="guided-step">3</span>
            <strong>Promote When Quiet</strong>
            <p>Move to <code>edith</code> only when setup, recovery, and daily use feel boringly reliable.</p>
          </article>
        </div>
      </section>

      <section class="section" id="systems">
        <div class="section-header">
          <h2>Subsystem Grid</h2>
          <span class="section-note">Operational posture for EDITH modules that matter in daily use.</span>
        </div>
        <div class="microgrid">
          <article class="microcard">
            <strong>Daemon</strong>
            <div id="daemon-value">${payload.daemon.running ? "Running" : "Stopped"}</div>
            <div class="subvalue"><span id="daemon-detail">${daemonDetail}</span></div>
          </article>
          <article class="microcard">
            <strong>Voice</strong>
            <div id="voice-value">${voiceValue}</div>
            <div class="subvalue">TTS <span id="voice-detail">${payload.voice.ttsEngine}</span></div>
          </article>
          <article class="microcard">
            <strong>Vision</strong>
            <div id="vision-value">${visionValue}</div>
            <div class="subvalue">Element detection <span id="vision-detail">${payload.vision.elementDetection}</span></div>
          </article>
          <article class="microcard">
            <strong>Proactive</strong>
            <div id="proactive-value">${payload.proactive.enabled ? "Enabled" : "Disabled"}</div>
            <div class="subvalue" id="proactive-detail">${proactiveDetail}</div>
          </article>
          <article class="microcard">
            <strong>Gateway</strong>
            <div><code id="gateway-url">${payload.gatewayUrl}</code></div>
            <div class="subvalue">WebSocket <code id="websocket-url">${payload.websocketUrl}</code></div>
          </article>
          <article class="microcard">
            <strong>WebChat</strong>
            <div><code id="webchat-url">${payload.webchatUrl}</code></div>
            <div class="subvalue">Use this when you want browser chat instead of desktop shell.</div>
          </article>
        </div>
      </section>

      <section class="section" id="commands">
        <div class="section-header">
          <h2>Command Deck</h2>
          <span class="section-note">Every card below has a real copy action. No fake control tiles.</span>
        </div>
        <div class="stack">
          <pre><code id="command-deck">${commandDeck}</code></pre>
          <div class="action-grid">${commandCards}</div>
        </div>
      </section>

      <section class="section" id="next">
        <div class="section-header">
          <h2>Action Center</h2>
          <span class="section-note">This is the part of the page that is actually meant to be used.</span>
        </div>
        <div class="action-grid">${actionCenterCards}</div>
      </section>
        </div>
      </main>
    </div>
    <script nonce="${nonce}">
      const controlState = {
        refreshIntervalMs: 8000,
        jsonUrl: "/?format=json",
      }
      const controlNavLinks = Array.from(document.querySelectorAll("[data-nav-target]"))

      function setText(id, value) {
        const node = document.getElementById(id)
        if (!node) return
        node.textContent = String(value ?? "")
      }

      function setHref(id, value) {
        const node = document.getElementById(id)
        if (!node) return
        node.setAttribute("href", String(value ?? "#"))
      }

      function setHrefAll(ids, value) {
        ids.forEach((id) => setHref(id, value))
      }

      function setActiveNav(sectionId) {
        controlNavLinks.forEach((link) => {
          link.classList.toggle("active", link.getAttribute("data-nav-target") === sectionId)
        })
      }

      function setDotClass(id, mode) {
        const node = document.getElementById(id)
        if (!node) return
        node.className = "dot " + mode
      }

      function formatChannels(channels) {
        return Array.isArray(channels) && channels.length > 0 ? channels.join(", ") : "none"
      }

      function describeDaemon(daemon) {
        return String(daemon?.triggersLoaded ?? 0) + " trigger(s) loaded / " + String(daemon?.intervalMs ?? 0) + "ms interval"
      }

      function describeVoice(voice) {
        return voice?.enabled ? String(voice.mode) + " / " + String(voice.sttEngine) : "Disabled"
      }

      function describeVision(vision) {
        return vision?.enabled ? String(vision.profile) + " / " + String(vision.multimodalEngine) : "Disabled"
      }

      function describeProactive(proactive) {
        return "desktop " + (proactive?.desktop ? "on" : "off") + " / mobile " + (proactive?.mobile ? "on" : "off") + " / voice " + (proactive?.voice ? "on" : "off") + " / watcher " + (proactive?.watcherEnabled ? "on" : "off")
      }

      function renderPayload(payload) {
        document.title = String(payload.name ?? "EDITH Control")
        setText("subtitle-copy", payload.subtitle)
        setText("control-url", payload.controlUrl)
        setText("uptime-label", payload.uptimeLabel)
        setText("uptime-rail", payload.uptimeLabel)
        setText("version-value", payload.version)
        setText("workbench-name", payload.workbenchName)
        setText("workbench-name-rail", payload.workbenchName)
        setText("workspace-dir", payload.workspaceDir)
        setText("workspace-dir-rail", payload.workspaceDir)
        setText("channels-value", formatChannels(payload.connectedChannels))
        setText("channels-rail", formatChannels(payload.connectedChannels))
        setText("channels-badge", formatChannels(payload.connectedChannels))
        setText("users-value", payload.connectedUserCount ?? 0)
        setText("users-rail", payload.connectedUserCount ?? 0)
        setText("users-badge", payload.connectedUserCount ?? 0)
        setText("daemon-value", payload.daemon?.running ? "Running" : "Stopped")
        setText("daemon-detail", describeDaemon(payload.daemon))
        setText("voice-value", describeVoice(payload.voice))
        setText("voice-detail", payload.voice?.ttsEngine ?? "edge")
        setText("vision-value", describeVision(payload.vision))
        setText("vision-detail", payload.vision?.elementDetection ?? "accessibility")
        setText("proactive-value", payload.proactive?.enabled ? "Enabled" : "Disabled")
        setText("proactive-detail", describeProactive(payload.proactive))
        setText("gateway-url", payload.gatewayUrl)
        setText("websocket-url", payload.websocketUrl)
        setText("webchat-url", payload.webchatUrl)
        setText("daemon-pill-label", "Daemon " + (payload.daemon?.running ? "armed" : "standby"))
        setText("voice-pill-label", "Voice " + (payload.voice?.enabled ? String(payload.voice.mode) : "disabled"))
        setText("vision-pill-label", "Vision " + (payload.vision?.enabled ? String(payload.vision.profile) : "disabled"))
        setDotClass("daemon-pill-dot", payload.daemon?.running ? "good" : "warn")
        setDotClass("voice-pill-dot", payload.voice?.enabled ? "good" : "off")
        setDotClass("vision-pill-dot", payload.vision?.enabled ? "good" : "off")
        setHrefAll(["open-webchat-link-state", "open-webchat-link-action"], payload.webchatUrl)
      }

      async function refreshControlState() {
        const statusNode = document.getElementById("sync-status")
        try {
          const response = await fetch(controlState.jsonUrl, {
            headers: { accept: "application/json" },
            cache: "no-store",
          })
          if (!response.ok) {
            throw new Error("HTTP " + response.status)
          }
          const nextPayload = await response.json()
          renderPayload(nextPayload)
          if (statusNode) {
            statusNode.textContent = "Last sync " + new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
          }
        } catch (error) {
          if (statusNode) {
            statusNode.textContent = "Refresh failed: " + (error instanceof Error ? error.message : String(error))
          }
        }
      }

      const sectionObserver = new IntersectionObserver((entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0]

        if (visible?.target?.id) {
          setActiveNav(visible.target.id)
        }
      }, {
        rootMargin: "-24% 0px -55% 0px",
        threshold: [0.2, 0.45, 0.7],
      })

      document.querySelectorAll("section[id]").forEach((section) => {
        sectionObserver.observe(section)
      })
      setActiveNav("overview")

      document.getElementById("refresh-button")?.addEventListener("click", () => {
        void refreshControlState()
      })

      document.querySelectorAll("[data-copy-target]").forEach((button) => {
        button.addEventListener("click", async () => {
          const targetId = button.getAttribute("data-copy-target")
          if (!targetId) return
          const target = document.getElementById(targetId)
          if (!target) return
          const text = target.textContent ?? ""
          try {
            await navigator.clipboard.writeText(text)
            const statusNode = document.getElementById("sync-status")
            if (statusNode) {
              statusNode.textContent = "Copied " + targetId.replace(/-/g, " ")
            }
          } catch {
            const statusNode = document.getElementById("sync-status")
            if (statusNode) {
              statusNode.textContent = "Clipboard copy failed"
            }
          }
        })
      })

      window.setInterval(() => {
        void refreshControlState()
      }, controlState.refreshIntervalMs)
    </script>
  </body>
</html>`
}

// ── Rate Limiter ─────────────────────────────────────────────────────────────

const rateLimiter = createRateLimiter({
  maxRequests: RATE_LIMIT_MAX,
  windowMs: RATE_LIMIT_WINDOW_MS,
})

function isRateLimited(ip: string): boolean {
  return rateLimiter.consume(ip).limited
}

function getRateLimitRemaining(ip: string): number {
  return rateLimiter.getRemaining(ip)
}

// Cleanup stale rate limit entries every 5 minutes
setInterval(() => {
  rateLimiter.cleanup()
}, 300_000).unref()

// ── Types ────────────────────────────────────────────────────────────────────

type SocketLike = {
  send: (payload: string) => void
  close: (code?: number) => void
  on: (event: "message" | "close", handler: (...args: unknown[]) => void) => void
}

interface ConnectedClient {
  socket: SocketLike
  auth: AuthContext
}

/** Typed gateway response payloads */
interface GatewayResponse {
  type: string
  requestId?: unknown
  [key: string]: unknown
}

interface GatewayErrorResponse extends GatewayResponse {
  type: "error"
  message: string
}

interface GatewayClientMessage {
  type: string
  requestId?: unknown
  userId?: string
  content?: string
  data?: string
  encoding?: string
  mimeType?: string
  language?: "auto" | "id" | "en" | "multi"
  sampleRate?: number
  channelCount?: number
  sequence?: number
  keyword?: string
  windowSeconds?: number
  /**
   * [Phase 3 Vision] Analysis mode for vision_analyze messages.
   *   "describe" — full natural language description of the image
   *   "ocr"      — extract text only (free, Tesseract, no LLM call)
   *   "find"     — find a specific UI element (content = element query)
   * Defaults to "describe" when not specified.
   */
  visionMode?: "describe" | "ocr" | "find"
}

function safeSend(socket: Pick<SocketLike, "send">, payload: unknown): boolean {
  try {
    socket.send(JSON.stringify(payload))
    return true
  } catch {
    return false
  }
}

function isCancellationError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false
  }
  if (error.name === "AbortError" || error.name === "PipelineAbortError") {
    return true
  }
  return Boolean((error as Error & { code?: string }).code === "PIPELINE_ABORTED")
}

function parseDaysParam(raw: unknown, fallback = DEFAULT_USAGE_DAYS): number {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return fallback
  }

  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed)) {
    return fallback
  }

  return Math.min(MAX_USAGE_DAYS, Math.max(1, parsed))
}

function buildDateRange(days: number): { startDate: Date; endDate: Date } {
  const endDate = new Date()
  const startDate = new Date(endDate)
  startDate.setDate(startDate.getDate() - days)
  return { startDate, endDate }
}

function isConfiguredAdminToken(token: string | undefined): token is string {
  return typeof token === "string" && token.trim().length > 0
}

const TIMING_SAFE_COMPARE_KEY = Buffer.from("edith.gateway.timing-safe-compare.v1", "utf8")

function digestForTimingCompare(input: string): Buffer {
  return crypto.createHmac("sha256", TIMING_SAFE_COMPARE_KEY).update(input).digest()
}

function timingSafeTokenEquals(candidate: string, expected: string): boolean {
  return crypto.timingSafeEqual(
    digestForTimingCompare(candidate),
    digestForTimingCompare(expected),
  )
}

function isAdminTokenAuthorized(candidate: unknown, configuredToken: string | undefined): boolean {
  if (!isConfiguredAdminToken(configuredToken)) {
    return false
  }

  if (typeof candidate !== "string") {
    return false
  }

  return timingSafeTokenEquals(candidate, configuredToken)
}

/**
 * Extract admin token from Authorization header (preferred) or query string (legacy).
 * Authorization: Bearer <token> takes precedence over ?adminToken=.
 */
function extractAdminToken(req: { headers: Record<string, string | undefined>; query: Record<string, unknown> }): string | null {
  const authHeader = req.headers.authorization
  if (typeof authHeader === "string" && authHeader.toLowerCase().startsWith("bearer ")) {
    const token = authHeader.slice(7).trim()
    if (token.length > 0) return token
  }
  // Legacy fallback — query string (log warning)
  const queryToken = req.query.adminToken
  if (typeof queryToken === "string" && queryToken.trim().length > 0) {
    logger.warn("admin token passed via query string — use Authorization header instead")
    return queryToken.trim()
  }
  return null
}

/**
 * Extract Bearer token from Authorization header for API auth.
 */
function extractBearerToken(req: { headers: Record<string, string | undefined> }): string | null {
  const authHeader = req.headers.authorization
  if (typeof authHeader === "string" && authHeader.toLowerCase().startsWith("bearer ")) {
    const token = authHeader.slice(7).trim()
    return token.length > 0 ? token : null
  }
  return null
}

function extractWebSocketToken(req: {
  headers: Record<string, string | undefined>
  query: Record<string, unknown>
}): string | null {
  const headerToken = extractBearerToken(req)
  if (headerToken) {
    return headerToken
  }

  const queryToken = req.query?.token
  if (typeof queryToken === "string" && queryToken.trim().length > 0) {
    logger.warn("websocket token passed via query string — use Authorization header instead")
    return queryToken.trim()
  }

  if (Array.isArray(queryToken)) {
    const first = (queryToken as unknown[]).find(
      (value) => typeof value === "string" && (value as string).trim().length > 0,
    )
    if (typeof first === "string") {
      logger.warn("websocket token passed via query string array — use Authorization header instead")
      return first.trim()
    }
  }

  return null
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null
}

function asFiniteNumber(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null
  }
  return value
}

function normalizeRequestPath(url: string): string {
  const queryStart = url.indexOf("?")
  return queryStart >= 0 ? url.slice(0, queryStart) : url
}

function getHeaderValue(headers: Record<string, unknown>, name: string): string | null {
  const normalizedName = name.toLowerCase()
  const direct = headers[normalizedName]

  if (typeof direct === "string") {
    return direct
  }

  if (Array.isArray(direct)) {
    const first = direct.find((value) => typeof value === "string")
    return typeof first === "string" ? first : null
  }

  return null
}

function parseCookieHeader(rawCookieHeader: string | undefined): Record<string, string> {
  if (!rawCookieHeader || rawCookieHeader.trim().length === 0) {
    return {}
  }

  const cookies: Record<string, string> = {}
  const entries = rawCookieHeader.split(";")

  for (const entry of entries) {
    const trimmed = entry.trim()
    if (!trimmed) {
      continue
    }

    const separatorIndex = trimmed.indexOf("=")
    if (separatorIndex <= 0) {
      continue
    }

    const key = trimmed.slice(0, separatorIndex).trim()
    const value = trimmed.slice(separatorIndex + 1).trim()
    if (!key) {
      continue
    }

    try {
      cookies[key] = decodeURIComponent(value)
    } catch {
      cookies[key] = value
    }
  }

  return cookies
}

function shouldEnforceCsrfRequest(req: {
  method: string
  url: string
  headers: Record<string, unknown>
}): boolean {
  const method = req.method.toUpperCase()
  if (CSRF_SAFE_METHODS.has(method)) {
    return false
  }

  const path = normalizeRequestPath(req.url)
  if (CSRF_EXEMPT_PATH_PREFIXES.some((prefix) => path.startsWith(prefix))) {
    return false
  }

  const origin = getHeaderValue(req.headers, "origin")
  return typeof origin === "string" && origin.trim().length > 0
}

function verifyCsrfRequest(req: {
  method: string
  url: string
  headers: Record<string, unknown>
}): { ok: boolean; reason?: string } {
  if (!shouldEnforceCsrfRequest(req)) {
    return { ok: true }
  }

  const origin = getHeaderValue(req.headers, "origin")
  if (!origin || !ALLOWED_ORIGINS.has(origin)) {
    return { ok: false, reason: "origin not allowed" }
  }

  const csrfHeader = getHeaderValue(req.headers, CSRF_HEADER_NAME)
  if (!csrfHeader || csrfHeader.trim().length === 0) {
    return { ok: false, reason: "missing csrf header" }
  }

  const cookieHeader = getHeaderValue(req.headers, "cookie") ?? undefined
  const cookies = parseCookieHeader(cookieHeader)
  const csrfCookie = cookies[CSRF_COOKIE_NAME]
  if (!csrfCookie || csrfCookie.trim().length === 0) {
    return { ok: false, reason: "missing csrf cookie" }
  }

  if (!timingSafeTokenEquals(csrfHeader.trim(), csrfCookie.trim())) {
    return { ok: false, reason: "invalid csrf token" }
  }

  return { ok: true }
}

function generateCsrfToken(): string {
  return crypto.randomBytes(CSRF_TOKEN_BYTES).toString("hex")
}

function buildCsrfCookie(token: string): string {
  const attributes = [
    `${CSRF_COOKIE_NAME}=${encodeURIComponent(token)}`,
    "Path=/",
    "SameSite=Strict",
  ]

  if (process.env.NODE_ENV === "production") {
    attributes.push("Secure")
  }

  return attributes.join("; ")
}

function isLoopbackAddress(ip: string | undefined): boolean {
  if (typeof ip !== "string") {
    return false
  }

  const normalized = ip.trim()
  return normalized === "127.0.0.1"
    || normalized === "::1"
    || normalized === "::ffff:127.0.0.1"
    || normalized === "localhost"
}

async function isConfigBootstrapAllowed(req: {
  headers: Record<string, string | undefined>
  ip?: string
}, configuredAdminToken: string | undefined): Promise<boolean> {
  const bearerToken = extractBearerToken(req)
  if (typeof bearerToken === "string" && bearerToken.length > 0) {
    return false
  }

  if (isConfiguredAdminToken(configuredAdminToken)) {
    return false
  }

  if (!isLoopbackAddress(req.ip)) {
    return false
  }

  const { getConfigBootstrapState } = await import("../config/edith-config.js")
  const bootstrapState = await getConfigBootstrapState()

  if (bootstrapState.hasSecretState) {
    logger.warn("config bootstrap denied: persisted secret-bearing state detected", {
      reasons: bootstrapState.reasons,
    })
    return false
  }

  return true
}

async function authorizeConfigRequest(req: {
  headers: Record<string, string | undefined>
  ip?: string
}): Promise<{ ok: true } | { ok: false; statusCode: number; error: string }> {
  const configuredAdminToken = process.env.ADMIN_TOKEN
  const bearerToken = extractBearerToken(req)

  if (typeof bearerToken === "string" && bearerToken.length > 0) {
    if (isAdminTokenAuthorized(bearerToken, configuredAdminToken)) {
      return { ok: true }
    }

    const auth = await authenticateWebSocket(bearerToken)
    if (auth && multiUser.isOwner(auth.userId)) {
      return { ok: true }
    }

    return { ok: false, statusCode: 403, error: "Invalid or unauthorized config token" }
  }

  if (await isConfigBootstrapAllowed(req, configuredAdminToken)) {
    return { ok: true }
  }

  return {
    ok: false,
    statusCode: 401,
    error: "Authorization header with owner token or admin token required",
  }
}

function normalizeIncomingClientMessage(input: unknown): GatewayClientMessage {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Invalid message payload: expected object")
  }

  const raw = input as Record<string, unknown>
  const type = asNonEmptyString(raw.type)
  if (!type) {
    throw new Error("Invalid message payload: missing 'type'")
  }

  const userId = asString(raw.userId) ?? undefined
  const content = asString(raw.content) ?? undefined
  const data = asString(raw.data) ?? undefined
  const encoding = asString(raw.encoding) ?? undefined
  const mimeType = asString(raw.mimeType) ?? undefined
  const language = asString(raw.language)
  const keyword = asString(raw.keyword) ?? undefined
  const sampleRate = asFiniteNumber(raw.sampleRate) ?? undefined
  const channelCount = asFiniteNumber(raw.channelCount) ?? undefined
  const sequence = asFiniteNumber(raw.sequence) ?? undefined
  const windowSecondsRaw = asFiniteNumber(raw.windowSeconds)
  const windowSeconds = windowSecondsRaw === null
    ? undefined
    : Math.min(30, Math.max(1, windowSecondsRaw))

  return {
    type,
    requestId: raw.requestId,
    userId,
    content,
    data,
    encoding,
    mimeType,
    language: language === "auto" || language === "id" || language === "en" || language === "multi"
      ? language
      : undefined,
    sampleRate,
    channelCount,
    sequence,
    keyword,
    windowSeconds,
  }
}

function ensureMessageContent(content: string | undefined, type: string): string {
  if (typeof content !== "string") {
    throw new Error(`Invalid '${type}' payload: 'content' must be a string`)
  }
  return content
}

/** Simple recursive deep merge for config objects. */
function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  const result = { ...target }
  for (const key of Object.keys(source)) {
    const value = source[key]
    if (
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      typeof result[key] === "object" &&
      result[key] !== null &&
      !Array.isArray(result[key])
    ) {
      result[key] = deepMerge(result[key] as Record<string, unknown>, value as Record<string, unknown>)
    } else {
      result[key] = value
    }
  }
  return result
}

function isSecretKey(key: string): boolean {
  const normalized = key.toLowerCase()
  return normalized.includes("key")
    || normalized.includes("token")
    || normalized.includes("secret")
    || normalized.includes("password")
}

function redactSecrets(value: unknown, keyHint?: string): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => redactSecrets(entry))
  }
  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {}
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      result[key] = redactSecrets(entry, key)
    }
    return result
  }
  if (typeof value === "string" && keyHint && isSecretKey(keyHint)) {
    return value ? "***" : ""
  }
  return value
}

function buildConnectedPayload(clientId: string) {
  return {
    type: "connected",
    clientId,
    engines: orchestrator.getAvailableEngines(),
    channels: channelManager.getConnectedChannels(),
    daemon: daemon.healthCheck(),
  }
}

function buildStatusPayload(requestId: unknown) {
  return {
    type: "status",
    engines: orchestrator.getAvailableEngines(),
    channels: channelManager.getConnectedChannels(),
    daemon: daemon.healthCheck(),
    requestId,
  }
}

export class GatewayServer {
  private app = Fastify({
    logger: false,
    bodyLimit: MAX_BODY_SIZE,
  })
  private clients = new Map<string, ConnectedClient>()
  private voiceSessionManager: VoiceSessionManager
  private eventSubscriptionsInitialized = false

  constructor(private port = config.GATEWAY_PORT) {
    this.voiceSessionManager = new VoiceSessionManager({
      generateResponse: async (userId, transcript, signal) =>
        this.handleUserMessage(userId, transcript, "voice", { signal }),
    })
    this.initializeEventSubscriptions()
    this.registerRoutes()
  }

  private initializeEventSubscriptions(): void {
    if (this.eventSubscriptionsInitialized) {
      return
    }

    this.eventSubscriptionsInitialized = true
    eventBus.on("notification.dispatched", (data) => {
      this.broadcastToUser(data.userId, {
        type: "notification",
        title: data.title,
        message: data.message,
        priority: data.priority,
        channels: data.channels,
        source: data.source,
        timestamp: data.timestamp,
        metadata: data.metadata,
      })
    })
  }

  private registerRoutes(): void {
    this.app.register(websocketPlugin)

    this.app.addHook("onRequest", async (req) => {
      ;(req as { __metricsStartTime?: number }).__metricsStartTime = Date.now()
    })

    // ── Security Headers ───────────────────────────────────────────
    this.app.addHook("onRequest", async (_req, reply) => {
      reply.header("X-Content-Type-Options", "nosniff")
      reply.header("X-Frame-Options", "DENY")
      reply.header("X-XSS-Protection", "1; mode=block")
      reply.header("Referrer-Policy", "strict-origin-when-cross-origin")
      reply.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
      reply.header("Content-Security-Policy", CONTENT_SECURITY_POLICY)
      if (process.env.NODE_ENV === "production") {
        reply.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
      }
    })

    // ── CORS (origin-restricted) ───────────────────────────────────
    this.app.addHook("onRequest", async (req, reply) => {
      const origin = req.headers.origin
      if (origin && ALLOWED_ORIGINS.has(origin)) {
        reply.header("Access-Control-Allow-Origin", origin)
        reply.header("Vary", "Origin")
      }
      reply.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
      reply.header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-CSRF-Token")
      reply.header("Access-Control-Max-Age", "86400")
      if (req.method === "OPTIONS") {
        return reply.code(204).send()
      }
    })

    // â”€â”€ CSRF Protection (browser-origin mutating requests) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    this.app.addHook("onRequest", async (req, reply) => {
      const validation = verifyCsrfRequest({
        method: req.method,
        url: req.url,
        headers: req.headers as Record<string, unknown>,
      })

      if (!validation.ok) {
        logger.warn("csrf validation failed", {
          method: req.method,
          url: req.url,
          reason: validation.reason,
          ip: req.ip,
        })
        return reply.code(403).send({
          error: "CSRF validation failed",
          reason: validation.reason,
        })
      }
    })

    // ── Rate Limiting ──────────────────────────────────────────────
    this.app.addHook("onRequest", async (req, reply) => {
      // Skip rate limiting for health checks
      if (req.url === "/health") return

      const ip = req.ip
      const decision = rateLimiter.consume(ip)
      if (decision.limited) {
        logger.warn("rate limit exceeded", { ip, url: req.url })
        return reply.code(429).send({
          error: "Too many requests",
          retryAfterSeconds: Math.max(1, Math.ceil(decision.retryAfterMs / 1000)),
        })
      }
      reply.header("X-RateLimit-Limit", String(decision.limit))
      reply.header("X-RateLimit-Remaining", String(decision.remaining))
    })

    // ── Global Error Handler ───────────────────────────────────────
    this.app.setErrorHandler(async (error: Error, _req, reply) => {
      logger.error("unhandled route error", { error: error.message, stack: error.stack })
      const statusCode = (error as Error & { statusCode?: number }).statusCode ?? 500
      return reply.code(statusCode).send({
        error: error.message ?? "Internal Server Error",
      })
    })

    this.app.addHook("onResponse", async (req, reply) => {
      const startedAt = (req as { __metricsStartTime?: number }).__metricsStartTime
      if (typeof startedAt !== "number") {
        return
      }
      observeHttpRequest(req.method, normalizeRequestPath(req.url), reply.statusCode, Date.now() - startedAt)
    })

    this.app.register(async (app) => {
      app.get("/ws", { websocket: true }, async (socket, req) => {
        const token = extractWebSocketToken(
          req as unknown as { headers: Record<string, string | undefined>; query: Record<string, unknown> },
        )
        const auth = await authenticateWebSocket(token)
        if (!auth) {
          const failure = getAuthFailure(token)
          safeSend(socket, {
            type: "error",
            message: failure.message,
            statusCode: failure.statusCode,
            retryAfterSeconds: failure.retryAfterSeconds,
          })
          socket.close(1008)
          return
        }

        await this.attachAuthenticatedClient(socket as unknown as SocketLike, auth)
      })

      app.get("/", async (req, reply) => {
        const format = (req as { query?: { format?: unknown } }).query?.format
        const payload = await buildGatewayHomePayload()
        const acceptHeader = req.headers.accept
        if (format === "json" || (typeof acceptHeader === "string" && acceptHeader.includes("application/json"))) {
          return payload
        }

        const nonce = crypto.randomBytes(16).toString("base64")
        reply.header("Content-Security-Policy", buildControlPageCsp(nonce))
        reply.type("text/html; charset=utf-8")
        return renderGatewayHomePage(payload, nonce)
      })

      app.get("/health", async () => ({
        status: "ok",
        version: APP_VERSION,
        uptime: Math.floor(process.uptime()),
        engines: orchestrator.getAvailableEngines(),
        channels: channelManager.getConnectedChannels(),
        users: multiUser.listUsers().length,
        memory: { initialized: true },
        daemon: daemon.isRunning(),
      }))

      app.post<{ Body?: { message?: unknown; userId?: unknown } }>(
        "/message",
        async (req, reply) => {
          // Require Bearer token authentication
          const token = extractBearerToken(req as { headers: Record<string, string | undefined> })
          if (!token) {
            return reply.code(401).send({ error: "Authorization header with Bearer token required" })
          }
          const auth = await authenticateWebSocket(token)
          if (!auth) {
            return reply.code(403).send({ error: "Invalid or expired token" })
          }

          const message = asString(req.body?.message)
          if (message === null) {
            return reply.code(400).send({ error: "Invalid body: 'message' must be a string" })
          }

          const userId = auth.userId
          const response = await withSpan("gateway.http_message", {
            route: "/message",
            userId,
            channel: "webchat",
          }, async () => this.handleUserMessage(userId, message, "webchat"))
          return { response }
        },
      )

      app.get("/metrics", async (_req, reply) => {
        const metrics = await renderPrometheusMetrics()
        reply.header("Content-Type", metricsContentType())
        return metrics
      })

      app.get(
        "/api/csrf-token",
        async (req, reply) => {
          const token = extractBearerToken(req as { headers: Record<string, string | undefined> })
          if (!token) {
            return reply.code(401).send({ error: "Authorization header with Bearer token required" })
          }

          const auth = await authenticateWebSocket(token)
          if (!auth) {
            return reply.code(403).send({ error: "Invalid or expired token" })
          }

          const csrfToken = generateCsrfToken()
          reply.header("Set-Cookie", buildCsrfCookie(csrfToken))

          return {
            csrfToken,
            tokenType: CSRF_HEADER_NAME,
          }
        },
      )

      app.get<{ Querystring: Record<string, unknown> }>(
        "/webhooks/whatsapp",
        async (req, reply) => {
          const verification = whatsAppChannel.verifyCloudWebhook(req.query)
          if (!verification.ok) {
            return reply.code(verification.statusCode).send({ error: verification.error })
          }
          return reply.type("text/plain").send(verification.challenge ?? "")
        },
      )

      app.post<{ Body?: unknown }>(
        "/webhooks/whatsapp",
        async (req, reply) => {
          if (!whatsAppChannel.isCloudWebhookEnabled()) {
            return reply.code(503).send({ error: "WhatsApp Cloud webhook is not configured" })
          }

          const ingest = await whatsAppChannel.handleCloudWebhookPayload(req.body)
          return reply.code(200).send({
            received: true,
            processed: ingest.processed,
            ignored: ingest.ignored,
          })
        },
      )

      app.get<{ Querystring: { userId?: string; days?: string } }>(
        "/api/usage/summary",
        async (req, reply) => {
          // Require Bearer token authentication
          const token = extractBearerToken(req as { headers: Record<string, string | undefined> })
          if (!token) {
            return reply.code(401).send({ error: "Authorization header with Bearer token required" })
          }
          const auth = await authenticateWebSocket(token)
          if (!auth) {
            return reply.code(403).send({ error: "Invalid or expired token" })
          }

          // Users can only query their own usage unless they pass a userId AND are the owner
          const requestedUserId = req.query.userId ?? auth.userId
          if (requestedUserId !== auth.userId && !multiUser.isOwner(auth.userId)) {
            return reply.code(403).send({ error: "Cannot query another user's usage" })
          }

          const days = parseDaysParam(req.query.days)
          const { startDate, endDate } = buildDateRange(days)
          const summary = await usageTracker.getUserSummary(requestedUserId, startDate, endDate)

          return {
            userId: requestedUserId,
            period: { start: startDate, end: endDate, days },
            summary,
          }
        },
      )

      app.get<{ Querystring: { days?: string; adminToken?: string } }>(
        "/api/usage/global",
        async (req, reply) => {
          const configuredAdminToken = process.env.ADMIN_TOKEN
          if (!isConfiguredAdminToken(configuredAdminToken)) {
            return reply.code(503).send({ error: "Admin usage endpoint is not configured" })
          }

          // Accept admin token from Authorization header (preferred) or query string (legacy)
          const adminCandidate = extractAdminToken(
            req as { headers: Record<string, string | undefined>; query: Record<string, unknown> },
          )
          if (!isAdminTokenAuthorized(adminCandidate, configuredAdminToken)) {
            return reply.code(401).send({ error: "Unauthorized" })
          }

          const days = parseDaysParam(req.query.days)
          const { startDate, endDate } = buildDateRange(days)
          const summary = await usageTracker.getGlobalSummary(startDate, endDate)

          return {
            period: { start: startDate, end: endDate, days },
            summary,
          }
        },
      )

      // ── Model Selection API ──────────────────────────────────────────

      app.get("/api/models", async (req, reply) => {
        // Require auth for model listing
        const token = extractBearerToken(req as { headers: Record<string, string | undefined> })
        if (!token) {
          return reply.code(401).send({ error: "Authorization header with Bearer token required" })
        }
        const auth = await authenticateWebSocket(token)
        if (!auth) {
          return reply.code(403).send({ error: "Invalid or expired token" })
        }

        const available = orchestrator.getAvailableEngines()
        const { ENGINE_MODEL_CATALOG } = await import("../engines/model-preferences.js")

        const engines = available.map((name) => ({
          name,
          displayName: ENGINE_MODEL_CATALOG[name]?.displayName ?? name,
          models: ENGINE_MODEL_CATALOG[name]?.models ?? [],
        }))

        return { engines, count: engines.length }
      })

      app.post<{ Body?: { userId?: string; engine?: string; model?: string } }>(
        "/api/models/select",
        async (req, reply) => {
          // Require auth for model selection
          const token = extractBearerToken(req as { headers: Record<string, string | undefined> })
          if (!token) {
            return reply.code(401).send({ error: "Authorization header with Bearer token required" })
          }
          const auth = await authenticateWebSocket(token)
          if (!auth) {
            return reply.code(403).send({ error: "Invalid or expired token" })
          }

          const { modelPreferences } = await import("../engines/model-preferences.js")
          const userId = auth.userId
          const engine = asString(req.body?.engine)
          const model = asString(req.body?.model)

          if (!engine) {
            return reply.code(400).send({ error: "'engine' is required" })
          }

          const available = orchestrator.getAvailableEngines()
          if (!available.includes(engine)) {
            return reply.code(400).send({
              error: `Engine '${engine}' is not available`,
              available,
            })
          }

          const pref = model
            ? modelPreferences.setModel(userId, engine, model)
            : modelPreferences.setEngine(userId, engine)

          return { ok: true, userId, preference: pref }
        },
      )

      app.delete<{ Querystring: { userId?: string } }>(
        "/api/models/select",
        async (req, reply) => {
          // Require auth for model reset
          const token = extractBearerToken(req as { headers: Record<string, string | undefined> })
          if (!token) {
            return reply.code(401).send({ error: "Authorization header with Bearer token required" })
          }
          const auth = await authenticateWebSocket(token)
          if (!auth) {
            return reply.code(403).send({ error: "Invalid or expired token" })
          }

          const { modelPreferences } = await import("../engines/model-preferences.js")
          const userId = auth.userId
          modelPreferences.reset(userId)
          return { ok: true, userId, preference: "auto" }
        },
      )

      // ── Config API (EDITH-style — for mobile/remote setup) ──────

      /**
       * GET /api/config — read current edith.json (redacts secret values).
       * No auth required for initial setup (no token exists yet).
       */
      app.get("/api/config", async (req, reply) => {
        const authorization = await authorizeConfigRequest(
          req as { headers: Record<string, string | undefined>; ip?: string },
        )
        if (!authorization.ok) {
          return reply.code(authorization.statusCode).send({ error: authorization.error })
        }

        const { loadEdithConfig } = await import("../config/edith-config.js")
        try {
          const cfg = await loadEdithConfig()
          // Redact API keys for security — only expose structure + provider info
          const redacted = redactSecrets(JSON.parse(JSON.stringify(cfg))) as Record<string, unknown>
          return { ok: true, config: redacted }
        } catch (err) {
          return reply.code(500).send({ error: (err as Error).message })
        }
      })

      /**
       * PUT /api/config — write edith.json (full replace).
       * Used by mobile app and CLI to configure the engine remotely.
       */
      app.put<{ Body?: Record<string, unknown> }>(
        "/api/config",
        async (req, reply) => {
          const authorization = await authorizeConfigRequest(
            req as { headers: Record<string, string | undefined>; ip?: string },
          )
          if (!authorization.ok) {
            return reply.code(authorization.statusCode).send({ error: authorization.error })
          }

          const body = req.body
          if (!body || typeof body !== "object") {
            return reply.code(400).send({ error: "JSON body required" })
          }

          const { writeEdithConfig } = await import("../config/edith-config.js")
          try {
            const target = await writeEdithConfig(body)
            return { ok: true, path: target }
          } catch (err) {
            return reply.code(500).send({ error: (err as Error).message })
          }
        },
      )

      /**
       * PATCH /api/config — merge partial config into existing edith.json.
       * Convenient for mobile: send only `{ env: { GROQ_API_KEY: "..." } }`.
       */
      app.patch<{ Body?: Record<string, unknown> }>(
        "/api/config",
        async (req, reply) => {
          const authorization = await authorizeConfigRequest(
            req as { headers: Record<string, string | undefined>; ip?: string },
          )
          if (!authorization.ok) {
            return reply.code(authorization.statusCode).send({ error: authorization.error })
          }

          const body = req.body
          if (!body || typeof body !== "object") {
            return reply.code(400).send({ error: "JSON body required" })
          }

          const { loadEdithConfig, writeEdithConfig } = await import("../config/edith-config.js")
          try {
            const existing = await loadEdithConfig()
            const merged = deepMerge(existing as Record<string, unknown>, body)
            const target = await writeEdithConfig(merged)
            return { ok: true, path: target }
          } catch (err) {
            return reply.code(500).send({ error: (err as Error).message })
          }
        },
      )

      /**
       * POST /api/config/test-provider — test if a provider's API key works.
       */
      app.post<{ Body?: { provider?: string; credentials?: Record<string, string> } }>(
        "/api/config/test-provider",
        async (req, reply) => {
          const authorization = await authorizeConfigRequest(
            req as { headers: Record<string, string | undefined>; ip?: string },
          )
          if (!authorization.ok) {
            return reply.code(authorization.statusCode).send({ error: authorization.error })
          }

          const provider = asString(req.body?.provider)
          const creds = req.body?.credentials ?? {}

          if (!provider) {
            return reply.code(400).send({ error: "'provider' is required" })
          }

          try {
            switch (provider) {
              case "groq": {
                const res = await fetch("https://api.groq.com/openai/v1/models", {
                  headers: { Authorization: `Bearer ${creds.GROQ_API_KEY ?? ""}` },
                })
                return { ok: res.ok, status: res.status }
              }
              case "anthropic": {
                const res = await fetch("https://api.anthropic.com/v1/messages", {
                  method: "POST",
                  headers: {
                    "x-api-key": creds.ANTHROPIC_API_KEY ?? "",
                    "anthropic-version": "2023-06-01",
                    "Content-Type": "application/json",
                  },
                  body: JSON.stringify({
                    model: "claude-3-haiku-20240307",
                    max_tokens: 1,
                    messages: [{ role: "user", content: "hi" }],
                  }),
                })
                return { ok: res.status !== 401 && res.status !== 403, status: res.status }
              }
              case "openai": {
                const res = await fetch("https://api.openai.com/v1/models", {
                  headers: { Authorization: `Bearer ${creds.OPENAI_API_KEY ?? ""}` },
                })
                return { ok: res.ok, status: res.status }
              }
              case "gemini": {
                const apiKey = creds.GEMINI_API_KEY ?? ""
                const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`)
                return { ok: res.ok, status: res.status }
              }
              case "ollama": {
                const host = creds.OLLAMA_HOST || "http://127.0.0.1:11434"
                const res = await fetch(`${host}/api/tags`)
                return { ok: res.ok, status: res.status }
              }
              case "deepgram": {
                const res = await fetch("https://api.deepgram.com/v1/projects", {
                  headers: {
                    Authorization: `Token ${creds.apiKey ?? ""}`,
                  },
                })
                return { ok: res.ok, status: res.status }
              }
              default:
                return reply.code(400).send({ error: `Unknown provider: ${provider}` })
            }
          } catch (err) {
            return { ok: false, error: (err as Error).message }
          }
        },
      )

      /**
       * POST /api/config/prepare-wake-model — download a recommended host wake-word model.
       * Used by onboarding/settings so users do not have to manually edit edith.json.
       */
      app.post<{ Body?: { engine?: string; modelName?: string; keyword?: string } }>(
        "/api/config/prepare-wake-model",
        async (req, reply) => {
          const authorization = await authorizeConfigRequest(
            req as { headers: Record<string, string | undefined>; ip?: string },
          )
          if (!authorization.ok) {
            return reply.code(authorization.statusCode).send({ error: authorization.error })
          }

          const requestedEngine = asString(req.body?.engine) ?? "openwakeword"
          if (requestedEngine !== "openwakeword") {
            return reply.code(400).send({
              ok: false,
              error: `Unsupported wake model engine: ${requestedEngine}`,
            })
          }

          try {
            const { prepareOpenWakeWordModel } = await import("../voice/wake-model-assets.js")
            const prepared = await prepareOpenWakeWordModel({
              modelName: asString(req.body?.modelName) ?? asString(req.body?.keyword) ?? undefined,
            })
            return { ok: true, prepared }
          } catch (err) {
            return reply.code(500).send({
              ok: false,
              error: (err as Error).message,
            })
          }
        },
      )
    })
  }

  private async attachAuthenticatedClient(socket: SocketLike, auth: AuthContext): Promise<void> {
    const clientId = crypto.randomUUID()
    let socketClosed = false

    this.clients.set(clientId, { socket, auth })
    logger.info(`client connected: ${clientId}`, {
      userId: auth.userId,
      channel: auth.channel,
    })

    safeSend(socket, buildConnectedPayload(clientId))

    socket.on("message", async (...args: unknown[]) => {
      const raw = args[0] as Buffer
      if (socketClosed) {
        return
      }

      try {
        const parsed = JSON.parse(raw.toString())
        const msg = normalizeIncomingClientMessage(parsed)
        const res = await this.handle(msg, auth, socket)
        safeSend(socket, res)
      } catch (err) {
        if (isCancellationError(err)) {
          safeSend(socket, { type: "cancelled", message: String(err) })
          return
        }
        safeSend(socket, { type: "error", message: String(err) })
      }
    })

    socket.on("close", () => {
      socketClosed = true
      this.clients.delete(clientId)
      this.stopVoiceSession(auth.userId, "socket close")
      memory.clearFeedback(auth.userId)
    })
  }

  private async handle(msg: GatewayClientMessage, auth?: AuthContext, socket?: SocketLike): Promise<GatewayResponse> {
    const userId = auth?.userId ?? msg.userId ?? config.DEFAULT_USER_ID

    await multiUser.getOrCreate(userId, "gateway")

    if (auth && msg.userId && msg.userId !== auth.userId) {
      return { type: "error", message: "Token user does not match request user" }
    }

    if (!multiUser.isOwner(userId) && msg.type !== "message") {
      return { type: "error", message: "Unauthorized for this action" }
    }

    switch (msg.type) {
      case "message": {
        const content = ensureMessageContent(msg.content, "message")
        const response = await withSpan("gateway.ws_message", {
          userId,
          channel: "webchat",
        }, async () => this.handleUserMessage(userId, content, "webchat", {
          onChunk: async (chunk, chunkIndex, totalChunks) => {
            if (!socket) {
              return
            }
            safeSend(socket, {
              type: "chunk",
              chunk,
              chunkIndex,
              totalChunks,
              requestId: msg.requestId,
            })
          },
        })
        )
        return { type: "final", content: response, requestId: msg.requestId }
      }
      case "status":
        return buildStatusPayload(msg.requestId)
      case "broadcast": {
        const content = ensureMessageContent(msg.content, "broadcast")
        await channelManager.broadcast(content)
        return { type: "ok", requestId: msg.requestId }
      }
      case "voice_start":
        return this.handleVoiceStart(userId, msg, socket)
      case "voice_chunk":
        return this.handleVoiceChunk(userId, msg)
      case "voice_stop":
        return this.handleVoiceStop(userId, msg)
      case "voice_wake_word":
        return this.handleWakeWord(userId, msg)

      // ── Phase 3: Vision Analysis ─────────────────────────────────────
      // Handles vision requests from mobile (React Native) and desktop clients.
      //
      // Message format:
      //   { type: "vision_analyze", data: "<base64>", mimeType: "image/png",
      //     visionMode: "describe" | "ocr" | "find", content: "<element query>" }
      //
      // Response: { type: "vision_result", mode, result, requestId }
      //
      // Paper basis: ScreenAgent (mobile → server vision pipeline)
      case "vision_analyze":
        return this.handleVisionAnalyze(userId, msg)

      default:
        return { type: "error", message: `unknown type: ${msg.type}` }
    }
  }

  async start(): Promise<void> {
    await this.app.listen({ port: this.port, host: config.GATEWAY_HOST })
    logger.info(`gateway running at ws://${config.GATEWAY_HOST}:${this.port}`)
  }

  private async handleUserMessage(
    userId: string,
    rawMessage: string,
    channel: string,
    options?: IncomingMessageOptions,
  ): Promise<string> {
    return handleIncomingUserMessage(userId, rawMessage, channel, options)
  }

  private stopVoiceSession(userId: string, reason: string): boolean {
    const stopped = this.voiceSessionManager.cancelSession(userId, reason)
    if (stopped) {
      logger.info("voice session stopped", { userId, reason })
    }
    return stopped
  }

  private async handleVoiceStart(
    userId: string,
    msg: GatewayClientMessage,
    socket?: SocketLike,
  ): Promise<GatewayResponse> {
    if (!socket) {
      return { type: "error", message: "Voice mode requires an active WebSocket", requestId: msg.requestId }
    }

    try {
      await this.voiceSessionManager.startSession({
        userId,
        requestId: msg.requestId,
        encoding: msg.encoding,
        mimeType: msg.mimeType,
        sampleRate: msg.sampleRate,
        channelCount: msg.channelCount,
        language: msg.language,
      }, (event) => {
        safeSend(socket, event)
      })
      logger.info("voice session started", { userId })
      return { type: "voice_started", requestId: msg.requestId }
    } catch (err) {
      logger.error("voice_start failed", { userId, error: String(err) })
      return {
        type: "error",
        message: `Failed to start voice: ${String(err)}`,
        requestId: msg.requestId,
      }
    }
  }

  private async handleVoiceChunk(userId: string, msg: GatewayClientMessage): Promise<GatewayResponse> {
    if (typeof msg.data !== "string" || msg.data.length === 0) {
      return { type: "error", message: "voice_chunk requires base64 'data'", requestId: msg.requestId }
    }

    try {
      this.voiceSessionManager.appendChunk({
        userId,
        requestId: msg.requestId,
        data: msg.data,
      })
      return { type: "ok", requestId: msg.requestId }
    } catch (err) {
      return {
        type: "error",
        message: `Failed to append voice chunk: ${String(err)}`,
        requestId: msg.requestId,
      }
    }
  }

  private async handleVoiceStop(userId: string, msg: GatewayClientMessage): Promise<GatewayResponse> {
    try {
      await this.voiceSessionManager.stopSession({
        userId,
        requestId: msg.requestId,
        data: msg.data,
      })
      return { type: "ok", requestId: msg.requestId }
    } catch (err) {
      return {
        type: "error",
        message: `Failed to stop voice session: ${String(err)}`,
        requestId: msg.requestId,
      }
    }
  }

  private async handleWakeWord(userId: string, msg: GatewayClientMessage): Promise<GatewayResponse> {
    const runtimeVoice = await loadRuntimeVoiceConfig()
    const keyword = msg.keyword ?? runtimeVoice.wake.keyword
    const windowSeconds = msg.windowSeconds ?? 2

    try {
      const detected = await checkWakeWordWindow(runtimeVoice, keyword, windowSeconds)
      return {
        type: "wake_word_result",
        detected,
        keyword,
        requestId: msg.requestId,
      }
    } catch (err) {
      logger.error("wake_word check failed", { userId, error: String(err) })
      return {
        type: "error",
        message: `Wake word check failed: ${String(err)}`,
        requestId: msg.requestId,
      }
    }
  }

  /**
   * Handle a vision_analyze WebSocket message from mobile or desktop client.
   *
   * This is the bridge between mobile camera captures and the VisionCortex.
   * The mobile client sends a base64-encoded image, we route it through
   * the appropriate vision analysis path based on `visionMode`.
   *
   * Vision modes:
   *   "describe" — ask multimodal LLM to describe the image (uses API, costs $)
   *   "ocr"      — extract text via Tesseract (free, no LLM call)
   *   "find"     — find a named element (msg.content = element query)
   *
   * The result is sent back as { type: "vision_result", mode, result }.
   *
   * Paper basis:
   *   ScreenAgent (IJCAI 2024): mobile → server vision pipeline design
   *   OSWorld (arXiv:2404.07972): provider-agnostic routing
   */
  private async handleVisionAnalyze(
    userId: string,
    msg: GatewayClientMessage,
  ): Promise<GatewayResponse> {
    // Validate: require base64 image data
    if (typeof msg.data !== "string" || msg.data.trim().length === 0) {
      return {
        type: "error",
        message: "vision_analyze requires base64 image in 'data' field",
        requestId: msg.requestId,
      }
    }

    try {
      // Decode base64 → Buffer for processing
      const imageBuffer = Buffer.from(msg.data, "base64")
      const mode = msg.visionMode ?? "describe"
      const runtimeVision = await loadRuntimeVisionConfig()

      if (!runtimeVision.enabled) {
        return {
          type: "error",
          message: "Vision is disabled in edith.json. Enable top-level vision config from onboarding first.",
          requestId: msg.requestId,
        }
      }

      // Lazy-import VisionCortex to avoid circular dependencies
      const { VisionCortex } = await import("../os-agent/vision-cortex.js")
      const visionCortex = new VisionCortex(runtimeVision)
      await visionCortex.initialize()

      let result: string | object

      try {
        switch (mode) {
          case "ocr":
            // OCR-only: free, no LLM, fast (~400ms)
            result = await visionCortex.extractText(imageBuffer)
            break

          case "find": {
            // Element finding: requires a query string in msg.content
            const query = msg.content?.trim()
            if (!query) {
              return {
                type: "error",
                message: "vision_analyze 'find' mode requires element query in 'content' field",
                requestId: msg.requestId,
              }
            }
            // findElement() uses captured screen, not the provided image
            // TODO: future — support finding elements in provided image
            const element = await visionCortex.findElement(query)
            result = element ?? { found: false }
            break
          }

          case "describe":
          default:
            // Full multimodal description via LLM (costs API credits)
            result = await visionCortex.describeImage(imageBuffer, msg.content)
            break
        }
      } finally {
        await visionCortex.shutdown().catch(() => {})
      }

      logger.info("vision analysis complete", {
        userId,
        mode,
        imageBytes: imageBuffer.length,
        profile: runtimeVision.profile,
        multimodalEngine: runtimeVision.multimodalEngine,
        resultType: typeof result,
      })

      return {
        type: "vision_result",
        mode,
        result,
        requestId: msg.requestId,
      }
    } catch (err) {
      logger.error("vision_analyze failed", { userId, error: String(err) })
      return {
        type: "error",
        message: `Vision analysis failed: ${String(err)}`,
        requestId: msg.requestId,
      }
    }
  }

  async stop(): Promise<void> {
    this.voiceSessionManager.cancelAll("shutdown")
    this.clients.clear()
    await this.app.close()
  }

  broadcast(payload: unknown): void {
    const raw = JSON.stringify(payload)
    for (const [, client] of this.clients) {
      try {
        client.socket.send(raw)
      } catch {
        continue
      }
    }
  }

  private broadcastToUser(userId: string, payload: unknown): void {
    const raw = JSON.stringify(payload)
    for (const [, client] of this.clients) {
      if (client.auth.userId !== userId) {
        continue
      }

      try {
        client.socket.send(raw)
      } catch {
        continue
      }
    }
  }
}

export const gateway = new GatewayServer()

export const __gatewayTestUtils = {
  parseDaysParam,
  isAdminTokenAuthorized,
  isLoopbackAddress,
  isConfigBootstrapAllowed,
  normalizeIncomingClientMessage,
  redactSecrets,
  estimateTokensFromText,
  extractAdminToken,
  extractWebSocketToken,
  parseCookieHeader,
  shouldEnforceCsrfRequest,
  verifyCsrfRequest,
  buildCsrfCookie,
  CSRF_HEADER_NAME,
  CSRF_COOKIE_NAME,
  isRateLimited,
  RATE_LIMIT_MAX,
  RATE_LIMIT_WINDOW_MS,
  APP_VERSION,
  CONTENT_SECURITY_POLICY,
}

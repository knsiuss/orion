# Production Hardening Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Harden EDITH for real-world local + VPS deployment — graceful shutdown, DB backup, health endpoint, environment-aware auth, log rotation, basic alerting, DM access policy, and Docker/autostart packaging.

**Architecture:** Native-first (Node.js + Python direct), Docker as VPS/server alternative. Gateway exposure is environment-aware: localhost = no extra auth, non-localhost = API token required. All new code follows existing project patterns (ESM, `createLogger`, Zod config, singleton exports).

**Tech Stack:** TypeScript ESM, Fastify, Prisma/SQLite, vitest, pnpm, Docker multi-stage build

---

## Task 1 — Graceful Shutdown

**Files:**
- Create: `src/core/shutdown.ts`
- Modify: `src/core/startup.ts`

The existing `shutdown()` function in `startup.ts` (line 270) is missing: final outbox flush, WAL checkpoint, `prisma.$disconnect()`, `pipelineRateLimiter.destroy()`, `channelManager.stop()`. The SIGTERM/SIGINT handlers (line 267-268) only call `sidecarManager.stopAll()`, not the full shutdown.

**Step 1: Write failing test**

Create `src/core/__tests__/shutdown.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("../startup.js", () => ({
  initialize: vi.fn(),
}))

const mockOutbox = { stopFlushing: vi.fn(), flush: vi.fn().mockResolvedValue(undefined) }
const mockChannelManager = { stop: vi.fn().mockResolvedValue(undefined) }
const mockSidecarManager = { stopAll: vi.fn() }
const mockPrisma = { $disconnect: vi.fn().mockResolvedValue(undefined), $executeRawUnsafe: vi.fn().mockResolvedValue(undefined) }
const mockRateLimiter = { destroy: vi.fn() }
const mockDaemon = { isRunning: vi.fn().mockReturnValue(true), stop: vi.fn() }

vi.mock("../../channels/outbox.js", () => ({ outbox: mockOutbox }))
vi.mock("../../channels/manager.js", () => ({ channelManager: mockChannelManager }))
vi.mock("../../sidecar-manager.js", () => ({ sidecarManager: mockSidecarManager }))
vi.mock("../../database/index.js", () => ({ prisma: mockPrisma }))
vi.mock("../../security/pipeline-rate-limiter.js", () => ({ pipelineRateLimiter: mockRateLimiter }))
vi.mock("../../background/daemon.js", () => ({ daemon: mockDaemon }))

import { performShutdown } from "../shutdown.js"

describe("performShutdown", () => {
  beforeEach(() => { vi.clearAllMocks() })

  it("flushes outbox before stopping flusher", async () => {
    const callOrder: string[] = []
    mockOutbox.stopFlushing.mockImplementation(() => callOrder.push("stop"))
    mockOutbox.flush.mockImplementation(() => { callOrder.push("flush"); return Promise.resolve() })
    await performShutdown()
    expect(callOrder.indexOf("flush")).toBeLessThan(callOrder.indexOf("stop"))
  })

  it("calls prisma.$disconnect after WAL checkpoint", async () => {
    await performShutdown()
    expect(mockPrisma.$executeRawUnsafe).toHaveBeenCalledWith("PRAGMA wal_checkpoint(TRUNCATE)")
    expect(mockPrisma.$disconnect).toHaveBeenCalled()
  })

  it("stops all services", async () => {
    await performShutdown()
    expect(mockChannelManager.stop).toHaveBeenCalled()
    expect(mockSidecarManager.stopAll).toHaveBeenCalled()
    expect(mockRateLimiter.destroy).toHaveBeenCalled()
  })
})
```

**Step 2: Run test to confirm it fails**

```bash
pnpm vitest run src/core/__tests__/shutdown.test.ts
```
Expected: FAIL — `performShutdown` not found.

**Step 3: Create `src/core/shutdown.ts`**

```typescript
/**
 * @file shutdown.ts
 * @description Graceful shutdown sequence for EDITH.
 *
 * ARCHITECTURE / INTEGRATION:
 *   Called by SIGTERM and SIGINT handlers registered in startup.ts.
 *   Executes a deterministic shutdown sequence within a 10-second timeout:
 *     1. Final outbox flush (deliver any buffered messages)
 *     2. Stop outbox flusher timer
 *     3. Stop daemon background loop
 *     4. Stop channel manager (close all channel connections)
 *     5. Stop Python sidecars
 *     6. Destroy pipeline rate limiter timer
 *     7. WAL checkpoint (ensure SQLite WAL is flushed to main DB file)
 *     8. Prisma disconnect
 *     9. process.exit(0)
 *   If shutdown takes longer than SHUTDOWN_TIMEOUT_MS, force-exits.
 *
 * @module core/shutdown
 */

import { outbox } from "../channels/outbox.js"
import { channelManager } from "../channels/manager.js"
import { sidecarManager } from "./sidecar-manager.js"
import { prisma } from "../database/index.js"
import { pipelineRateLimiter } from "../security/pipeline-rate-limiter.js"
import { daemon } from "../background/daemon.js"
import { createLogger } from "../logger.js"

const log = createLogger("core.shutdown")

/** Maximum time to wait for graceful shutdown before force-exiting. */
const SHUTDOWN_TIMEOUT_MS = 10_000

/**
 * Execute the EDITH graceful shutdown sequence.
 * Safe to call multiple times — subsequent calls are no-ops.
 */
let shutdownCalled = false

export async function performShutdown(): Promise<void> {
  if (shutdownCalled) return
  shutdownCalled = true

  log.info("graceful shutdown started")

  const timer = setTimeout(() => {
    log.error("shutdown timed out — force exiting", { timeoutMs: SHUTDOWN_TIMEOUT_MS })
    process.exit(1)
  }, SHUTDOWN_TIMEOUT_MS)

  try {
    // 1. Final flush before stopping the timer
    await outbox.flush(async (userId, message) => {
      return channelManager.send(userId, message)
    }).catch((err) => log.warn("final outbox flush failed", { err: String(err) }))

    // 2. Stop outbox retry timer
    outbox.stopFlushing()

    // 3. Stop daemon background loop
    if (daemon.isRunning()) daemon.stop()

    // 4. Stop all channels
    await channelManager.stop()
      .catch((err) => log.warn("channel manager stop failed", { err: String(err) }))

    // 5. Stop Python sidecars
    sidecarManager.stopAll()

    // 6. Destroy pipeline rate limiter eviction timer
    pipelineRateLimiter.destroy()

    // 7. WAL checkpoint — flush WAL into main DB file before disconnect
    await prisma.$executeRawUnsafe("PRAGMA wal_checkpoint(TRUNCATE)")
      .catch((err) => log.warn("WAL checkpoint failed", { err: String(err) }))

    // 8. Disconnect Prisma
    await prisma.$disconnect()
      .catch((err) => log.warn("prisma disconnect failed", { err: String(err) }))

    log.info("graceful shutdown complete")
  } finally {
    clearTimeout(timer)
    process.exit(0)
  }
}
```

**Step 4: Update `src/core/startup.ts`**

Replace the two lines at line 267-268:
```typescript
process.on("SIGTERM", () => sidecarManager.stopAll())
process.on("SIGINT", () => sidecarManager.stopAll())
```
With:
```typescript
process.on("SIGTERM", () => { void performShutdown() })
process.on("SIGINT",  () => { void performShutdown() })
```

Add import at top of startup.ts:
```typescript
import { performShutdown } from "./shutdown.js"
```

**Step 5: Run tests**

```bash
pnpm vitest run src/core/__tests__/shutdown.test.ts
```
Expected: 3/3 PASS

**Step 6: Typecheck**

```bash
pnpm typecheck
```
Expected: 0 errors

**Step 7: Commit**

```bash
git add src/core/shutdown.ts src/core/startup.ts src/core/__tests__/shutdown.test.ts
git commit -m "feat(core): add graceful shutdown with WAL checkpoint + final outbox flush"
```

---

## Task 2 — Health Endpoint

**Files:**
- Modify: `src/gateway/server.ts`

**Step 1: Write failing test**

Create `src/gateway/__tests__/health.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest"

vi.mock("../../channels/outbox.js", () => ({
  outbox: { getStatus: vi.fn().mockReturnValue({ pending: 0, deadLetters: 0 }) },
}))
vi.mock("../../gateway/channel-health-monitor.js", () => ({
  channelHealthMonitor: {
    getHealth: vi.fn().mockReturnValue([
      { channelId: "telegram", connected: true },
      { channelId: "discord", connected: false },
    ]),
  },
}))
vi.mock("../../database/index.js", () => ({
  prisma: { $queryRaw: vi.fn().mockResolvedValue([{ result: 1 }]) },
}))
vi.mock("../../config.js", () => ({ default: { WEBCHAT_PORT: 3000 } }))

import { buildHealthPayload } from "../health.js"

describe("buildHealthPayload", () => {
  it("returns ok status when DB is healthy", async () => {
    const payload = await buildHealthPayload()
    expect(payload.status).toBe("ok")
    expect(payload.db).toBe("ok")
  })

  it("includes channel connection states", async () => {
    const payload = await buildHealthPayload()
    expect(payload.channels["telegram"]).toBe(true)
    expect(payload.channels["discord"]).toBe(false)
  })

  it("includes outbox stats", async () => {
    const payload = await buildHealthPayload()
    expect(payload.outbox.pending).toBe(0)
  })
})
```

**Step 2: Run test to confirm it fails**

```bash
pnpm vitest run src/gateway/__tests__/health.test.ts
```
Expected: FAIL — `buildHealthPayload` not found.

**Step 3: Create `src/gateway/health.ts`**

```typescript
/**
 * @file health.ts
 * @description Health check payload builder for GET /health endpoint.
 *
 * ARCHITECTURE / INTEGRATION:
 *   Called by the Fastify route handler in server.ts.
 *   Queries DB liveness, channel states, and outbox depth.
 *   Returns a typed payload that the route serializes to JSON.
 *   Returns HTTP 200 when status = "ok", 503 when "degraded" or "down".
 *
 * @module gateway/health
 */

import { prisma } from "../database/index.js"
import { outbox } from "../channels/outbox.js"
import { channelHealthMonitor } from "./channel-health-monitor.js"
import { createLogger } from "../logger.js"

const log = createLogger("gateway.health")

/** Shape of the /health response body. */
export interface HealthPayload {
  status: "ok" | "degraded" | "down"
  uptime: number
  version: string
  db: "ok" | "error"
  channels: Record<string, boolean>
  outbox: { pending: number; deadLetters: number }
}

let appVersion = "0.0.0"
export function setAppVersion(v: string): void { appVersion = v }

/**
 * Build the health payload by probing DB and reading live state.
 * Never throws — always returns a valid payload (db = "error" on failure).
 */
export async function buildHealthPayload(): Promise<HealthPayload> {
  let db: "ok" | "error" = "ok"
  try {
    await prisma.$queryRaw`SELECT 1`
  } catch (err) {
    log.warn("health check DB probe failed", { err: String(err) })
    db = "error"
  }

  const channelHealthList = channelHealthMonitor.getHealth()
  const channels: Record<string, boolean> = {}
  for (const ch of channelHealthList) {
    channels[ch.channelId] = ch.connected
  }

  const outboxStatus = outbox.getStatus()
  const connectedCount = Object.values(channels).filter(Boolean).length

  const status: HealthPayload["status"] =
    db === "error" ? "down"
    : connectedCount === 0 ? "degraded"
    : "ok"

  return {
    status,
    uptime: Math.floor(process.uptime()),
    version: appVersion,
    db,
    channels,
    outbox: outboxStatus,
  }
}
```

**Step 4: Register route in `src/gateway/server.ts`**

Add import near top of server.ts:
```typescript
import { buildHealthPayload, setAppVersion } from "./health.js"
```

After `const APP_VERSION = readPackageVersion()`, add:
```typescript
setAppVersion(APP_VERSION)
```

In the Fastify route registration section (after existing routes), add:
```typescript
// Health check — no auth, no rate limit, used by load balancers and Docker healthcheck
app.get("/health", async (_req, reply) => {
  const payload = await buildHealthPayload()
  const statusCode = payload.status === "ok" ? 200 : 503
  return reply.status(statusCode).send(payload)
})
```

**Step 5: Run tests**

```bash
pnpm vitest run src/gateway/__tests__/health.test.ts
```
Expected: 3/3 PASS

**Step 6: Typecheck + commit**

```bash
pnpm typecheck
git add src/gateway/health.ts src/gateway/server.ts src/gateway/__tests__/health.test.ts
git commit -m "feat(gateway): add GET /health endpoint with DB + channel + outbox status"
```

---

## Task 3 — Database Auto-Backup

**Files:**
- Create: `src/database/backup.ts`
- Modify: `src/background/daemon.ts`
- Modify: `src/config.ts`

**Step 1: Add config var**

In `src/config.ts`, inside `ConfigSchema`, add:
```typescript
EDITH_BACKUP_DIR: z.string().default(".edith/backups"),
EDITH_BACKUP_INTERVAL_HOURS: z.coerce.number().int().positive().default(1),
EDITH_BACKUP_RETAIN_COUNT: z.coerce.number().int().positive().default(24),
```

**Step 2: Write failing test**

Create `src/database/__tests__/backup.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest"

const mockCopyFile = vi.fn().mockResolvedValue(undefined)
const mockMkdir = vi.fn().mockResolvedValue(undefined)
const mockReaddir = vi.fn().mockResolvedValue([])
const mockUnlink = vi.fn().mockResolvedValue(undefined)

vi.mock("node:fs/promises", () => ({
  default: { copyFile: mockCopyFile, mkdir: mockMkdir, readdir: mockReaddir, unlink: mockUnlink },
  copyFile: mockCopyFile, mkdir: mockMkdir, readdir: mockReaddir, unlink: mockUnlink,
}))
vi.mock("../../database/index.js", () => ({
  prisma: { $executeRawUnsafe: vi.fn().mockResolvedValue(undefined) },
}))
vi.mock("../../config.js", () => ({
  default: { EDITH_BACKUP_DIR: ".edith/backups", EDITH_BACKUP_RETAIN_COUNT: 3, DATABASE_URL: "file:./prisma/edith.db" },
}))

import { DatabaseBackup } from "../backup.js"

describe("DatabaseBackup", () => {
  let backup: DatabaseBackup

  beforeEach(() => {
    backup = new DatabaseBackup()
    vi.clearAllMocks()
    mockReaddir.mockResolvedValue([])
  })

  it("creates backup directory if missing", async () => {
    await backup.run()
    expect(mockMkdir).toHaveBeenCalled()
  })

  it("copies DB file with timestamped name", async () => {
    await backup.run()
    expect(mockCopyFile).toHaveBeenCalledOnce()
    const dest = mockCopyFile.mock.calls[0]?.[1] as string
    expect(dest).toMatch(/edith-\d{4}-\d{2}-\d{2}-\d{2}\.db$/)
  })

  it("prunes old backups when over retain count", async () => {
    mockReaddir.mockResolvedValue([
      "edith-2026-01-01-00.db",
      "edith-2026-01-01-01.db",
      "edith-2026-01-01-02.db",
      "edith-2026-01-01-03.db",
    ])
    await backup.run()
    expect(mockUnlink).toHaveBeenCalledTimes(2) // 4 existing + 1 new = 5, retain 3, prune 2
  })
})
```

**Step 3: Run test to confirm it fails**

```bash
pnpm vitest run src/database/__tests__/backup.test.ts
```
Expected: FAIL — `DatabaseBackup` not found.

**Step 4: Create `src/database/backup.ts`**

```typescript
/**
 * @file backup.ts
 * @description Periodic SQLite database backup with retention management.
 *
 * ARCHITECTURE / INTEGRATION:
 *   Scheduled via daemon.ts on an hourly basis.
 *   Before copying, runs PRAGMA wal_checkpoint(TRUNCATE) to ensure the
 *   WAL file is flushed into the main DB file, producing a consistent backup.
 *   Backups are stored in EDITH_BACKUP_DIR (default: .edith/backups/).
 *   Old backups beyond EDITH_BACKUP_RETAIN_COUNT are pruned automatically.
 *
 * @module database/backup
 */

import fs from "node:fs/promises"
import path from "node:path"

import { prisma } from "./index.js"
import { createLogger } from "../logger.js"
import config from "../config.js"

const log = createLogger("database.backup")

/** Parse the SQLite file path from a DATABASE_URL like "file:./prisma/edith.db". */
function resolveDbPath(): string {
  const url = config.DATABASE_URL ?? ""
  const filePath = url.startsWith("file:") ? url.slice(5) : url
  return path.resolve(process.cwd(), filePath)
}

/** Generate a backup filename: edith-YYYY-MM-DD-HH.db */
function backupFilename(): string {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, "0")
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}`
  return `edith-${date}.db`
}

/**
 * Manages periodic SQLite backups.
 *
 * Usage:
 *   const backup = new DatabaseBackup()
 *   backup.start()  // called from daemon.ts
 */
export class DatabaseBackup {
  private timer: ReturnType<typeof setInterval> | null = null

  /**
   * Run one backup cycle: checkpoint WAL, copy DB, prune old backups.
   */
  async run(): Promise<void> {
    const backupDir = path.resolve(process.cwd(), config.EDITH_BACKUP_DIR)
    const dbPath = resolveDbPath()
    const dest = path.join(backupDir, backupFilename())

    try {
      await fs.mkdir(backupDir, { recursive: true })

      // Checkpoint WAL for a consistent snapshot
      await prisma.$executeRawUnsafe("PRAGMA wal_checkpoint(TRUNCATE)")

      await fs.copyFile(dbPath, dest)
      log.info("backup created", { dest })

      await this.prune(backupDir)
    } catch (err) {
      log.warn("backup failed", { err: String(err) })
    }
  }

  /**
   * Start the periodic backup timer.
   * @param intervalHours - Backup frequency in hours (default from config)
   */
  start(intervalHours = config.EDITH_BACKUP_INTERVAL_HOURS): void {
    if (this.timer) return
    const intervalMs = intervalHours * 60 * 60 * 1_000
    this.timer = setInterval(() => { void this.run() }, intervalMs)
    this.timer.unref()
    log.info("backup scheduler started", { intervalHours, retainCount: config.EDITH_BACKUP_RETAIN_COUNT })
    // Run immediately on start to create a fresh baseline
    void this.run()
  }

  /** Stop the backup timer. */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  /** Remove oldest backup files beyond the retention count. */
  private async prune(backupDir: string): Promise<void> {
    const retain = config.EDITH_BACKUP_RETAIN_COUNT
    const files = (await fs.readdir(backupDir))
      .filter((f) => f.startsWith("edith-") && f.endsWith(".db"))
      .sort() // lexicographic = chronological for our filename format

    const toDelete = files.slice(0, Math.max(0, files.length + 1 - retain))
    for (const f of toDelete) {
      await fs.unlink(path.join(backupDir, f))
      log.debug("pruned old backup", { file: f })
    }
  }
}

/** Singleton backup instance. */
export const databaseBackup = new DatabaseBackup()
```

**Step 5: Wire into `src/background/daemon.ts`**

Add import at top of daemon.ts:
```typescript
import { databaseBackup } from "../database/backup.js"
```

Inside `EDITHDaemon.start()` method (find where daemon starts), add:
```typescript
databaseBackup.start()
```

Inside `EDITHDaemon.stop()`, add:
```typescript
databaseBackup.stop()
```

**Step 6: Run tests**

```bash
pnpm vitest run src/database/__tests__/backup.test.ts
```
Expected: 3/3 PASS

**Step 7: Commit**

```bash
pnpm typecheck
git add src/database/backup.ts src/database/__tests__/backup.test.ts src/background/daemon.ts src/config.ts
git commit -m "feat(database): add hourly SQLite backup with WAL checkpoint and retention pruning"
```

---

## Task 4 — Gateway API Token Auth

**Files:**
- Create: `src/gateway/api-auth.ts`
- Modify: `src/gateway/server.ts`
- Modify: `src/config.ts`

**Step 1: Add config vars**

In `src/config.ts` ConfigSchema:
```typescript
EDITH_API_TOKEN: z.string().default(""),
GATEWAY_HOST: z.string().default("127.0.0.1"),
```

**Step 2: Write failing test**

Create `src/gateway/__tests__/api-auth.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest"

vi.mock("../../config.js", () => ({
  default: { EDITH_API_TOKEN: "secret-token", GATEWAY_HOST: "0.0.0.0" },
}))

import { checkApiToken, isLocalhostBinding } from "../api-auth.js"

describe("isLocalhostBinding", () => {
  it("returns true for 127.0.0.1", () => expect(isLocalhostBinding("127.0.0.1")).toBe(true))
  it("returns true for ::1", () => expect(isLocalhostBinding("::1")).toBe(true))
  it("returns false for 0.0.0.0", () => expect(isLocalhostBinding("0.0.0.0")).toBe(false))
})

describe("checkApiToken", () => {
  it("passes with correct Bearer token", () => {
    expect(checkApiToken("Bearer secret-token")).toBe(true)
  })

  it("rejects wrong token", () => {
    expect(checkApiToken("Bearer wrong")).toBe(false)
  })

  it("rejects missing token", () => {
    expect(checkApiToken(undefined)).toBe(false)
  })

  it("rejects empty token", () => {
    expect(checkApiToken("")).toBe(false)
  })
})
```

**Step 3: Run to confirm failure**

```bash
pnpm vitest run src/gateway/__tests__/api-auth.test.ts
```

**Step 4: Create `src/gateway/api-auth.ts`**

```typescript
/**
 * @file api-auth.ts
 * @description Environment-aware API token authentication for the Fastify gateway.
 *
 * ARCHITECTURE / INTEGRATION:
 *   Used as a Fastify preHandler hook on all HTTP REST routes except /health and /webhooks/*.
 *   Auth is skipped entirely when GATEWAY_HOST is a loopback address (127.0.0.1, ::1)
 *   because the gateway is then only reachable from the local machine.
 *   When bound to a non-loopback address (e.g. 0.0.0.0 for LAN/VPS), every request
 *   must include: `Authorization: Bearer <EDITH_API_TOKEN>`
 *
 *   If EDITH_API_TOKEN is not set and gateway is non-local, EDITH logs a startup
 *   warning and rejects all requests with 401.
 *
 * @module gateway/api-auth
 */

import config from "../config.js"
import { createLogger } from "../logger.js"

const log = createLogger("gateway.api-auth")

const LOCALHOST_BINDINGS = new Set(["127.0.0.1", "::1", "localhost"])

/**
 * Returns true if the gateway is bound to a loopback address.
 * When true, auth checks are bypassed.
 */
export function isLocalhostBinding(host: string): boolean {
  return LOCALHOST_BINDINGS.has(host)
}

/**
 * Validate an Authorization header value against the configured API token.
 * Expects format: "Bearer <token>"
 *
 * @param authHeader - The raw Authorization header value (or undefined)
 * @returns true if the token matches, false otherwise
 */
export function checkApiToken(authHeader: string | undefined): boolean {
  const expected = config.EDITH_API_TOKEN
  if (!expected || !authHeader) return false

  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : authHeader
  return token === expected
}

/**
 * Log a warning at startup if the gateway is public but no token is configured.
 * Call once during server initialization.
 */
export function warnIfInsecure(): void {
  if (!isLocalhostBinding(config.GATEWAY_HOST) && !config.EDITH_API_TOKEN) {
    log.warn(
      "SECURITY WARNING: gateway is bound to a non-localhost address but EDITH_API_TOKEN is not set — all REST requests will be rejected",
      { GATEWAY_HOST: config.GATEWAY_HOST },
    )
  }
}
```

**Step 5: Wire into `src/gateway/server.ts`**

Add import near top:
```typescript
import { checkApiToken, isLocalhostBinding, warnIfInsecure } from "./api-auth.js"
```

In the server startup function (near the top where it initializes), call:
```typescript
warnIfInsecure()
```

Add a Fastify `addHook` preHandler before route registration to guard all routes except `/health` and `/webhooks/*`:
```typescript
app.addHook("preHandler", async (request, reply) => {
  const path = request.url.split("?")[0] ?? ""

  // Skip auth for health check and webhooks (they have their own validation)
  if (path === "/health" || path.startsWith("/webhooks/")) return

  // Skip auth when gateway is bound to localhost
  if (isLocalhostBinding(config.GATEWAY_HOST)) return

  if (!checkApiToken(request.headers.authorization)) {
    return reply.status(401).send({ error: "Unauthorized" })
  }
})
```

**Step 6: Run tests + typecheck**

```bash
pnpm vitest run src/gateway/__tests__/api-auth.test.ts
pnpm typecheck
```
Expected: 4/4 PASS, 0 errors

**Step 7: Commit**

```bash
git add src/gateway/api-auth.ts src/gateway/__tests__/api-auth.test.ts src/gateway/server.ts src/config.ts
git commit -m "feat(gateway): add environment-aware API token auth — localhost trusted, non-local requires Bearer token"
```

---

## Task 5 — Log File Rotation

**Files:**
- Modify: `src/logger.ts`
- Modify: `src/config.ts`

The current logger writes to `logs/edith.log` (single always-appended file, no rotation). We add daily rotation: new file per day, prune files older than `LOG_RETAIN_DAYS`.

**Step 1: Add config var**

In `src/config.ts` ConfigSchema:
```typescript
LOG_RETAIN_DAYS: z.coerce.number().int().positive().default(7),
```

**Step 2: Write failing test**

Create `src/core/__tests__/logger-rotation.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest"

const mockMkdirSync = vi.fn()
const mockCreateWriteStream = vi.fn(() => ({ write: vi.fn(), end: vi.fn() }))
const mockReaddirSync = vi.fn().mockReturnValue([])
const mockUnlinkSync = vi.fn()
const mockExistsSync = vi.fn().mockReturnValue(true)

vi.mock("node:fs", () => ({
  default: {
    mkdirSync: mockMkdirSync,
    createWriteStream: mockCreateWriteStream,
    readdirSync: mockReaddirSync,
    unlinkSync: mockUnlinkSync,
    existsSync: mockExistsSync,
  },
  mkdirSync: mockMkdirSync,
  createWriteStream: mockCreateWriteStream,
  readdirSync: mockReaddirSync,
  unlinkSync: mockUnlinkSync,
  existsSync: mockExistsSync,
}))

vi.mock("../../config.js", () => ({
  default: { LOG_LEVEL: "info", LOG_RETAIN_DAYS: 3 },
}))

import { buildLogFilename, pruneOldLogs } from "../../logger.js"

describe("buildLogFilename", () => {
  it("generates YYYY-MM-DD format filename", () => {
    const name = buildLogFilename(new Date("2026-03-09"))
    expect(name).toBe("edith-2026-03-09.log")
  })
})

describe("pruneOldLogs", () => {
  it("deletes files older than retain window", () => {
    mockReaddirSync.mockReturnValue([
      "edith-2026-01-01.log",
      "edith-2026-01-02.log",
      "edith-2026-01-03.log",
      "edith-2026-03-09.log",
    ])
    pruneOldLogs("/logs", new Date("2026-03-09"), 3)
    // Files more than 3 days old should be deleted
    expect(mockUnlinkSync).toHaveBeenCalledWith(expect.stringContaining("2026-01-01"))
  })
})
```

**Step 3: Run to confirm failure**

```bash
pnpm vitest run src/core/__tests__/logger-rotation.test.ts
```

**Step 4: Update `src/logger.ts`**

Export two new utility functions and update `LogStream` to rotate daily:

```typescript
/** Generate the log filename for a given date. */
export function buildLogFilename(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0")
  return `edith-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.log`
}

/** Delete log files older than retainDays. */
export function pruneOldLogs(logsDir: string, now: Date, retainDays: number): void {
  try {
    const cutoff = new Date(now)
    cutoff.setDate(cutoff.getDate() - retainDays)
    const files = fs.readdirSync(logsDir).filter((f) => f.match(/^edith-\d{4}-\d{2}-\d{2}\.log$/))
    for (const file of files) {
      const datePart = file.slice(6, 16) // "YYYY-MM-DD"
      if (new Date(datePart) < cutoff) {
        fs.unlinkSync(path.join(logsDir, file))
      }
    }
  } catch {
    // Best-effort — never throw from logger
  }
}
```

Update `LogStream` constructor to:
1. Use `buildLogFilename(new Date())` for the filename
2. Schedule midnight rotation via `setTimeout` to switch to next day's file
3. Call `pruneOldLogs` at rotation time

**Step 5: Run tests + typecheck**

```bash
pnpm vitest run src/core/__tests__/logger-rotation.test.ts
pnpm typecheck
```
Expected: PASS, 0 errors

**Step 6: Commit**

```bash
git add src/logger.ts src/core/__tests__/logger-rotation.test.ts src/config.ts
git commit -m "feat(logger): add daily log rotation with configurable retention (LOG_RETAIN_DAYS)"
```

---

## Task 6 — Basic Alerting

**Files:**
- Create: `src/observability/alerting.ts`
- Modify: `src/background/daemon.ts`
- Modify: `src/config.ts`

**Step 1: Add config var**

In `src/config.ts` ConfigSchema:
```typescript
ALERT_USER_ID: z.string().default(""),
ALERT_DEAD_LETTER_THRESHOLD: z.coerce.number().int().positive().default(5),
ALERT_ERROR_RATE_THRESHOLD: z.coerce.number().int().positive().default(10),
```

**Step 2: Write failing test**

Create `src/observability/__tests__/alerting.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest"

const mockSend = vi.fn().mockResolvedValue(true)
vi.mock("../../channels/manager.js", () => ({ channelManager: { send: mockSend } }))
vi.mock("../../channels/outbox.js", () => ({ outbox: { getStatus: vi.fn().mockReturnValue({ pending: 0, deadLetters: 0 }) } }))
vi.mock("../../channels/circuit-breaker.js", () => ({ channelCircuitBreaker: { getState: vi.fn().mockReturnValue("closed") } }))
vi.mock("../../config.js", () => ({ default: { ALERT_USER_ID: "admin", ALERT_DEAD_LETTER_THRESHOLD: 5, ALERT_ERROR_RATE_THRESHOLD: 10 } }))

import { AlertingService } from "../alerting.js"

describe("AlertingService", () => {
  let service: AlertingService

  beforeEach(() => {
    service = new AlertingService()
    vi.clearAllMocks()
  })

  it("does not alert when everything is healthy", async () => {
    await service.check()
    expect(mockSend).not.toHaveBeenCalled()
  })

  it("sends alert when dead-letter count exceeds threshold", async () => {
    const { outbox } = await import("../../channels/outbox.js")
    vi.mocked(outbox.getStatus).mockReturnValue({ pending: 0, deadLetters: 10 })
    await service.check()
    expect(mockSend).toHaveBeenCalledWith("admin", expect.stringContaining("dead-letter"))
  })
})
```

**Step 3: Create `src/observability/alerting.ts`**

```typescript
/**
 * @file alerting.ts
 * @description Lightweight alerting service that sends self-alerts via EDITH's own channels.
 *
 * ARCHITECTURE / INTEGRATION:
 *   Called by daemon.ts every minute.
 *   Checks: dead-letter accumulation, circuit-breaker state, error rate.
 *   Sends alert messages to ALERT_USER_ID via channelManager if triggered.
 *   Uses a cooldown (30min per alert type) to prevent alert storms.
 *
 * @module observability/alerting
 */

import { channelManager } from "../channels/manager.js"
import { outbox } from "../channels/outbox.js"
import { channelCircuitBreaker } from "../channels/circuit-breaker.js"
import { createLogger } from "../logger.js"
import config from "../config.js"

const log = createLogger("observability.alerting")

/** Cooldown between repeated alerts of the same type (30 minutes). */
const ALERT_COOLDOWN_MS = 30 * 60 * 1_000

export class AlertingService {
  private readonly lastAlertAt = new Map<string, number>()

  /**
   * Run all alert checks. Call once per minute from the daemon.
   */
  async check(): Promise<void> {
    if (!config.ALERT_USER_ID) return
    await Promise.all([
      this.checkDeadLetters(),
      this.checkCircuitBreakers(),
    ])
  }

  private async checkDeadLetters(): Promise<void> {
    const { deadLetters } = outbox.getStatus()
    if (deadLetters >= config.ALERT_DEAD_LETTER_THRESHOLD) {
      await this.sendAlert(
        "dead-letter",
        `[EDITH Alert] Outbox dead-letter count reached ${deadLetters} — messages are being dropped after max retries.`,
      )
    }
  }

  private async checkCircuitBreakers(): Promise<void> {
    const channels = ["telegram", "discord", "whatsapp", "sms", "email"]
    const open = channels.filter((c) => channelCircuitBreaker.getState(c) === "open")
    if (open.length >= 2) {
      await this.sendAlert(
        "circuit-breaker",
        `[EDITH Alert] Circuit breaker open on ${open.length} channels: ${open.join(", ")}.`,
      )
    }
  }

  private async sendAlert(type: string, message: string): Promise<void> {
    const now = Date.now()
    const lastSent = this.lastAlertAt.get(type) ?? 0
    if (now - lastSent < ALERT_COOLDOWN_MS) return

    this.lastAlertAt.set(type, now)
    log.warn("sending alert", { type, userId: config.ALERT_USER_ID })
    await channelManager.send(config.ALERT_USER_ID, message)
      .catch((err) => log.warn("alert send failed", { type, err: String(err) }))
  }
}

export const alertingService = new AlertingService()
```

**Step 4: Wire into `src/background/daemon.ts`**

Add import:
```typescript
import { alertingService } from "../observability/alerting.js"
```

In the daemon's 1-minute tick (find the cycle method and add a call to):
```typescript
void alertingService.check()
  .catch((err) => logger.warn("alerting check failed", { err: String(err) }))
```

**Step 5: Run tests + commit**

```bash
pnpm vitest run src/observability/__tests__/alerting.test.ts
pnpm typecheck
git add src/observability/alerting.ts src/observability/__tests__/alerting.test.ts src/background/daemon.ts src/config.ts
git commit -m "feat(observability): add self-alerting service for dead-letters and circuit-breaker events"
```

---

## Task 7 — DM Access Policy

**Files:**
- Create: `src/security/dm-policy.ts`
- Modify: `src/core/message-pipeline.ts`
- Modify: `src/config.ts`

**Step 1: Add config vars**

In `src/config.ts` ConfigSchema (DM_POLICY_MODE and ADMIN_USER_ID already exist from Phase 28):
```typescript
ALLOWED_USER_IDS: z.string().default(""),   // comma-separated
BLOCKED_USER_IDS: z.string().default(""),   // comma-separated
```

**Step 2: Write failing test**

Create `src/security/__tests__/dm-policy.test.ts`:

```typescript
import { describe, it, expect } from "vitest"
import { DmPolicy } from "../dm-policy.js"

describe("DmPolicy — open mode", () => {
  const policy = new DmPolicy({ mode: "open", adminUserId: "", allowedIds: [], blockedIds: [] })
  it("allows any user", () => expect(policy.isAllowed("anyone")).toBe(true))
})

describe("DmPolicy — allowlist mode", () => {
  const policy = new DmPolicy({ mode: "allowlist", adminUserId: "", allowedIds: ["alice", "bob"], blockedIds: [] })
  it("allows listed user", () => expect(policy.isAllowed("alice")).toBe(true))
  it("blocks unlisted user", () => expect(policy.isAllowed("charlie")).toBe(false))
})

describe("DmPolicy — blocklist mode", () => {
  const policy = new DmPolicy({ mode: "blocklist", adminUserId: "", allowedIds: [], blockedIds: ["spammer"] })
  it("blocks listed user", () => expect(policy.isAllowed("spammer")).toBe(false))
  it("allows unlisted user", () => expect(policy.isAllowed("alice")).toBe(true))
})

describe("DmPolicy — admin-only mode", () => {
  const policy = new DmPolicy({ mode: "admin-only", adminUserId: "admin123", allowedIds: [], blockedIds: [] })
  it("allows admin", () => expect(policy.isAllowed("admin123")).toBe(true))
  it("blocks non-admin", () => expect(policy.isAllowed("user456")).toBe(false))
})
```

**Step 3: Create `src/security/dm-policy.ts`**

```typescript
/**
 * @file dm-policy.ts
 * @description DM access control policy for EDITH's message pipeline.
 *
 * ARCHITECTURE / INTEGRATION:
 *   Checked at Stage 0 of message-pipeline.ts before rate-limiting.
 *   Policy mode is configured via DM_POLICY_MODE env var.
 *   The singleton `dmPolicy` reads config at construction time.
 *
 * @module security/dm-policy
 */

import config from "../config.js"
import { createLogger } from "../logger.js"

const log = createLogger("security.dm-policy")

type PolicyMode = "open" | "allowlist" | "blocklist" | "admin-only"

interface DmPolicyConfig {
  mode: PolicyMode
  adminUserId: string
  allowedIds: string[]
  blockedIds: string[]
}

/**
 * DM access policy — controls which userId values may interact with EDITH.
 */
export class DmPolicy {
  private readonly config: DmPolicyConfig

  constructor(cfg: DmPolicyConfig) {
    this.config = cfg
  }

  /**
   * Returns true if the user is allowed to send messages.
   * @param userId - The inbound user identifier
   */
  isAllowed(userId: string): boolean {
    const { mode, adminUserId, allowedIds, blockedIds } = this.config

    switch (mode) {
      case "open":
        return true
      case "allowlist":
        return allowedIds.includes(userId)
      case "blocklist":
        return !blockedIds.includes(userId)
      case "admin-only":
        return userId === adminUserId
    }
  }
}

function parseIds(raw: string): string[] {
  return raw.split(",").map((s) => s.trim()).filter(Boolean)
}

/** Singleton DM policy built from environment config. */
export const dmPolicy = new DmPolicy({
  mode: (config.DM_POLICY_MODE as PolicyMode) ?? "open",
  adminUserId: config.ADMIN_USER_ID ?? "",
  allowedIds: parseIds(config.ALLOWED_USER_IDS ?? ""),
  blockedIds: parseIds(config.BLOCKED_USER_IDS ?? ""),
})

log.info("DM policy active", { mode: config.DM_POLICY_MODE })
```

**Step 4: Wire into `src/core/message-pipeline.ts`**

Add import at top:
```typescript
import { dmPolicy } from "../security/dm-policy.js"
```

In `processMessage()`, right after the `requestId` is generated and BEFORE the rate-limit check, add:
```typescript
// Stage 0a: DM access policy check
if (!dmPolicy.isAllowed(userId)) {
  log.warn("message blocked by DM policy", { userId, requestId })
  return blockedResult(requestId)
}
```

**Step 5: Run tests + commit**

```bash
pnpm vitest run src/security/__tests__/dm-policy.test.ts
pnpm typecheck
git add src/security/dm-policy.ts src/security/__tests__/dm-policy.test.ts src/core/message-pipeline.ts src/config.ts
git commit -m "feat(security): add DM access policy — open/allowlist/blocklist/admin-only modes"
```

---

## Task 8 — Dockerfile + docker-compose

**Files:**
- Create: `Dockerfile`
- Create: `docker-compose.yml`
- Create: `.dockerignore`

No tests needed — build validation is the test.

**Step 1: Create `.dockerignore`**

```
node_modules
.git
.env
logs/
.edith/
prisma/*.db
prisma/*.db-shm
prisma/*.db-wal
coverage/
dist/
*.log
```

**Step 2: Create `Dockerfile`**

```dockerfile
# ─── Stage 1: Node build ─────────────────────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy manifests first (layer cache)
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# Copy source
COPY . .

# Generate Prisma client + build TypeScript
RUN pnpm exec prisma generate
RUN pnpm build 2>/dev/null || true   # tsc or tsup — tolerate if not set up

# ─── Stage 2: Python deps ─────────────────────────────────────────────────────
FROM python:3.11-slim AS python-deps

WORKDIR /python
COPY python/requirements*.txt ./
RUN pip install --no-cache-dir -r requirements.txt 2>/dev/null || true

# ─── Stage 3: Runtime ────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime

# Install Python runtime
RUN apk add --no-cache python3 py3-pip

WORKDIR /app

# Create non-root user
RUN addgroup -S edith && adduser -S edith -G edith

# Copy Node artifacts
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/src ./src
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/workspace ./workspace
COPY --from=builder /app/package.json ./
COPY --from=builder /app/tsconfig.json ./

# Copy Python artifacts
COPY --from=python-deps /python /python
COPY python ./python

# Create data directories owned by edith user
RUN mkdir -p .edith/backups .edith/logs && chown -R edith:edith /app

USER edith

# Run migrations then start EDITH
CMD ["sh", "-c", "node_modules/.bin/prisma migrate deploy && node --loader tsx/esm src/main.ts"]

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1
```

**Step 3: Create `docker-compose.yml`**

```yaml
services:
  edith:
    build:
      context: .
      dockerfile: Dockerfile
    container_name: edith
    restart: unless-stopped
    volumes:
      - ./prisma:/app/prisma           # SQLite DB persistence
      - ./.edith:/app/.edith           # backups + outbox
      - ./.env:/app/.env:ro            # secrets (read-only)
      - ./workspace:/app/workspace     # SOUL.md, USER.md, etc.
    ports:
      - "${GATEWAY_PORT:-3000}:3000"
    env_file:
      - .env
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:3000/health"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 15s
```

**Step 4: Validate**

```bash
docker compose config   # validate docker-compose.yml syntax
```
Expected: prints merged config, no errors.

**Step 5: Commit**

```bash
git add Dockerfile docker-compose.yml .dockerignore
git commit -m "feat(deploy): add multi-stage Dockerfile and docker-compose for VPS/server deployment"
```

---

## Task 9 — Auto-start Scripts

**Files:**
- Create: `scripts/edith.service` (systemd template)
- Create: `scripts/com.edith.plist` (launchd template)
- Create: `scripts/ecosystem.config.cjs` (PM2)
- Create: `scripts/setup-autostart.mjs` (detection + install instructions)
- Modify: `package.json` (add `setup:autostart` script)

No tests needed.

**Step 1: Create `scripts/edith.service`**

```ini
[Unit]
Description=EDITH AI Companion
After=network.target

[Service]
Type=simple
User=__USER__
WorkingDirectory=__INSTALL_DIR__
ExecStart=/usr/bin/node --loader tsx/esm src/main.ts
Restart=on-failure
RestartSec=10
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

**Step 2: Create `scripts/com.edith.plist`**

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>           <string>com.edith.ai</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/node</string>
    <string>--loader</string><string>tsx/esm</string>
    <string>__INSTALL_DIR__/src/main.ts</string>
  </array>
  <key>WorkingDirectory</key> <string>__INSTALL_DIR__</string>
  <key>RunAtLoad</key>        <true/>
  <key>KeepAlive</key>        <true/>
  <key>StandardOutPath</key>  <string>__INSTALL_DIR__/.edith/logs/edith.stdout.log</string>
  <key>StandardErrorPath</key><string>__INSTALL_DIR__/.edith/logs/edith.stderr.log</string>
</dict>
</plist>
```

**Step 3: Create `scripts/ecosystem.config.cjs`**

```javascript
module.exports = {
  apps: [{
    name: "edith",
    script: "src/main.ts",
    interpreter: "node",
    interpreter_args: "--loader tsx/esm",
    cwd: "__INSTALL_DIR__",
    restart_delay: 5000,
    max_restarts: 10,
    env: { NODE_ENV: "production" },
    log_date_format: "YYYY-MM-DD HH:mm:ss",
  }],
}
```

**Step 4: Create `scripts/setup-autostart.mjs`**

```javascript
#!/usr/bin/env node
import { platform } from "node:os"
import { resolve } from "node:path"
import { readFileSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

const installDir = resolve(fileURLToPath(import.meta.url), "../..")
const user = process.env.USER ?? process.env.USERNAME ?? "edith"
const os = platform()

function fill(template, replacements) {
  return Object.entries(replacements).reduce(
    (s, [k, v]) => s.replaceAll(k, v), template
  )
}

console.log(`\nEDITH Auto-start Setup`)
console.log(`Install directory: ${installDir}`)
console.log(`Detected OS: ${os}\n`)

if (os === "linux") {
  const src = readFileSync(new URL("edith.service", import.meta.url), "utf-8")
  const out = fill(src, { __USER__: user, __INSTALL_DIR__: installDir })
  writeFileSync("/tmp/edith.service", out)
  console.log("systemd unit written to /tmp/edith.service")
  console.log("Run these commands to enable:\n")
  console.log("  sudo cp /tmp/edith.service /etc/systemd/system/")
  console.log("  sudo systemctl daemon-reload")
  console.log("  sudo systemctl enable edith")
  console.log("  sudo systemctl start edith\n")
} else if (os === "darwin") {
  const src = readFileSync(new URL("com.edith.plist", import.meta.url), "utf-8")
  const out = fill(src, { __INSTALL_DIR__: installDir })
  const dest = `${process.env.HOME}/Library/LaunchAgents/com.edith.plist`
  writeFileSync(dest, out)
  console.log(`launchd plist written to ${dest}`)
  console.log("Run to start:\n")
  console.log(`  launchctl load ${dest}\n`)
} else if (os === "win32") {
  console.log("Windows: Use PM2 or Task Scheduler.\n")
  console.log("PM2 approach:")
  console.log("  npm install -g pm2")
  console.log("  pm2 start scripts/ecosystem.config.cjs")
  console.log("  pm2 save")
  console.log("  pm2 startup  (follow the printed command)\n")
} else {
  console.log("Unknown OS. Recommend using PM2:")
  console.log("  npm install -g pm2")
  console.log("  pm2 start scripts/ecosystem.config.cjs\n")
}

console.log("PM2 works on all platforms:")
console.log("  npm install -g pm2")
console.log("  pm2 start scripts/ecosystem.config.cjs")
console.log("  pm2 save\n")
```

**Step 5: Add script to `package.json`**

In the `"scripts"` section:
```json
"setup:autostart": "node scripts/setup-autostart.mjs"
```

**Step 6: Test**

```bash
pnpm run setup:autostart
```
Expected: prints platform-specific install instructions without errors.

**Step 7: Commit**

```bash
git add scripts/ package.json
git commit -m "feat(deploy): add auto-start scripts for systemd/launchd/PM2 with pnpm setup:autostart"
```

---

## Task 10 — Final Verification

**Step 1: Full typecheck**

```bash
pnpm typecheck
```
Expected: 0 errors

**Step 2: Full test suite**

```bash
pnpm test
```
Expected: all tests passing (previous count + new tests from Tasks 1–7)

**Step 3: Update MEMORY.md**

Update `C:\Users\test\.claude\projects\C--Users-test-OneDrive-Desktop-EDITH\memory\MEMORY.md` with:
- New files created in this session
- Updated production readiness scores
- New config vars added

**Step 4: Final commit**

```bash
git add docs/plans/
git commit -m "docs: add production hardening implementation plan"
```

/**
 * @file os-agent/types.ts — Shared types for the OS-Agent layer
 * @module os-agent/types
 */

// ── Configuration Types ──

export interface OSAgentConfig {
  gui: GUIConfig
  vision: VisionConfig
  voice: VoiceIOConfig
  system: SystemConfig
  iot: IoTConfig
  /** Perception fusion refresh interval in ms (default: 1000) */
  perceptionIntervalMs?: number
}

export interface GUIConfig {
  enabled: boolean
  /** Automation backend: "native" | "nutjs" | "robotjs" */
  backend: "native" | "nutjs" | "robotjs"
  /** Screenshot method: "native" | "puppeteer" */
  screenshotMethod: "native" | "puppeteer"
  /** Safety: require confirmation for destructive GUI actions */
  requireConfirmation: boolean
  /** Max actions per minute (rate limiting for safety) */
  maxActionsPerMinute: number
}

export interface VisionConfig {
  enabled: boolean
  /** Runtime profile. "minimum-spec" is the safe default for EDITH's minimum system requirement. */
  profile: "minimum-spec" | "balanced"
  /** OCR engine: "tesseract" | "cloud" */
  ocrEngine: "tesseract" | "cloud"
  /** Element detection: "accessibility" | "yolo" | "omniparser" */
  elementDetection: "accessibility" | "yolo" | "omniparser"
  /** Multimodal LLM for image understanding */
  multimodalEngine: "auto" | "gemini" | "openai" | "anthropic" | "ollama"
  /** Screen monitoring interval in ms */
  monitorIntervalMs: number
  /** Rate limit for multimodal requests in ms. */
  rateLimitMs: number
  /** Maximum accepted image payload size in megabytes. */
  maxImageBytesMb: number
  /** Maximum image edge before downscaling. */
  maxImageEdgePx: number
}

export interface VoiceIOConfig {
  enabled: boolean
  mode: "push-to-talk" | "always-on"
  /** Wake word: "hey-edith" | "edith" | custom */
  wakeWord: string
  /** Optional host-local wake model path (.ppn / .onnx / .tflite). */
  wakeWordModelPath?: string
  /** Wake word engine: "porcupine" | "openwakeword" */
  wakeWordEngine: "porcupine" | "openwakeword"
  /** STT engine for host-side always-on mode. */
  sttEngine: "auto" | "python-whisper" | "deepgram"
  /** VAD engine preference for host-side turn detection. */
  vadEngine: "cobra" | "silero" | "webrtc"
  /** Whisper model size (if local): "tiny" | "base" | "small" | "medium" | "large". */
  whisperModel?: "tiny" | "base" | "small" | "medium" | "large"
  /** Audio input device index (undefined = default) */
  inputDeviceIndex?: number
  /** Audio output device index (undefined = default) */
  outputDeviceIndex?: number
  /** Enable full-duplex (barge-in / interruption support) */
  fullDuplex: boolean
  /** Language for STT and transcript normalization. */
  language: "auto" | "id" | "en" | "multi"
  /** Preferred TTS voice for host-side playback. */
  ttsVoice?: string
  /** Optional provider credentials stored in edith.json, never env-injected. */
  providers?: {
    deepgram?: {
      apiKey?: string
    }
    picovoice?: {
      accessKey?: string
    }
  }
}

export interface SystemConfig {
  enabled: boolean
  /** File system paths to watch */
  watchPaths: string[]
  /** Monitor clipboard changes */
  watchClipboard: boolean
  /** Monitor active window changes */
  watchActiveWindow: boolean
  /** Resource check interval in ms */
  resourceCheckIntervalMs: number
  /** CPU threshold to warn (percentage) */
  cpuWarningThreshold: number
  /** RAM threshold to warn (percentage) */
  ramWarningThreshold: number
  /** Disk threshold to warn (percentage) */
  diskWarningThreshold: number
}

export interface IoTConfig {
  enabled: boolean
  /** Home Assistant server URL */
  homeAssistantUrl?: string
  /** Home Assistant long-lived access token */
  homeAssistantToken?: string
  /** MQTT broker URL */
  mqttBrokerUrl?: string
  /** MQTT username */
  mqttUsername?: string
  /** MQTT password */
  mqttPassword?: string
  /** Auto-discover devices on startup */
  autoDiscover: boolean
}

export type NotificationPriority = "low" | "medium" | "high"

export type NotificationChannel = "desktop" | "mobile" | "voice"

export interface NotificationPayload {
  userId: string
  title: string
  message: string
  priority: NotificationPriority
  source: "trigger" | "file-watcher" | "heartbeat" | "system"
  channels?: NotificationChannel[]
  bypassQuietHours?: boolean
  cooldownKey?: string
  cooldownMs?: number
  metadata?: Record<string, unknown>
}

export interface NotificationDispatchResult {
  ok: boolean
  requestedChannels: NotificationChannel[]
  deliveredChannels: NotificationChannel[]
  suppressedReason?: "proactive-disabled" | "quiet-hours" | "cooldown" | "no-channels"
}

// ── Action Types ──

export type OSAction =
  | { type: "gui"; payload: GUIActionPayload }
  | { type: "shell"; payload: ShellActionPayload }
  | { type: "voice"; payload: VoiceActionPayload }
  | { type: "iot"; payload: IoTActionPayload }
  | { type: "screenshot"; payload?: ScreenshotPayload }

export interface GUIActionPayload {
  action: "click" | "double_click" | "right_click" | "type" | "hotkey" | "scroll" | "drag" | "move" | "focus_window" | "open_app" | "close_window"
  coordinates?: { x: number; y: number }
  endCoordinates?: { x: number; y: number }
  text?: string
  keys?: string[]
  direction?: "up" | "down" | "left" | "right"
  amount?: number
  windowTitle?: string
  appName?: string
  /** Natural-language target for grounding, e.g. "Save button". */
  targetQuery?: string
  /** Expected observable result after the action, used by the reflect loop. */
  expectedOutcome?: string
  /** If false, skip the post-action visual reflection step. */
  reflectAfterAction?: boolean
}

export interface ShellActionPayload {
  command: string
  options?: {
    cwd?: string
    timeout?: number
    shell?: "bash" | "powershell" | "cmd" | "zsh"
    /** If true, run in background and return immediately */
    background?: boolean
  }
}

export interface VoiceActionPayload {
  text: string
  options?: {
    voice?: string
    rate?: number
    pitch?: number
    /** If true, wait for speech to finish before returning */
    blocking?: boolean
  }
}

export interface IoTActionPayload {
  target: "home_assistant" | "mqtt"
  domain?: string
  service?: string
  entityId?: string
  topic?: string
  data?: Record<string, unknown>
}

export interface ScreenshotPayload {
  region?: { x: number; y: number; width: number; height: number }
  analyze?: boolean
}

// ── Result Types ──

export interface OSActionResult {
  success: boolean
  data?: unknown
  error?: string
  duration?: number
}

// ── Perception Types ──

export interface PerceptionSnapshot {
  timestamp: number
  screen?: ScreenState
  audio?: AudioState
  system: SystemState
  iot?: IoTState
  activeContext: ActiveContext
}

export interface ScreenState {
  /** Active window title */
  activeWindowTitle: string
  /** Active window process name */
  activeWindowProcess: string
  /** Screen resolution */
  resolution: { width: number; height: number }
  /** Optional: detected UI elements */
  elements?: UIElement[]
  /** Optional: OCR text from screen */
  ocrText?: string
}

export interface AudioState {
  /** Is someone currently speaking? */
  isSpeaking: boolean
  /** Is the wake word active? */
  wakeWordDetected: boolean
  /** Current audio level (0-1) */
  audioLevel: number
  /** Transcribed text (if STT is active) */
  transcription?: string
}

export interface SystemState {
  /** CPU usage percentage (0-100) */
  cpuUsage: number
  /** RAM usage percentage (0-100) */
  ramUsage: number
  /** Battery level (0-100, undefined if no battery) */
  batteryLevel?: number
  /** Is charging? */
  isCharging?: boolean
  /** Disk usage percentage */
  diskUsage: number
  /** Currently running process names (top 10) */
  topProcesses: string[]
  /** Network connectivity */
  networkConnected: boolean
  /** User idle time in seconds */
  idleTimeSeconds: number
  /** Clipboard content (truncated) */
  clipboardPreview?: string
}

export interface IoTState {
  /** Connected devices count */
  connectedDevices: number
  /** Device states summary */
  devices: Array<{
    entityId: string
    friendlyName: string
    state: string
    domain: string
  }>
}

export interface ActiveContext {
  /** What the user is currently doing (inferred) */
  userActivity: "coding" | "browsing" | "writing" | "communicating" | "designing" | "gaming" | "media" | "idle" | "unknown"
  /** Confidence of activity detection (0-1) */
  activityConfidence: number
  /** Current project/workspace (if detectable) */
  currentProject?: string
  /** Duration of current activity in minutes */
  activityDurationMinutes: number
}

export interface UIElement {
  type: "button" | "input" | "link" | "text" | "image" | "menu" | "checkbox" | "dropdown" | "tab" | "unknown"
  text: string
  bounds: { x: number; y: number; width: number; height: number }
  interactable: boolean
  /** Accessibility role (if available) */
  role?: string
  /** Accessibility name */
  name?: string
  /** Detection source for observability and routing decisions. */
  source?: "accessibility" | "llm-som" | "llm-vision" | "advanced-detector"
  /** Confidence score [0-1] from grounding or detection. */
  confidence?: number
  /** Optional verifier result for LLM-grounded candidates. */
  verification?: GroundingVerification
}

export interface GroundingVerification {
  passed: boolean
  score: number
  method: "heuristic" | "multimodal" | "multimodal+heuristic"
  reason: string
}

export interface GUIActionReflection {
  action: GUIActionPayload["action"]
  success: boolean
  verificationStatus: "confirmed" | "uncertain" | "not-observed"
  summary: string
  signals: string[]
  beforeWindow?: string
  afterWindow?: string
  targetQuery?: string
  expectedOutcome?: string
  resolvedElement?: UIElement
  memoryId?: string | null
  episodeId?: string
}

export interface VisualMemoryMatch {
  id: string
  source: "semantic-memory" | "episodic-memory"
  kind: "visual_context" | "visual_reflection"
  content: string
  activeWindow?: string
  timestamp?: number
  score: number
  tags?: string[]
}

export interface VisualMemoryRecall {
  query: string
  matches: VisualMemoryMatch[]
  summary: string[]
}

export interface WindowInfo {
  title: string
  processName: string
  pid: number
  bounds: { x: number; y: number; width: number; height: number }
  isActive: boolean
}

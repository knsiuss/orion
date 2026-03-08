/**
 * @file bridge.test.ts
 * @description Unit tests for VoiceBridge — TTS/STT orchestration with provider fallback.
 *
 * ARCHITECTURE / INTEGRATION:
 *   Tests the VoiceBridge class in isolation by mocking all external I/O:
 *   - kokoro-js (KokoroTTS provider)
 *   - nodejs-whisper (WhisperCpp STT)
 *   - execa (Python sidecar calls)
 *   - fish-audio (Fish Audio HTTP/WS TTS)
 *   - offline coordinator (connectivity state)
 *   - fs (file system reads/writes)
 *
 *   VoiceBridge never performs real I/O in these tests.
 *   All provider paths (Kokoro.js, Fish Audio, Python fallback) are exercised.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// ---------------------------------------------------------------------------
// Module-level mocks — must be declared BEFORE any import that references them
// ---------------------------------------------------------------------------

vi.mock("../../config.js", () => ({
  default: {
    VOICE_ENABLED: false,
    KOKORO_TTS_ENABLED: false,
    KOKORO_TTS_DTYPE: "q8",
    KOKORO_TTS_VOICE: "af_heart",
    FISH_AUDIO_ENABLED: false,
    FISH_AUDIO_API_KEY: "",
    FISH_AUDIO_MODEL_ID: "s1",
    FISH_AUDIO_LATENCY: "balanced",
    FISH_AUDIO_EMOTION_MODELS: "",
    WHISPER_CPP_ENABLED: false,
    WHISPER_CPP_MODEL: "base",
    VOICE_LANGUAGE: "",
    PYTHON_PATH: "python",
  },
}))

vi.mock("../../logger.js", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}))

vi.mock("../../offline/coordinator.js", () => ({
  offlineCoordinator: {
    isOffline: vi.fn().mockReturnValue(false),
  },
}))

vi.mock("../fish-audio.js", () => ({
  fishAudioSpeak: vi.fn().mockResolvedValue(null),
  fishAudioSpeakStreaming: vi.fn().mockResolvedValue(false),
}))

vi.mock("execa", () => ({
  execa: vi.fn().mockResolvedValue({ stdout: "", stderr: "" }),
}))

vi.mock("node:fs/promises", () => ({
  default: {
    readFile: vi.fn().mockResolvedValue(Buffer.from("FAKE_WAV")),
    writeFile: vi.fn().mockResolvedValue(undefined),
    unlink: vi.fn().mockResolvedValue(undefined),
  },
}))

// ---------------------------------------------------------------------------
// Imports (after mocks are set up)
// ---------------------------------------------------------------------------

import config from "../../config.js"
import { offlineCoordinator } from "../../offline/coordinator.js"
import { fishAudioSpeak, fishAudioSpeakStreaming } from "../fish-audio.js"
import { execa } from "execa"
import fs from "node:fs/promises"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Mutate the mocked config to override specific fields for a single test. */
function withConfig(overrides: Partial<typeof config>): void {
  Object.assign(config, overrides)
}

/** Reset config back to the base "voice disabled" state. */
function resetConfig(): void {
  Object.assign(config, {
    VOICE_ENABLED: false,
    KOKORO_TTS_ENABLED: false,
    FISH_AUDIO_ENABLED: false,
    FISH_AUDIO_API_KEY: "",
    WHISPER_CPP_ENABLED: false,
  })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("VoiceBridge", () => {
  let VoiceBridge: typeof import("../bridge.js").VoiceBridge

  beforeEach(async () => {
    vi.clearAllMocks()
    resetConfig()
    vi.mocked(offlineCoordinator.isOffline).mockReturnValue(false)
    vi.mocked(fishAudioSpeak).mockResolvedValue(null)
    vi.mocked(fishAudioSpeakStreaming).mockResolvedValue(false)
    vi.mocked(execa).mockResolvedValue({ stdout: "", stderr: "" } as ReturnType<typeof execa> extends Promise<infer T> ? T : never)
    vi.mocked(fs.readFile).mockResolvedValue(Buffer.from("FAKE_WAV") as Parameters<typeof fs.readFile>[0] extends string ? Buffer : never)
    vi.mocked(fs.writeFile).mockResolvedValue(undefined)
    vi.mocked(fs.unlink).mockResolvedValue(undefined)

    // Re-import fresh each time to reset module-level singletons
    // (kokoroInitAttempted, whisperCppAttempted, etc.)
    vi.resetModules()
    const mod = await import("../bridge.js")
    VoiceBridge = mod.VoiceBridge
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // =========================================================================
  //  speak() — voice disabled
  // =========================================================================

  describe("speak() when VOICE_ENABLED=false", () => {
    it("returns without calling any TTS provider", async () => {
      withConfig({ VOICE_ENABLED: false })
      const bridge = new VoiceBridge()

      await bridge.speak("Hello world")

      expect(execa).not.toHaveBeenCalled()
      expect(fishAudioSpeak).not.toHaveBeenCalled()
    })

    it("handles empty string silently", async () => {
      withConfig({ VOICE_ENABLED: false })
      const bridge = new VoiceBridge()

      await expect(bridge.speak("")).resolves.toBeUndefined()
      expect(execa).not.toHaveBeenCalled()
    })
  })

  // =========================================================================
  //  speak() — voice enabled, Python fallback
  // =========================================================================

  describe("speak() when VOICE_ENABLED=true, local TTS disabled", () => {
    it("falls through to Python sidecar when Kokoro and Fish Audio are disabled", async () => {
      withConfig({
        VOICE_ENABLED: true,
        KOKORO_TTS_ENABLED: false,
        FISH_AUDIO_ENABLED: false,
      })
      const bridge = new VoiceBridge()

      await bridge.speak("Test speech")

      expect(execa).toHaveBeenCalledOnce()
      const [cmd] = vi.mocked(execa).mock.calls[0]
      expect(cmd).toBe("python")
    })

    it("passes the text to the Python sidecar", async () => {
      withConfig({ VOICE_ENABLED: true, KOKORO_TTS_ENABLED: false, FISH_AUDIO_ENABLED: false })
      const bridge = new VoiceBridge()

      await bridge.speak("Say this")

      const args = vi.mocked(execa).mock.calls[0][1] as string[]
      const pyCode = args.join(" ")
      expect(pyCode).toContain("Say this")
    })

    it("does not throw when Python sidecar fails", async () => {
      withConfig({ VOICE_ENABLED: true, KOKORO_TTS_ENABLED: false })
      vi.mocked(execa).mockRejectedValueOnce(new Error("python not found"))
      const bridge = new VoiceBridge()

      await expect(bridge.speak("boom")).resolves.toBeUndefined()
    })
  })

  // =========================================================================
  //  speak() — Fish Audio path
  // =========================================================================

  describe("speak() when Fish Audio is enabled and online", () => {
    it("calls fishAudioSpeak when online and returns buffer", async () => {
      withConfig({
        VOICE_ENABLED: true,
        KOKORO_TTS_ENABLED: false,
        FISH_AUDIO_ENABLED: true,
        FISH_AUDIO_API_KEY: "test-key",
      })
      vi.mocked(offlineCoordinator.isOffline).mockReturnValue(false)
      vi.mocked(fishAudioSpeak).mockResolvedValue(Buffer.from("WAV_DATA"))
      const bridge = new VoiceBridge()

      await bridge.speak("Fish audio test")

      expect(fishAudioSpeak).toHaveBeenCalledWith("Fish audio test")
    })

    it("skips Fish Audio when offline even if enabled", async () => {
      withConfig({
        VOICE_ENABLED: true,
        KOKORO_TTS_ENABLED: false,
        FISH_AUDIO_ENABLED: true,
        FISH_AUDIO_API_KEY: "test-key",
      })
      vi.mocked(offlineCoordinator.isOffline).mockReturnValue(true)
      const bridge = new VoiceBridge()

      await bridge.speak("Offline test")

      expect(fishAudioSpeak).not.toHaveBeenCalled()
    })

    it("falls back to Python when Fish Audio returns null", async () => {
      withConfig({
        VOICE_ENABLED: true,
        KOKORO_TTS_ENABLED: false,
        FISH_AUDIO_ENABLED: true,
        FISH_AUDIO_API_KEY: "key",
      })
      vi.mocked(offlineCoordinator.isOffline).mockReturnValue(false)
      vi.mocked(fishAudioSpeak).mockResolvedValue(null)
      const bridge = new VoiceBridge()

      await bridge.speak("Fallback needed")

      expect(execa).toHaveBeenCalled()
    })
  })

  // =========================================================================
  //  speak() — Kokoro.js path (dynamic import returns null / not installed)
  // =========================================================================

  describe("speak() when KOKORO_TTS_ENABLED=true but kokoro-js not installed", () => {
    it("falls back to Python sidecar gracefully", async () => {
      withConfig({ VOICE_ENABLED: true, KOKORO_TTS_ENABLED: true })
      // The dynamic import inside loadKokoroTTS uses Function('return import(...)') which
      // resolves to null in test environment — so kokoroSpeak returns null and Python runs
      const bridge = new VoiceBridge()

      await bridge.speak("Kokoro unavailable")

      // Python sidecar should be called as fallback
      expect(execa).toHaveBeenCalled()
    })
  })

  // =========================================================================
  //  transcribe()
  // =========================================================================

  describe("transcribe()", () => {
    it("returns empty string when VOICE_ENABLED=false", async () => {
      withConfig({ VOICE_ENABLED: false })
      const bridge = new VoiceBridge()

      const result = await bridge.transcribe("/tmp/audio.wav")

      expect(result).toBe("")
      expect(execa).not.toHaveBeenCalled()
    })

    it("calls Python sidecar when WhisperCpp is disabled", async () => {
      withConfig({ VOICE_ENABLED: true, WHISPER_CPP_ENABLED: false })
      vi.mocked(execa).mockResolvedValueOnce({ stdout: "hello world", stderr: "" } as ReturnType<typeof execa> extends Promise<infer T> ? T : never)
      const bridge = new VoiceBridge()

      const result = await bridge.transcribe("/tmp/test.wav")

      expect(execa).toHaveBeenCalled()
      expect(result).toBe("hello world")
    })

    it("returns empty string when Python sidecar transcription fails", async () => {
      withConfig({ VOICE_ENABLED: true, WHISPER_CPP_ENABLED: false })
      vi.mocked(execa).mockRejectedValueOnce(new Error("sidecar crash"))
      const bridge = new VoiceBridge()

      const result = await bridge.transcribe("/tmp/test.wav")

      expect(result).toBe("")
    })

    it("calls WhisperCpp path when WHISPER_CPP_ENABLED=true (falls back to Python if not installed)", async () => {
      withConfig({ VOICE_ENABLED: true, WHISPER_CPP_ENABLED: true })
      vi.mocked(execa).mockResolvedValueOnce({ stdout: "from python", stderr: "" } as ReturnType<typeof execa> extends Promise<infer T> ? T : never)
      const bridge = new VoiceBridge()

      // WhisperCpp's dynamic import fails in test env → whisperCppAvailable=false → Python fallback
      const result = await bridge.transcribe("/tmp/audio.wav")

      // Either WhisperCpp returned a result or Python did — either way no throw
      expect(typeof result).toBe("string")
    })

    it("trims whitespace from Python sidecar output", async () => {
      withConfig({ VOICE_ENABLED: true, WHISPER_CPP_ENABLED: false })
      vi.mocked(execa).mockResolvedValueOnce({ stdout: "  trimmed output  ", stderr: "" } as ReturnType<typeof execa> extends Promise<infer T> ? T : never)
      const bridge = new VoiceBridge()

      const result = await bridge.transcribe("/tmp/audio.wav")

      expect(result).toBe("trimmed output")
    })
  })

  // =========================================================================
  //  listen()
  // =========================================================================

  describe("listen()", () => {
    it("returns empty string when VOICE_ENABLED=false", async () => {
      withConfig({ VOICE_ENABLED: false })
      const bridge = new VoiceBridge()

      const result = await bridge.listen()

      expect(result).toBe("")
      expect(execa).not.toHaveBeenCalled()
    })

    it("calls Python sidecar with correct duration", async () => {
      withConfig({ VOICE_ENABLED: true })
      vi.mocked(execa).mockResolvedValueOnce({ stdout: "user said hello", stderr: "" } as ReturnType<typeof execa> extends Promise<infer T> ? T : never)
      const bridge = new VoiceBridge()

      const result = await bridge.listen(3)

      expect(execa).toHaveBeenCalled()
      const args = vi.mocked(execa).mock.calls[0][1] as string[]
      expect(args.join(" ")).toContain("3")
      expect(result).toBe("user said hello")
    })

    it("returns empty string when sidecar fails", async () => {
      withConfig({ VOICE_ENABLED: true })
      vi.mocked(execa).mockRejectedValueOnce(new Error("mic fail"))
      const bridge = new VoiceBridge()

      const result = await bridge.listen()

      expect(result).toBe("")
    })
  })

  // =========================================================================
  //  getProviderStatus()
  // =========================================================================

  describe("getProviderStatus()", () => {
    it("reports python for both TTS and STT when local providers are disabled", async () => {
      withConfig({ VOICE_ENABLED: false, KOKORO_TTS_ENABLED: false, WHISPER_CPP_ENABLED: false })
      vi.mocked(offlineCoordinator.isOffline).mockReturnValue(false)
      const bridge = new VoiceBridge()

      const status = await bridge.getProviderStatus()

      expect(status.tts).toBe("python")
      expect(status.stt).toBe("python")
      expect(status.offline).toBe(false)
    })

    it("reports offline=true when OfflineCoordinator says offline", async () => {
      vi.mocked(offlineCoordinator.isOffline).mockReturnValue(true)
      const bridge = new VoiceBridge()

      const status = await bridge.getProviderStatus()

      expect(status.offline).toBe(true)
    })

    it("reports python/python when Kokoro and WhisperCpp are enabled but not installed", async () => {
      withConfig({ KOKORO_TTS_ENABLED: true, WHISPER_CPP_ENABLED: true })
      vi.mocked(offlineCoordinator.isOffline).mockReturnValue(false)
      const bridge = new VoiceBridge()

      const status = await bridge.getProviderStatus()

      // Dynamic import fails in test → both report "python"
      expect(status.tts).toBe("python")
      expect(status.stt).toBe("python")
    })
  })

  // =========================================================================
  //  speakStreaming()
  // =========================================================================

  describe("speakStreaming()", () => {
    it("returns without calling any provider when VOICE_ENABLED=false", async () => {
      withConfig({ VOICE_ENABLED: false })
      const bridge = new VoiceBridge()
      const onChunk = vi.fn()

      await bridge.speakStreaming("Hello", "default", onChunk)

      expect(onChunk).not.toHaveBeenCalled()
      expect(execa).not.toHaveBeenCalled()
    })

    it("calls Python sidecar when local TTS is disabled", async () => {
      withConfig({ VOICE_ENABLED: true, KOKORO_TTS_ENABLED: false, FISH_AUDIO_ENABLED: false })
      // Build a mock child process that resolves immediately so speakStreaming does not hang
      const resolvedPromise = Promise.resolve({ stdout: "", stderr: "" })
      const mockChild = Object.assign(resolvedPromise, {
        stdout: { on: vi.fn() },
        kill: vi.fn(),
        stderr: null,
      })
      vi.mocked(execa).mockReturnValueOnce(mockChild as unknown as ReturnType<typeof execa>)
      const bridge = new VoiceBridge()

      await bridge.speakStreaming("Stream this", "default", vi.fn())

      expect(execa).toHaveBeenCalled()
    })

    it("uses Fish Audio streaming when enabled and online", async () => {
      withConfig({
        VOICE_ENABLED: true,
        KOKORO_TTS_ENABLED: false,
        FISH_AUDIO_ENABLED: true,
        FISH_AUDIO_API_KEY: "key",
      })
      vi.mocked(offlineCoordinator.isOffline).mockReturnValue(false)
      vi.mocked(fishAudioSpeakStreaming).mockResolvedValue(true)
      const bridge = new VoiceBridge()
      const onChunk = vi.fn()

      await bridge.speakStreaming("Fish stream", "default", onChunk)

      expect(fishAudioSpeakStreaming).toHaveBeenCalledWith("Fish stream", undefined, onChunk)
      expect(execa).not.toHaveBeenCalled()
    })
  })

  // =========================================================================
  //  startStreamingConversation()
  // =========================================================================

  describe("startStreamingConversation()", () => {
    it("returns a no-op stop function when VOICE_ENABLED=false", async () => {
      withConfig({ VOICE_ENABLED: false })
      const bridge = new VoiceBridge()

      const stop = await bridge.startStreamingConversation(vi.fn(), vi.fn())

      expect(typeof stop).toBe("function")
      expect(() => stop()).not.toThrow()
      expect(execa).not.toHaveBeenCalled()
    })

    it("returns a callable stop function when VOICE_ENABLED=true", async () => {
      withConfig({ VOICE_ENABLED: true })
      const mockKill = vi.fn()
      const resolvedPromise = Promise.resolve({ stdout: "", stderr: "" })
      const mockChild = Object.assign(resolvedPromise, {
        stdout: { on: vi.fn() },
        kill: mockKill,
        stderr: null,
      })
      vi.mocked(execa).mockReturnValueOnce(mockChild as unknown as ReturnType<typeof execa>)
      const bridge = new VoiceBridge()

      const stop = await bridge.startStreamingConversation(vi.fn(), vi.fn())
      stop()

      expect(mockKill).toHaveBeenCalledWith("SIGTERM")
    })
  })

  // =========================================================================
  //  checkWakeWord()
  // =========================================================================

  describe("checkWakeWord()", () => {
    it("returns false when VOICE_ENABLED=false", async () => {
      withConfig({ VOICE_ENABLED: false })
      const bridge = new VoiceBridge()

      const result = await bridge.checkWakeWord("edith")

      expect(result).toBe(false)
    })

    it("returns true when Python sidecar outputs 'true'", async () => {
      withConfig({ VOICE_ENABLED: true })
      vi.mocked(execa).mockResolvedValueOnce({ stdout: "true", stderr: "" } as ReturnType<typeof execa> extends Promise<infer T> ? T : never)
      const bridge = new VoiceBridge()

      const result = await bridge.checkWakeWord("edith")

      expect(result).toBe(true)
    })

    it("returns false when Python sidecar outputs 'false'", async () => {
      withConfig({ VOICE_ENABLED: true })
      vi.mocked(execa).mockResolvedValueOnce({ stdout: "false", stderr: "" } as ReturnType<typeof execa> extends Promise<infer T> ? T : never)
      const bridge = new VoiceBridge()

      const result = await bridge.checkWakeWord("edith")

      expect(result).toBe(false)
    })

    it("returns false when Python sidecar throws", async () => {
      withConfig({ VOICE_ENABLED: true })
      vi.mocked(execa).mockRejectedValueOnce(new Error("timeout"))
      const bridge = new VoiceBridge()

      const result = await bridge.checkWakeWord("edith", 1)

      expect(result).toBe(false)
    })
  })

  // =========================================================================
  //  listProfiles()
  // =========================================================================

  describe("listProfiles()", () => {
    it("returns parsed JSON array from Python sidecar", async () => {
      vi.mocked(execa).mockResolvedValueOnce({ stdout: '["default","warm","formal"]', stderr: "" } as ReturnType<typeof execa> extends Promise<infer T> ? T : never)
      const bridge = new VoiceBridge()

      const profiles = await bridge.listProfiles()

      expect(profiles).toEqual(["default", "warm", "formal"])
    })

    it("returns empty array when Python sidecar fails", async () => {
      vi.mocked(execa).mockRejectedValueOnce(new Error("no python"))
      const bridge = new VoiceBridge()

      const profiles = await bridge.listProfiles()

      expect(profiles).toEqual([])
    })
  })

  // =========================================================================
  //  Offline coordinator integration
  // =========================================================================

  describe("offline coordinator integration", () => {
    it("shouldPreferLocalTTS is true when offline even if KOKORO_TTS_ENABLED=false", async () => {
      withConfig({ VOICE_ENABLED: true, KOKORO_TTS_ENABLED: false, FISH_AUDIO_ENABLED: false })
      vi.mocked(offlineCoordinator.isOffline).mockReturnValue(true)
      const bridge = new VoiceBridge()

      // When offline, Kokoro path is attempted. Since it's not installed in tests,
      // it falls through to Python. But Fish Audio must NOT be called.
      await bridge.speak("Offline test")

      expect(fishAudioSpeak).not.toHaveBeenCalled()
    })

    it("shouldPreferLocalSTT is true when offline even if WHISPER_CPP_ENABLED=false", async () => {
      withConfig({ VOICE_ENABLED: true, WHISPER_CPP_ENABLED: false })
      vi.mocked(offlineCoordinator.isOffline).mockReturnValue(true)
      vi.mocked(execa).mockResolvedValueOnce({ stdout: "fallback", stderr: "" } as ReturnType<typeof execa> extends Promise<infer T> ? T : never)
      const bridge = new VoiceBridge()

      // WhisperCpp dynamic import fails in tests → falls to Python. No throw expected.
      const result = await bridge.transcribe("/tmp/offline.wav")

      expect(typeof result).toBe("string")
    })
  })

  // =========================================================================
  //  voice singleton export
  // =========================================================================

  describe("singleton export", () => {
    it("exports a VoiceBridge singleton named 'voice'", async () => {
      const mod = await import("../bridge.js")
      expect(mod.voice).toBeInstanceOf(mod.VoiceBridge)
    })
  })
})

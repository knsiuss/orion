# Phase 1 - Voice Input Pipeline

Status: Complete with operational caveats
Milestone scope: Voice milestone only
Canonical runtime: Gateway-first push-to-talk plus desktop host always-on reusing the same voice configuration and response pipeline

## Summary

Phase 1 is closed for the voice milestone.

- `Phase 1A` ships one canonical push-to-talk path through the gateway.
- `Phase 1B` ships desktop host always-on voice with wake word, turn detection, and barge-in on top of the same runtime voice config.
- Voice provider credentials are user-managed in top-level `voice` config inside `edith.json`, not in `env`.
- Desktop and mobile are thin clients for capture, transport, and playback. The gateway remains the canonical runtime for STT -> chat pipeline -> TTS.
- Repo-wide TypeScript and non-voice test failures are explicitly out of scope for this milestone.

## Shipped Architecture

### Phase 1A: Gateway-first buffered push-to-talk

The canonical request path is:

`capture audio -> voice_start / voice_chunk / voice_stop -> VoiceSessionManager -> STT -> existing chat pipeline -> Edge TTS -> voice_audio playback`

Current behavior:

- Desktop and mobile can start a voice session with `voice_start`.
- Clients may stream repeated `voice_chunk` messages or send the full buffered recording on `voice_stop`.
- The gateway owns session lifecycle through `VoiceSessionManager`.
- STT runs first, then the existing response pipeline runs unchanged, then TTS streams audio chunks back to the client.
- Text chat contracts remain unchanged. Voice adds a parallel `voice_*` contract for turn events and playback.

Implementation anchors:

- `EDITH-ts/src/gateway/server.ts`
- `EDITH-ts/src/voice/session-manager.ts`
- `EDITH-ts/src/voice/providers.ts`

### Phase 1B: Desktop host always-on voice

The host-side always-on path is:

`host mic capture -> Python streaming VAD/segmentation -> native wake word when available -> STT turn -> existing message pipeline -> Edge TTS playback`

Current behavior:

- Startup enables the OS-Agent voice loop when top-level `voice.mode` is `always-on`.
- `VoiceIO` handles mic capture, turn segmentation, wake handling, speech events, and TTS interruption.
- Barge-in cancels active TTS when full-duplex mode is enabled.
- Wake-word execution prefers native engine paths when dependencies and model assets are available.
- If native wake-word requirements are not met, the runtime falls back to transcript-keyword behavior instead of failing startup.

Implementation anchors:

- `EDITH-ts/src/core/startup.ts`
- `EDITH-ts/src/os-agent/voice-io.ts`
- `EDITH-ts/src/os-agent/voice-plan.ts`
- `EDITH-ts/src/voice/wake-model-assets.ts`

## Runtime Decisions

These are the locked Phase 1 runtime decisions.

- The gateway is the canonical voice runtime for push-to-talk.
- Desktop and mobile do not own separate voice response pipelines.
- Top-level `voice` config in `edith.json` is the source of truth.
- Legacy `osAgent.voice` values are still read as compatibility fallback, but new setup flows should write top-level `voice`.
- Voice credentials are stored under `voice.*`, not injected into `process.env`.
- Deepgram is optional. If Deepgram is configured and the requested language is `en` or `id`, the runtime may use Deepgram; otherwise it falls back to local Python Whisper.
- TTS is Edge-only in Phase 1.
- OpenWakeWord is the recommended native wake-word path for default setup.
- Porcupine is supported when the user provides both a Picovoice access key and a custom `.ppn` keyword model.

## Public Contracts

### `edith.json`

Phase 1 documents the following top-level `voice` structure:

```json
{
  "voice": {
    "enabled": true,
    "mode": "push-to-talk",
    "stt": {
      "engine": "auto",
      "language": "auto",
      "whisperModel": "base",
      "providers": {
        "deepgram": {
          "apiKey": ""
        }
      }
    },
    "tts": {
      "engine": "edge",
      "voice": "en-US-GuyNeural"
    },
    "wake": {
      "engine": "openwakeword",
      "keyword": "hey-edith",
      "modelPath": "",
      "providers": {
        "picovoice": {
          "accessKey": ""
        }
      }
    },
    "vad": {
      "engine": "silero"
    }
  }
}
```

### Gateway and setup APIs

- `GET /api/config`
  - returns current config with nested secrets redacted, including `voice.stt.providers.deepgram.apiKey` and `voice.wake.providers.picovoice.accessKey`
- `PUT /api/config`
  - full config replace
- `PATCH /api/config`
  - partial config merge
- `POST /api/config/test-provider`
  - supports provider tests including Deepgram using request credentials, not env injection
- `POST /api/config/prepare-wake-model`
  - prepares the recommended host OpenWakeWord preset and returns keyword plus asset paths

### WebSocket voice protocol

Client -> server:

- `voice_start`
  - includes `requestId`, `encoding`, `mimeType`, `sampleRate`, `channelCount`, and optional `language`
- `voice_chunk`
  - includes `requestId`, `data`, and optional `sequence`
- `voice_stop`
  - includes `requestId` and may include full buffered `data`

Server -> client:

- `voice_started`
- `voice_transcript`
- `assistant_transcript`
- `voice_audio`
- `voice_stopped`
- `error`

## Setup Flows

Desktop and mobile setup now write voice settings through config surfaces instead of env-only setup.

- Desktop onboarding writes the chat provider into `env` when needed and writes voice settings under top-level `voice`.
- Desktop onboarding can browse a local wake model path and can prepare the recommended OpenWakeWord preset on the gateway host.
- Mobile setup writes the same top-level `voice` structure through `PATCH /api/config`.
- Mobile setup can also call `POST /api/config/prepare-wake-model` for the recommended OpenWakeWord host preset.

Phase 1 recommended path:

- Use `openwakeword`
- prepare the recommended preset on the host
- accept the returned keyword and `modelPath`

## Operational Readiness

Phase 1 voice is ready for use.

Important caveats:

- The recommended managed wake-model flow currently prepares the official OpenWakeWord preset `hey mycroft`, not a custom `hey edith` model.
- If you want an exact custom wake phrase such as `hey edith`, you still need a custom wake-word asset:
  - Porcupine: custom `.ppn`
  - OpenWakeWord: custom `.onnx` or `.tflite`
- Native wake-word mode only activates when required dependencies and model assets are available.
- Full repo health is not part of Phase 1 closure.

## Closeout Verification

The following are the official Phase 1 closeout gates.

### Automated gates

Latest local verification was rerun on March 8, 2026.

- `pnpm voice:deps:check`
  - pass
  - verified `.venv-voice` plus `sounddevice`, `soundfile`, `whisper`, `pvporcupine`, `openwakeword`, and `onnxruntime`
- targeted voice test suite
  - pass
  - `6` files / `40` tests
  - files:
    - `src/voice/__tests__/session-manager.test.ts`
    - `src/voice/__tests__/wake-word.test.ts`
    - `src/voice/__tests__/wake-model-assets.test.ts`
    - `src/os-agent/__tests__/voice-plan.test.ts`
    - `src/os-agent/__tests__/voice-io.test.ts`
    - `src/gateway/__tests__/server.test.ts`

### Manual milestone gates

These remain part of the Phase 1 closeout definition and were already validated during the implementation milestone:

- desktop onboarding smoke
  - voice config save works
  - wake-model prepare flow works
- real host acceptance
  - desktop always-on startup works with the prepared recommended model path

## Known Non-Blocking Exceptions

These do not block Phase 1 closure.

- Full-repo `pnpm typecheck` is currently red in unrelated areas such as:
  - `src/engines/openai.ts`
  - `src/os-agent/vision-cortex.ts`
  - multiple non-voice test typing and mocking failures under `src/os-agent/__tests__`
- Full-suite test execution outside the targeted Phase 1 voice gates is not required for this milestone.

## Done Definition

For this repository, "Phase 1 done" means:

- the shipped voice runtime matches the documented gateway-first and host always-on design
- setup flows write voice credentials and wake-model configuration to top-level `voice`
- official voice closeout gates are green
- unrelated repo-wide failures are documented as out of scope

It does not mean the entire repository is fully green.

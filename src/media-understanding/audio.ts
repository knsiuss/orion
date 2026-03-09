/**
 * @file audio.ts
 * @description Audio media handler  transcribes voice messages via VoiceBridge (Whisper).
 *
 * ARCHITECTURE / INTEGRATION:
 *   Delegates to voice/bridge.ts STT pipeline. Called from message-pipeline.ts
 *   when an inbound message contains an audio attachment.
 */
import { voice } from "../voice/bridge.js"
import { createLogger } from "../logger.js"

const log = createLogger("media-understanding.audio")

export class AudioTranscriber {
  async transcribe(audioSource: string): Promise<string> {
    try {
      const result = await voice.transcribe(audioSource)

      if (!result) {
        return "Unable to transcribe audio"
      }

      return result
    } catch (error) {
      log.error("transcribe failed", error)
      return "Unable to transcribe audio"
    }
  }
}

export const audioTranscriber = new AudioTranscriber()

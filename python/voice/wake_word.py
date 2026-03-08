#!/usr/bin/env python3
"""
wake_word.py — Wake word detection sidecar.

Streams mic audio through Whisper in 2-second chunks.
Outputs newline-delimited JSON to stdout:
  {"transcript": "hey edith turn on lights", "confidence": 0.9}

Environment:
  WAKE_PHRASE — the wake phrase to detect (default: "hey edith")

Privacy: all audio processing is local. No audio leaves the device.

Fallback: if whisper/sounddevice are not installed, runs in stdin relay mode
(reads lines from stdin and re-emits them as JSON) — useful for testing.
"""
import sys
import json
import os

WAKE_PHRASE = os.environ.get("WAKE_PHRASE", "hey edith").lower()


def emit(transcript: str, confidence: float = 1.0) -> None:
    """Emit a transcript event to stdout as newline-delimited JSON."""
    print(json.dumps({"transcript": transcript, "confidence": confidence}), flush=True)


def run_whisper_mode() -> None:
    """Run with real Whisper + sounddevice for live mic detection."""
    import whisper  # type: ignore[import]
    import sounddevice as sd  # type: ignore[import]
    import numpy as np  # type: ignore[import]

    model = whisper.load_model("tiny")
    SAMPLE_RATE = 16000
    CHUNK_SECONDS = 2

    sys.stderr.write("[wake_word] Whisper tiny loaded — listening for: " + WAKE_PHRASE + "\n")
    sys.stderr.flush()

    while True:
        audio = sd.rec(
            int(CHUNK_SECONDS * SAMPLE_RATE),
            samplerate=SAMPLE_RATE,
            channels=1,
            dtype="float32",
        )
        sd.wait()
        audio_flat = audio.flatten()

        result = model.transcribe(audio_flat, language=None, fp16=False)
        transcript = result.get("text", "").strip()
        if transcript:
            emit(transcript, 0.9)


def run_stdin_relay_mode() -> None:
    """Fallback: relay stdin lines as transcript events (for testing/dev)."""
    sys.stderr.write("[wake_word] whisper/sounddevice not available — stdin relay mode\n")
    sys.stderr.flush()
    for line in sys.stdin:
        line = line.strip()
        if line:
            emit(line)


def main() -> None:
    try:
        run_whisper_mode()
    except ImportError:
        run_stdin_relay_mode()
    except KeyboardInterrupt:
        sys.stderr.write("[wake_word] interrupted\n")
        sys.stderr.flush()


if __name__ == "__main__":
    main()

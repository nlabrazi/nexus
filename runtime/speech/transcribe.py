"""Offline speech worker: audio bytes on stdin, one JSON result on stdout."""

import argparse
import io
import json
import os
from pathlib import Path
import re
import sys

# Set before importing the model runtime, including when used directly from a terminal.
os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
MAX_AUDIO_BYTES = 20_000_000


def transcribe(model_path, language, audio):
    if not audio:
        return {"error": "invalid_audio"}
    if len(audio) > MAX_AUDIO_BYTES:
        return {"error": "audio_too_large"}
    if language is not None and not re.fullmatch(r"[a-z]{2,3}", language):
        return {"error": "invalid_configuration"}

    model_dir = Path(model_path)
    # Requiring the local tokenizer also prevents faster-whisper's fallback download.
    if not model_dir.is_absolute() or not all(
        (model_dir / name).is_file()
        for name in ("model.bin", "config.json", "tokenizer.json")
    ):
        return {"error": "not_configured"}
    try:
        from faster_whisper import WhisperModel
        from faster_whisper.audio import decode_audio

        model = WhisperModel(
            str(model_dir), device="cpu", compute_type="int8",
            cpu_threads=4, local_files_only=True,
        )
    except Exception:
        return {"error": "unavailable"}

    if language is not None and language not in model.supported_languages:
        return {"error": "invalid_configuration"}
    try:
        decoded = decode_audio(io.BytesIO(audio), sampling_rate=16000)
        if decoded.size == 0:
            return {"error": "invalid_audio"}
    except Exception:
        return {"error": "invalid_audio"}
    try:
        segments, _ = model.transcribe(decoded, language=language, vad_filter=True)
        return {"text": " ".join(segment.text.strip() for segment in segments).strip()}
    except Exception:
        return {"error": "transcription_failed"}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", required=True)
    parser.add_argument("--language")
    args = parser.parse_args()
    audio = sys.stdin.buffer.read(MAX_AUDIO_BYTES + 1)
    result = transcribe(args.model, args.language, audio)
    print(json.dumps(result, ensure_ascii=True))


if __name__ == "__main__":
    main()

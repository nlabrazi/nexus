"""Offline Piper worker: UTF-8 text on stdin, complete WAV audio on stdout."""

import argparse
import io
from pathlib import Path
import sys
import wave


def synthesize(model_path, speaker_id, text):
    model = Path(model_path)
    if (
        not model.is_absolute()
        or not model.is_file()
        or not Path(str(model) + ".json").is_file()
        or not text.strip()
        or not isinstance(speaker_id, int)
        or speaker_id < 0
    ):
        raise ValueError("Invalid local voice configuration")

    from piper import PiperVoice, SynthesisConfig

    # Loading an existing ONNX file directly never invokes the voice downloader.
    voice = PiperVoice.load(str(model), use_cuda=False)
    if speaker_id >= voice.config.num_speakers:
        raise ValueError("Invalid speaker ID")
    audio = io.BytesIO()
    with wave.open(audio, "wb") as wav_file:
        voice.synthesize_wav(text, wav_file, syn_config=SynthesisConfig(speaker_id=speaker_id))
    return audio.getvalue()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", required=True)
    parser.add_argument("--speaker", type=int, default=0)
    args = parser.parse_args()
    try:
        text = sys.stdin.buffer.read(4097)
        if len(text) > 4096:
            raise ValueError("Text too long")
        audio = synthesize(args.model, args.speaker, text.decode("utf-8"))
        sys.stdout.buffer.write(audio)
    except Exception:
        # Keep filesystem paths and native runtime diagnostics out of Telegram.
        print("Piper speech synthesis unavailable", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())

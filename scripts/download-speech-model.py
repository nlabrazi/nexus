"""Explicit, one-time model download. Never called during transcription."""

import argparse
import os
from pathlib import Path

os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
# Keep the download's cache inside the project as well.
os.environ.setdefault("HF_HOME", str(Path(__file__).resolve().parents[1] / ".nexus-speech" / "cache"))

from faster_whisper import download_model


parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--model", choices=["tiny", "base", "small"], default="small")
parser.add_argument("--output", required=True)
args = parser.parse_args()
destination = Path(args.output).resolve()
download_model(args.model, output_dir=str(destination))
print(f"Modèle local prêt : {destination}")

"""Offline worker checks with a fake model; no Python packages or model download needed."""

import importlib.util
import io
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

spec = importlib.util.spec_from_file_location(
    "speech_worker", Path(__file__).resolve().parents[1] / "runtime/speech/transcribe.py"
)
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)


class SpeechWorkerTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.model_path = Path(self.directory.name)
        for name in ("model.bin", "config.json", "tokenizer.json"):
            (self.model_path / name).touch()
        self.model = Mock(supported_languages=["fr", "en"])
        self.model.transcribe.return_value = (
            iter([SimpleNamespace(text=" Bonjour"), SimpleNamespace(text=" à tous.")]), None
        )
        self.factory = Mock(return_value=self.model)
        self.decoded = SimpleNamespace(size=16000)
        self.decode = Mock(return_value=self.decoded)
        modules = patch.dict("sys.modules", {
            "faster_whisper": SimpleNamespace(WhisperModel=self.factory),
            "faster_whisper.audio": SimpleNamespace(decode_audio=self.decode),
        })
        modules.start()
        self.addCleanup(modules.stop)

    def run_worker(self, audio=b"audio", language="fr"):
        return worker.transcribe(str(self.model_path), language, audio)

    def test_offline_cpu_model_and_in_memory_decode(self):
        self.assertEqual(self.run_worker(), {"text": "Bonjour à tous."})
        self.factory.assert_called_once_with(
            str(self.model_path), device="cpu", compute_type="int8",
            cpu_threads=4, local_files_only=True,
        )
        stream = self.decode.call_args.args[0]
        self.assertIsInstance(stream, io.BytesIO)
        self.assertEqual(stream.getvalue(), b"audio")
        self.model.transcribe.assert_called_once_with(self.decoded, language="fr", vad_filter=True)

    def test_missing_tokenizer_never_starts_model_or_fallback_download(self):
        (self.model_path / "tokenizer.json").unlink()
        self.assertEqual(self.run_worker(), {"error": "not_configured"})
        self.factory.assert_not_called()

    def test_invalid_input_is_rejected_before_model_loading(self):
        for audio, language, code in [
            (b"", "fr", "invalid_audio"),
            (b"a" * (worker.MAX_AUDIO_BYTES + 1), "fr", "audio_too_large"),
            (b"audio", "../fr", "invalid_configuration"),
        ]:
            self.assertEqual(self.run_worker(audio, language), {"error": code})
        self.factory.assert_not_called()

    def test_runtime_failure_and_corrupt_audio_have_safe_errors(self):
        self.factory.side_effect = RuntimeError("private path")
        self.assertEqual(self.run_worker(), {"error": "unavailable"})
        self.factory.side_effect = None
        self.decode.side_effect = ValueError("private audio")
        self.assertEqual(self.run_worker(), {"error": "invalid_audio"})

    def test_unsupported_language_and_empty_decode(self):
        self.assertEqual(self.run_worker(language="xyz"), {"error": "invalid_configuration"})
        self.decode.assert_not_called()
        self.decoded.size = 0
        self.assertEqual(self.run_worker(), {"error": "invalid_audio"})

    def test_auto_language_and_silence(self):
        self.model.transcribe.return_value = (iter([]), None)
        self.assertEqual(self.run_worker(language=None), {"text": ""})
        self.assertIsNone(self.model.transcribe.call_args.kwargs["language"])

    def test_errors_during_lazy_transcription_are_caught(self):
        def segments():
            yield SimpleNamespace(text="partial")
            raise RuntimeError("private diagnostic")
        self.model.transcribe.return_value = (segments(), None)
        self.assertEqual(self.run_worker(), {"error": "transcription_failed"})


if __name__ == "__main__":
    unittest.main()

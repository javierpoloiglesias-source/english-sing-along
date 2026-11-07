"""Reconocimiento de voz local con faster-whisper.

- Se ejecuta 100 % en el ordenador del usuario (CPU o GPU NVIDIA si existe).
- El modelo se descarga gratis la primera vez desde Hugging Face y queda en
  `datos/modelos`. Después funciona sin conexión.
- Se piden marcas de tiempo por palabra para el karaoke.
"""
from __future__ import annotations

import re
import threading
from typing import Callable

from . import config

_models: dict[tuple[str, str], object] = {}
_models_lock = threading.Lock()

# Cuantas palabras como máximo en una línea de subtítulo y qué pausa (s)
# entre palabras fuerza un corte de línea.
MAX_WORDS_PER_LINE = 10
PAUSE_SPLIT = 0.8


def is_available() -> bool:
    try:
        import faster_whisper  # noqa: F401
        return True
    except Exception:
        return False


def _device() -> tuple[str, str]:
    try:
        import ctranslate2
        if ctranslate2.get_cuda_device_count() > 0:
            return "cuda", "float16"
    except Exception:
        pass
    return "cpu", "int8"


def device_info() -> dict:
    dev, ct = _device()
    return {"device": dev, "compute_type": ct}


def load_model(name: str):
    if name not in config.WHISPER_MODELS:
        raise ValueError(f"Modelo desconocido: {name}")
    from faster_whisper import WhisperModel
    dev, ct = _device()
    key = (name, dev)
    with _models_lock:
        if key not in _models:
            try:
                _models[key] = WhisperModel(name, device=dev, compute_type=ct,
                                            download_root=str(config.models_dir()))
            except Exception as e:  # noqa: BLE001
                if dev == "cuda":  # GPU sin librerías CUDA: se reintenta en CPU
                    _models[key] = WhisperModel(name, device="cpu", compute_type="int8",
                                                download_root=str(config.models_dir()))
                else:
                    raise RuntimeError(
                        f"No se pudo cargar o descargar el modelo Whisper '{name}'. La primera vez "
                        f"necesita conexión a internet (descarga gratuita desde Hugging Face). Detalle: {e}"
                    ) from e
        return _models[key]


def split_into_lines(words: list[dict], max_words: int = MAX_WORDS_PER_LINE,
                     pause: float = PAUSE_SPLIT) -> list[dict]:
    """Agrupa palabras con tiempos en líneas cortas, cómodas para leer.

    Corta en pausas largas, al final de una frase (. ? !) o al llegar a
    `max_words`. Devuelve segmentos {start, end, text, words}.
    """
    lines: list[dict] = []
    cur: list[dict] = []

    def flush():
        if cur:
            text = " ".join(w["word"] for w in cur).strip()
            text = re.sub(r"\s+([,.!?;:])", r"\1", text)
            lines.append({"start": round(cur[0]["start"], 3), "end": round(cur[-1]["end"], 3),
                          "text": text, "words": [dict(w) for w in cur]})
            cur.clear()

    for w in words:
        if cur and (w["start"] - cur[-1]["end"] >= pause or len(cur) >= max_words):
            flush()
        cur.append(w)
        if re.search(r"[.?!]$", w["word"]) and len(cur) >= 3:
            flush()
    flush()
    return lines


def transcribe(path: str, model_name: str = "small", language: str = "en",
               progress: Callable[[float, str], None] | None = None,
               cancel: threading.Event | None = None) -> list[dict]:
    """Transcribe un archivo local. Devuelve segmentos con palabras y tiempos."""
    progress = progress or (lambda p, m: None)
    progress(0.02, f"Cargando modelo Whisper '{model_name}' (la primera vez se descarga)…")
    model = load_model(model_name)
    progress(0.08, "Analizando el audio…")
    seg_iter, info = model.transcribe(
        path, language=language or None, word_timestamps=True,
        vad_filter=True, vad_parameters={"min_silence_duration_ms": 500},
        beam_size=5, condition_on_previous_text=False,
    )
    duration = float(getattr(info, "duration", 0) or 0)
    words: list[dict] = []
    for seg in seg_iter:
        if cancel is not None and cancel.is_set():
            raise RuntimeError("Proceso cancelado")
        seg_words = getattr(seg, "words", None) or []
        if seg_words:
            for w in seg_words:
                token = (w.word or "").strip()
                if token:
                    words.append({"word": token, "start": float(w.start), "end": float(w.end),
                                  "p": round(float(getattr(w, "probability", 1.0)), 3)})
        elif seg.text.strip():
            words.append({"word": seg.text.strip(), "start": float(seg.start), "end": float(seg.end), "p": 1.0})
        if duration:
            progress(0.08 + 0.8 * min(1.0, seg.end / duration),
                     f"Transcribiendo… {int(seg.end)} s de {int(duration)} s")
    return split_into_lines(words)

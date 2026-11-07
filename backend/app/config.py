"""Rutas y configuración del servidor local.

Todo se guarda en una carpeta de datos local (por defecto `datos/` junto al
proyecto). Se puede cambiar con la variable de entorno ESA_DATA_DIR o desde la
pantalla de Configuración (se guarda en `datos/servidor.json`).
"""
from __future__ import annotations

import json
import os
from pathlib import Path

PROJECT_DIR = Path(__file__).resolve().parents[2]
FRONTEND_DIR = PROJECT_DIR / "frontend"
DEFAULT_DATA_DIR = PROJECT_DIR / "datos"
BOOT_FILE = DEFAULT_DATA_DIR / "servidor.json"

MAX_UPLOAD_MB = 1024
ALLOWED_EXT = {
    ".mp3", ".wav", ".ogg", ".oga", ".m4a", ".aac", ".flac", ".opus", ".weba",
    ".mp4", ".webm", ".mkv", ".mov", ".m4v", ".ogv",
}
WHISPER_MODELS = ["tiny", "base", "small", "medium", "large-v3"]


def _read_boot() -> dict:
    try:
        return json.loads(BOOT_FILE.read_text(encoding="utf-8"))
    except Exception:
        return {}


def data_dir() -> Path:
    env = os.environ.get("ESA_DATA_DIR")
    path = Path(env) if env else Path(_read_boot().get("data_dir") or DEFAULT_DATA_DIR)
    path.mkdir(parents=True, exist_ok=True)
    return path


def set_data_dir(new_dir: str) -> Path:
    path = Path(new_dir).expanduser().resolve()
    path.mkdir(parents=True, exist_ok=True)
    DEFAULT_DATA_DIR.mkdir(parents=True, exist_ok=True)
    boot = _read_boot()
    boot["data_dir"] = str(path)
    BOOT_FILE.write_text(json.dumps(boot, indent=2), encoding="utf-8")
    return path


def media_dir() -> Path:
    p = data_dir() / "media"
    p.mkdir(parents=True, exist_ok=True)
    return p


def models_dir() -> Path:
    p = data_dir() / "modelos"
    p.mkdir(parents=True, exist_ok=True)
    return p


def db_path() -> Path:
    return data_dir() / "english_sing_along.sqlite3"

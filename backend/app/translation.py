"""Traducción local con Argos Translate (código abierto, sin claves).

El paquete de idioma (p. ej. inglés→español, ~100 MB) se descarga gratis una
sola vez del índice público de Argos y después funciona sin conexión.
"""
from __future__ import annotations

import threading
import time

from . import db

_install_lock = threading.Lock()
_last_failure: dict[str, tuple[float, str]] = {}
RETRY_AFTER = 300  # s: no reintentar descargas fallidas en cada frase


def is_available() -> bool:
    try:
        import argostranslate.translate  # noqa: F401
        return True
    except Exception:
        return False


def installed_pairs() -> list[str]:
    if not is_available():
        return []
    try:
        import argostranslate.package
        return [f"{p.from_code}-{p.to_code}" for p in argostranslate.package.get_installed_packages()]
    except Exception:
        return []


def has_pair(src: str, tgt: str) -> bool:
    return f"{src}-{tgt}" in installed_pairs()


def install_pair(src: str, tgt: str, force: bool = False) -> str:
    """Descarga e instala el paquete de idioma si falta.

    Si una descarga falla, no se reintenta durante unos minutos (salvo
    `force`), para no bloquear cada traducción sin conexión.
    """
    import argostranslate.package
    with _install_lock:
        if has_pair(src, tgt):
            return "ya instalado"
        key = f"{src}-{tgt}"
        if not force and key in _last_failure and time.time() - _last_failure[key][0] < RETRY_AFTER:
            raise RuntimeError(_last_failure[key][1])
        try:
            try:
                argostranslate.package.update_package_index()
            except Exception as e:  # noqa: BLE001
                raise RuntimeError(f"No se pudo descargar el índice de idiomas de Argos (¿sin conexión?): {e}") from e
            pkgs = [p for p in argostranslate.package.get_available_packages()
                    if p.from_code == src and p.to_code == tgt]
            if not pkgs:
                raise RuntimeError(f"Argos no tiene paquete {src}→{tgt}")
            try:
                path = pkgs[0].download()
            except Exception as e:  # noqa: BLE001
                raise RuntimeError(f"No se pudo descargar el paquete {src}→{tgt} de Argos (¿sin conexión?): {e}") from e
            argostranslate.package.install_from_path(path)
            _last_failure.pop(key, None)
            return "instalado"
        except Exception as e:
            _last_failure[key] = (time.time(), str(e))
            raise


def translate_many(texts: list[str], src: str = "en", tgt: str = "es") -> list[str]:
    """Traduce una lista de frases usando caché SQLite para no repetir trabajo."""
    clean = [t.strip() for t in texts]
    cache = db.cached_translations(src, tgt, [t for t in clean if t])
    missing = [t for t in dict.fromkeys(clean) if t and t not in cache]
    if missing:
        if not is_available():
            raise RuntimeError("Argos Translate no está instalado")
        if not has_pair(src, tgt):
            install_pair(src, tgt)
        import argostranslate.translate
        new = {t: argostranslate.translate.translate(t, src, tgt) for t in missing}
        db.store_translations(src, tgt, new)
        cache.update(new)
    return [cache.get(t, "") if t else "" for t in clean]

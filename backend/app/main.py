"""Servidor local de English Sing Along (FastAPI).

Arranque:  python -m uvicorn app.main:app --port 8765   (desde backend/)
Sirve la interfaz web en http://127.0.0.1:8765 y la API en /api.
Solo escucha en 127.0.0.1: nada se expone a la red ni se envía a terceros.
"""
from __future__ import annotations

import hashlib
import mimetypes
import os
import shutil
import tempfile
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import __version__, autosong, config, db, jobs, pronunciation, transcription, translation, youtube

app = FastAPI(title="English Sing Along", version=__version__)


# Modo servidor público (ESA_PUBLIC=1, p. ej. Hugging Face Spaces): se bloquea
# lo que consume mucho o cambia el servidor (subidas, Whisper, cambiar carpeta).
if os.environ.get("ESA_PUBLIC") == "1":
    from fastapi.responses import JSONResponse

    _BLOCKED = (("POST", "/api/media"), ("POST", "/api/transcribe"),
                ("PUT", "/api/storage"), ("POST", "/api/translate/install"))

    @app.middleware("http")
    async def _public_guard(request, call_next):
        if (request.method, request.url.path) in _BLOCKED:
            return JSONResponse({"detail": "Desactivado en la versión web pública."}, status_code=403)
        return await call_next(request)


# --------------------------------------------------------------------------
# Estado
@app.get("/api/health")
def health():
    return {
        "ok": True,
        "version": __version__,
        "whisper": transcription.is_available(),
        "whisper_models": config.WHISPER_MODELS,
        "device": transcription.device_info() if transcription.is_available() else None,
        "argos": translation.is_available(),
        "argos_pairs": translation.installed_pairs(),
        "espeak": pronunciation.espeak_path(),
        "cmudict": bool(pronunciation._cmu()),
        "data_dir": str(config.data_dir()),
        "auto": autosong_available(),
    }


# --------------------------------------------------------------------------
# Traspaso de datos del navegador de http://127.0.0.1 a http://localhost.
# YouTube no deja insertar vídeos musicales en páginas servidas desde una IP
# (error 150), así que la app se usa en http://localhost. Los datos de
# IndexedDB van por origen: la página antigua los deja aquí (en memoria) y la
# nueva los recoge una sola vez.
_migration: dict | None = None


@app.post("/api/migrate")
def migrate_put(data: dict):
    global _migration
    if data.get("app") != "english-sing-along":
        raise HTTPException(400, "Datos no válidos")
    _migration = data
    return {"ok": True}


@app.get("/api/migrate")
def migrate_get():
    global _migration
    data, _migration = _migration, None
    return {"data": data}


def autosong_available() -> bool:
    try:
        import yt_dlp  # noqa: F401
        return True
    except Exception:
        return False


# --------------------------------------------------------------------------
# Archivos locales
def _media_path(m: dict) -> Path:
    return config.media_dir() / m["stored_name"]


@app.post("/api/media")
async def upload_media(file: UploadFile = File(...), title: str = Form(""), artist: str = Form("")):
    ext = Path(file.filename or "").suffix.lower()
    if ext not in config.ALLOWED_EXT:
        raise HTTPException(400, f"Formato no admitido: {ext or 'desconocido'}")
    h = hashlib.sha256()
    size = 0
    fd, tmp = tempfile.mkstemp(dir=config.media_dir(), suffix=".part")
    try:
        with os.fdopen(fd, "wb") as out:
            while chunk := await file.read(1024 * 1024):
                size += len(chunk)
                if size > config.MAX_UPLOAD_MB * 1024 * 1024:
                    raise HTTPException(413, "Archivo demasiado grande")
                h.update(chunk)
                out.write(chunk)
        digest = h.hexdigest()[:32]
        stored = digest + ext
        dest = config.media_dir() / stored
        if dest.exists():
            os.remove(tmp)
        else:
            shutil.move(tmp, dest)
    except BaseException:
        if os.path.exists(tmp):
            os.remove(tmp)
        raise
    mime = file.content_type or mimetypes.guess_type(stored)[0] or "application/octet-stream"
    m = db.add_media(digest, file.filename or stored, stored, mime, size,
                     title or Path(file.filename or "").stem, artist or None)
    return _media_public(m)


def _media_public(m: dict) -> dict:
    t = db.get_transcript(m["hash"])
    return {**m, "url": f"/api/media/{m['hash']}/file", "has_transcript": bool(t)}


@app.get("/api/media")
def list_media():
    return [_media_public(m) for m in db.list_media() if _media_path(m).exists()]


@app.get("/api/media/{hash_}/file")
def media_file(hash_: str):
    m = db.get_media(hash_)
    if not m or not _media_path(m).exists():
        raise HTTPException(404, "Archivo no encontrado")
    return FileResponse(_media_path(m), media_type=m["mime"], filename=m["filename"])


@app.delete("/api/media/{hash_}")
def delete_media(hash_: str):
    m = db.get_media(hash_)
    if not m:
        raise HTTPException(404)
    p = _media_path(m)
    if p.exists():
        p.unlink()
    db.delete_media(hash_)
    return {"ok": True}


# --------------------------------------------------------------------------
# Transcripción + traducción
class TranscribeReq(BaseModel):
    hash: str
    model: str = "small"
    language: str = "en"
    target: str = "es"
    translate: bool = True
    force: bool = False


def _translate_segments(segments: list[dict], src: str, tgt: str, progress=None) -> list[dict]:
    texts = [s.get("text", "") for s in segments]
    if progress:
        progress(0.9, "Traduciendo con Argos Translate…")
    tr = translation.translate_many(texts, src, tgt)
    for s, t in zip(segments, tr):
        s["translation"] = t
    return segments


@app.post("/api/transcribe")
def transcribe(req: TranscribeReq):
    m = db.get_media(req.hash)
    if not m or not _media_path(m).exists():
        raise HTTPException(404, "Primero sube el archivo")
    if not req.force:
        cached = db.get_transcript(req.hash)
        if cached:
            return {"cached": True, "transcript": cached}
    if not transcription.is_available():
        raise HTTPException(503, "faster-whisper no está instalado. Ejecuta instalar.bat")
    path = str(_media_path(m))

    def work(progress, cancel):
        segs = transcription.transcribe(path, req.model, req.language, progress, cancel)
        warning = None
        if req.translate and segs:
            try:
                _translate_segments(segs, req.language, req.target, progress)
            except Exception as e:  # noqa: BLE001
                warning = f"Transcripción hecha, pero la traducción falló: {e}"
        t = db.save_transcript(req.hash, segs, req.model, req.language, req.target)
        return {"transcript": t, "warning": warning}

    return {"cached": False, "job": jobs.create("transcribe", work)}


@app.get("/api/jobs/{job_id}")
def job_status(job_id: str):
    j = jobs.get(job_id)
    if not j:
        raise HTTPException(404)
    return j


@app.delete("/api/jobs/{job_id}")
def job_cancel(job_id: str):
    return {"ok": jobs.cancel(job_id)}


@app.get("/api/transcripts/{hash_}")
def get_transcript(hash_: str):
    t = db.get_transcript(hash_)
    if not t:
        raise HTTPException(404)
    return t


class TranscriptPut(BaseModel):
    segments: list[dict]
    language: str = "en"
    target: str = "es"


@app.put("/api/transcripts/{hash_}")
def put_transcript(hash_: str, body: TranscriptPut):
    if not db.get_media(hash_):
        raise HTTPException(404)
    return db.save_transcript(hash_, body.segments, None, body.language, body.target, edited=True)


class TranslateReq(BaseModel):
    texts: list[str] = Field(default_factory=list, max_length=2000)
    source: str = "en"
    target: str = "es"


@app.post("/api/translate")
def translate(req: TranslateReq):
    if not translation.is_available():
        raise HTTPException(503, "Argos Translate no está instalado. Ejecuta instalar.bat")
    try:
        return {"translations": translation.translate_many(req.texts, req.source, req.target)}
    except Exception as e:  # noqa: BLE001
        raise HTTPException(500, f"No se pudo traducir: {e}")


class PairReq(BaseModel):
    source: str = "en"
    target: str = "es"


@app.post("/api/translate/install")
def translate_install(req: PairReq):
    if not translation.is_available():
        raise HTTPException(503, "Argos Translate no está instalado")
    try:
        return {"status": translation.install_pair(req.source, req.target, force=True)}
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"No se pudo descargar el paquete de idioma: {e}")


# --------------------------------------------------------------------------
# Pronunciación
class PronReq(BaseModel):
    text: str = Field(max_length=2000)


@app.post("/api/pronounce")
def pronounce(req: PronReq):
    return pronunciation.sentence(req.text)


@app.get("/api/tts")
def tts(text: str, speed: int = 150):
    if len(text) > 1000:
        raise HTTPException(400, "Texto demasiado largo")
    wav = pronunciation.espeak_wav(text, max(60, min(400, speed)))
    if not wav:
        raise HTTPException(503, "eSpeak NG no está instalado")
    return Response(wav, media_type="audio/wav")


# --------------------------------------------------------------------------
# YouTube (solo verificación de metadatos públicos)
class VerifyReq(BaseModel):
    items: list[dict] = Field(max_length=200)


@app.post("/api/youtube/verify")
def yt_verify(req: VerifyReq):
    return {"results": youtube.verify(req.items)}


@app.get("/api/youtube/info")
def yt_info(url: str):
    vid = youtube.parse_video_id(url)
    if not vid:
        raise HTTPException(400, "Enlace de YouTube no válido")
    info = youtube.oembed(vid)
    return {"id": vid, "ok": bool(info), "title": info and info["title"], "author": info and info["author"]}


# --------------------------------------------------------------------------
# Modo automático: letra sincronizada + vídeo + traducción
class AutoReq(BaseModel):
    artist: str = Field(max_length=300)
    title: str = Field(max_length=300)
    candidate: str | None = None
    video_id: str | None = None
    target: str = "es"
    force: bool = False


@app.post("/api/auto")
def auto(req: AutoReq):
    if req.video_id:
        vid = youtube.parse_video_id(req.video_id)
        if not vid:
            raise HTTPException(400, "Enlace de YouTube no válido")
        vkey = f"yt:{vid}|{req.target}"
        if not req.force:
            cached = db.get_auto(vkey)
            if cached:
                return {"cached": True, "result": cached}

        def vwork(progress, cancel):
            hint_a = "" if req.artist in ("", "YouTube") else req.artist
            return autosong.prepare_video(vid, hint_a, "", req.target, True, progress, req.force)

        return {"cached": False, "job": jobs.create("auto", vwork, exclusive=False)}

    key =f"{autosong.norm(autosong.main_artist(req.artist))}|{autosong.norm(autosong.clean_title(req.title))}|{req.target}"
    if not req.force:
        cached = db.get_auto(key)
        if cached:
            return {"cached": True, "result": cached}
    cand = youtube.parse_video_id(req.candidate or "") if req.candidate else None

    def work(progress, cancel):
        return autosong.prepare(req.artist, req.title, cand, req.target, True, progress, req.force)

    return {"cached": False, "job": jobs.create("auto", work, exclusive=False)}


# --------------------------------------------------------------------------
# Almacenamiento
@app.get("/api/storage")
def storage():
    d = config.data_dir()
    total = sum(f.stat().st_size for f in d.rglob("*") if f.is_file())
    media = sum(f.stat().st_size for f in config.media_dir().glob("*") if f.is_file())
    return {"data_dir": str(d), "total_bytes": total, "media_bytes": media,
            "media_count": len(db.list_media())}


class DirReq(BaseModel):
    data_dir: str


@app.put("/api/storage")
def set_storage(req: DirReq):
    try:
        p = config.set_data_dir(req.data_dir)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(400, f"No se pudo usar esa carpeta: {e}")
    return {"data_dir": str(p), "note": "Reinicia la aplicación para usar la nueva carpeta."}


@app.exception_handler(404)
async def not_found(request, exc):
    if request.url.path.startswith("/api/"):
        detail = getattr(exc, "detail", None) or "No encontrado"
        return JSONResponse({"detail": detail}, status_code=404)
    return FileResponse(config.FRONTEND_DIR / "index.html")


# La interfaz web (debe ir al final para no tapar /api)
app.mount("/", StaticFiles(directory=config.FRONTEND_DIR, html=True), name="frontend")

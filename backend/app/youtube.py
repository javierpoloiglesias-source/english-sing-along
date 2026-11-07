"""Verificación de vídeos de YouTube mediante oEmbed (público y gratuito).

No descarga vídeo ni audio: solo comprueba que el identificador existe, que
admite inserción y que su título corresponde a la canción esperada.
"""
from __future__ import annotations

import re
import time
import unicodedata

import httpx

from . import db

OEMBED = "https://www.youtube.com/oembed"
ID_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")
RECHECK_SECONDS = 30 * 24 * 3600


def parse_video_id(url_or_id: str) -> str | None:
    s = (url_or_id or "").strip()
    if ID_RE.match(s):
        return s
    m = re.search(r"(?:v=|youtu\.be/|embed/|shorts/|live/)([A-Za-z0-9_-]{11})", s)
    return m.group(1) if m else None


def _norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


def title_matches(video_title: str, author: str, song_title: str, artist: str) -> bool:
    vt = _norm(video_title + " " + author)
    st = _norm(re.sub(r"\(.*?\)", "", song_title))
    first_artist = _norm(re.split(r",|&| ft\.? | feat\.? | x | and ", artist, flags=re.I)[0])
    title_ok = st and all(w in vt.split() for w in st.split() if len(w) > 1) or (st and st in vt)
    artist_ok = not first_artist or any(w in vt.split() for w in first_artist.split() if len(w) > 2) \
        or first_artist.replace(" ", "") in vt.replace(" ", "")
    return bool(title_ok and artist_ok)


def oembed(video_id: str, client: httpx.Client | None = None) -> dict | None:
    cached = db.get_youtube(video_id)
    if cached and time.time() - cached["checked_at"] < RECHECK_SECONDS:
        return cached if cached["ok"] else None
    own = client is None
    client = client or httpx.Client(timeout=8)
    try:
        r = client.get(OEMBED, params={"url": f"https://www.youtube.com/watch?v={video_id}", "format": "json"})
        if r.status_code == 200:
            d = r.json()
            db.put_youtube(video_id, True, d.get("title"), d.get("author_name"))
            return db.get_youtube(video_id)
        if r.status_code in (400, 401, 403, 404):  # no existe o no admite inserción
            db.put_youtube(video_id, False, None, None)
        return None
    except httpx.HTTPError:
        return None  # sin conexión: no se guarda, se reintentará
    finally:
        if own:
            client.close()


def verify(items: list[dict]) -> list[dict]:
    """items: [{id, title, artist}] → [{id, ok, matches, video_title, author}]."""
    out = []
    with httpx.Client(timeout=8) as client:
        for it in items:
            vid = parse_video_id(it.get("id", ""))
            if not vid:
                out.append({"id": it.get("id"), "ok": False, "matches": False, "reason": "id inválido"})
                continue
            info = oembed(vid, client)
            if not info:
                out.append({"id": vid, "ok": False, "matches": False, "reason": "no disponible o sin conexión"})
                continue
            m = title_matches(info["title"] or "", info["author"] or "", it.get("title", ""), it.get("artist", ""))
            out.append({"id": vid, "ok": True, "matches": m, "video_title": info["title"], "author": info["author"]})
    return out

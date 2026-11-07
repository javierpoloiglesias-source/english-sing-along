"""Preparación automática de una canción: pulsar ▶ y listo.

1. Letra sincronizada (LRC) desde LRCLIB (https://lrclib.net): servicio
   público, gratuito, de código abierto y sin claves. La letra no se incluye en
   la app: se consulta al reproducir y se guarda en la caché local.
2. Vídeo de YouTube cuya duración coincide con la letra (así los tiempos
   cuadran), buscado con yt-dlp SOLO para leer metadatos (no descarga nada) y
   comprobado con oEmbed (que admita inserción).
3. Traducción local con Argos y pronunciación aproximada.
"""
from __future__ import annotations

import json
import re
import time
import unicodedata

import httpx

from . import db, pronunciation, translation, youtube

LRCLIB = "https://lrclib.net/api"
UA = "EnglishSingAlong/1.1 (aplicacion educativa gratuita y local)"
BAD_WORDS = ["live", "cover", "karaoke", "remix", "sped up", "slowed", "8d", "reaction", "instrumental",
             "lesson", "tutorial", "acoustic", "nightcore", "hour", "hours", "loop", "piano", "guitar",
             "letra", "subtitulada", "traducida", "español", "espanol", "mashup", "parody", "concert", "tour"]


def norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().lower()
    s = s.replace("&", " and ")
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


def main_artist(artist: str) -> str:
    return re.split(r"\s+(?:ft\.?|feat\.?|&|x|and|with)\s+|,", artist, flags=re.I)[0].strip()


def clean_title(title: str) -> str:
    t = re.sub(r"\s*[\(\[].*?[\)\]]", "", title)
    return re.sub(r"\s+(?:ft\.?|feat\.?|featuring)\s+.*$", "", t, flags=re.I).strip(" .")


# ---------------------------------------------------------------------------
# LRC
def parse_lrc(text: str) -> list[dict]:
    out = []
    for line in (text or "").splitlines():
        tags = re.findall(r"\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]", line)
        content = re.sub(r"\[[^\]]*\]", "", line).strip()
        for m, s, frac in tags:
            t = int(m) * 60 + int(s) + (int(frac.ljust(3, "0")[:3]) / 1000 if frac else 0)
            out.append({"start": round(t, 3), "text": content})
    out.sort(key=lambda x: x["start"])
    segs = []
    for i, x in enumerate(out):
        if not x["text"] or re.fullmatch(r"[♪♫\s.…-]*", x["text"]):
            continue
        nxt = next((y["start"] for y in out[i + 1:] if y["start"] > x["start"]), x["start"] + 5)
        segs.append({"start": x["start"], "end": round(min(nxt, x["start"] + 8), 3), "text": x["text"]})
    return segs


def _get(client: httpx.Client, path: str, params: dict) -> list | dict | None:
    r = client.get(f"{LRCLIB}/{path}", params=params, headers={"User-Agent": UA}, timeout=15)
    if r.status_code == 404:
        return None
    r.raise_for_status()
    return r.json()


def find_lyrics(artist: str, title: str, client: httpx.Client) -> dict | None:
    """Devuelve {synced, plain, duration, source_id} o None."""
    a, t = main_artist(artist), clean_title(title)
    results = _get(client, "search", {"artist_name": a, "track_name": t}) or []
    if not results:
        results = _get(client, "search", {"q": f"{a} {t}"}) or []
    nt, na = norm(t), norm(a)

    def score(r):
        sc = 0
        rt, ra = norm(r.get("trackName", "")), norm(r.get("artistName", ""))
        if rt == nt:
            sc += 30
        elif nt in rt:
            sc += 15
        else:
            sc -= 40
        if na in ra or ra in na:
            sc += 20
        if r.get("syncedLyrics"):
            sc += 25
        if any(w in rt and w not in nt for w in ("live", "remix", "acoustic", "version", "edit")):
            sc -= 15
        return sc

    results = [r for r in results if not r.get("instrumental")]
    if not results:
        return None
    # duración más habitual entre las coincidencias buenas (versión de álbum)
    good = [r for r in results if score(r) >= 40 and r.get("duration")]
    durs = [round(r["duration"]) for r in good]
    common = max(set(durs), key=durs.count) if durs else None
    best = max(results, key=lambda r: score(r) + (5 if common and abs((r.get("duration") or 0) - common) <= 2 else 0))
    if score(best) < 20:
        return None
    return {"synced": best.get("syncedLyrics") or "", "plain": best.get("plainLyrics") or "",
            "duration": best.get("duration"), "source_id": best.get("id"),
            "track": best.get("trackName"), "artist": best.get("artistName")}


# ---------------------------------------------------------------------------
# Vídeo
def search_youtube(query: str, n: int = 10) -> list[dict]:
    from yt_dlp import YoutubeDL
    opts = {"quiet": True, "no_warnings": True, "skip_download": True, "extract_flat": "in_playlist"}
    with YoutubeDL(opts) as ydl:
        info = ydl.extract_info(f"ytsearch{n}:{query}", download=False)
    out = []
    for e in info.get("entries") or []:
        if not e or not e.get("id") or len(e["id"]) != 11:
            continue
        out.append({"id": e["id"], "title": e.get("title") or "", "duration": e.get("duration"),
                    "channel": e.get("channel") or e.get("uploader") or "", "live": e.get("live_status")})
    return out


def score_video(v: dict, artist: str, title: str, duration: float | None, candidate: str | None) -> float:
    vt, ch = norm(v["title"]), norm(v["channel"])
    nt, na = norm(clean_title(title)), norm(main_artist(artist))
    sc = 0.0
    words = [w for w in nt.split() if len(w) > 1] or nt.split()
    if nt and (nt in vt or all(w in vt.split() for w in words)):
        sc += 25
    else:
        sc -= 50
    if na and (na in vt or na in ch or na.replace(" ", "") in ch.replace(" ", "")):
        sc += 15
    elif na:
        sc -= 35
    if ch.endswith(" topic"):
        sc += 8
    if "vevo" in ch or "official" in ch or "official" in vt:
        sc += 6
    if any(re.search(rf"\b{re.escape(w)}\b", vt) and w not in nt for w in BAD_WORDS):
        sc -= 80
    if v.get("live") in ("is_live", "is_upcoming"):
        sc -= 100
    if duration and v.get("duration"):
        d = abs(v["duration"] - duration)
        sc += 45 if d <= 2 else 32 if d <= 4 else 12 if d <= 8 else -5 if d <= 20 else -30
    if candidate and v["id"] == candidate:
        sc += 10
    return sc


def find_video(artist: str, title: str, duration: float | None, candidate: str | None,
               client: httpx.Client) -> dict | None:
    a, t = main_artist(artist), clean_title(title)
    seen: dict[str, dict] = {}
    for q in (f"{a} {t} official audio", f"{a} {t}"):
        try:
            for v in search_youtube(q):
                seen.setdefault(v["id"], v)
        except Exception:  # noqa: BLE001
            continue
    ranked = sorted(seen.values(), key=lambda v: score_video(v, artist, title, duration, candidate), reverse=True)
    for v in ranked[:6]:
        sc = score_video(v, artist, title, duration, candidate)
        if sc < 20:
            break
        info = youtube.oembed(v["id"], client)  # comprueba que admite inserción
        if info:
            return {**v, "score": sc, "synced": bool(duration and v.get("duration") and abs(v["duration"] - duration) <= 4)}
    return None


# ---------------------------------------------------------------------------
def prepare(artist: str, title: str, candidate: str | None = None, target: str = "es",
            translate: bool = True, progress=None, force: bool = False) -> dict:
    progress = progress or (lambda p, m: None)
    key = f"{norm(main_artist(artist))}|{norm(clean_title(title))}|{target}"
    if not force:
        cached = db.get_auto(key)
        if cached:
            return cached
    result: dict = {"artist": artist, "title": title, "segments": [], "plain": [], "video": None,
                    "lyrics_source": None, "warnings": []}
    with httpx.Client(timeout=15, follow_redirects=True) as client:
        progress(0.1, "Buscando la letra sincronizada…")
        try:
            lyr = find_lyrics(artist, title, client)
        except Exception as e:  # noqa: BLE001
            lyr = None
            result["warnings"].append(f"No se pudo consultar LRCLIB: {e}")
        duration = None
        if lyr:
            duration = lyr["duration"]
            result["lyrics_source"] = {"name": "LRCLIB", "id": lyr["source_id"], "track": lyr["track"],
                                       "artist": lyr["artist"], "duration": duration}
            result["segments"] = parse_lrc(lyr["synced"])
            if not result["segments"]:
                result["plain"] = [{"start": None, "end": None, "text": l.strip()}
                                   for l in lyr["plain"].splitlines() if l.strip()]
        progress(0.35, "Buscando el vídeo que encaja con la letra…")
        try:
            result["video"] = find_video(artist, title, duration, candidate, client)
        except Exception as e:  # noqa: BLE001
            result["warnings"].append(f"No se pudo buscar el vídeo: {e}")
        v = result["video"]
        if lyr and lyr.get("synced") and v and not v.get("synced") and v.get("duration"):
            # el vídeo no dura lo mismo que la canción del disco (intro, diálogo…):
            # se busca una letra cronometrada para ese vídeo
            progress(0.5, "Ajustando la letra a los tiempos del vídeo…")
            try:
                vt = find_video_timed(lyr["artist"] or artist, lyr["track"] or title, v.get("title") or "",
                                      v["duration"], _first_start(lyr["synced"]), client)
            except Exception:  # noqa: BLE001
                vt = None
            if vt:
                result["segments"] = parse_lrc(vt["synced"])
                result["lyrics_source"]["duration"] = vt["duration"]
                result["lyrics_source"]["id"] = vt["source_id"]
                v["synced"] = True
            else:
                result["warnings"].append(
                    "El vídeo no dura lo mismo que la canción del disco: la letra puede ir algo desfasada "
                    "(usa los botones «Antes / Después» o el 🎯 en la frase que oigas).")
    _finish(result, key, translate, target, progress)
    return result


def _finish(result: dict, key: str, translate: bool, target: str, progress) -> None:
    """Traduce, calcula la pronunciación y guarda en caché."""
    lines = result["segments"] or result["plain"]
    if lines and translate and translation.is_available():
        progress(0.6, "Traduciendo al español…")
        try:
            tr = translation.translate_many([s["text"] for s in lines], "en", target)
            for s, x in zip(lines, tr):
                s["translation"] = x
        except Exception as e:  # noqa: BLE001
            result["warnings"].append(f"Traducción no disponible: {e}")
    elif lines and translate:
        result["warnings"].append("Traducción no disponible: falta el paquete inglés→español de Argos (ejecuta instalar.bat).")
    progress(0.9, "Preparando la pronunciación…")
    for s in lines:
        p = pronunciation.sentence(s["text"])
        s["pron"], s["ipa"] = p["approx"], p["ipa"]
    result["created"] = time.time()
    if lines and not any("Traducción" in w for w in result["warnings"]):
        db.put_auto(key, result)


# ---------------------------------------------------------------------------
# Enlaces de YouTube pegados por el usuario: el vídeo ya está elegido, solo
# hay que averiguar qué canción es para buscar su letra.
NOISE = re.compile(
    r"[\(\[\{](?:[^\)\]\}]*?(?:official|lyric|lyrics|audio|video|visuali[sz]er|hd|4k|remaster|music|clip|letra|subtitulada|subtitulado|sub español|con letra|ft\.?|feat\.?)[^\)\]\}]*?)[\)\]\}]"
    r"|\s*[|•·]\s*.*$|\s+(?:official|lyrics?|lyric video|music video|video oficial|letra)\s*$", re.I)


def clean_video_title(t: str) -> str:
    t = NOISE.sub("", t or "")
    t = NOISE.sub("", t)
    return re.sub(r"\s+", " ", t.replace("“", '"').replace("”", '"')).strip(" -–—\"'")


def candidates_from_video(info: dict) -> list[tuple[str, str]]:
    """Posibles pares (artista, título) a partir de los metadatos del vídeo."""
    out: list[tuple[str, str]] = []

    def add(a, t):
        a, t = (a or "").strip(), (t or "").strip()
        if t and (a, t) not in out:
            out.append((a, t))

    if info.get("artist") and info.get("track"):
        add(re.split(r",|;", info["artist"])[0], info["track"])
    title = clean_video_title(info.get("title") or "")
    ch = re.sub(r"(?i)\s*-\s*topic$|vevo$|\s*official$", "", info.get("channel") or info.get("uploader") or "").strip()
    m = re.match(r"^(.+?)\s+[-–—:]\s+(.+)$", title)
    if m:
        add(m.group(1), m.group(2))
        add(m.group(2), m.group(1))  # por si viene «Canción - Artista»
    q = re.match(r'^(.+?)\s*"(.+?)"', title)
    if q:
        add(q.group(1), q.group(2))
    add(ch, title)
    add("", title)
    return out


def video_info(video_id: str) -> dict | None:
    from yt_dlp import YoutubeDL
    opts = {"quiet": True, "no_warnings": True, "skip_download": True, "noplaylist": True}
    try:
        with YoutubeDL(opts) as ydl:
            d = ydl.extract_info(f"https://www.youtube.com/watch?v={video_id}", download=False)
        return {"id": video_id, "title": d.get("title") or "", "channel": d.get("channel") or d.get("uploader") or "",
                "duration": d.get("duration"), "artist": d.get("artist"), "track": d.get("track")}
    except Exception:  # noqa: BLE001
        pass
    o = youtube.oembed(video_id)  # sin duración, pero al menos título y canal
    return {"id": video_id, "title": o["title"], "channel": o["author"], "duration": None} if o else None


def dedupe_artist(artist: str) -> str:
    """LRCLIB a veces repite el artista («Adele, Adele»): quita los repetidos."""
    seen, out = set(), []
    for part in (artist or "").split(","):
        p = part.strip()
        if p and norm(p) not in seen:
            seen.add(norm(p))
            out.append(p)
    return ", ".join(out)


def _first_start(lrc: str) -> float | None:
    segs = parse_lrc(lrc or "")
    return segs[0]["start"] if segs else None


def find_video_timed(artist: str, track: str, video_title: str, vdur: float, album_start: float | None,
                     client: httpx.Client) -> dict | None:
    """Busca en LRCLIB una letra cronometrada para el videoclip (misma duración que el vídeo).

    Muchas entradas con la duración del vídeo son copias de la letra del álbum (empiezan igual);
    solo se acepta una versión desplazada si al menos dos entradas coinciden en el inicio."""
    seen: dict = {}
    for q in (f"{main_artist(artist)} {clean_title(track)} official music video", video_title):
        if not q:
            continue
        for r in _get(client, "search", {"q": q}) or []:
            seen.setdefault(r.get("id"), r)
    nt = norm(clean_title(track))
    cands = []
    for r in seen.values():
        if not r.get("syncedLyrics") or not r.get("duration") or abs(r["duration"] - vdur) > 3:
            continue
        if nt not in norm(r.get("trackName", "")):
            continue
        st = _first_start(r["syncedLyrics"])
        if st is None or (album_start is not None and abs(st - album_start) <= 3):
            continue
        cands.append((round(st), r))
    if not cands:
        return None
    starts = [s for s, _ in cands]
    mode = max(set(starts), key=starts.count)
    if starts.count(mode) < 2:
        return None
    best = next(r for s, r in cands if s == mode)
    return {"synced": best["syncedLyrics"], "plain": best.get("plainLyrics") or "", "duration": best["duration"],
            "source_id": best.get("id"), "track": best.get("trackName"), "artist": best.get("artistName")}


def prepare_video(video_id: str, hint_artist: str = "", hint_title: str = "", target: str = "es",
                  translate: bool = True, progress=None, force: bool = False) -> dict:
    progress = progress or (lambda p, m: None)
    key = f"yt:{video_id}|{target}"
    if not force:
        cached = db.get_auto(key)
        if cached:
            return cached
    result: dict = {"artist": hint_artist, "title": hint_title, "segments": [], "plain": [], "video": None,
                    "lyrics_source": None, "warnings": []}
    progress(0.1, "Reconociendo la canción del enlace…")
    info = video_info(video_id) or {"id": video_id, "title": hint_title, "channel": hint_artist, "duration": None}
    cands = candidates_from_video(info)
    if hint_title:
        cands.insert(0, (hint_artist, hint_title))
    vdur = info.get("duration")
    lyr = None
    with httpx.Client(timeout=15, follow_redirects=True) as client:
        progress(0.3, "Buscando la letra sincronizada…")
        for a, t in cands:
            try:
                lyr = find_lyrics(a, t, client)
            except Exception as e:  # noqa: BLE001
                result["warnings"].append(f"No se pudo consultar LRCLIB: {e}")
                break
            if lyr:
                result["artist"], result["title"] = dedupe_artist(lyr["artist"]) or a, lyr["track"] or t
                break
        if lyr and lyr.get("synced") and vdur and lyr.get("duration") and abs(vdur - lyr["duration"]) > 8:
            progress(0.4, "Buscando la letra con los tiempos del videoclip…")
            try:
                vt = find_video_timed(result["artist"], result["title"], info.get("title") or "", vdur,
                                      _first_start(lyr["synced"]), client)
            except Exception:  # noqa: BLE001
                vt = None
            if vt:
                lyr = {**vt, "track": result["title"], "artist": result["artist"]}
    result["video"] = {"id": video_id, "duration": vdur, "title": info.get("title"), "score": None,
                       "synced": bool(lyr and vdur and lyr.get("duration") and abs(vdur - lyr["duration"]) <= 4)}
    if lyr:
        result["lyrics_source"] = {"name": "LRCLIB", "id": lyr["source_id"], "track": lyr["track"],
                                   "artist": lyr["artist"], "duration": lyr["duration"]}
        result["segments"] = parse_lrc(lyr["synced"])
        if not result["segments"]:
            result["plain"] = [{"start": None, "end": None, "text": l.strip()}
                               for l in lyr["plain"].splitlines() if l.strip()]
        if result["segments"] and vdur and lyr.get("duration") and abs(vdur - lyr["duration"]) > 8:
            result["warnings"].append(
                f"Este vídeo dura {round(vdur)} s y la letra {round(lyr['duration'])} s: puede que la letra vaya algo desfasada "
                "(ajusta el desfase en «Opciones avanzadas»).")
    else:
        result["warnings"].append("No he encontrado la letra de esta canción en LRCLIB.")
    _finish(result, key, translate, target, progress)
    return result


def dumps(d: dict) -> str:
    return json.dumps(d, ensure_ascii=False)

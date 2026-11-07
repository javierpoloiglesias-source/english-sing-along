"""Ayuda de pronunciación para hispanohablantes.

Fuentes (todas gratuitas y locales):
1. Diccionario CMU (paquete `cmudict`, ~134.000 palabras, inglés americano).
2. eSpeak NG, si está instalado, para palabras que no estén en el diccionario
   y para obtener IPA más precisa.

La "pronunciación aproximada" es una REESCRITURA ORIENTATIVA con letras del
español, no una transcripción fonética exacta: hay sonidos ingleses que no
existen en español (por ejemplo la "v" labiodental, la schwa o la "th").
"""
from __future__ import annotations

import functools
import os
import re
import shutil
import subprocess

# --------------------------------------------------------------------------
# ARPAbet (CMU) → español aproximado
VOWELS_ES = {
    "AA": "a", "AE": "a", "AO": "o", "AW": "au", "AY": "ai", "EH": "e",
    "ER": "er", "EY": "ei", "IH": "i", "IY": "i", "OW": "ou", "OY": "oi",
    "UH": "u", "UW": "u",
}
CONS_ES = {
    "B": "b", "CH": "ch", "D": "d", "DH": "d", "F": "f", "G": "g", "HH": "j",
    "JH": "y", "K": "k", "L": "l", "M": "m", "N": "n", "NG": "ng", "P": "p",
    "R": "r", "S": "s", "SH": "sh", "T": "t", "TH": "z", "V": "v", "W": "u",
    "Y": "i", "Z": "s", "ZH": "sh",
}
ACCENT = str.maketrans("aeiou", "áéíóú")

# ARPAbet → IPA
VOWELS_IPA = {
    "AA": "ɑ", "AE": "æ", "AO": "ɔ", "AW": "aʊ", "AY": "aɪ", "EH": "ɛ",
    "ER": "ɝ", "EY": "eɪ", "IH": "ɪ", "IY": "i", "OW": "oʊ", "OY": "ɔɪ",
    "UH": "ʊ", "UW": "u",
}
CONS_IPA = {
    "B": "b", "CH": "tʃ", "D": "d", "DH": "ð", "F": "f", "G": "ɡ", "HH": "h",
    "JH": "dʒ", "K": "k", "L": "l", "M": "m", "N": "n", "NG": "ŋ", "P": "p",
    "R": "ɹ", "S": "s", "SH": "ʃ", "T": "t", "TH": "θ", "V": "v", "W": "w",
    "Y": "j", "Z": "z", "ZH": "ʒ",
}

# IPA (eSpeak) → español aproximado, ordenado de símbolos largos a cortos.
IPA_ES = [
    ("tʃ", "ch"), ("dʒ", "y"), ("aɪ", "ai"), ("aʊ", "au"), ("eɪ", "ei"),
    ("oʊ", "ou"), ("əʊ", "ou"), ("ɔɪ", "oi"), ("ɪə", "ia"), ("eə", "ea"),
    ("ʊə", "ua"), ("ɜː", "er"), ("ɝ", "er"), ("ɚ", "er"), ("iː", "i"),
    ("uː", "u"), ("ɑː", "a"), ("ɔː", "o"), ("ɐ", "a"), ("ə", "e"), ("ʌ", "a"),
    ("æ", "a"), ("ɪ", "i"), ("ᵻ", "i"), ("ʊ", "u"), ("ɑ", "a"), ("ɒ", "o"),
    ("ɔ", "o"), ("ɛ", "e"), ("θ", "z"), ("ð", "d"), ("ʃ", "sh"), ("ʒ", "sh"),
    ("ŋ", "ng"), ("ɹ", "r"), ("ɾ", "r"), ("ɡ", "g"), ("j", "i"), ("w", "u"),
    ("h", "j"), ("z", "s"), ("ʔ", ""), ("ː", ""), ("ˌ", ""), ("ʲ", ""),
]

WORD_RE = re.compile(r"[A-Za-z][A-Za-z'’]*|[^A-Za-z\s]+")


@functools.lru_cache(maxsize=1)
def _cmu() -> dict:
    try:
        import cmudict
        return cmudict.dict()
    except Exception:
        return {}


def espeak_path() -> str | None:
    found = shutil.which("espeak-ng") or shutil.which("espeak")
    if found:
        return found
    for cand in (r"C:\Program Files\eSpeak NG\espeak-ng.exe",
                 r"C:\Program Files (x86)\eSpeak NG\espeak-ng.exe"):
        if os.path.exists(cand):
            return cand
    return None


@functools.lru_cache(maxsize=4096)
def espeak_ipa(text: str) -> str | None:
    exe = espeak_path()
    if not exe:
        return None
    try:
        out = subprocess.run([exe, "-q", "--ipa", "-v", "en-us", text], capture_output=True,
                             text=True, encoding="utf-8", timeout=10,
                             creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        return " ".join(out.stdout.split()) or None
    except Exception:
        return None


def espeak_wav(text: str, speed: int = 150, voice: str = "en-us") -> bytes | None:
    exe = espeak_path()
    if not exe:
        return None
    out = subprocess.run([exe, "-v", voice, "-s", str(speed), "--stdout", text],
                         capture_output=True, timeout=20,
                         creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    return out.stdout or None


def _split_phones(phones: list[str]) -> list[tuple[str, int | None]]:
    res = []
    for p in phones:
        m = re.match(r"([A-Z]+)(\d)?$", p)
        if m:
            res.append((m.group(1), int(m.group(2)) if m.group(2) is not None else None))
    return res


def arpabet_to_spanish(phones: list[str]) -> str:
    parts = _split_phones(phones)
    n_vowels = sum(1 for ph, s in parts if s is not None)
    out = []
    for i, (ph, stress) in enumerate(parts):
        if stress is not None:  # vocal
            if ph == "AH":
                v = "a" if stress > 0 else "e"
            else:
                v = VOWELS_ES.get(ph, "")
            if stress == 1 and n_vowels > 1 and v:
                v = v[0].translate(ACCENT) + v[1:]
            out.append(v)
        else:
            c = CONS_ES.get(ph, "")
            nxt = parts[i + 1] if i + 1 < len(parts) else None
            nxt_txt = ""
            if nxt and nxt[1] is not None:
                nxt_txt = "a" if nxt[0] == "AH" and nxt[1] else VOWELS_ES.get(nxt[0], "e" if nxt[0] == "AH" else "")
            if ph == "G" and nxt_txt[:1] in ("e", "i"):
                c = "gu"
            out.append(c)
    return _tidy("".join(out))


def _tidy(s: str) -> str:
    """Pequeños ajustes de lectura: 'ngk' → 'nk', consonantes dobles."""
    s = s.replace("ngk", "nk").replace("ngg", "ng")
    return re.sub(r"([bdfgklmnprstvz])\1", r"\1", s)


def arpabet_to_ipa(phones: list[str]) -> str:
    parts = _split_phones(phones)
    out = []
    for i, (ph, stress) in enumerate(parts):
        if stress is not None:
            v = ("ʌ" if stress else "ə") if ph == "AH" else VOWELS_IPA.get(ph, "")
            if ph == "ER" and stress == 0:
                v = "ɚ"
            if stress == 1 and len([p for p in parts if p[1] is not None]) > 1:
                # marca de acento antes de la consonante inicial de la sílaba
                if out and i > 0 and parts[i - 1][1] is None:
                    out.insert(len(out) - 1, "ˈ")
                else:
                    out.append("ˈ")
            out.append(v)
        else:
            out.append(CONS_IPA.get(ph, ""))
    return "".join(out)


def ipa_to_spanish(ipa: str) -> str:
    s = ipa
    stressed = "ˈ" in s
    # acentúa la primera vocal tras la marca primaria
    if stressed:
        s = re.sub(r"ˈ([^aeiouæɑɒɔəɐɛɜɝɚɪᵻʊʌ]*)([aeiouæɑɒɔəɐɛɜɝɚɪᵻʊʌ])",
                   lambda m: m.group(1) + "\u0301" + m.group(2), s, count=1)
    s = s.replace("ˈ", "")
    for a, b in IPA_ES:
        s = s.replace(a, b)
    # mueve la tilde combinada sobre la vocal resultante
    s = re.sub(r"\u0301([a-z]*?)([aeiou])", lambda m: m.group(1) + m.group(2).translate(ACCENT), s, count=1)
    s = s.replace("\u0301", "")
    s = _tidy(s)
    if len(re.findall(r"[aeiouáéíóú]+", s)) <= 1:
        s = s.translate(str.maketrans("áéíóú", "aeiou"))
    return s


def word_info(word: str) -> dict:
    key = word.lower().replace("’", "'")
    entry = _cmu().get(key) or _cmu().get(key.strip("'"))
    if entry:
        phones = entry[0]
        approx = arpabet_to_spanish(phones)
        ipa = arpabet_to_ipa(phones)
        source = "cmudict"
        es = espeak_ipa(word)
        if es:
            ipa = es
        return {"word": word, "ipa": ipa, "approx": approx, "source": source}
    es = espeak_ipa(word)
    if es:
        return {"word": word, "ipa": es, "approx": ipa_to_spanish(es), "source": "espeak-ng"}
    return {"word": word, "ipa": "", "approx": word.lower(), "source": "sin-datos"}


def sentence(text: str) -> dict:
    """Devuelve IPA y pronunciación aproximada para una frase completa."""
    tokens = WORD_RE.findall(text or "")
    approx_parts: list[str] = []
    ipa_parts: list[str] = []
    words = []
    unknown = []
    for tok in tokens:
        if re.match(r"[A-Za-z]", tok):
            info = word_info(tok)
            words.append(info)
            if info["source"] == "sin-datos":
                unknown.append(tok)
            approx_parts.append(info["approx"])
            ipa_parts.append(info["ipa"] or tok.lower())
        else:
            punct = tok.strip()
            if punct and approx_parts:
                approx_parts[-1] += punct
                ipa_parts[-1] += punct if punct in ",.?!" else ""
    approx = " ".join(approx_parts)
    if approx:
        approx = approx[0].upper() + approx[1:]
    return {"text": text, "approx": approx, "ipa": " ".join(ipa_parts), "words": words,
            "unknown": unknown, "espeak": bool(espeak_path())}

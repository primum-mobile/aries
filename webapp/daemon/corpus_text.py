# SPDX-FileCopyrightText: Morinus contributors
# SPDX-FileCopyrightText: 2026 Max Lange (Aries modifications)
# SPDX-License-Identifier: GPL-3.0-or-later
# Modified for Aries in 2026 by Max Lange.

"""Pure-Python corpus source-text normalization for the webapp inspector.

The wx desktop renders Valens passages through ``corpuspane.py`` (a wx widget),
which both *cleans* the parser-emitted text and *segments* it into styled runs:

  * ``⟨i⟩…⟨/i⟩`` / ``⟨b⟩…⟨/b⟩``  → italic / bold runs (markers stripped)
  * ``<editorial>``               → editorial-coloured run (brackets stripped)
  * Unicode astro glyphs (☉♌☽…)  → Morinus glyph-font run (PUA substituted)
  * LaTeX measure debris ``[3.5cm]`` / page refs ``/123K/`` → removed
  * whitespace collapsed, paragraph breaks preserved

The webapp daemon previously shipped ``section['text']`` *raw*, so the emphasis
markers showed up as literal junk, the editorial brackets were kept, the LaTeX
debris was not stripped, and the astro glyphs never picked up the Morinus font —
i.e. all of the desktop's formatting was lost.

This module reproduces ``corpuspane``'s cleaning + segmentation as PURE functions
(no wx import, so the daemon can use it). The regexes and the Unicode→Morinus map
are kept byte-for-byte in sync with ``corpuspane.py`` (the desktop oracle).
Nothing here fabricates content — it only normalizes and tags spans of the
verbatim source text.
"""

from __future__ import annotations

import re
from typing import List, TypedDict

# ── Unicode → Morinus PUA glyph map (mirror of corpuspane._UNICODE_TO_MORINUS) ──
_UNICODE_TO_MORINUS = {
    "☉": "A",  # ☉ Sun
    "☽": "B",  # ☽ Moon
    "☿": "C",  # ☿ Mercury
    "♀": "D",  # ♀ Venus
    "♂": "E",  # ♂ Mars
    "♃": "F",  # ♃ Jupiter
    "♄": "G",  # ♄ Saturn
    "♈": "a",  # ♈ Aries
    "♉": "b",  # ♉ Taurus
    "♊": "c",  # ♊ Gemini
    "♋": "d",  # ♋ Cancer
    "♌": "e",  # ♌ Leo
    "♍": "f",  # ♍ Virgo
    "♎": "g",  # ♎ Libra
    "♏": "h",  # ♏ Scorpio
    "♐": "i",  # ♐ Sagittarius
    "♑": "j",  # ♑ Capricorn
    "♒": "k",  # ♒ Aquarius
    "♓": "l",  # ♓ Pisces
    "☊": "K",  # ☊ North Node
    "☋": "K",  # ☋ South Node
    "☌": "M",  # ☌ Conjunction
    "☍": "N",  # ☍ Opposition
    "△": "O",  # △ Trine
    "□": "P",  # □ Square
    "⚹": "Q",  # ⚹ Sextile
}
_GLYPH_CHARS = set(_UNICODE_TO_MORINUS.keys())

# Run kinds (mirror corpuspane._RUN_*).
NORMAL = "normal"
GLYPH = "glyph"
EDITORIAL = "editorial"
ITALIC = "italic"
BOLD = "bold"

# ── Regexes (mirror corpuspane) ──
_EDITORIAL_RE = re.compile(r"<([^>]*)>")
_INLINE_FN_RE = re.compile(r"\[fn:\s*([^\]]+)\]")
_EMPH_RE = re.compile(r"⟨([ib])⟩(.*?)⟨/\1⟩", re.DOTALL)
_EMPH_STRIP_RE = re.compile(r"⟨/?[ib]⟩")
# Safety-net text-cleaning (mirror corpuspane._clean_display_text).
_LATEX_MEASURE_RE = re.compile(r"\[[\d.]+\s*(?:cm|mm|pt|em|ex|in)\]")
_PAGE_REF_RE = re.compile(r"/\d+[KP]/")
_PLANET_HEADING_RE = re.compile(
    r"^(?:[" + "".join(re.escape(g) for g in _GLYPH_CHARS) + r"]\s*)?"
    r"(?:[A-Z][a-z]+\s*)?"
    r"[" + "".join(re.escape(g) for g in _GLYPH_CHARS) + r"]\s*"
    r"(.*)$",
    re.DOTALL,
)
_HEADING_LABEL_PREFIXES = (
    "Indicates:", "Sect:", "Colour:", "Color:", "Taste:", "Body:", "Of ",
    "Climate:", "Fixed Stars:", "Paranatellonta:", "Zones:",
)
_LEAD_LABEL_RE = re.compile(
    r"^(Indicates:|Of [^:]+:|Body:|Sect:|Colou?r:|Taste:|Climate:|Fixed Stars:|Paranatellonta:|Zones:)\s*(.*)$",
    re.IGNORECASE | re.DOTALL,
)


class TextRun(TypedDict):
    kind: str
    text: str


class PassageParagraph(TypedDict):
    label: str | None
    text: str
    runs: List[TextRun]
    bullet: bool


def clean_display_text(text: str) -> str:
    """Clean text for display, normalize whitespace, preserve paragraph breaks.

    Byte-for-byte mirror of corpuspane._clean_display_text — the desktop oracle.
    """
    text = (text or "").strip()
    text = _LATEX_MEASURE_RE.sub("", text)
    text = _PAGE_REF_RE.sub("", text)
    # Drop empty emphasis spans (e.g. ⟨b⟩⟨/b⟩ left when a LaTeX command produced
    # no textual content after symbol substitution).
    text = re.sub(r"⟨([ib])⟩\s*⟨/\1⟩", "", text)
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n\s*\n", "\n\n", text)
    return text.strip()


def _strip_planet_heading(text: str) -> tuple[str, bool]:
    """Mirror corpuspane._strip_planet_heading for source-text paragraphs."""
    m = _PLANET_HEADING_RE.match(text)
    if m:
        remainder = m.group(1).strip()
        if (
            remainder == ""
            or any(remainder.startswith(lbl) for lbl in _HEADING_LABEL_PREFIXES)
            or (remainder and remainder[0] in _GLYPH_CHARS)
        ):
            return remainder, remainder == ""
    return text, False


def _strip_leading_glyph(text: str) -> str:
    if text and text[0] in _GLYPH_CHARS:
        return text[1:].lstrip()
    return text


def _extract_inline_footnotes(text: str) -> tuple[str, list[str]]:
    footnotes = [m.group(1).strip() for m in _INLINE_FN_RE.finditer(text)]
    return _INLINE_FN_RE.sub("", text).strip(), footnotes


def _split_bullet_paragraph(text: str) -> list[str]:
    if "•" not in text:
        return [text] if text else []
    parts = []
    prefix, rest = text.split("•", 1)
    prefix = prefix.strip()
    if prefix:
        parts.append(prefix)
    for item in ("•" + chunk for chunk in rest.split("•")):
        item = item.strip()
        if item:
            parts.append(item)
    return parts


def _clean_single_line(text: str) -> str:
    return re.sub(r"\s+", " ", clean_display_text(text)).strip()


def _strip_emphasis_markers(text: str) -> str:
    return _EMPH_STRIP_RE.sub("", text or "")


def _section_heading_values(section: dict | None) -> set[str]:
    heading = str((section or {}).get("heading") or "").strip()
    if not heading:
        return set()
    return {heading, heading.strip("[]")}


def _section_body_paragraphs(section: dict | None) -> tuple[list[str], list[str]]:
    text = clean_display_text((section or {}).get("text", ""))
    raw_paras = [re.sub(r"[ \t]+", " ", p).strip() for p in text.split("\n\n")]
    raw_paras = [p for p in raw_paras if p]
    expanded: list[str] = []
    for para in raw_paras:
        expanded.extend(_split_bullet_paragraph(para))

    heading_values = _section_heading_values(section)
    stripped_paras: list[str] = []
    for para in expanded:
        if para in heading_values:
            continue
        clean, heading_only = _strip_planet_heading(para)
        if heading_only:
            continue
        clean = clean.strip()
        if clean and clean not in heading_values:
            stripped_paras.append(clean)

    inline_footnotes: list[str] = []
    clean_paras: list[str] = []
    for para in stripped_paras:
        clean_para, footnotes = _extract_inline_footnotes(para)
        inline_footnotes.extend(footnotes)
        if clean_para:
            clean_paras.append(clean_para)
    return clean_paras, inline_footnotes


def section_citation(section: dict | None) -> str:
    """Mirror corpuspane._section_citation without importing wx."""
    s = section or {}
    book = s.get("book_title") or ""
    chapter = s.get("chapter") or ""
    heading = s.get("heading") or ""
    kroll = s.get("kroll_page") or ""
    pingree = s.get("pingree_page") or ""

    ref = "Valens, Anthologies"
    if book:
        ref += " — " + str(book)
    if chapter:
        ref += ", ch.\u2009" + str(chapter)
    if heading:
        ref += "  “" + str(heading).strip("[]") + "”"
    if kroll or pingree:
        parts = []
        if kroll:
            parts.append(str(kroll) + "K")
        if pingree:
            parts.append(str(pingree) + "P")
        ref += "  (" + ", ".join(parts) + ")"
    return ref


def structured_paragraphs(section: dict | None) -> tuple[list[PassageParagraph], list[str]]:
    """Return wx QuoteTextPane-style paragraphs for the web renderer."""
    paras, inline_footnotes = _section_body_paragraphs(section)
    structured: list[PassageParagraph] = []
    for para in paras:
        label = None
        body = para
        match = _LEAD_LABEL_RE.match(para)
        if match:
            label = match.group(1).strip()
            body = _strip_leading_glyph(match.group(2).strip())
        bullet = body.startswith("•")
        if bullet:
            body = body[1:].lstrip()
        structured.append({
            "label": label,
            "text": _strip_emphasis_markers(body),
            "runs": segment_text_styled(body),
            "bullet": bullet,
        })
    return structured, inline_footnotes


def structured_section(section: dict | None) -> dict:
    """JSON-ready display structure matching corpuspane.QuoteTextPane."""
    paragraphs, inline_footnotes = structured_paragraphs(section)
    footnotes = [
        _clean_single_line(str(fn))
        for fn in list((section or {}).get("footnotes") or []) + list(inline_footnotes)
        if str(fn).strip()
    ]
    citation = section_citation(section)
    return {
        "citation": citation,
        "citation_runs": segment_text_styled(citation),
        "paragraphs": paragraphs,
        "footnotes": footnotes,
    }


def _segment_glyph_normal(text: str) -> List[TextRun]:
    """Split plain text into NORMAL / GLYPH runs (Unicode astro glyph → Morinus).

    Mirror of corpuspane._segment_glyph_normal, but it also performs the PUA
    substitution (corpuspane._substitute_glyphs) so the frontend can render the
    glyph run directly in the Morinus font.
    """
    if not text:
        return []
    runs: List[TextRun] = []
    current = ""
    current_type = GLYPH if text[0] in _GLYPH_CHARS else NORMAL
    for ch in text:
        t = GLYPH if ch in _GLYPH_CHARS else NORMAL
        if t == current_type:
            current += ch
        else:
            if current:
                runs.append(_emit(current_type, current))
            current = ch
            current_type = t
    if current:
        runs.append(_emit(current_type, current))
    return runs


def _emit(kind: str, text: str) -> TextRun:
    if kind == GLYPH:
        text = "".join(_UNICODE_TO_MORINUS.get(ch, ch) for ch in text)
    return {"kind": kind, "text": text}


def _segment_emphasis(text: str):
    """Yield (emphasis|None, plain_text) splitting on ⟨i⟩/⟨b⟩ markers.

    Mirror of corpuspane._segment_emphasis.
    """
    if not text:
        return
    pos = 0
    for m in _EMPH_RE.finditer(text):
        before = text[pos : m.start()]
        if before:
            yield (None, before)
        content = m.group(2)
        if content:  # silently drop empty marker spans
            yield (ITALIC if m.group(1) == "i" else BOLD, content)
        pos = m.end()
    tail = text[pos:]
    if tail:
        yield (None, tail)


def segment_text_styled(text: str) -> List[TextRun]:
    """Split text into styled runs across all layers.

    Mirror of corpuspane._segment_text_styled: emphasis (italic/bold) is the
    outer layer, <editorial> the inner layer, and astro glyphs always win as
    GLYPH runs (Morinus font) even when nested inside emphasis/editorial.
    """
    if not text:
        return []
    runs: List[TextRun] = []
    for emph_tag, chunk in _segment_emphasis(text):
        if emph_tag in (ITALIC, BOLD):
            for seg in _segment_glyph_normal(chunk):
                if seg["kind"] == GLYPH:
                    runs.append(seg)
                else:
                    runs.append({"kind": emph_tag, "text": seg["text"]})
            continue
        # Inner pass: <editorial> spans on the non-emphasised chunk.
        pos = 0
        for m in _EDITORIAL_RE.finditer(chunk):
            before = chunk[pos : m.start()]
            if before:
                runs.extend(_segment_glyph_normal(before))
            content = m.group(1)
            if content:
                for seg in _segment_glyph_normal(content):
                    if seg["kind"] == GLYPH:
                        runs.append(seg)
                    else:
                        runs.append({"kind": EDITORIAL, "text": seg["text"]})
            pos = m.end()
        tail = chunk[pos:]
        if tail:
            runs.extend(_segment_glyph_normal(tail))
    return runs


def styled_runs(text: str) -> List[TextRun]:
    """Clean the verbatim source text, then segment it into styled runs.

    This is the daemon entry point: ``clean_display_text`` then
    ``segment_text_styled``. Paragraph breaks (``\\n\\n``) survive cleaning and
    appear as literal newlines inside NORMAL runs; the frontend renders them with
    ``whitespace-pre-line`` (exactly as the previous raw rendering did), so layout
    is unchanged.
    """
    return segment_text_styled(clean_display_text(text))

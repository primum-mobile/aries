#!/usr/bin/env python3
# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

"""
parse_latex.py — Valens Anthologies LaTeX → Structured JSON

Parses the janegca/latex-valens .tex files into a queryable JSON corpus
for use in a traditional astrology interpreter engine.

Usage:
    python parse_latex.py ../corpus/raw/valens/ ../corpus/parsed/valens.json

Output structure:
    {
        "meta": { ... },
        "books": [
            {
                "book_number": 1,
                "title": "Book I",
                "chapters": [
                    {
                        "chapter_number": 1,
                        "title": "The Nature of the Stars",
                        "kroll_ref": "1K",
                        "pingree_ref": "1P",
                        "sections": [
                            {
                                "heading": null,
                                "text": "...",
                                "tags": ["planets", "saturn", "nature"],
                                "footnotes": [...],
                                "editorial_notes": [...]
                            }
                        ]
                    }
                ]
            }
        ]
    }
"""

import re
import os
import sys
import json
import glob
from pathlib import Path
from dataclasses import dataclass, field, asdict
from typing import Optional


# ─── ASTROLOGICAL TAG DETECTION ─────────────────────────────────────────────

ASTRO_KEYWORDS = {
    # planets
    "saturn": ["saturn", "kronos", "cronus"],
    "jupiter": ["jupiter", "zeus"],
    "mars": ["mars", "ares"],
    "venus": ["venus", "aphrodite"],
    "mercury": ["mercury", "hermes"],
    "sun": ["sun", "helios", "solar"],
    "moon": ["moon", "selene", "lunar"],
    # nodes
    "north_node": ["ascending node", "north node", "head of the dragon", "caput"],
    "south_node": ["descending node", "south node", "tail of the dragon", "cauda"],
    # signs
    "aries": ["aries", "ram"],
    "taurus": ["taurus", "bull"],
    "gemini": ["gemini", "twins"],
    "cancer": ["cancer", "crab"],
    "leo": ["leo", "lion"],
    "virgo": ["virgo", "maiden", "virgin"],
    "libra": ["libra", "scales", "balance"],
    "scorpio": ["scorpio", "scorpion"],
    "sagittarius": ["sagittarius", "archer"],
    "capricorn": ["capricorn", "goat"],
    "aquarius": ["aquarius", "water-bearer", "waterbearer"],
    "pisces": ["pisces", "fishes", "fish"],
    # houses / places
    "ascendant": ["ascendant", "ascending", "horoskopos", "horoscope", "1st place", "first place"],
    "midheaven": ["midheaven", "mc", "medium coeli", "10th place", "tenth place"],
    "descendant": ["descendant", "descending", "7th place", "seventh place"],
    "ic": ["subterranean", "imum coeli", "4th place", "fourth place", "lower midheaven"],
    # techniques
    "profections": ["profection", "profections"],
    "zodiacal_releasing": ["zodiacal releasing", "releasing", "loosing of the bond"],
    "time_lords": ["time lord", "time-lord", "chronocrator", "chronocrators", "distributor", "period lord"],
    "lots": ["lot of fortune", "lot of spirit", "lot of eros", "lot of necessity",
             "lot of courage", "lot of victory", "lot of nemesis", "lot of"],
    "lot_of_fortune": ["lot of fortune", "fortune", "fortuna"],
    "lot_of_spirit": ["lot of spirit", "spirit", "daimon"],
    "triplicity": ["triplicity", "triplicities", "triplicity lord", "triplicity rulers"],
    "sect": ["sect", "diurnal", "nocturnal", "hairesin"],
    "aspects": ["trine", "square", "sextile", "opposition", "conjunction", "aspect"],
    "domicile": ["domicile", "house ruler", "ruler of"],
    "exaltation": ["exaltation", "exalted"],
    "depression": ["depression", "fall", "dejection"],
    "terms": ["terms", "bounds", "confines"],
    "decans": ["decan", "decans", "face", "faces"],
    "primary_directions": ["direction", "primary direction", "prorogation", "prorogator", "apheta", "hyleg"],
    "solar_return": ["solar return", "revolution of the year", "revolution"],
    "transits": ["transit", "transits", "ingress"],
    "fixed_stars": ["fixed star", "fixed stars", "spica", "regulus", "antares", "aldebaran", "fomalhaut"],
    # topics
    "marriage": ["marriage", "wife", "husband", "spouse", "wedding", "nuptial"],
    "children": ["children", "child", "offspring", "son", "daughter"],
    "parents": ["father", "mother", "parents"],
    "death": ["death", "destruction", "killing", "dying", "deadly"],
    "illness": ["illness", "disease", "sickness", "sick", "chronic", "injury", "wound"],
    "wealth": ["wealth", "rich", "poverty", "poor", "property", "possessions", "fortune", "money"],
    "career": ["career", "occupation", "rank", "eminence", "action", "profession", "livelihood"],
    "travel": ["travel", "journey", "foreign", "abroad", "sailing", "voyage"],
    "slavery": ["slave", "slavery", "servitude", "bondage"],
    "length_of_life": ["length of life", "longevity", "vital sector", "life span", "years of life"],
}


def detect_tags(text: str) -> list[str]:
    """Scan text for astrological keywords and return matching tags."""
    lower = text.lower()
    found = []
    for tag, keywords in ASTRO_KEYWORDS.items():
        for kw in keywords:
            if kw in lower:
                found.append(tag)
                break
    return sorted(set(found))


# ─── LATEX CLEANING ──────────────────────────────────────────────────────────

def _find_matching_brace(text: str, start: int) -> int:
    """From opening { at `start`, return index of matching }. Returns -1 on failure."""
    depth = 1
    i = start + 1
    while i < len(text) and depth > 0:
        if text[i] == '{':
            depth += 1
        elif text[i] == '}':
            depth -= 1
        i += 1
    return i - 1 if depth == 0 else -1


def _replace_command_balanced(text: str, cmd: str, replacement_fn) -> str:
    """Replace \\cmd{...} using brace-aware matching. replacement_fn(content) -> str."""
    result = []
    i = 0
    tag = '\\' + cmd + '{'
    while i < len(text):
        pos = text.find(tag, i)
        if pos == -1:
            result.append(text[i:])
            break
        result.append(text[i:pos])
        brace_start = pos + len(tag) - 1
        brace_end = _find_matching_brace(text, brace_start)
        if brace_end == -1:
            result.append(text[pos:])
            break
        content = text[brace_start + 1:brace_end]
        result.append(replacement_fn(content))
        i = brace_end + 1
    return ''.join(result)


def _strip_href(text: str) -> str:
    """Replace \\href{URL}{display text} with display text using brace-aware matching."""
    result = []
    i = 0
    tag = '\\href{'
    while i < len(text):
        pos = text.find(tag, i)
        if pos == -1:
            result.append(text[i:])
            break
        result.append(text[i:pos])
        # find end of URL brace
        url_start = pos + len(tag) - 1
        url_end = _find_matching_brace(text, url_start)
        if url_end == -1:
            result.append(text[pos:])
            break
        # find display text brace
        j = url_end + 1
        while j < len(text) and text[j] in ' \t\n':
            j += 1
        if j >= len(text) or text[j] != '{':
            result.append(text[pos:])
            break
        disp_start = j
        disp_end = _find_matching_brace(text, disp_start)
        if disp_end == -1:
            result.append(text[pos:])
            break
        result.append(text[disp_start + 1:disp_end])
        i = disp_end + 1
    return ''.join(result)


def clean_latex(text: str) -> str:
    """Strip LaTeX commands down to readable plaintext while preserving structure."""

    # Preserve line breaks for paragraph detection
    text = re.sub(r'\\\\', '\n', text)

    # Remove comments (lines starting with %)
    text = re.sub(r'(?m)^%.*$', '', text)
    text = re.sub(r'(?<!\\)%.*$', '', text, flags=re.MULTILINE)

    # Handle common LaTeX environments
    text = re.sub(r'\\begin\{quote\}', '', text)
    text = re.sub(r'\\end\{quote\}', '', text)
    text = re.sub(r'\\begin\{enumerate\}', '', text)
    text = re.sub(r'\\end\{enumerate\}', '', text)
    text = re.sub(r'\\begin\{itemize\}', '', text)
    text = re.sub(r'\\end\{itemize\}', '', text)
    text = re.sub(r'\\begin\{center\}', '', text)
    text = re.sub(r'\\end\{center\}', '', text)
    text = re.sub(r'\\begin\{table\}.*?\\end\{table\}', '[TABLE]', text, flags=re.DOTALL)
    text = re.sub(r'\\begin\{figure\}.*?\\end\{figure\}', '[FIGURE]', text, flags=re.DOTALL)
    text = re.sub(r'\\begin\{tabular\}.*?\\end\{tabular\}', '[TABLE]', text, flags=re.DOTALL)
    text = re.sub(r'\\begin\{description\}(?:\[[^\]]*\])*', '', text)
    text = re.sub(r'\\end\{description\}', '', text)

    # Handle list items
    text = re.sub(r'\\item\s*', '• ', text)

    # Handle \href{URL}{display text} — keep display text, discard URL
    text = _strip_href(text)

    # Extract text from formatting commands, preserving emphasis as inline markers.
    # Italic and bold spans use mathematical angle brackets U+27E8/U+27E9 so they
    # don't collide with the <editorial> ASCII angle brackets used elsewhere and
    # survive the generic { } cleanup below.
    text = re.sub(r'\\(?:textit|emph)\{([^}]*)\}', r'⟨i⟩\1⟨/i⟩', text)
    text = re.sub(r'\\(?:textbf|textsc)\{([^}]*)\}', r'⟨b⟩\1⟨/b⟩', text)
    text = re.sub(r'\\(?:texttt|textrm|textsf)\{([^}]*)\}', r'\1', text)
    text = re.sub(r'\\underline\{([^}]*)\}', r'\1', text)
    text = re.sub(r'\{\\bf\s+([^}]*)\}', r'⟨b⟩\1⟨/b⟩', text)
    text = re.sub(r'\{\\(?:it|em|sc)\s+([^}]*)\}', r'⟨i⟩\1⟨/i⟩', text)
    text = re.sub(r'\{\\(?:tt|rm|sf)\s+([^}]*)\}', r'\1', text)

    # Handle \footnote — extract into brackets (brace-aware to handle nested commands)
    text = _replace_command_balanced(text, 'footnote', lambda c: f' [fn: {c}]')

    # Handle cross-references
    text = re.sub(r'\\(?:label|ref|pageref|nameref)\{[^}]*\}', '', text)
    text = re.sub(r'\\hyperref\[[^\]]*\]\{([^}]*)\}', r'\1', text)

    # Astrological symbols — map common LaTeX symbol commands to text
    symbol_map = {
        r'\\Saturn': '♄', r'\\Jupiter': '♃', r'\\Mars': '♂',
        r'\\Sun': '☉', r'\\Moon': '☽', r'\\Venus': '♀',
        r'\\Mercury': '☿', r'\\Aries': '♈', r'\\Taurus': '♉',
        r'\\Gemini': '♊', r'\\Cancer': '♋', r'\\Leo': '♌',
        r'\\Virgo': '♍', r'\\Libra': '♎', r'\\Scorpio': '♏',
        r'\\Sagittarius': '♐', r'\\Capricorn': '♑', r'\\Aquarius': '♒',
        r'\\Pisces': '♓', r'\\NorthNode': '☊', r'\\SouthNode': '☋',
        r'\\Conjunction': '☌', r'\\Opposition': '☍',
        r'\\Trine': '△', r'\\Square': '□', r'\\Sextile': '⚹',
        # Editorial modern insertions like <\Neptune> should survive as text.
        r'\\Neptune': 'Neptune',
        # StarFont Sans commands (Griscti uses these)
        r'\\starmark': '★', r'\\ascmark': 'ASC', r'\\mcmark': 'MC',
    }
    for cmd, sym in symbol_map.items():
        text = re.sub(cmd + r'(?:\{\}|\b)', sym, text)

    # Handle \degree and similar
    text = re.sub(r'\\degree', '°', text)
    text = re.sub(r'\\textdegree', '°', text)
    text = re.sub(r'\\textsuperscript\{([^}]*)\}', r'\1', text)

    # Thin spaces — single-char control sequences missed by \\[a-zA-Z]+
    text = re.sub(r'\\[,;:.]', ' ', text)

    # mdframed environment — strip wrapper, keep contents
    text = re.sub(r'\\begin\{mdframed\}(?:\[[^\]]*\])?', '', text)
    text = re.sub(r'\\end\{mdframed\}', '', text)

    # wrapfigure environment — strip entirely (wraps figures/tikz)
    text = re.sub(r'\\begin\{wrapfigure\}(?:\[[^\]]*\])?\{[^}]*\}\{[^}]*\}.*?\\end\{wrapfigure\}', '', text, flags=re.DOTALL)

    # tikzpicture environment — strip entirely (vector graphics code)
    text = re.sub(r'\\begin\{tikzpicture\}.*?\\end\{tikzpicture\}', '', text, flags=re.DOTALL)

    # scope environment (inside tikz) — strip entirely
    text = re.sub(r'\\begin\{scope\}.*?\\end\{scope\}', '', text, flags=re.DOTALL)

    # longtable environment — strip like tabular
    text = re.sub(r'\\begin\{longtable\}.*?\\end\{longtable\}', '[TABLE]', text, flags=re.DOTALL)

    # Index markers — catch before generic command removal to avoid ! leaking
    text = re.sub(r'\\index\{[^}]*\}', '', text)

    # Strip remaining simple commands
    text = re.sub(r'\\(?:noindent|par|newline|clearpage|newpage|bigskip|medskip|smallskip|hfill|vfill|centering)\b', '', text)
    text = re.sub(r'\\(?:vspace|hspace)\*?\{[^}]*\}', '', text)
    text = re.sub(r'\\(?:large|Large|LARGE|huge|Huge|small|footnotesize|scriptsize|tiny|normalsize)\b', '', text)

    # Remove \input, \include (we walk files separately)
    text = re.sub(r'\\(?:input|include)\{[^}]*\}', '', text)

    # Remove remaining unknown commands but keep their arguments
    text = re.sub(r'\\[a-zA-Z]+\*?\{([^}]*)\}', r'\1', text)
    # Remove commands with no arguments
    text = re.sub(r'\\[a-zA-Z]+\*?', '', text)

    # Clean up braces
    text = text.replace('{', '').replace('}', '')

    # Clean up tildes (non-breaking spaces)
    text = text.replace('~', ' ')

    # Strip LaTeX measurement artifacts: [0.2cm], [-0.5cm], [1in], etc.
    text = re.sub(r'\[-?[\d.]+\s*(?:cm|mm|pt|em|ex|in)\]', '', text)

    # Extract inline Kroll/Pingree page refs: /100K/ → stripped from body
    # (these are captured as structured metadata by extract_refs() on headings;
    #  inline occurrences are display noise)
    text = re.sub(r'/(\d+)[KP]/', '', text)

    # Normalize whitespace
    text = re.sub(r'[ \t]+', ' ', text)
    text = re.sub(r'\n{3,}', '\n\n', text)
    text = text.strip()

    return text


# ─── REFERENCE EXTRACTION ────────────────────────────────────────────────────

def extract_refs(title: str) -> dict:
    """Pull Kroll (K) and Pingree (P) page references from chapter/section titles."""
    refs = {}
    k_match = re.search(r'\(?\s*(\d+)\s*K\s*\)?', title)
    p_match = re.search(r'\(?\s*(\d+)\s*P\s*\)?', title)
    kp_match = re.search(r'\(?\s*(\d+)\s*K\s*,\s*(\d+)\s*P\s*\)?', title)

    if kp_match:
        refs['kroll_page'] = kp_match.group(1)
        refs['pingree_page'] = kp_match.group(2)
    else:
        if k_match:
            refs['kroll_page'] = k_match.group(1)
        if p_match:
            refs['pingree_page'] = p_match.group(1)

    # Clean refs out of the title for display
    clean_title = re.sub(r'\s*\(?\s*\d+\s*K\s*(?:,\s*\d+\s*P\s*)?\)?\s*', '', title)
    clean_title = re.sub(r'\s*\(?\s*\d+\s*P\s*\)?\s*', '', clean_title)
    clean_title = clean_title.strip().rstrip('.')

    return clean_title, refs


def extract_editorial_notes(text: str) -> tuple[str, list[str]]:
    """Extract editorial clarifications in angle brackets <like this>."""
    notes = re.findall(r'<([^>]+)>', text)
    return notes


def extract_footnotes(text: str) -> tuple[str, list[str]]:
    """Extract [fn: ...] markers left by clean_latex and return them separately."""
    footnotes = re.findall(r'\[fn:\s*([^\]]+)\]', text)
    cleaned = re.sub(r'\s*\[fn:\s*[^\]]+\]', '', text)
    return cleaned, footnotes


# ─── TEX FILE WALKER ─────────────────────────────────────────────────────────

@dataclass
class Section:
    heading: Optional[str] = None
    text: str = ""
    tags: list = field(default_factory=list)
    footnotes: list = field(default_factory=list)
    editorial_notes: list = field(default_factory=list)

@dataclass
class Chapter:
    chapter_number: int = 0
    title: str = ""
    kroll_page: Optional[str] = None
    pingree_page: Optional[str] = None
    sections: list = field(default_factory=list)

@dataclass
class Book:
    book_number: int = 0
    title: str = ""
    chapters: list = field(default_factory=list)


def find_tex_files(src_dir: str) -> list[str]:
    """Locate all .tex files in the source directory, sorted sensibly."""
    src = Path(src_dir)
    tex_files = list(src.rglob("*.tex"))

    # Sort: try to order by book number if filenames contain them
    def sort_key(p):
        name = p.stem.lower()
        # Try to extract a book number
        m = re.search(r'book[_\-]?(\d+)', name)
        if m:
            return (0, int(m.group(1)), name)
        m = re.search(r'(\d+)', name)
        if m:
            return (0, int(m.group(1)), name)
        # Main/preamble files first
        if 'main' in name or 'preamble' in name or 'front' in name:
            return (-1, 0, name)
        return (1, 0, name)

    tex_files.sort(key=sort_key)
    return [str(f) for f in tex_files]


def resolve_inputs(main_tex: str, src_dir: str) -> str:
    """If a main .tex file uses \\input{} or \\include{}, inline those files."""
    src = Path(src_dir)

    def replacer(match):
        fname = match.group(1)
        if not fname.endswith('.tex'):
            fname += '.tex'
        fpath = src / fname
        if fpath.exists():
            return fpath.read_text(encoding='utf-8', errors='replace')
        # Try subdirectories
        candidates = list(src.rglob(fname))
        if candidates:
            return candidates[0].read_text(encoding='utf-8', errors='replace')
        return f'% [MISSING INPUT: {fname}]'

    text = Path(main_tex).read_text(encoding='utf-8', errors='replace')
    # Resolve up to 3 levels of nesting
    for _ in range(3):
        if r'\input' not in text and r'\include' not in text:
            break
        text = re.sub(r'\\(?:input|include)\{([^}]+)\}', replacer, text)

    return text


def parse_tex_content(content: str) -> list[Book]:
    """Parse raw LaTeX content into Book → Chapter → Section hierarchy."""
    books = []
    current_book = None
    current_chapter = None
    current_section_text = []
    current_section_heading = None

    def flush_section():
        nonlocal current_section_text, current_section_heading
        if current_chapter is not None and current_section_text:
            raw_text = '\n'.join(current_section_text)
            cleaned = clean_latex(raw_text)
            if cleaned.strip():
                cleaned, footnotes = extract_footnotes(cleaned)
                editorial = extract_editorial_notes(cleaned)
                tags = detect_tags(cleaned)
                sec = Section(
                    heading=current_section_heading,
                    text=cleaned.strip(),
                    tags=tags,
                    footnotes=footnotes,
                    editorial_notes=editorial,
                )
                current_chapter.sections.append(sec)
        current_section_text = []
        current_section_heading = None

    def flush_chapter():
        flush_section()
        nonlocal current_chapter
        if current_book is not None and current_chapter is not None:
            if current_chapter.sections:  # only add non-empty chapters
                current_book.chapters.append(current_chapter)
        current_chapter = None

    def flush_book():
        flush_chapter()
        nonlocal current_book
        if current_book is not None and current_book.chapters:
            books.append(current_book)
        current_book = None

    lines = content.split('\n')

    for line in lines:
        stripped = line.strip()

        # Skip preamble / document setup
        if stripped.startswith(r'\documentclass') or stripped.startswith(r'\usepackage'):
            continue
        if stripped.startswith(r'\begin{document}') or stripped.startswith(r'\end{document}'):
            continue
        if stripped.startswith(r'\maketitle') or stripped.startswith(r'\tableofcontents'):
            continue
        if stripped.startswith(r'\frontmatter') or stripped.startswith(r'\mainmatter'):
            continue

        # ── Detect \part{} or \book — top-level book divisions
        book_match = re.match(r'\\(?:part|chapter)\s*\{(.+?)\}', stripped)
        if not book_match:
            book_match = re.match(r'\\(?:part|chapter)\*\s*\{(.+?)\}', stripped)

        if book_match:
            raw_title = book_match.group(1)
            # Try to extract book number
            num_match = re.search(r'(?:book|liber)\s*(\w+)', raw_title, re.IGNORECASE)
            book_num = 0
            if num_match:
                val = num_match.group(1).upper()
                roman_map = {'I':1,'II':2,'III':3,'IV':4,'V':5,'VI':6,'VII':7,'VIII':8,'IX':9,'X':10}
                book_num = roman_map.get(val, 0)
                if book_num == 0:
                    try:
                        book_num = int(val)
                    except ValueError:
                        pass

            flush_book()
            current_book = Book(book_number=book_num, title=clean_latex(raw_title).strip())
            current_chapter = None
            continue

        # ── Detect \section{} — chapter-level divisions
        chap_match = re.match(r'\\section\s*\{(.+?)\}', stripped)
        if not chap_match:
            chap_match = re.match(r'\\section\*\s*\{(.+?)\}', stripped)

        if chap_match:
            raw_title = chap_match.group(1)

            # If no book exists yet, create a default one
            if current_book is None:
                current_book = Book(book_number=0, title="Untitled Book")

            flush_chapter()

            clean_title, refs = extract_refs(clean_latex(raw_title))
            chap_num = len(current_book.chapters) + 1

            # Try to get chapter number from title
            cn_match = re.search(r'^(\d+)[\.\s]', clean_title)
            if cn_match:
                chap_num = int(cn_match.group(1))
                clean_title = re.sub(r'^\d+[\.\s]+', '', clean_title).strip()

            current_chapter = Chapter(
                chapter_number=chap_num,
                title=clean_title,
                kroll_page=refs.get('kroll_page'),
                pingree_page=refs.get('pingree_page'),
            )
            continue

        # ── Detect \subsection{} — section-level divisions within chapters
        sec_match = re.match(r'\\subsection\s*\{(.+?)\}', stripped)
        if not sec_match:
            sec_match = re.match(r'\\subsection\*\s*\{(.+?)\}', stripped)

        if sec_match:
            flush_section()
            raw_heading = sec_match.group(1)
            current_section_heading = clean_latex(raw_heading).strip()

            # If no chapter exists, create one
            if current_chapter is None and current_book is not None:
                current_chapter = Chapter(chapter_number=1, title="Untitled Chapter")

            continue

        # ── Accumulate text lines
        if current_chapter is not None or current_book is not None:
            current_section_text.append(line)

    # Flush remaining
    flush_book()

    return books


# ─── FALLBACK: SINGLE-FILE HEURISTIC PARSER ─────────────────────────────────

def parse_single_file_heuristic(content: str) -> list[Book]:
    """
    If the LaTeX doesn't use standard \\part/\\chapter/\\section hierarchy,
    try to detect book/chapter breaks from patterns like:
        BOOK I
        1. The Nature of the Stars
        1.2 Saturn
    """
    books = []
    current_book = None
    current_chapter = None
    current_text = []

    def flush():
        nonlocal current_text
        if current_chapter and current_text:
            raw = '\n'.join(current_text)
            cleaned = clean_latex(raw)
            if cleaned.strip():
                cleaned, fn = extract_footnotes(cleaned)
                ed = extract_editorial_notes(cleaned)
                current_chapter.sections.append(Section(
                    text=cleaned.strip(),
                    tags=detect_tags(cleaned),
                    footnotes=fn,
                    editorial_notes=ed,
                ))
        current_text = []

    for line in content.split('\n'):
        stripped = line.strip()

        # Book header: "BOOK I" or "Book 1" etc.
        bm = re.match(r'^(?:BOOK|Book|Liber)\s+(\w+)', stripped)
        if bm and len(stripped) < 40:
            flush()
            if current_book and current_chapter:
                if current_chapter.sections:
                    current_book.chapters.append(current_chapter)
            if current_book and current_book.chapters:
                books.append(current_book)

            val = bm.group(1).upper()
            roman_map = {'I':1,'II':2,'III':3,'IV':4,'V':5,'VI':6,'VII':7,'VIII':8,'IX':9,'X':10}
            num = roman_map.get(val, 0)
            if not num:
                try: num = int(val)
                except: num = len(books) + 1

            current_book = Book(book_number=num, title=stripped)
            current_chapter = None
            continue

        # Chapter header: "1. Title" or "1.1 Title" pattern at start of line
        cm = re.match(r'^(\d+)\.\s+([A-Z].*)', stripped)
        if cm and len(stripped) < 120:
            flush()
            if current_book is None:
                current_book = Book(book_number=1, title="Book I")
            if current_chapter and current_chapter.sections:
                current_book.chapters.append(current_chapter)

            title, refs = extract_refs(cm.group(2))
            current_chapter = Chapter(
                chapter_number=int(cm.group(1)),
                title=title,
                kroll_page=refs.get('kroll_page'),
                pingree_page=refs.get('pingree_page'),
            )
            continue

        current_text.append(line)

    # Final flush
    flush()
    if current_book and current_chapter:
        if current_chapter.sections:
            current_book.chapters.append(current_chapter)
    if current_book and current_book.chapters:
        books.append(current_book)

    return books


# ─── MAIN PIPELINE ───────────────────────────────────────────────────────────

def parse_valens(src_dir: str) -> dict:
    """Main entry: parse all .tex files in src_dir into structured corpus."""
    src_dir = str(Path(src_dir).resolve())
    tex_files = find_tex_files(src_dir)

    if not tex_files:
        print(f"ERROR: No .tex files found in {src_dir}", file=sys.stderr)
        sys.exit(1)

    print(f"Found {len(tex_files)} .tex files in {src_dir}")
    for f in tex_files:
        print(f"  • {Path(f).name}")

    # Strategy 1: Look for a main.tex that \\inputs everything
    main_candidates = [f for f in tex_files if Path(f).stem.lower() in
                       ('main', 'valens', 'anthologies', 'anthology', 'book')]
    if main_candidates:
        print(f"\nUsing main file: {Path(main_candidates[0]).name}")
        full_content = resolve_inputs(main_candidates[0], src_dir)
    else:
        # Concatenate all .tex files in order
        print("\nNo main file found — concatenating all .tex files")
        parts = []
        for f in tex_files:
            parts.append(Path(f).read_text(encoding='utf-8', errors='replace'))
        full_content = '\n\n'.join(parts)

    # Parse with LaTeX-aware parser
    books = parse_tex_content(full_content)

    # If that yielded nothing useful, try heuristic
    if not books or sum(len(b.chapters) for b in books) < 3:
        print("LaTeX hierarchy sparse — trying heuristic parser...")
        books2 = parse_single_file_heuristic(full_content)
        if sum(len(b.chapters) for b in books2) > sum(len(b.chapters) for b in books):
            books = books2

    # Build output
    corpus = {
        "meta": {
            "author": "Vettius Valens",
            "title": "Anthologies (Anthology)",
            "translator": "Mark T. Riley",
            "reformatted_by": "Jane Griscti",
            "date_original": "c. 150-175 CE",
            "language_original": "Greek",
            "translation_language": "English",
            "copyright_status": "GPL-2.0-only; see source repository",
            "source_repo": "https://github.com/janegca/latex-valens",
            "source_license": "GPL-2.0-only",
            "source_attribution": "Mark T. Riley translation; Jane Griscti re-formatting and annotations",
            "parser_version": "1.0",
            "total_books": len(books),
            "total_chapters": sum(len(b.chapters) for b in books),
            "total_sections": sum(
                len(c.sections) for b in books for c in b.chapters
            ),
        },
        "books": [asdict(b) for b in books],
    }

    return corpus


def print_stats(corpus: dict):
    """Print a summary of what was parsed."""
    m = corpus['meta']
    print(f"\n{'='*60}")
    print(f"  PARSE COMPLETE: {m['title']}")
    print(f"  Translator: {m['translator']}")
    print(f"{'='*60}")
    print(f"  Books:    {m['total_books']}")
    print(f"  Chapters: {m['total_chapters']}")
    print(f"  Sections: {m['total_sections']}")
    print()

    all_tags = set()
    for book in corpus['books']:
        chap_count = len(book['chapters'])
        sec_count = sum(len(c['sections']) for c in book['chapters'])
        print(f"  Book {book['book_number']}: {book['title']}")
        print(f"    {chap_count} chapters, {sec_count} sections")
        for ch in book['chapters']:
            for sec in ch['sections']:
                all_tags.update(sec['tags'])

    print(f"\n  Unique doctrinal tags detected: {len(all_tags)}")
    for tag in sorted(all_tags):
        print(f"    • {tag}")


# ─── CLI ─────────────────────────────────────────────────────────────────────

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print("Usage: python parse_latex.py <src_dir> [output.json]")
        print("  src_dir:     Path to cloned latex-valens repo")
        print("  output.json: Output path (default: valens.json)")
        sys.exit(1)

    src_dir = sys.argv[1]
    out_path = sys.argv[2] if len(sys.argv) > 2 else 'valens.json'

    corpus = parse_valens(src_dir)
    print_stats(corpus)

    Path(out_path).parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(corpus, f, indent=2, ensure_ascii=False)

    print(f"\n  Written to: {out_path}")
    size_mb = Path(out_path).stat().st_size / (1024 * 1024)
    print(f"  File size:  {size_mb:.2f} MB")

#!/usr/bin/env python3
# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

"""
query_corpus.py — Search the parsed Valens JSON for doctrinal content.

This is the bridge between your parsed corpus and your interpreter engine.
Use it standalone for testing, or import CorpusDB into your engine.

Usage:
    python query_corpus.py corpus/parsed/valens.json "lot of fortune"
    python query_corpus.py corpus/parsed/valens.json --tag profections
    python query_corpus.py corpus/parsed/valens.json --book 4 --tag time_lords
    python query_corpus.py corpus/parsed/valens.json --list-tags
    python query_corpus.py corpus/parsed/valens.json --index
"""

import json
import sys
import re
from pathlib import Path
from dataclasses import dataclass


class CorpusDB:
    """
    In-memory queryable corpus loaded from parsed JSON.
    Drop this class into your engine and call its methods.
    """

    def __init__(self, json_path: str):
        with open(json_path, 'r', encoding='utf-8') as f:
            self.data = json.load(f)
        self.meta = self.data['meta']
        self.books = self.data['books']
        self._build_index()

    def _build_index(self):
        """Build flat index of all sections for fast search."""
        self.sections = []
        self.tag_index = {}  # tag → [section_indices]

        for book in self.books:
            for chapter in book['chapters']:
                for section in chapter['sections']:
                    idx = len(self.sections)
                    entry = {
                        'idx': idx,
                        'book': book['book_number'],
                        'book_title': book['title'],
                        'chapter': chapter['chapter_number'],
                        'chapter_title': chapter['title'],
                        'kroll_page': chapter.get('kroll_page'),
                        'pingree_page': chapter.get('pingree_page'),
                        'heading': section.get('heading'),
                        'text': section['text'],
                        'tags': section.get('tags', []),
                        'footnotes': section.get('footnotes', []),
                        'editorial_notes': section.get('editorial_notes', []),
                    }
                    self.sections.append(entry)

                    for tag in entry['tags']:
                        if tag not in self.tag_index:
                            self.tag_index[tag] = []
                        self.tag_index[tag].append(idx)

    # ── QUERY METHODS (use these in your engine) ──

    def search_text(self, query: str, book: int = None) -> list[dict]:
        """Full-text search across all sections. Case-insensitive."""
        query_lower = query.lower()
        results = []
        for sec in self.sections:
            if book is not None and sec['book'] != book:
                continue
            if query_lower in sec['text'].lower():
                results.append(sec)
        return results

    def search_by_tag(self, tag: str, book: int = None) -> list[dict]:
        """Find all sections tagged with a specific doctrinal tag."""
        indices = self.tag_index.get(tag, [])
        results = [self.sections[i] for i in indices]
        if book is not None:
            results = [r for r in results if r['book'] == book]
        return results

    def search_by_tags(self, tags: list[str], mode: str = 'any',
                       book: int = None) -> list[dict]:
        """
        Find sections matching multiple tags.
        mode='any': section has at least one of the tags
        mode='all': section has ALL of the tags
        """
        if mode == 'all':
            sets = [set(self.tag_index.get(t, [])) for t in tags]
            if not sets:
                return []
            indices = set.intersection(*sets)
        else:
            indices = set()
            for t in tags:
                indices.update(self.tag_index.get(t, []))

        results = [self.sections[i] for i in sorted(indices)]
        if book is not None:
            results = [r for r in results if r['book'] == book]
        return results

    def get_chapter(self, book: int, chapter: int) -> list[dict]:
        """Get all sections from a specific book/chapter."""
        return [s for s in self.sections
                if s['book'] == book and s['chapter'] == chapter]

    def get_book(self, book: int) -> list[dict]:
        """Get all sections from a specific book."""
        return [s for s in self.sections if s['book'] == book]

    def list_tags(self) -> dict[str, int]:
        """Return all tags with their occurrence counts, sorted by frequency."""
        counts = {tag: len(indices) for tag, indices in self.tag_index.items()}
        return dict(sorted(counts.items(), key=lambda x: -x[1]))

    def list_chapters(self) -> list[dict]:
        """Return a table of contents."""
        toc = []
        for book in self.books:
            for ch in book['chapters']:
                toc.append({
                    'book': book['book_number'],
                    'chapter': ch['chapter_number'],
                    'title': ch['title'],
                    'kroll_page': ch.get('kroll_page'),
                    'sections': len(ch['sections']),
                })
        return toc

    def get_context(self, section: dict, window: int = 1) -> list[dict]:
        """Get surrounding sections for context (±window sections)."""
        idx = section['idx']
        start = max(0, idx - window)
        end = min(len(self.sections), idx + window + 1)
        return self.sections[start:end]

    def passage_ref(self, section: dict) -> str:
        """Format a human-readable reference string for a section."""
        ref = f"Valens, Anthologies {section['book']}.{section['chapter']}"
        if section['heading']:
            ref += f" ({section['heading']})"
        if section['kroll_page']:
            ref += f" [{section['kroll_page']}K"
            if section['pingree_page']:
                ref += f",{section['pingree_page']}P"
            ref += "]"
        return ref


# ── FORMATTERS ────────────────────────────────────────────────────────────────

def format_result(sec: dict, db: CorpusDB, max_len: int = 400) -> str:
    """Format a search result for terminal display."""
    ref = db.passage_ref(sec)
    text = sec['text']
    if len(text) > max_len:
        text = text[:max_len].rsplit(' ', 1)[0] + '...'
    tags = ', '.join(sec['tags'][:8])
    return f"\n{'─'*60}\n📖 {ref}\n🏷  [{tags}]\n\n{text}\n"


# ── CLI ───────────────────────────────────────────────────────────────────────

def main():
    import argparse
    parser = argparse.ArgumentParser(
        description='Query the parsed Valens corpus')
    parser.add_argument('corpus', help='Path to parsed JSON file')
    parser.add_argument('query', nargs='?', default=None,
                        help='Free-text search query')
    parser.add_argument('--tag', '-t', action='append', default=[],
                        help='Filter by doctrinal tag (can repeat)')
    parser.add_argument('--book', '-b', type=int, default=None,
                        help='Restrict to book number')
    parser.add_argument('--chapter', '-c', type=int, default=None,
                        help='Specific chapter (requires --book)')
    parser.add_argument('--list-tags', action='store_true',
                        help='List all detected tags with counts')
    parser.add_argument('--index', action='store_true',
                        help='Show table of contents')
    parser.add_argument('--limit', '-n', type=int, default=10,
                        help='Max results to display')
    parser.add_argument('--full', action='store_true',
                        help='Show full text (no truncation)')

    args = parser.parse_args()

    db = CorpusDB(args.corpus)
    print(f"Loaded: {db.meta['title']} by {db.meta['author']}")
    print(f"  {db.meta['total_books']} books, "
          f"{db.meta['total_chapters']} chapters, "
          f"{db.meta['total_sections']} sections")

    if args.list_tags:
        tags = db.list_tags()
        print(f"\n{'TAG':<30} {'COUNT':>6}")
        print('─' * 38)
        for tag, count in tags.items():
            print(f"  {tag:<28} {count:>6}")
        return

    if args.index:
        toc = db.list_chapters()
        print(f"\n{'BK':>3} {'CH':>4}  {'TITLE':<50} {'§':>4} {'K':>5}")
        print('─' * 72)
        for row in toc:
            k = row['kroll_page'] or ''
            print(f"  {row['book']:>2} {row['chapter']:>4}  "
                  f"{row['title'][:48]:<50} {row['sections']:>4} {k:>5}")
        return

    if args.chapter and args.book:
        results = db.get_chapter(args.book, args.chapter)
    elif args.tag and args.query:
        # Tag filter + text search
        tag_results = db.search_by_tags(args.tag, mode='any', book=args.book)
        query_lower = args.query.lower()
        results = [r for r in tag_results if query_lower in r['text'].lower()]
    elif args.tag:
        results = db.search_by_tags(args.tag, mode='any', book=args.book)
    elif args.query:
        results = db.search_text(args.query, book=args.book)
    else:
        parser.print_help()
        return

    print(f"\n  Found {len(results)} results")

    max_len = 99999 if args.full else 400
    for sec in results[:args.limit]:
        print(format_result(sec, db, max_len=max_len))

    if len(results) > args.limit:
        print(f"\n  ... and {len(results) - args.limit} more. "
              f"Use --limit {len(results)} to see all.")


if __name__ == '__main__':
    main()

// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

type OuterName = { label: string; shortLabel?: string };
const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const graphemes = (text: string) => Array.from(segmenter.segment(text), part => part.segment);
const identity = (text: string) => text.normalize("NFC").toLowerCase().replace(/[.\u2026]/gu, "");
const candidateCache = new Map<string, ReadonlyMap<string, readonly string[]>>();

/** Last resort after preferred aliases: a measured prefix, ambiguity allowed. */
export function fitOuterLabelPrefix(
  text: string, fits: (prefix: string, abbreviated: boolean) => boolean,
): { prefix: string; abbreviated: boolean } {
  const letters = graphemes(text);
  let low = 1;
  let high = letters.length - 1;
  let best = "";
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const prefix = letters.slice(0, middle).join("").trimEnd();
    if (fits(prefix, true)) { best = prefix; low = middle + 1; }
    else high = middle - 1;
  }
  if (best) return { prefix: best, abbreviated: true };
  const first = letters[0] ?? "";
  return { prefix: first && fits(first, false) ? first : "", abbreviated: false };
}

/** Bounded, cached display choices. Keep every word so qualifiers survive. */
export function outerLabelCandidates(names: readonly OuterName[]): ReadonlyMap<string, readonly string[]> {
  const unique = [...new Map(names.map(name => [name.label, name])).values()]
    .sort((a, b) => a.label.localeCompare(b.label));
  const key = JSON.stringify(unique.map(name => [name.label, name.shortLabel]));
  const cached = candidateCache.get(key);
  if (cached) return cached;
  const choices = unique.map(({ label, shortLabel }) => {
    const result = [label];
    if (shortLabel) result.push(shortLabel);
    const words = label.split(/\s+/u);
    for (const length of [8, 6, 5, 4, 3]) {
      result.push(words.map(word => {
        const letters = graphemes(word);
        return letters.length > length + 1 ? letters.slice(0, length).join("") + "." : word;
      }).join(" "));
    }
    // Single-word/custom names also have a shortest unique prefix. Comparing
    // graphemes avoids cutting combining marks or multi-codepoint characters.
    if (words.length === 1) {
      const letters = graphemes(label);
      let length = Math.min(3, letters.length);
      for (const other of unique) {
        if (other.label === label) continue;
        const peer = graphemes(other.label);
        let shared = 0;
        while (shared < letters.length && shared < peer.length
          && identity(letters[shared]) === identity(peer[shared])) shared++;
        length = Math.max(length, shared + 1);
      }
      if (length + 1 < letters.length) result.push(letters.slice(0, length).join("") + ".");
      // Close names may differ only at the end (Maximiliandu / Maximiliana).
      // Preserve that distinction when no readable prefix fits the margin.
      for (const prefix of [6, 4, 3]) for (const suffix of [2, 1]) {
        if (prefix + suffix + 1 < letters.length) {
          result.push(letters.slice(0, prefix).join("") + "\u2026" + letters.slice(-suffix).join(""));
        }
      }
    }
    return [...new Set(result)];
  });
  const owners = new Map<string, Set<string>>();
  unique.forEach(({ label }, index) => choices[index].forEach(choice => {
    const normalized = identity(choice);
    const entries = owners.get(normalized) ?? new Set<string>();
    entries.add(label);
    owners.set(normalized, entries);
  }));
  const result = new Map(unique.map(({ label }, index) => [label,
    choices[index].filter(choice => choice === label || owners.get(identity(choice))?.size === 1),
  ]));
  if (candidateCache.size >= 16) candidateCache.delete(candidateCache.keys().next().value!);
  candidateCache.set(key, result);
  return result;
}

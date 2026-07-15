"""Keep the public shortcut table aligned with the live in-app Help list."""

from __future__ import annotations

from pathlib import Path

from webapp.daemon.manifest_service import _shortcut_entries


ROOT = Path(__file__).resolve().parents[1]


def _readme_shortcut_keys() -> set[str]:
    readme = (ROOT / "README.md").read_text(encoding="utf-8")
    section = readme.split("## Keyboard shortcuts", 1)[1].split("\n## ", 1)[0]
    keys = set()
    for line in section.splitlines():
        if not line.startswith("| `"):
            continue
        key_cell = line.split("|", 2)[1].strip().replace("`", "")
        keys.add(key_cell)
    return {_normalize_readme_key(key) for key in keys}


def _normalize_readme_key(key: str) -> str:
    for prefix, replacement in (
        ("Cmd/Ctrl + Shift + ", "⌘ ⇧ "),
        ("Cmd/Ctrl + Alt + ", "⌘ ⌥ "),
        ("Cmd/Ctrl + ", "⌘ "),
    ):
        if key.startswith(prefix):
            return replacement + key.removeprefix(prefix)
    replacements = {
        "Shift, then Shift": "⇧ ⇧",
        "Shift + Left / Shift + Right": "⇧ + ← / →",
        "Alt/Option + Left / Alt/Option + Right": "⌥ + ← / →",
        "Shift + Up / Shift + Down": "⇧ + ↑ / ↓",
        "Left / Right": "← / →",
        "Up / Down": "↑ / ↓",
    }
    return replacements.get(key, key)


def test_public_readme_matches_in_app_help_shortcut_keys() -> None:
    help_keys = {
        str(row["keys"])
        for row in _shortcut_entries()
        if row.get("bound") and row["keys"] != "?"
    }

    assert _readme_shortcut_keys() == help_keys

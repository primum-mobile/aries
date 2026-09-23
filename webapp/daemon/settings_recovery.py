"""Preserve damaged preferences before a user-requested clean restart.

Only settings stores are moved. Chart collections, ephemerides, notes, and the
native licensing store are outside this allowlist and remain in place.
"""
from __future__ import annotations

import json
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path


SETTINGS_STORES = (
    "arabic_parts.json",
    "astrocartography.opt",
    "sidebar_lists.opt",
    "style-profiles.json",
    "style-drafts-v2.json",
    "style-drafts.json",
    "wheel-presets.json",
    "primary-direction-presets.json",
)


def preserve_and_reset_settings(opts) -> dict:
    """Move saved settings into a private backup; a restart loads factory state.

    Keep this operation independent of ``get_options`` and style-store loading:
    either of those may be the reason the Settings screen is unavailable.
    """
    options_dir = Path(opts.optsdirtxt)
    if not options_dir.is_dir():
        raise OSError("Aries settings directory is unavailable")
    names = set(opts.optionsfilestxt) | set(SETTINGS_STORES)
    sources = [options_dir / name for name in sorted(names)
               if (options_dir / name).is_file() and not (options_dir / name).is_symlink()]
    backup_root = options_dir.parent / "Recovery"
    backup_root.mkdir(mode=0o700, parents=True, exist_ok=True)
    backup_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ") + "-" + uuid.uuid4().hex[:8]
    backup_dir = backup_root / backup_id
    backup_dir.mkdir(mode=0o700)
    moved: list[tuple[Path, Path]] = []
    try:
        for source in sources:
            destination = backup_dir / source.name
            os.replace(source, destination)
            moved.append((source, destination))
        (backup_dir / "manifest.json").write_text(json.dumps({
            "kind": "aries.settings-recovery",
            "createdAt": datetime.now(timezone.utc).isoformat(),
            "files": [source.name for source, _ in moved],
        }, indent=2) + "\n", encoding="utf-8")
        # A reset must not reimport older Morinus preferences on the next boot.
        marker = options_dir / ".migrated-from-morinus"
        if not marker.exists():
            marker.write_text("Aries settings recovery; do not reimport legacy preferences.\n", encoding="utf-8")
    except Exception:
        for source, destination in reversed(moved):
            os.replace(destination, source)
        raise
    return {"backupId": backup_id, "filesPreserved": len(moved), "restartRequired": True}

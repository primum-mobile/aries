# Morinus (local fork)

This workspace contains the Morinus traditional astrology program source code and a macOS build setup.

- App entrypoint: `morinus.py`
- Swiss Ephemeris wrapper source: `SWEP/src` (builds the `sweastrology` extension)
- Ephemeris files: `SWEP/Ephem`
- Contribution and release workflow: `CONTRIBUTING.md`
- Stable checkpoint checklist: `RELEASE_CHECKLIST.md`

macOS build instructions: `BUILDING_MACOS.md`

## GitHub structure

This repository now includes:

- GitHub CI for macOS smoke builds
- a tag-based macOS release workflow
- a documented `main` + `codex/*` branch/worktree model

Stable checkpoints should be tagged from `main` before large architectural work lands.

# Morinus — Critical Rules

## Launch command (MANDATORY)
ALWAYS use `python3 morinus.py` to run the app.
NEVER use `pythonw` — it resolves to Python 2.7 on this machine and will crash immediately.

In worktrees, `sweastrology.so` is gitignored and must be available before launch.
`preview_start "morinus"` handles this automatically via `.claude/launch.json` — it symlinks the compiled `.so` from the main workspace (`/Users/Max/Documents/morinus-workspace/SWEP/src/`) rather than rebuilding. The Swiss Ephemeris C extension never changes, so the main workspace copy is always reusable.

If the main workspace has never been built (fresh machine), run once:
`cd SWEP/src && python3 setup.py build_ext --inplace -q && cd ../..`
After that, all worktrees use the symlink automatically.

## Before any project-specific work
Read `AGENTS.md` for the full module map, coding conventions, and architecture rules.

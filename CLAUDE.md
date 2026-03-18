# Morinus — Critical Rules

## Launch command (MANDATORY)
ALWAYS use `python3 morinus.py` to run the app.
NEVER use `pythonw` — it resolves to Python 2.7 on this machine and will crash immediately.

In worktrees, build SWEP first:
`cd SWEP/src && python3 setup.py build_ext --inplace -q && cd ../.. && python3 morinus.py`

A `.claude/launch.json` is configured — `preview_start "morinus"` runs the above automatically.

## Before any project-specific work
Read `AGENTS.md` for the full module map, coding conventions, and architecture rules.

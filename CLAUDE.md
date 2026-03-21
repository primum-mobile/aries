# Morinus — Critical Rules

## Launch command (MANDATORY)
ALWAYS use `python3 morinus.py` to run the app.
NEVER use `pythonw` — it resolves to Python 2.7 on this machine and will crash immediately.

`sweastrology` is gitignored and must be built locally before launch on a fresh checkout.
There is no checked-in `.claude/launch.json` automation in this repo right now, so build it in-place when needed:
`cd SWEP/src && python3 setup.py build_ext --inplace -q && cd ../..`
Then start Morinus from the repo root with `python3 morinus.py`.

## Before any project-specific work
Read `AGENTS.md` for the full module map, coding conventions, and architecture rules.

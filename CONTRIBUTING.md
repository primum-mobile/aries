# Contributing to Aries

Thank you for your interest in contributing to **Aries**, the 10.x continuation and modernization of the open-source astrology software **Morinus**.

Aries is a historical codebase under active modernization. Contributions are welcome, but changes should be made carefully: the goal is to improve maintainability, usability, and platform support **without casually breaking established astrological behavior**.

## Project Priorities

At this stage, the project especially benefits from help with:

- bug fixes
- Python 3 cleanup and modernization
- cross-platform testing
- Windows and Linux build support
- wxPython GUI refinement
- build and dependency cleanup
- documentation
- restoration or extension of traditional techniques

## Before You Start

Please do the following first:

1. Read `README.md`
2. Check existing Issues and Pull Requests
3. For anything non-trivial, open an Issue before starting work

Small, focused fixes and documentation improvements can usually be submitted directly.

## What Makes a Good Contribution

The best contributions are:

- narrowly scoped
- easy to review
- tested
- documented where necessary
- respectful of legacy Morinus behavior

Please avoid combining unrelated fixes into one pull request.

## Areas That Need Extra Care

This project is not just a generic GUI app. Certain changes have outsized risk and should be explained clearly:

- astrological calculations
- time and date logic
- ayanamsha / zodiac handling
- chart rendering
- export or save/load behavior
- defaults shipped in `Opts/`
- platform-specific packaging or runtime behavior

If your change affects any of these, describe it in detail in the PR.

## Bug Reports

When reporting a bug, include:

- operating system and version
- Python version
- Aries version, release tag, or commit hash
- exact steps to reproduce
- expected result
- actual result
- traceback or console output, if any
- screenshots, if relevant

Reports that include a reproducible sequence are much easier to act on.

## Feature Requests

Feature requests should explain:

- what problem the feature solves
- why it belongs in Aries
- whether it restores legacy behavior, improves usability, or adds something new
- whether it affects calculations, workflow, or output
- whether it changes compatibility with older Morinus behavior

## Development Setup

Read the repository documentation first:

- `README.md`
- `DEPENDENCIES.md`
- `BUILDING_MACOS.md`

The project currently includes platform-specific build notes and dependency notes there. Do not duplicate those instructions in a pull request unless you are updating them.

## Branching

Do not work directly on `main`.

Create a topic branch for your change, for example:

- `fix/transit-crash`
- `feat/linux-build-notes`
- `docs/readme-installation`
- `refactor/chart-session-cleanup`

Keep one branch per logical unit of work.

## Pull Requests

When opening a pull request:

- explain what changed
- explain why it changed
- mention what you tested
- include screenshots for UI changes
- mention platform coverage
- mention compatibility implications, if any

A good PR description usually answers these questions:

### Summary
What does this change do?

### Motivation
Why is this change needed?

### Testing
What did you run or verify?

### Risk / Compatibility
Could this alter results, defaults, rendering, or behavior users may rely on?

## Testing Expectations

At minimum, contributors should do a local sanity check before submitting changes.

Examples include:

- app starts successfully
- affected window or workflow opens correctly
- no new traceback appears
- changed feature behaves as intended
- no obvious regression in related workflows

Where relevant, also run:

```bash
python3 -m compileall -q .

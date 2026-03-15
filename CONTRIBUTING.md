# Contributing

This fork is moving toward a stable GitHub-centered workflow so releases can be rolled back cleanly while larger UI work continues.

## GitHub setup

Create the GitHub repository first, then connect this checkout:

```bash
git remote add origin https://github.com/primum-mobile/aries.git
git push -u origin main
```

Recommended repository settings after the first push:

- set the default branch to `main`,
- enable branch protection for `main`,
- require pull requests for non-trivial changes,
- keep GitHub Actions enabled so build artifacts are available on every push and tag.

## Branch model

- `main`
  - Always intended to be releasable.
  - Do not do experimental work directly on `main`.
- `codex/<topic>`
  - Default branch prefix for implementation work.
  - Merge into `main` only when the branch builds cleanly and is worth keeping.

## Worktree model

Use worktrees for parallel streams instead of mixing unrelated work in one checkout.

Example:

```bash
git switch main
git pull
git worktree add ../morinus-search codex/search
git worktree add ../morinus-workspace codex/workspace-shell
```

Recommended usage:

- Keep one worktree on `main` for release verification only.
- Do feature work in a separate worktree per major stream.
- Before merging, rebase or merge the feature branch onto the current `main` and rebuild.

## Release policy

- Tag releases only from `main`.
- Tag only after:
  - the repository builds successfully,
  - the app launches from the built bundle,
  - there are no unintended source changes in the tree.
- Use annotated tags:

```bash
git tag -a v0.1.0 -m "Stable checkpoint before workspace shell"
git push origin main --tags
```

The GitHub release workflow will build a macOS app bundle from release tags matching `v*`.

Use [`RELEASE_CHECKLIST.md`](/Users/Max/Documents/Morinus Code /RELEASE_CHECKLIST.md) before cutting or approving a stable checkpoint.

## Local options

This fork currently keeps `Opts/` in the repository so preferred defaults can travel between builds.

That is acceptable for now, but be deliberate:

- Treat `Opts/` changes as product-default changes, not personal scratch changes.
- Before cutting a release, review `Opts/` diffs and confirm they are intended to ship.
- If local experimentation becomes noisy later, we can split factory defaults from user state in a future pass.

## Build checks

Local sanity checks before pushing:

```bash
python3 -m compileall -q .
./scripts/build_sweastrology.sh
./scripts/build_macos_app.sh
```

## Large UI changes

For long-running overhaul work:

- cut a stable release tag first,
- branch from that point,
- keep commits small and reversible,
- land shell/framework changes before migrating feature windows.

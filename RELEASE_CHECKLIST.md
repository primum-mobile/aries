# Release Checklist

Use this before cutting a stable checkpoint on `main`.

## Git

- `git status` is understood and contains no accidental files.
- `main` contains only changes intended for the checkpoint.
- `origin` points to `https://github.com/primum-mobile/aries.git`.
- The current commit history is coherent enough to keep as rollback points.

## Build

- `python3 -m compileall -q .`
- `./scripts/build_sweastrology.sh`
- `./scripts/build_macos_app.sh`
- Launch the built app from `dist/Morinus.app`.

## Product review

- Search the diff for temporary files, debug code, and local-only assets.
- Review tracked `Opts/` changes and confirm they are intended defaults.
- Confirm major new modules are reachable from the UI and do not break startup.

## GitHub

- Push `main` to `origin`.
- Confirm the GitHub Actions macOS build succeeds.
- Create an annotated tag from `main`, for example:

```bash
git tag -a v0.1.0 -m "Stable checkpoint before workspace shell"
git push origin main --tags
```

- Confirm the GitHub release workflow uploads the macOS zip asset.

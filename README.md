# Aries

Aries is professional astrology software by Max Lange. It is a native Tauri
desktop app with a React interface and a Python calculation daemon, built on
the Morinus project.

Aries is prerelease software. macOS is the actively packaged and tested desktop
platform; Windows and Linux source builds are welcome but are not yet offered as
official supported installers.

## Keyboard shortcuts


| Key | Function |
|---|---|
| `Cmd/Ctrl + N` | New chart |
| `Cmd/Ctrl + O` | Open chart |
| `Cmd/Ctrl + E` | Edit chart data |
| `Cmd/Ctrl + R` | Here and Now |
| `Cmd/Ctrl + S` | Save |
| `Cmd/Ctrl + Shift + S` | Save As |
| `Cmd/Ctrl + W` | Close active document |
| `Cmd/Ctrl + B` | Toggle sidebar |
| `Cmd/Ctrl + F` | Search |
| `Cmd/Ctrl + Y` | Synastry |
| `Cmd/Ctrl + G` | Cycle the secondary-ring view |
| `Cmd/Ctrl + Alt + A` | Ascensional Transits |
| `Cmd/Ctrl + Shift + A` | Appearance |
| `I` | Toggle Inspector |
| `?` | Show key hints |
| `Shift`, then `Shift` | Open Spotlight |
| `0`–`9` | Open Spotlight with that digit |
| `T` | Transits |
| `R` | Solar Revolution |
| `L` | Lunar Revolution |
| `S` | Secondary Progression |
| `P` | Profections |
| `D` | Primary Directions |
| `C` | Circumambulations |
| `E` | Eclipses |
| `Z` | Zodiacal Releasing |
| `A` | Toggle aspects |
| `M` | Toggle minor aspects |
| `H` | Toggle houses |
| `Left` / `Right` | Previous / next contextual time step |
| `Shift + Left` / `Shift + Right` | Finer contextual time step |
| `Alt/Option + Left` / `Alt/Option + Right` | Finest contextual time step |
| `Up` / `Down` | Contextual week or list navigation |
| `Shift + Up` / `Shift + Down` | Previous / next lunar quarter |
| `Space` | Reset to the document's initial chart |
| `Tab` | Toggle comparison / biwheel view |
| `Esc` | Close the active transient view or overlay |

## Features

- Natal, transit, synastry, mundane, solar-return, lunar-return, progression,
  profection, and primary-direction workflows.
- High-precision chart calculation through Swiss Ephemeris.
- Traditional techniques including time lords, zodiacal releasing, Arabic
  parts, antiscia, dodecatemoria, fixed stars, eclipses, and circumambulations.
- Keyboard-driven time navigation and retained professional workspaces.
- Dynamic chart wheels, comparison rings, inspectors, searches, lists, tables,
  notes, and export tools.
- Tropical and sidereal chart support with multilingual application catalogs.

## Architecture

The native application lives under `webapp/`:

- `webapp/frontend/` — React, Next.js, and the Tauri shell.
- `webapp/daemon/` — the local Python API and workspace/session authority.
- Root Python modules — astrology calculations and established Morinus engine
  behavior.
- `SWEP/` — Swiss Ephemeris sources and ephemeris resources.

React renders daemon snapshots and forwards user intent. Calculation and
session truth remain in Python.

A fresh installation contains one starter chart: Jean-Baptiste Morin
(`Morinus`). On a pristine profile it is copied to
`~/Documents/Aries/Charts/Charts.jsonl`. Aries never creates or replaces that
starter collection when the `Aries/Charts` directory already exists, even if it
is empty.
No developer or customer charts are bundled.

## Build from source

### Requirements

- Python 3.10 or newer.
- Node.js 20.9 or newer with npm.
- Current stable Rust toolchain with Cargo.
- Platform prerequisites required by Tauri.
- On macOS, Xcode Command Line Tools.

From the repository root, install the JavaScript dependencies:

```bash
(cd notes_web && npm ci)
(cd webapp/frontend && npm ci)
```

Start the native development application:

```bash
make run
```

On its first run, this command creates the Python environment, installs daemon
dependencies, builds the native Swiss Ephemeris extension and daemon sidecar,
and starts the retained Tauri development app.

The public command surface is:

```bash
make          # show supported commands
make run      # start the native development app
make check    # run public static and backend checks
make package  # create an unlocked, unsigned local package
```

On Windows, use the equivalent PowerShell or direct Python/npm/Cargo commands
where GNU Make is unavailable.

## Corpus packs

Corpus packs are optional data packages and are not required to build Aries.
The curated Lilly pack ships with the paid edition and is not included in this
repository.

The Valens core corpus is included as a separately licensed GPL-2.0-only
resource. Its source and attribution are in
`third_party/latex-valens-source/`. Third-party and user-authored packs remain
governed by their own provenance and licenses.

## Contributing

Contributions are welcome, especially focused fixes, cross-platform packaging,
tests, localization, accessibility, and carefully sourced traditional
techniques. Preserve established astrology behavior unless a change is
intentional and documented.

Before opening a pull request:

```bash
python3 -m pip install -r requirements-dev.txt
make check
```

Explain calculation, compatibility, or packaging consequences when relevant.

## Credits

Copyright © 2026 Max Lange

Aries builds on work developed across the Morinus project:

- Robert Nagy — original author through Morinus 6.2.
- Roberto Luporini — Morinus 7.x.
- Elías D. Molins — Morinus 8.x.
- Shin Ji-Hyeon and James Ren — Morinus 9.x.

Additional contributors include Philippe Epaud, Margherita Fiorello, Martin
Gansten, Jaime Chica Londoño, Petr Radek, Endre Csaba Simon, Václav Jan
Špirhanzl, and Denis Steinhoff.

## License

Aries is free software distributed under the GNU Affero General Public License,
version 3 or later. See `LICENSE` for the complete terms.

Swiss Ephemeris has its own dual-licensing terms. See the notices under `SWEP/`.

Attribution and license notices for other redistributed data, fonts, and
frontend components are collected in `THIRD_PARTY_NOTICES.txt`.

Website: [aries.sh](https://aries.sh/)

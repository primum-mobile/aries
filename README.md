# Morinus 10.0.0 — *Aries*

![Morinus Aries Screenshot](./Res/screenshot-main.png)

**Open Source Traditional Astrology Software — Rebuilt for Modern Systems**

---

## Overview

**Morinus (Aries)** is a continuation and modernization of the Morinus astrology software lineage.  
Version 10.0.0 represents a major architectural and UX overhaul, updating the project for contemporary systems while preserving its focus on traditional astrology techniques and high-precision calculation.

Key changes in this version:

- Complete migration from **Python 2 to Python 3**
- Rewritten and modernized **GUI and interaction model**
- Introduction of a **keyboard-driven workflow**
- Initial **cross-platform compatibility** (macOS confirmed; other systems expected to work from source)
- Refactoring of the legacy codebase for maintainability and future extension

---

## Lineage & Version History

Morinus has evolved through multiple contributors over time:

- **Robert Nagy** — original author, versions up to 6.2
- **Roberto Luporini** — version 7.x.x (2013)
- **Elías D. Molins** — version 8.x.x (2013)
- **Shin Ji-Hyeon / James Ren** — version 9.x.x (2025)
- **Max Lange** — version 10.x.x, *Aries* (2026–)

This release, **Aries**, is a current continuation of the project under the 10.x series.

---

## Contributors

- **Robert Nagy** — programming, astrology
- **Philippe Epaud** — French translation
- **Margherita Fiorello** — astrology, Italian translation
- **Martin Gansten** — astrology
- **Jaime Chica Londoño** — Spanish translation
- **Max Lange** — programming, astrology
- **Roberto Luporini** — programming, astrological astronomy
- **Elías D. Molins** — programming, astrology
- **Petr Radek** — astrology
- **James Ren** — programming, astrology, Chinese translation
- **Shin Ji-Hyeon** — programming, astrology, Korean translation
- **Endre Csaba Simon** — programming, astrology
- **Václav Jan Špirhanzl** — MacOS version
- **Denis Steinhoff** — astrology, Russian translation

If additional historical contributors are identified in older releases or mirrors, they should be added here.

---

## Features

- High-precision calculations via **Swiss Ephemeris**
- Strong focus on **traditional astrology methods**
- Transit search engine
- Multiple chart types, including:
  - Natal
  - Transits
  - Solar Revolutions
  - Lunar Revolutions
  - Synastry
  - Mundane charts
- Traditional techniques, including:
  - Profections
  - Continuous Profections
  - Directions
  - Firdaria
  - Decennials
  - Zodiacal Releasing
  - Circumambulations
  - Time lords
- Extended objects and techniques:
  - Fixed stars
  - Arabic Parts
  - Antiscia
  - Dodecatemoria
- Modernized interface:
  - Sidebar-based navigation
  - Keyboard-centered interaction
  - Improved workflow speed for exploratory chart work

---

## Installation

### Current Status

- A macOS `.app` build has been tested
- No official installers are available yet
- The code is intended to be compilable on macOS, Windows, and Linux, but this has not yet been fully verified on all systems

### Build from Source

```bash
git clone https://github.com/primum-mobile/aries.git
cd aries
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python3 morinus.py
```

### Requirements

- Python 3.8+
- wxPython
- Swiss Ephemeris

System-specific dependency setup may still be required.

---

## Keyboard Shortcuts (New Functionality)

This section lists **new shortcuts introduced in Aries**.  
It does **not** attempt to document all legacy shortcuts.

### Chart Tab Actions

- `R` — Solar Revolution
- `L` — Lunar Revolution
- `S` — Transit Search Engine

### Secondary Ring Mode

- `Cmd + G` — Change secondary ring mode

Available secondary ring modes include:

- Dodecatemoria
- Arabic Parts
- Fixed Stars
- Antiscia

---

## Time Navigation

Aries introduces expanded keyboard-based time stepping across most chart types.

### Basic Time Stepping

- `←` — Step backward in time
- `→` — Step forward in time

### Modified Time Stepping

The step size changes depending on modifier keys and chart type:

- `Shift + ← / →` — alternate increment
- `Alt + ← / →` — alternate increment
- In some contexts, modifiers produce different step sizes depending on the active chart

This system works across most charts and is especially useful in exploratory workflows.

### Continuous Profections

Continuous Profections are designed to work particularly well with the new time stepping system.

### Transit Charts

Transit charts include an additional lunation-phase navigation feature:

- `Shift + ↑ / ↓` — jump through moon phases

This allows fast movement through 90° sun-moon 

---

## UX Model

Aries introduces a more continuous and exploratory interaction model.

Charts are no longer treated only as static outputs.  
Instead, the program supports dynamic movement through time using keyboard controls, making it easier to inspect transitions, phases, and timing-based techniques in practice.

This is one of the defining changes of the Aries release.

---

## Project Status

Aries is currently a major code and UX revamp of Morinus.

Current priorities are:

- code modernization
- interface refinement
- restoration and extension of existing functionality
- stabilization of cross-platform builds
- preparation of installers and distribution packages

The macOS application bundle has been tested. Other systems are expected to work from source, but this remains subject to confirmation.

---

## Contributing

Contributions are welcome.

Areas that especially benefit from help include:

- Windows packaging
- Linux packaging
- build and dependency cleanup
- testing across platforms
- documentation
- UI refinement
- restoration or extension of traditional techniques

Please open an issue or submit a pull request if you want to contribute.

---

## License

Morinus is free software and is distributed under the terms of the  
**GNU General Public License, version 3 or later**.

See the `LICENSE` file for details.

---

## Repository

[GitHub Repository](https://github.com/primum-mobile/aries)

---

## Notes

- **Aries** is the name of the 10.x continuation of Morinus
- Installers are not yet available
- Documentation is still being revised as the project stabilizes
- Historical credits may be expanded as more source material is reviewed

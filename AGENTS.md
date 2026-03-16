# AGENTS.md — Morinus Astrology (Python 3 / wxPython)

## Entry Point
`morinus.py` — main application entry point.

## Stack
- Python 3
- wxPython (all GUI)
- Swiss Ephemeris via `SWEP/`

## Module Map

### Core Engine (no GUI)
| File | Owns |
|---|---|
| `astrology.py` | Central data model and calculation engine |
| `houses.py` | House system calculations |
| `circumambulation.py` | Circumambulation logic |
| `zodparsbase.py` | Base zodiac parsing primitives |
| `zodpars.py` | Zodiac parsing (builds on zodparsbase) |
| `secmotion.py` | Secondary progressions / secondary motion |
| `syzygy.py` | Syzygy calculations |
| `suntransits.py` | Solar transit calculations |
| `moonphasejump.py` | Moon phase jump logic |
| `fixstars.py` | Fixed stars data and calculations |
| `placidiansapd.py` | Placidian semi-arc primary directions |
| `fortune.py` | Part of Fortune calculations |
| `munfortune.py` | Mundane Part of Fortune |
| `hours.py` | Planetary hours |
| `searchbackend.py` | Search engine core logic |
| `searchquery.py` | Search query model |
| `searchcatalog.py` | Search catalog / index |
| `options.py` | Application settings and options model |
| `util.py` | General-purpose utilities |

### GUI — Windows (`*wnd.py`)
| File | Owns |
|---|---|
| `commonwnd.py` | Shared base window classes |
| `miscwnd.py` | Miscellaneous standalone windows |
| `phasiswnd.py` | Phasis display window |
| `antisciawnd.py` | Antiscia display window |
| `zodiacalreleasingwnd.py` | Zodiacal releasing window |
| `angleatbirthwnd.py` | Angle-at-birth window |
| `pdsinchartingresswnd.py` | PDS in-chart ingress window |
| `eclipseswnd.py` | Eclipses window |
| `customerwnd.py` | Customer/client data window |

### GUI — Frames (`*frame.py`)
| File | Owns |
|---|---|
| `mundaneframe.py` | Mundane chart frame |
| `phasisframe.py` | Phasis frame |
| `antisciaframe.py` | Antiscia frame |
| `squarechartframe.py` | Square chart frame |
| `profstableframe.py` | Profections table frame |
| `stripframe.py` | Strip/timeline chart frame |
| `speedsframe.py` | Planetary speeds frame |
| `positionsframe.py` | Planetary positions frame |
| `arabicpartsframe.py` | Arabic parts frame |
| `electionsframe.py` | Electional astrology frame |
| `miscframe.py` | Miscellaneous frames |
| `transitmframe.py` | Transit/mundane transit frame |
| `pdsinchartframe.py` | PDS in-chart frame |
| `fixstarsparallelsframe.py` | Fixed stars parallels frame |
| `fixstarspddlg.py` | Fixed stars primary directions frame |
| `circumambulationframe.py` | Circumambulation frame |

### GUI — Dialogs (`*dlg.py`)
| File | Owns |
|---|---|
| `firdariadlg.py` | Firdaria dialog |
| `stepperdlg.py` | Stepper dialog |
| `electionstepperdlg.py` | Election stepper dialog |
| `revolutionsdlg.py` | Solar/lunar revolutions dialog |
| `proftablemondlg.py` | Profections table month dialog |
| `pdsinchartterrdlgopts.py` | PDS in-chart territory dialog options |
| `colorsdlg.py` | Colors/theme dialog |
| `langsdlg.py` | Language selection dialog |
| `decansdlg.py` | Decans dialog |
| `stepalertsdlg.py` | Step alerts dialog |
| `horfiledlg.py` | Horoscope file dialog |
| `macfiledialog.py` | macOS file dialog wrapper |
| `dlgutils.py` | Shared dialog utilities |

### HTML Help
| File | Owns |
|---|---|
| `htmlhelpframebiblio.py` | Bibliography help frame |

### Tools
| File | Owns |
|---|---|
| `tools/audit_deps.py` | Dependency auditing (dev tool, not app logic) |

---

## Coding Conventions

- **wxPython only** — no tkinter, no Qt. All GUI must use `wx.*`.
- **Frames vs Windows vs Dialogs** — follow the existing naming convention:
  - `*frame.py` = dockable/embedded panel (`wx.Panel` or `wx.Frame` used as a pane)
  - `*wnd.py` = standalone top-level window (`wx.Frame`)
  - `*dlg.py` = modal or modeless dialog (`wx.Dialog`)
- **Options** — all persistent settings go through `options.py`. Do not hardcode defaults elsewhere.
- **Utilities** — generic helpers go in `util.py`. Dialog-specific helpers go in `dlgutils.py`.
- **No business logic in GUI files** — calculations belong in the engine layer (non-`*wnd`, non-`*frame`, non-`*dlg` files).

---

## Scope Rules for Tasks

- **Adding a new GUI feature**: create or edit the appropriate `*frame.py`, `*wnd.py`, or `*dlg.py`. Wire data from the engine layer; do not add calculation logic to GUI files.
- **Changing a calculation**: edit only the relevant engine file. Do not touch GUI files unless a label or display unit must change.
- **Refactoring**: keep changes within the file being refactored unless an interface signature changes, in which case update all callers in the same PR.
- **Bug fix**: identify the owning module from the map above, fix there. Note which module was changed in the commit message.

---

## What to Avoid

- Do not read all files to orient yourself — use this map.
- Do not refactor `astrology.py`, `zodparsbase.py`, or `options.py` speculatively; they are load-bearing and have many callers.
- Do not introduce new top-level dependencies without noting them in your response.
- Do not convert wx event patterns to async/await.

## Running the App
Smoke test GUI changes with: `pythonw morinus.py`
Never compile/package to test. Run directly.

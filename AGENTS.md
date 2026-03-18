# AGENTS.md — Morinus Astrology (Python 3 / wxPython)

## ⚠️ Running the App (READ THIS FIRST)

Run with: **`python3 morinus.py`**

**ALWAYS use `python3`** (Python 3.13+). **NEVER use `pythonw`** — it resolves to Python 2.7 on this machine and will crash immediately.

Never compile/package to test. Run directly.
After code changes, always run `python3 morinus.py` so behavior can be verified immediately.

**One-shot build + launch (use this in worktrees or after a fresh clone):**
```bash
cd SWEP/src && python3 setup.py build_ext --inplace -q && cd ../.. && python3 morinus.py
```

A `.claude/launch.json` is present — `preview_start "morinus"` runs the above automatically.

---

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
| `interchartaspects.py` | Cross-chart aspect calculation helpers |
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

## GUI Coherence (Morinus Aries — non-negotiable)

Morinus Aries has a **single, coherent GUI**. Every scrollable surface must behave identically. These rules are mandatory — violations must be fixed, not worked around:

- **`SCROLL_RATE = 10` everywhere** — no hardcoded scroll rates anywhere in the codebase. All scrollable windows (whether they inherit `CommonWnd` or `wx.ScrolledWindow` directly) must use `SCROLL_RATE = 10`. This matches the sidebar grain (rate 4 ≈ 12 px/tick; tables at rate 10 = 30 px/tick — close enough for consistent feel). Never introduce a per-file override.
- **Native scrollbars always hidden** — `ShowScrollbars(wx.SHOW_SB_NEVER, wx.SHOW_SB_NEVER)` in `CommonWnd.__init__` and in `MainWindowShell.set_table_content` hides both axes; both are replaced by custom `_FadingScrollbar` overlays.
- **Custom `_FadingScrollbar` for all table views** — both vertical and horizontal `_FadingScrollbar` instances (orientation-aware via `orientation=wx.VERTICAL/wx.HORIZONTAL`) are created in `MainWindowShell.set_table_content`. Do not rely on native scrollbars for any axis.
- **1-second inactivity auto-hide** — all `_FadingScrollbar` instances auto-fade 1 s after the last `show_bar()` call (driven by `_inactivity_timer`, constant `_SCROLLBAR_INACTIVITY_MS = 1000`). `EVT_MOTION` on all scrollable panels must call `show_bar()` to reset the timer while the mouse is moving.
- **Timer safety** — any `wx.Timer` owned by a widget must be stopped in `EVT_WINDOW_DESTROY` to prevent use-after-free crashes when the widget is destroyed mid-animation.

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
- **No feature logic in GUI files** — renderers and shells may draw or dispatch, but aspect classification, comparison rules, filtering, and other reusable behavior must live in engine/helper modules so the GUI layer remains replaceable.
- **Keep time logic out of rendering** — astrological date/time resolution, solar-year boundary checks, LOY selection, and similar temporal logic must live in engine/helper modules. Rendering and GUI modules may only consume precomputed values or explicit display datetimes passed in from the engine/session layer.
- **No popup dialogs for table configuration** — tables always embed directly in the workspace. Options (start sign, parameters, display modes) are exposed via right-click context menu on the embedded table. Extend `self.pmenu` using `Insert()`/`InsertSubMenu()` on the inherited `CommonWnd` menu. See `ZRWnd` in `zodiacalreleasingwnd.py` as the reference implementation of this pattern.

### Internal Reference Logic (Code Annotation)

```py
# Base resolution rule:
# radix = active_chart_session.radix if present else self.horoscope

# Timed chart opens (Transits / Secondary / Profections / Revolutions):
# - Always compute from `radix` (never from currently focused derived chart)
# - Build new chart identity/time/place from `radix` context
# - Open session with `radix=radix`

# Solar/Lunar/Planetary Revolution safety:
# - Never chain SR/LR off a transit-derived chart
# - Revolution recompute + stepper refresh must reuse fixed radix context

# Secondary directions stepping semantics:
# - User intent = real/signified time stepping
# - key delta applies to signified datetime (year/month/week/day)
# - then map back to symbolic age for chart recompute

# Reset invariant (SPACE):
# - Every session stores initial chart + initial display datetime at open
# - SPACE restores exactly that initial state (not recomputed "now")
```

## Time Architecture (Authoritative Model)

### Core concept
Morinus does **not** use a global singleton clock.
Time authority is scoped to the **active `ChartSession`**.

### Canonical session time fields
- `cs.chart.time` = chart computational time (may be symbolic).
- `cs.display_datetime` = real/user-intended cursor `(y, m, d, h, mi, s)`.
- `cs.radix` = immutable birth anchor used for lineage and age semantics.

### Rule of truth (real-time consumers)
For any feature that needs real-world time:
1. Use `cs.display_datetime` if present.
2. Else fall back to `cs.chart.time` orig fields.
3. Never infer real time from `htype` alone.

### Transit comparison modes (explicit contract)
Treat transit overlays as two distinct modes:

1. **Real-time transits**
  - Purpose: "What is happening IRL now around this chart?"
  - Seed time source: wall clock (`datetime.now()`).
  - Implementation: opens a **separate child document** with `view_mode=COMPOUND`, `radix=base_chart`, `chart=transit_chart`. The transit is an independent session that can be navigated on its own.
  - Context menu item: plain "Transits" → `_workspace_open_transits_from_document()`.

2. **Parallel transits**
  - Purpose: "What natural-time transits correspond to the symbolic moment shown by this chart?"
  - Seed time source: base session real cursor (`cs.display_datetime`) or equivalent signified datetime.
  - **Not a separate document.** Parallel transits are a **toggle on the existing session** that adds an outer transit ring to the current chart.
  - When enabled, `drawBkg()` computes a fresh transit chart from `display_datetime` on every render and passes it as `chrt2` to the biwheel renderer. The session's own `cs.chart` becomes the **center** wheel.
  - When the user steps the parent chart (e.g., secondary progression ±1 year), both the center chart and the parallel transit ring update together because `display_datetime` changes.
  - State stored in workspace runtime: `session['parallel_transits_enabled'] = True/False`.
  - Toggle via context menu checkable item "Transits ‖" → `_toggle_workspace_parallel_transits_for_document()`.
  - Availability gated by `_workspace_parallel_transit_available()` (needs non-bc chart with ChartSession).

### Shared `TRANSIT` htype caveat
`TRANSIT` is used by both plain transit charts and secondary-derived flows.
Do not branch on `htype` alone; use session context (`_stepper`, `display_datetime`, lineage) to disambiguate semantics.

### Change pipeline
`ChartSession.change_chart(...)` → update `cs.display_datetime` → `morin._on_chart_session_change(cs)` → recompute title/status/sidebar and dependent consumers.

### Child chart lineage contract
When opening timed children:
- Keep document lineage (parent/child) separate from time lineage.
- Time lineage must carry: `radix` + explicit real cursor (`display_datetime`) + mode (`real-time` vs `parallel`).
- Do not silently reseed with wall clock when user intent is parallel/synchronized time.

### Invariants
- SPACE reset restores both initial chart and initial display cursor.
- Age text, LOY, and labels must read the same real cursor ordering above.
- New timed chart types must implement both runtime title updates and caption/status fallbacks using the same cursor semantics.

### LOY contract (authoritative)
- LOY always starts from the real cursor (`cs.display_datetime` when present; otherwise runtime now).
- LOY is always evaluated in the native personal solar-year cycle anchored to `radix` (single mapping path for all chart types).
- Do not special-case LOY by chart `htype` (no separate quantization/snapping rules for `SOLAR`, `LUNAR`, `TRANSIT`, or `PROFECTION`).
- If LOY behavior changes, update only the central `lordofyear.py` mapping path, not per-view render code.

---

## Scope Rules for Tasks

- **Adding a new GUI feature**: create or edit the appropriate `*frame.py`, `*wnd.py`, or `*dlg.py`. Wire data from the engine layer; do not add calculation logic to GUI files.
- **Adding comparison/synastry/chart interaction features**: put the reusable logic in an engine/helper module first, then call it from the GUI layer.
- **Changing a calculation**: edit only the relevant engine file. Do not touch GUI files unless a label or display unit must change.
- **Refactoring**: keep changes within the file being refactored unless an interface signature changes, in which case update all callers in the same PR.
- **Bug fix**: identify the owning module from the map above, fix there. Note which module was changed in the commit message.

## Legacy Window → Workspace Migration Blueprint (authoritative)

Use this exact path when porting legacy popup windows into integrated workspace shell + optional sidebar action.

### 1) Classify the legacy UI target
- **`*wnd.py` / content panel (`wx.Panel`)**: embed directly in workspace table host.
- **`*frame.py` / top-level frame (`wx.Frame`)**: extract or reuse its inner content panel; do not spawn a new top-level frame for workspace mode.
- **`*dlg.py` (`wx.Dialog`)**: keep dialog flow if user input is required first, then open resulting content in workspace.

### 2) Add sidebar action only if requested
- Add `WorkspaceAction` in `workspace_model.py` under the correct section.
- Prefer existing section names; add a new section (e.g., **Time Lords**) only when it improves grouping.
- Keep labels user-facing and stable; internal action ids stay lowercase snake-like strings.

### 3) Wire workspace action in `morin.py`
- In `_workspace_navigation_state()`: gate enabled state via existing availability rules (`has_chart`, `solar_available`, `not bc`, etc.).
- In `_handle_workspace_action()`: map action id to a dedicated `_workspace_table_*` or `_workspace_open_*` handler.
- Keep legacy menu handler (`onXxx`) intact unless explicitly replacing it.

### 3b) Always add workspace-first delegation in legacy handlers
- In each legacy `onXxx` menu handler, add an early workspace branch:
  - if workspace shell is active, call the matching `_workspace_table_*` (or `_workspace_open_*`) and `return`.
- Keep legacy popup code as fallback for non-workspace mode.
- This guarantees one migration path supports both old menu flows and new sidebar/workspace flows.

### 4) Embed content using the workspace host contract
- Get host via `host = self._workspace_shell.get_table_host()`.
- Prefer a wrapper panel for complex legacy widgets:
  - `panel = wx.Panel(host)`
  - `sizer = wx.BoxSizer(wx.VERTICAL)`
  - `content = LegacyWnd(panel, ...)`
  - `sizer.Add(content, 1, wx.EXPAND)`
  - `panel.SetSizer(sizer)`
  - `self._show_table_in_workspace(action_id, panel)`
- This wrapper pattern is the default safe path; use direct embed only for simple, proven controls.

### 4b) Widget safety tiers (mandatory)
- **Tier A (safe)**: pure `*wnd` tables that render from chart/options only → embed directly or wrapper panel.
- **Tier B (caution)**: windows that open dialogs, perform threaded jobs, or rely on frame-owned toolbars/state → use wrapper panel and test menu+sidebar flows.
- **Tier C (fragile)**: modules with known runtime constructor failures in current environment (e.g., SWEP API mismatch) → keep action disabled or guarded; never allow workspace crash.
- If constructor fails in workspace path, show `NotAvailable` message and return cleanly.
- Do not fallback to a legacy frame when that frame instantiates the same failing `*wnd` internally.

### 5) Keep time semantics centralized
- Workspace-timed features must consume session/display cursor semantics from central paths (`ChartSession.display_datetime` flow).
- Reusable time-lord logic belongs in central helper modules (e.g., `lordofyear.py`), not in view rendering files.

### 6) Optional chart-overlay/sidebar-info integration
- If the feature also appears in chart overlay text, add a small getter in `graphchart.py` and `graphchart2.py` that calls centralized logic.
- Rendering layer only formats glyph/text; calculation stays outside view modules.

### 7) Validation checklist (required)
- `python3 -m py_compile` for edited files.
- `python3 morinus.py` launch check.
- Manual workspace check:
  - sidebar action visible/enabled only under valid conditions
  - opens in integrated table area (no stray popup)
  - switching back to chart view works
  - no regression in legacy menu command unless intentionally changed.

### 7b) Bulk migration smoke matrix (required for "migrate many")
- Verify each migrated view opens from:
  - sidebar action
  - legacy top menu handler (`onXxx`)
- Verify each migrated view closes cleanly when switching to a chart document.
- Verify gating behavior for each migrated action (`bc`, fixed-star selection, chart-required states).
- If one migrated view is unstable, isolate it (disable/gate action) and continue shipping the rest.

### 8) Non-goals during migration
- Do not refactor unrelated engine logic.
- Do not redesign legacy UI during embedding pass.
- Do not duplicate business logic between popup and workspace paths.

### 9) Rollout strategy (authoritative)
- Migrate in batches by risk:
  1. stable table windows
  2. time-lord windows with simple data dependencies
  3. fragile/ephemeris-heavy windows
- After each batch: compile, launch, smoke-test, then proceed.
- Prefer shipping 90% stable integration quickly over blocking on one fragile window.

## Migration outcomes summary (March 2026 baseline)

This codebase now has a proven workspace-integration path for legacy popup features.
Treat the following outcomes as established practice, not experiments:

- **Workspace-first delegation works**: legacy `onXxx` handlers may remain as compatibility entry points, but when workspace shell is active they should delegate early to the matching `_workspace_table_*` or `_workspace_open_*` path and return.
- **One action, two entry paths**: the authoritative open path must support both sidebar navigation and legacy top-menu activation, so both flows exercise the same integration code.
- **Wrapper-panel embedding is the default safe adapter**: when a legacy widget was designed for frame ownership or needs setup calls, create a `wx.Panel(host)` wrapper and embed the widget there instead of reusing top-level frame behavior directly.
- **Fragile views must fail soft**: if a workspace constructor or backend dependency is unstable, guard it, show `NotAvailable`, and keep the rest of the workspace usable.
- **Time-lord and cursor logic belongs in backend helpers**: LOY, term-lord selection, solar-year boundary decisions, and similar rules must stay in central helper modules so overlay, workspace, and future backends all consume the same result.
- **Session cursor semantics are the shared contract**: integrated timed views are now expected to read explicit session state such as `radix`, `display_datetime`, lineage, and mode, instead of inferring behavior from chart type alone.
- **Migration success means parity plus containment**: a view is considered successfully migrated only when it opens in workspace, still works from the old menu path, respects gating rules, and does not crash the shell when dependencies fail.

### Migration lessons (authoritative)
- Move behavior inward before moving UI outward: extract reusable calculation or initialization logic into engine/helper paths first, then embed the view.
- Do not trust constructor success alone: some legacy widgets instantiate but still require explicit `set_data(...)`, `compute_and_draw()`, or similar initialization in workspace mode.
- Treat SWEP and ephemeris calls as backend capability boundaries: normalize return-shape handling in helper/backend code, not in navigation or rendering layers.
- Prefer guarded partial delivery over all-or-nothing migration: if one time-lord or ephemeris-heavy screen is unstable, isolate it and continue shipping the stable batch.

## Future track: Web backend transition

If Morinus later gains a web backend or remote workspace surface, use the desktop migration work above as the contract boundary.
Do **not** reintroduce business logic into transport or rendering layers.

### Backend ownership rules
- Astrological calculations, time-lord selection, LOY logic, symbolic/real-time mapping, and distribution generation remain owned by engine/helper modules.
- A web/backend layer may orchestrate those modules, cache results, and expose them through APIs, but it must not fork calculation rules from desktop code.
- If a rule changes, update the central engine/helper implementation first, then let desktop/workspace/web consumers inherit the new behavior.

### View-model contract rules
- Workspace tables, time-lord tables, overlays, and timed status text should be expressible as serializable view-models: plain rows, labels, timestamps, glyph ids, and capability flags.
- wx widgets remain adapters that render those view-models locally.
- A future web frontend should consume the same view-model contract instead of re-deriving astrology state in JavaScript or UI handlers.
- When a legacy widget cannot yet expose a clean view-model, treat it as desktop-only until the underlying engine contract is separated.

### Capability and degradation rules
- Backend consumers must advertise capabilities explicitly: available chart types, fixed-star support, SWEP-dependent features, timed-navigation support, and long-running computations.
- If a capability is missing, the caller must degrade gracefully with a disabled action, informational state, or `NotAvailable` response.
- Never let backend/provider failures take down the entire workspace shell or future web session.

### Adapter boundary rules
- `morin.py`, workspace navigation, and future transport handlers should be dispatch/adaptation layers only.
- wx-only concerns such as menus, panels, focus, bitmap rendering, and dialog flow must stay isolated behind adapters.
- Future HTTP/WebSocket/gRPC decisions are implementation details; the stable requirement is that transport calls into the same backend contracts already used by workspace integration.

### Web-track non-goals
- Do not rewrite the desktop UI into a web client during ordinary workspace migrations.
- Do not speculatively refactor core engine modules only because a future backend may exist.
- Do not lock the project to a specific server protocol or frontend stack in AGENTS guidance before a concrete implementation plan exists.
- Do not duplicate astrology logic between wx handlers and future backend handlers.

### Web-track readiness checklist
- Can the feature's core result be produced without constructing a wx window?
- Can the result be expressed as plain data plus formatting hints?
- Are capability failures surfaced as data/flags instead of uncaught exceptions?
- Does the feature consume `ChartSession`-style explicit time context instead of hidden GUI state?
- Is the rendering layer replaceable without changing astrology rules?

---

## What to Avoid

- Do not read all files to orient yourself — use this map.
- Do not refactor `astrology.py`, `zodparsbase.py`, or `options.py` speculatively; they are load-bearing and have many callers.
- Do not introduce new top-level dependencies without noting them in your response.
- Do not convert wx event patterns to async/await.

## Swiss Ephemeris (SWEP) C Extension
Morinus depends on `sweastrology`, a C extension built from `SWEP/src/`.
The compiled `.so` is gitignored, so **git worktrees will not have it**.

**If you get `ModuleNotFoundError: No module named 'sweastrology'`**, rebuild it:
```bash
cd SWEP/src && python3 setup.py build_ext --inplace && cd ../..
```
This must be done once per worktree or fresh clone.

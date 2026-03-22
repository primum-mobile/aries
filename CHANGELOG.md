# Changelog

## 2026-03-22

Computation: Removed the radix-birth floor from backward planetary return selection in `revolutions.py`. Exact previous-hit stepping now searches the full configured cycle horizon in both directions, so planetary revolutions can continue into pre-birth years when an earlier exact hit exists there instead of falsely stopping at the natal year boundary.

GUI: Updated the planetary stepping status text in `morin.py` so a failed backward step reports a generic search-window boundary instead of implying that radix birth is always the hard stop. The existing menu and arrow-key stepping surfaces are unchanged.

Computation: Reworked planetary return selection and stepping so Mercury, Venus, Mars, Jupiter, and Saturn now use a shared exact-hit backend. The return engine now considers all exact hits within retrograde clusters, can step to the immediate previous or next exact hit by datetime, and opens the current return cycle at the first hit in the active cluster instead of the last hit. Lunar return stepping was also corrected to search the full target month so current lunations are not skipped when a preserved day-of-month would otherwise jump past a valid hit.

GUI: Kept the existing return UI and stepper surfaces intact, but rewired the quick planetary opener, the planetary revolution dialog open path, and the planetary steppers to consume the new shared backend methods. No redesign or layout change was introduced; this was a behavior and wiring correction only.

Computation: Added Uranus as a first-class planetary return type in the centralized return engine. The generic planetary compute path in `revolutions.py` now dispatches through shared planetary metadata instead of explicit Mercury-through-Saturn branches, so future outer-planet additions can be made from the backend definition table with much less code churn.

GUI: Added Uranus Return to the Other Revolutions menus and to the revolutions type list used by the dialog/open paths. The existing planetary return UI behavior was preserved; Uranus now uses the same opener and stepper wiring already used by the other supported planetary returns.

Computation: Extracted a central bounded-range planetary hit enumerator in `revolutions.py` and refactored the planetary return selectors to consume it. The return engine now has one path for “enumerate exact hits in range, then choose next/previous/cycle start,” and monthly planetary hit results are cached underneath that helper so repeated return queries on the same chart reuse solved months instead of recomputing them every time.

GUI: No material GUI change in this pass. Existing return menus, dialogs, and steppers continue to behave the same way, but they now benefit from the refactored backend hit enumeration path.

Computation: Added a true lazy hit-list path for intensive planetary returns, starting with Uranus. On first Uranus return query, the engine now builds and caches a sorted list of exact return hits from birth through the currently needed future window, then uses bisect-based list navigation for next/previous/current-cycle selection instead of re-running bounded month searches on every step.

GUI: No material GUI change in this pass. Uranus opening and arrow-key stepping keep the same controls and visual flow, but can now become fluid after the first query because backend selection reuses the cached hit list.

Computation: Tightened the intensive-planet hit-list policy to match the stepping UX goal instead of prebuilding a long historical span. Uranus now keeps a local neighborhood of exact hits around the current reference, extending the cache only until roughly five previous and five next exact hits are available or the birth/future search bounds are reached. This keeps repeated arrow-key stepping hot without forcing an unnecessary birth-to-far-future preload on first use.

GUI: No material GUI change in this pass. The return stepper behavior is the same from the user’s perspective, but Uranus stepping is now optimized for short bursts of left/right research navigation rather than a heavier initial preload.

Computation: Corrected the Uranus neighborhood-cache rollout so it only accelerates exact previous/next hit stepping. Current-cycle opening now stays on the stable selector path that first resolves the proper anchor hit and then rewinds to the start of that retrograde cluster, which avoids opening on the wrong lifetime hit when the small navigation cache does not yet carry enough context.

GUI: No material GUI change in this pass. Quick Uranus return open and dialog-driven current-cycle open keep the same controls, but they now use the corrected backend path while arrow-key stepping still benefits from the local exact-hit cache.

Computation: Disabled the Uranus hit-list acceleration by default after it caused selector divergence in real return workflows. All supported planetary returns now route through the same shared exact-hit selector contract again, prioritizing correct current-cycle opening and exact previous/next stepping over the experimental cache path.

GUI: No material GUI change in this pass. Uranus and Saturn keep the same menu and stepper surfaces; this rollback only removes the backend fast-path so their behavior matches the previously validated shared return logic.

Computation: Kept the shared planetary return math on the same backend exact-hit selectors and did not reintroduce any planet-specific fast-path in `revolutions.py`. Current-cycle selection and exact previous/next hit resolution remain centralized there.

GUI: Moved the stepping optimization into `morin.py` as a small per-session buffer of neighboring exact planetary return hits. When a planetary return opens, the UI now preloads a few previous and next exact hits and extends that buffer on demand during left/right stepping, which keeps Saturn and Jupiter navigation responsive without changing the backend return calculations.

Computation: Reverted the later Uranus/list experiments and restored the simpler shared planetary-return backend contract. The centralized metadata in `revolutions.py` remains, and planetary current-cycle / previous-hit / next-hit selection again relies only on the shared exact-hit selector methods instead of any hit-list or session-buffer path.

GUI: Reverted the temporary planetary step-buffer logic from `morin.py`. Quick planetary open and dialog-driven planetary stepping are back on the original generic wiring that uses the centralized backend helpers directly, without extra UI-side caching.

Computation: Fixed a generic forward-search boundary bug in the shared planetary return engine. The exclusive upper bound used by `compute_planetary_after_datetime(...)` was stopping one month too early, which could make Jupiter, Saturn, and other planetary returns appear to get stuck when the next exact hit fell in that omitted terminal month. The backend now includes the full configured horizon month in its forward exact-hit search.

GUI: No material GUI change in this pass. The stepper wiring in `morin.py` is unchanged; the fix is entirely in the shared backend selector that the planetary steppers already call.

Computation: Reworked the shared planetary exact-hit selectors so `compute_planetary_after_datetime(...)`, `compute_planetary_before_datetime(...)`, and `compute_planetary_cycle_start_datetime(...)` all use the same local month-by-month search model. This removes the old asymmetry where backward and cycle-start logic scanned from birth to the reference datetime, which could make some planets appear to stall when stepping far enough through time. Current-cycle opening still rewinds to the first hit in the active retrograde cluster, but it now does so by repeatedly stepping to the immediately previous exact hit until the cluster gap is broken.

GUI: No material GUI change in this pass. The planetary steppers in `morin.py` still call the same centralized backend helpers; only the shared selector behavior behind them changed.

Computation: Live probing against a historical `.hor` chart showed that the normalized slow-planet selectors do keep returning valid earlier Saturn and Uranus hits far into the past, so the remaining “stuck at birth” symptom is not simply a generic slow-planet search miss. The backend normalization remains in place.

GUI: Added explicit planetary step-boundary feedback in `morin.py`. When planetary stepping reaches a real boundary such as “no earlier return after radix birth” or “no later return found in search window,” the status bar now reports that state and the app rings the bell instead of failing silently and appearing frozen.

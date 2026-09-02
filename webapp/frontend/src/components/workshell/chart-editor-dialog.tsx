// SPDX-FileCopyrightText: Morinus contributors
// SPDX-FileCopyrightText: 2026 Max Lange (Aries modifications)
// SPDX-License-Identifier: GPL-3.0-or-later
// Modified for Aries in 2026 by Max Lange.

"use client";

import * as React from "react";

import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  editorApply,
  editorApplyCursor,
  editorBuild,
  editorSave,
  fetchEditorMeta,
  fetchEditorRadixSeed,
  fetchEditorRecord,
  fetchNotes,
  listCollections,
  resolvePlace,
  type ChartCollection,
  type EditorCursorSeed,
  type EditorDefaults,
  type EditorFields,
  type EditorMeta,
  type EditorRecord,
  type PlaceCandidate,
} from "@/lib/daemon/client";
import type { ChartRenderSnapshot } from "@/lib/chart/types";
import {
  automaticCalendarForDate,
  calendarAfterDateChange,
} from "@/lib/chart/calendar-auto";
import { useT } from "@/lib/i18n/i18n";

// ---------------------------------------------------------------------------
// Chart editor (Personal Data) dialog.
//
// Faithful translation of personaldatadlg.py — every field, order and grouping
// mirrors the wx dialog (cited in doc/migration/surfaces/chart-editor.md §7);
// styling is from scratch in the Aries webapp component language (dense rows,
// hairline groups, compact labels, tabular-nums numeric fields).
//
// Drives the daemon editor lane: /api/editor/resolve-place (city search →
// fills lat/lon/tz/alt), /api/editor/build (live Asc/MC preview), and
// /api/editor/save (upsert into a .jsonl collection). On submit it saves, then
// asks the host to open the saved chart as a workspace radix.
//
// CREATE vs EDIT: with no `editRecord` the form seeds from the daemon's
// editor-meta `defaults` (a fresh chart, no id → save appends). With an
// `editRecord` (GET /api/editor/load, the desktop "Personal Data on an existing
// radix" path) the form prefills from the loaded record and threads its `id`
// through save, so /api/editor/save UPSERTS by id (overwrite, no duplicate).
// ---------------------------------------------------------------------------

type FormState = {
  // Stable record id — empty for a new chart, the loaded id when editing. Kept
  // verbatim so save overwrites the same record (editor_service.save_chart
  // upserts by id).
  id: string;
  name: string;
  male: boolean | null; // True=Male, False=Female, null=no gender (preserved from a loaded record; radio only sets true/false)
  type: string;
  bc: boolean;
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
  second: string;
  lonDeg: string;
  lonMin: string;
  lonSec: string;
  east: boolean;
  latDeg: string;
  latMin: string;
  latSec: string;
  north: boolean;
  // Authoritative signed decimals (E/N positive). Set by a map/search-pick or a
  // loaded record; "" once the user edits any DMS field on that axis, so manual
  // edits fall back to deg/min/sec and a pick keeps full precision.
  lonDec: string;
  latDec: string;
  placeSearch: string;
  place: string; // hidden backing value (max 20) — the persisted name
  cal: string;
  zt: string;
  plus: boolean; // GMT sign: true = '+'
  zoneHour: string;
  zoneMin: string;
  daylightSaving: boolean;
  tzauto: boolean;
  tzid: string;
  altitude: string;
  notes: string;
};

// The form holds every field as a string (text inputs). The seed values come
// from the daemon — either editor-meta `defaults` (engine `now` + canonical
// defaults, personaldatadlg.initialize(), for a NEW chart) or a loaded
// `EditorRecord` (an existing chart, GET /api/editor/load) — never the browser
// clock; we only stringify them. An `EditorRecord` additionally carries its
// stable `id`, which we keep so save overwrites by id (no duplicate).
function stateFromDefaults(d: EditorDefaults | EditorRecord): FormState {
  return {
    id: "id" in d ? d.id : "",
    name: d.name,
    male: d.male,
    type: d.type,
    bc: d.bc,
    year: String(d.year),
    month: String(d.month),
    day: String(d.day),
    hour: String(d.hour),
    minute: String(d.minute),
    second: String(d.second),
    lonDeg: String(d.lonDeg),
    lonMin: String(d.lonMin),
    lonSec: String(d.lonSec ?? 0),
    east: d.east,
    latDeg: String(d.latDeg),
    latMin: String(d.latMin),
    latSec: String(d.latSec ?? 0),
    north: d.north,
    // Fresh defaults carry the saved Default Location; loaded records carry
    // their stored decimal. Both stay authoritative until a DMS field is edited.
    lonDec: d.lon != null ? String(d.lon) : "",
    latDec: d.lat != null ? String(d.lat) : "",
    placeSearch: d.place,
    place: d.place,
    cal: d.cal,
    zt: d.zt,
    plus: d.plus,
    zoneHour: String(d.zoneHour),
    zoneMin: String(d.zoneMin),
    daylightSaving: d.daylightSaving,
    tzauto: d.tzauto,
    tzid: d.tzid,
    altitude: String(d.altitude),
    notes: d.notes,
  };
}

function toFields(s: FormState): EditorFields {
  const n = (v: string) => {
    const x = parseInt(v, 10);
    return Number.isFinite(x) ? x : 0;
  };
  // Authoritative signed decimal per axis: a map/search-pick (or loaded record)
  // sets lonDec/latDec verbatim; once the user edits a DMS field that axis's dec
  // is cleared and we reconstruct from deg/min/sec. Either way both lat and lon
  // go to the daemon as 6dp decimals (its preferred, full-precision branch).
  const fromDms = (deg: string, min: string, sec: string, positive: boolean) => {
    const v = Math.abs(n(deg)) + Math.abs(n(min)) / 60 + Math.abs(n(sec)) / 3600;
    return Math.round((positive ? v : -v) * 1e6) / 1e6;
  };
  const dec = (raw: string, deg: string, min: string, sec: string, positive: boolean) => {
    const parsed = parseFloat(raw);
    if (raw !== "" && Number.isFinite(parsed)) return Math.round(parsed * 1e6) / 1e6;
    return fromDms(deg, min, sec, positive);
  };
  return {
    // Empty id in CREATE mode → editor_service mints a fresh uuid (append). A
    // non-empty id in EDIT mode → save_chart upserts that record (overwrite).
    ...(s.id ? { id: s.id } : {}),
    name: s.name,
    male: s.male,
    type: s.type,
    bc: s.bc,
    year: n(s.year),
    month: n(s.month),
    day: n(s.day),
    hour: n(s.hour),
    minute: n(s.minute),
    second: n(s.second),
    cal: s.cal,
    zt: s.zt,
    lonDeg: n(s.lonDeg),
    lonMin: n(s.lonMin),
    lonSec: n(s.lonSec),
    east: s.east,
    latDeg: n(s.latDeg),
    latMin: n(s.latMin),
    latSec: n(s.latSec),
    north: s.north,
    lon: dec(s.lonDec, s.lonDeg, s.lonMin, s.lonSec, s.east),
    lat: dec(s.latDec, s.latDeg, s.latMin, s.latSec, s.north),
    place: s.place || s.placeSearch.slice(0, 20),
    altitude: n(s.altitude),
    plus: s.plus,
    zoneHour: n(s.zoneHour),
    zoneMin: n(s.zoneMin),
    daylightSaving: s.daylightSaving,
    tzauto: s.tzauto,
    tzid: s.tzid,
    notes: s.notes,
  };
}

/** Which existing chart to edit.
 *
 * Stored-radix mode: `name` is the chart name (the radix doc's sourceName),
 * `source` is its collection .jsonl path (the radix doc's fpath, optional —
 * omit for the default Hors source). Omit the whole prop for CREATE mode.
 *
 * Session-cursor mode (morin.py:14821): `cursorDocId` is set and `cursorSeed`
 * carries the daemon's seed (fields + lockChartType + timeContextHint). The
 * editor seeds from the cursor anchor, locks the Type combo, shows the hint,
 * and on submit applies back to the cursor chart (POST /api/editor/apply-cursor)
 * instead of writing a .jsonl record. */
export type EditTarget = {
  name: string;
  source?: string;
  cursorDocId?: string;
  cursorSeed?: EditorCursorSeed;
  /** Present → the edited chart is OPEN as this radix document; apply the edit
   * in place (no close/reopen) + auto-save to its bound collection. */
  radixDocId?: string;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after a successful save with the chart name + the collection file
   * it was written to, so the host can open it as a workspace radix. */
  onSaved: (chartName: string, collectionPath: string, recordIndex: number | null) => void;
  /** Present → EDIT an existing chart (prefill from GET /api/editor/load,
   * preserve its id on save). Absent → CREATE a new chart from defaults. */
  editTarget?: EditTarget | null;
};

export function ChartEditorDialog({ open, onOpenChange, onSaved, editTarget }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" motion="none" className="grid gap-0 overflow-hidden p-0">
        {open ? (
          <EditorLoader
            onOpenChange={onOpenChange}
            onSaved={onSaved}
            editTarget={editTarget ?? null}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

// Loads the daemon-owned editor meta (enum catalogs + canonical defaults) before
// the form mounts, so the skin renders enums + seeds state from the daemon, not
// from hardcoded lists or the browser clock. In EDIT mode it ALSO loads the
// existing chart record (GET /api/editor/load) and seeds the form from it
// instead of the defaults. Remounted on every open via the `{open ? … : null}`
// gate, so a fresh load fires per open.
function EditorLoader({
  onOpenChange,
  onSaved,
  editTarget,
}: {
  onOpenChange: (open: boolean) => void;
  onSaved: (chartName: string, collectionPath: string, recordIndex: number | null) => void;
  editTarget: EditTarget | null;
}) {
  const t = useT();
  const [meta, setMeta] = React.useState<EditorMeta | null>(null);
  const [metaErr, setMetaErr] = React.useState<string | null>(null);
  // Edit mode: the loaded record + the collection it came from. In create mode
  // both stay null and the form seeds from meta.defaults.
  const [record, setRecord] = React.useState<EditorRecord | null>(null);
  const [recordCollection, setRecordCollection] = React.useState<string | null>(null);
  // Session-cursor mode (morin.py:14821) is fully self-contained: the daemon
  // already shipped the seed fields in editTarget.cursorSeed, so there is no
  // record fetch — the form is ready as soon as meta loads.
  const cursorMode = Boolean(editTarget?.cursorDocId && editTarget?.cursorSeed?.usesSessionCursor);
  const [recordLoaded, setRecordLoaded] = React.useState(!editTarget);

  React.useEffect(() => {
    const ctrl = new AbortController();
    fetchEditorMeta(ctrl.signal)
      .then(setMeta)
      .catch((err) => {
        if ((err as { name?: string }).name === "AbortError") return;
        setMetaErr(String((err as Error).message ?? err));
      });
    return () => ctrl.abort();
  }, []);

  React.useEffect(() => {
    if (!editTarget) return;
    const ctrl = new AbortController();
    const load = async () => {
      const awaitFlush: Promise<unknown>[] = [];
      window.dispatchEvent(new CustomEvent("aries://flush-notes", { detail: { awaitFlush } }));
      if (awaitFlush.length > 0) await Promise.allSettled(awaitFlush);
      if (cursorMode && editTarget.cursorSeed?.fields) {
        const note = await fetchNotes(
          editTarget.name,
          { documentId: editTarget.cursorDocId },
          ctrl.signal,
        );
        return {
          fields: { ...editTarget.cursorSeed.fields, notes: note.content ?? "" },
          collection: editTarget.source ?? "",
        };
      }
      return editTarget.radixDocId
        ? fetchEditorRadixSeed(editTarget.radixDocId, ctrl.signal)
        : fetchEditorRecord(editTarget.name, editTarget.source, ctrl.signal);
    };
    void load()
      .then((res) => {
        setRecord(res.fields);
        setRecordCollection(res.collection);
        setRecordLoaded(true);
        window.dispatchEvent(new CustomEvent("aries://notes-changed"));
      })
      .catch((err) => {
        if ((err as { name?: string }).name === "AbortError") return;
        setMetaErr(String((err as Error).message ?? err));
      });
    return () => ctrl.abort();
  }, [editTarget, cursorMode]);

  if (metaErr) {
    return (
      <div className="px-[var(--aries-pane-wide-inset)] py-[var(--aries-pane-state-padding)] text-[length:var(--aries-font-size-base)] text-destructive">
        {t("editor.loadError", { error: metaErr })}
      </div>
    );
  }
  if (!meta || !recordLoaded) {
    return (
      <div className="px-[var(--aries-pane-wide-inset)] py-[var(--aries-pane-state-padding)] text-[length:var(--aries-font-size-base)] text-foreground/55">{t("editor.loading")}</div>
    );
  }
  return (
    <EditorBody
      meta={meta}
      seed={record ?? (cursorMode ? editTarget?.cursorSeed?.fields : null) ?? meta.defaults}
      isEdit={Boolean(editTarget)}
      seedCollection={recordCollection}
      cursorDocId={cursorMode ? (editTarget?.cursorDocId ?? null) : null}
      radixDocId={cursorMode ? null : (editTarget?.radixDocId ?? null)}
      lockChartType={cursorMode ? Boolean(editTarget?.cursorSeed?.lockChartType) : false}
      timeContextHint={cursorMode ? (editTarget?.cursorSeed?.timeContextHint ?? "") : ""}
      onOpenChange={onOpenChange}
      onSaved={onSaved}
    />
  );
}

function EditorBody({
  meta,
  seed,
  isEdit,
  seedCollection,
  cursorDocId,
  radixDocId,
  lockChartType,
  timeContextHint,
  onOpenChange,
  onSaved,
}: {
  meta: EditorMeta;
  // The form seed — meta.defaults (CREATE), a loaded EditorRecord (EDIT), or
  // the daemon cursor seed (session-cursor mode).
  seed: EditorDefaults | EditorRecord;
  isEdit: boolean;
  // The collection the edited record was loaded from (EDIT) — preselected as
  // the save target so an overwrite stays in the same file. Null in CREATE.
  seedCollection: string | null;
  // Session-cursor mode (morin.py:14821): the document whose cursor chart we
  // edit. Non-null → submit applies to the cursor (no .jsonl save).
  cursorDocId: string | null;
  // The edited chart is OPEN as this radix document → submit applies IN PLACE
  // + auto-saves to its bound collection (wx onData), no close/reopen flash.
  radixDocId: string | null;
  // The Type combo is disabled when editing a transit/SR session cursor
  // (lock_chart_type, personaldatadlg.py:759).
  lockChartType: boolean;
  // Stepping-anchor hint shown above the form (set_time_context_hint,
  // personaldatadlg.py:748).
  timeContextHint: string;
  onOpenChange: (open: boolean) => void;
  onSaved: (chartName: string, collectionPath: string, recordIndex: number | null) => void;
}) {
  const t = useT();
  // Seeded once from the daemon (canonical defaults in CREATE, the loaded record
  // in EDIT — incl. its id, threaded through save so it overwrites); remounted
  // fresh on every open.
  const [s, setS] = React.useState<FormState>(() => stateFromDefaults(seed));
  const seedAutoCalendar = automaticCalendarForDate(
    stateFromDefaults(seed),
    meta.calendarAutoPolicy,
  );
  // An exceptional stored chart (its saved calendar differs from the ordinary
  // date-based choice) is already a manual override. New/conventional charts
  // stay automatic until the user touches the Calendar selector.
  const calendarManualOverrideRef = React.useRef(
    seedAutoCalendar === null || seed.cal !== seedAutoCalendar,
  );
  const set = React.useCallback(
    <K extends keyof FormState>(key: K, value: FormState[K]) =>
      setS((prev) => {
        const next: FormState = { ...prev, [key]: value };
        // Editing any DMS field drops that axis's authoritative decimal, so the
        // value reconstructs from deg/min/sec; an untouched map/search-pick keeps it.
        if (key === "lonDeg" || key === "lonMin" || key === "lonSec" || key === "east") next.lonDec = "";
        if (key === "latDeg" || key === "latMin" || key === "latSec" || key === "north") next.latDec = "";
        if (key === "bc" || key === "year" || key === "month" || key === "day") {
          next.cal = calendarAfterDateChange(
            next,
            meta.calendarAutoPolicy,
            next.cal,
            calendarManualOverrideRef.current,
          );
        }
        return next;
      }),
    [meta.calendarAutoPolicy],
  );

  const nameRef = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => {
    nameRef.current?.focus();
  }, []);

  // Collections (save target). Default to the main Hors collection.
  const [collections, setCollections] = React.useState<ChartCollection[]>([]);
  const [collectionPath, setCollectionPath] = React.useState<string>("");
  React.useEffect(() => {
    const ctrl = new AbortController();
    listCollections(ctrl.signal)
      .then((list) => {
        setCollections(list);
        // EDIT: preselect the collection the record came from so the overwrite
        // stays in the same file. CREATE: the default Hors collection.
        const editColl = seedCollection
          ? list.find((c) => c.path === seedCollection)
          : null;
        const def = editColl ?? list.find((c) => c.isDefault) ?? list[0];
        if (def) setCollectionPath(def.path);
      })
      .catch((err) => {
        if ((err as { name?: string }).name === "AbortError") return;
        console.error("[editor] collections", err);
      });
    return () => ctrl.abort();
  }, [seedCollection]);

  // -- City search → candidate list ---------------------------------------
  const [searching, setSearching] = React.useState(false);
  const [candidates, setCandidates] = React.useState<PlaceCandidate[] | null>(null);
  const [searchError, setSearchError] = React.useState<string | null>(null);

  // The daemon already returns each candidate in form-field shape (deg/min split,
  // E/W·N/S, capped name, altitude≥0, GMT offset, tzid — the
  // personaldatadlg._applyGeoPlace work, done server-side). The skin only assigns.
  const applyCandidate = React.useCallback((c: PlaceCandidate) => {
    setS((prev) => ({
      ...prev,
      placeSearch: c.label,
      place: c.name,
      lonDeg: String(c.lonDeg),
      lonMin: String(c.lonMin),
      lonSec: String(c.lonSec ?? 0),
      east: c.east,
      latDeg: String(c.latDeg),
      latMin: String(c.latMin),
      latSec: String(c.latSec ?? 0),
      north: c.north,
      // Keep the candidate's full-precision decimals authoritative so the pick
      // lands at the same accuracy as a map-pick (deg/min/sec are display).
      lonDec: c.lon != null ? String(c.lon) : "",
      latDec: c.lat != null ? String(c.lat) : "",
      altitude: String(c.altitude),
      plus: c.plus,
      zoneHour: String(c.zoneHour),
      zoneMin: String(c.zoneMin),
      tzid: c.tzid,
    }));
    setCandidates(null);
  }, []);

  const runSearch = React.useCallback(async () => {
    const q = s.placeSearch.trim();
    setSearchError(null);
    if (q.length < 3) {
      setSearchError(t("editor.searchMinChars"));
      return;
    }
    setSearching(true);
    setCandidates(null);
    try {
      const list = await resolvePlace(q);
      if (list.length === 0) {
        setSearchError(t("editor.searchNoResults"));
      } else if (list.length === 1) {
        applyCandidate(list[0]);
      } else {
        setCandidates(list);
      }
    } catch (err) {
      setSearchError(String((err as Error).message ?? err));
    } finally {
      setSearching(false);
    }
  }, [s.placeSearch, applyCandidate, t]);

  // -- Live preview (Asc/MC) ----------------------------------------------
  const [preview, setPreview] = React.useState<{ asc: number; mc: number } | null>(null);
  const [previewErr, setPreviewErr] = React.useState<string | null>(null);
  // Debounced build on field changes — purely informational.
  React.useEffect(() => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      editorBuild(toFields(s), ctrl.signal)
        .then((res) => {
          const ang = readAscMc(res.snapshot);
          setPreview(ang);
          setPreviewErr(ang ? null : null);
        })
        .catch((err) => {
          if ((err as { name?: string }).name === "AbortError") return;
          setPreview(null);
          // Surface the daemon's validation message (e.g. a bad date the
          // canonical chart.Time path rejects) instead of validating here.
          setPreviewErr(humanizeDaemonError(err));
        });
    }, 350);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [s]);

  // -- Save ----------------------------------------------------------------
  const [saving, setSaving] = React.useState(false);
  const [saveError, setSaveError] = React.useState<string | null>(null);

  const onSubmit = React.useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      setSaveError(null);
      const name = s.name.trim();
      if (!name) {
        setSaveError(t("editor.nameRequired"));
        nameRef.current?.focus();
        return;
      }
      // No client-side calendar/domain validation. The daemon's /api/editor/save
      // constructs the chart on the canonical chart.Time path, which rejects a
      // bad date with a 400 + readable message — surfaced below as saveError.
      setSaving(true);
      try {
        if (cursorDocId) {
          // Session-cursor edit (morin.py:14855): re-derive the cursor chart on
          // the canonical Binding -> Deriver -> Chart path; no .jsonl write. The
          // daemon broadcasts session.changed/documents.changed, so the open
          // child + its descendants repaint without a re-open dance.
          await editorApplyCursor(cursorDocId, toFields(s));
          window.dispatchEvent(new CustomEvent("aries://notes-changed"));
          onOpenChange(false);
        } else if (radixDocId) {
          // Editing the OPEN radix (wx onData, morin.py:14869): apply in place +
          // auto-save to the bound collection — the daemon swaps the new chart
          // into the live session and broadcasts session.changed, so the wheel
          // repaints WITHOUT a close/reopen flash. No collection picker, no
          // separate save step.
          await editorApply(radixDocId, toFields(s));
          window.dispatchEvent(new CustomEvent("aries://notes-changed"));
          onOpenChange(false);
        } else {
          const result = await editorSave({
            collection: collectionPath || null,
            record: toFields(s),
          });
          window.dispatchEvent(new CustomEvent("aries://notes-changed"));
          onSaved(name, result.collection || collectionPath, result.recordIndex ?? null);
          onOpenChange(false);
        }
      } catch (err) {
        setSaveError(humanizeDaemonError(err));
      } finally {
        setSaving(false);
      }
    },
    [s, collectionPath, cursorDocId, radixDocId, onSaved, onOpenChange, t],
  );

  const zoneIsZone = s.zt === "zone";
  // Manual zone fields disabled unless zone-type==Zone AND Auto is off
  // (syncAutoTimezone, personaldatadlg.py:481).
  const manualZoneDisabled = !zoneIsZone || s.tzauto;

  return (
    <form onSubmit={onSubmit} className="flex max-h-[var(--aries-dialog-viewport-height)] flex-col">
      <header className="flex items-baseline justify-between border-b border-border/40 px-[var(--aries-pane-wide-inset)] py-[var(--aries-dialog-section-padding-y)]">
        <h2 className="text-[length:var(--aries-font-size-large)] font-medium tracking-tight">
          {cursorDocId ? t("editor.titleCursor") : isEdit ? t("editor.titleEdit") : t("editor.titleNew")}
        </h2>
        <p className="text-[length:var(--aries-font-size-small)] text-foreground/55">{t("editor.personalData")}</p>
      </header>

      {/* Stepping-anchor hint — cursor-edit only (set_time_context_hint,
          personaldatadlg.py:748). Plain text; newlines from the daemon hint are
          preserved so the symbolic-time line shows under the real-cursor line. */}
      {cursorDocId && timeContextHint ? (
        <p className="whitespace-pre-line border-b border-border/40 bg-foreground/[0.03] px-[var(--aries-pane-wide-inset)] py-[var(--aries-pane-header-padding-y)] text-[length:var(--aries-font-size-small)] leading-snug text-foreground/65">
          {timeContextHint}
        </p>
      ) : null}

      <div className="grid min-h-0 flex-1 grid-cols-[1fr_var(--aries-form-aside-width)] gap-0 overflow-y-auto">
        {/* Left column — Name/Lot formula, Time, Place, Zone, Altitude */}
        <div className="flex flex-col gap-[var(--aries-form-section-gap)] border-r border-border/40 px-[var(--aries-pane-wide-inset)] py-[var(--aries-dialog-padding)]">
          {/* Group 1 — Name & Lot formula (personaldatadlg.py:60) */}
          <Group title={t("editor.groupIdentity")}>
            <Row label={t("editor.name")}>
              <input
                data-aries-control-appearance="local"
                ref={nameRef}
                value={s.name}
                onChange={(e) => set("name", e.target.value)}
                className={fieldCls("flex-1")}
                placeholder={t("editor.namePlaceholder")}
              />
            </Row>
            <Row label={t("editor.lotsCalculatedAs")}>
              <RadioPair
                value={s.male ? "m" : "f"}
                options={[
                  { value: "m", label: t("editor.male") },
                  { value: "f", label: t("editor.female") },
                ]}
                onChange={(v) => set("male", v === "m")}
              />
            </Row>
            <Row label={t("editor.type")}>
              <Select
                value={s.type}
                options={meta.chartTypes}
                onChange={(v) => set("type", v)}
                disabled={lockChartType}
              />
            </Row>
          </Group>

          {/* Group 2 — Time (personaldatadlg.py:101) */}
          <Group title={t("editor.groupTime")}>
            <Checkbox checked={s.bc} onChange={(v) => set("bc", v)} label={t("editor.bc")} />
            <div className="grid grid-cols-3 gap-x-[var(--aries-form-row-gap)] gap-y-[var(--aries-form-field-gap)]">
              <NumField label={t("editor.year")} value={s.year} maxLength={4} onChange={(v) => set("year", v)} />
              <NumField label={t("editor.month")} value={s.month} maxLength={2} onChange={(v) => set("month", v)} />
              <NumField label={t("editor.day")} value={s.day} maxLength={2} onChange={(v) => set("day", v)} />
              <NumField label={t("editor.hour")} value={s.hour} maxLength={2} onChange={(v) => set("hour", v)} />
              <NumField label={t("editor.min")} value={s.minute} maxLength={2} onChange={(v) => set("minute", v)} />
              <NumField label={t("editor.sec")} value={s.second} maxLength={2} onChange={(v) => set("second", v)} />
            </div>
          </Group>

          {/* Group 3 — Place (personaldatadlg.py:177) */}
          <Group title={t("editor.groupPlace")}>
            <div className="grid grid-cols-[auto_auto_auto_auto_auto] items-end gap-x-[var(--aries-form-row-gap)] gap-y-[var(--aries-form-field-gap)]">
              <span className="self-center text-[length:var(--aries-font-size-small)] text-foreground/55">{t("editor.long")}</span>
              <NumField label={t("editor.deg")} value={s.lonDeg} maxLength={3} onChange={(v) => set("lonDeg", v)} />
              <NumField label={t("editor.min")} value={s.lonMin} maxLength={2} onChange={(v) => set("lonMin", v)} />
              <NumField label={t("editor.sec")} value={s.lonSec} maxLength={2} onChange={(v) => set("lonSec", v)} />
              <RadioPair
                value={s.east ? "e" : "w"}
                options={[
                  { value: "e", label: t("editor.east") },
                  { value: "w", label: t("editor.west") },
                ]}
                onChange={(v) => set("east", v === "e")}
                inline
              />
              <span className="self-center text-[length:var(--aries-font-size-small)] text-foreground/55">{t("editor.lat")}</span>
              <NumField label={t("editor.deg")} value={s.latDeg} maxLength={2} onChange={(v) => set("latDeg", v)} />
              <NumField label={t("editor.min")} value={s.latMin} maxLength={2} onChange={(v) => set("latMin", v)} />
              <NumField label={t("editor.sec")} value={s.latSec} maxLength={2} onChange={(v) => set("latSec", v)} />
              <RadioPair
                value={s.north ? "n" : "s"}
                options={[
                  { value: "n", label: t("editor.north") },
                  { value: "s", label: t("editor.south") },
                ]}
                onChange={(v) => set("north", v === "n")}
                inline
              />
            </div>
            <div className="flex items-center gap-[var(--aries-form-field-gap)]">
              <input
                data-aries-control-appearance="local"
                value={s.placeSearch}
                onChange={(e) => set("placeSearch", e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void runSearch();
                  }
                }}
                className={fieldCls("flex-1")}
                placeholder={t("editor.searchCity")}
              />
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={searching}
                onClick={() => void runSearch()}
              >
                {searching ? t("editor.searching") : t("editor.search")}
              </Button>
            </div>
            {searchError ? (
              <p className="text-[length:var(--aries-font-size-small)] text-destructive">{searchError}</p>
            ) : null}
            {candidates ? (
              <ul className="max-h-40 overflow-y-auto rounded-md border border-border/40">
                {candidates.map((c, i) => (
                  <li key={`${c.label}-${i}`}>
                    <button
                      type="button"
                      onClick={() => applyCandidate(c)}
                      className="flex w-full flex-col items-start gap-[calc(var(--aries-control-gap-compact)/2)] px-[var(--aries-control-padding-x)] py-[var(--aries-control-gap)] text-left hover:bg-accent/60"
                    >
                      <span className="text-[length:var(--aries-font-size-base)] text-foreground">
                        {c.label}
                        {c.countryName ? `, ${c.countryName}` : ""}
                      </span>
                      <span className="text-[length:var(--aries-font-size-section)] tabular-nums text-foreground/55">
                        {c.latDeg}°{c.latMin}′{c.latSec ?? 0}″{c.north ? "N" : "S"},{" "}
                        {c.lonDeg}°{c.lonMin}′{c.lonSec ?? 0}″{c.east ? "E" : "W"}
                        {c.tzid ? ` · ${c.tzid}` : ""}
                        {` · ${c.altitude}m`}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </Group>

          {/* Group 4 — Zone (personaldatadlg.py:263) */}
          <Group title={t("editor.groupZone")}>
            <div className="flex flex-wrap items-end gap-[var(--aries-form-row-gap)]">
              <LabeledSelect
                label={t("editor.calendar")}
                value={s.cal}
                options={meta.calendars}
                onChange={(v) => {
                  calendarManualOverrideRef.current = true;
                  set("cal", v);
                }}
              />
              <LabeledSelect
                label={t("editor.zoneType")}
                value={s.zt}
                options={meta.zoneTypes}
                onChange={(v) => set("zt", v)}
              />
            </div>
            <div className="flex flex-wrap items-end gap-[var(--aries-form-row-gap)]">
              <div className="flex flex-col gap-[var(--aries-control-gap-compact)]">
                <FieldLabel>{t("editor.gmt")}</FieldLabel>
                <Select
                  value={s.plus ? "+" : "-"}
                  options={[
                    { value: "+", label: "+" },
                    { value: "-", label: "-" },
                  ]}
                  onChange={(v) => set("plus", v === "+")}
                  disabled={manualZoneDisabled}
                  className="w-16"
                />
              </div>
              <NumField
                label={t("editor.hour")}
                value={s.zoneHour}
                maxLength={2}
                onChange={(v) => set("zoneHour", v)}
                disabled={manualZoneDisabled}
              />
              <NumField
                label={t("editor.min")}
                value={s.zoneMin}
                maxLength={2}
                onChange={(v) => set("zoneMin", v)}
                disabled={manualZoneDisabled}
              />
            </div>
            <Checkbox
              checked={s.daylightSaving}
              onChange={(v) => set("daylightSaving", v)}
              label={t("editor.daylightSaving")}
              disabled={manualZoneDisabled}
            />
            <Checkbox
              checked={s.tzauto}
              onChange={(v) => set("tzauto", v)}
              label={t("editor.autoDstTz")}
              disabled={!zoneIsZone}
            />
            {s.tzauto && s.tzid ? (
              <p className="text-[length:var(--aries-font-size-section)] tabular-nums text-foreground/55">{s.tzid}</p>
            ) : null}
          </Group>

          {/* Group 5 — Altitude (personaldatadlg.py:311) */}
          <Group title={t("editor.groupAltitude")}>
            <Row label={t("editor.altitude")}>
              <input
                data-aries-control-appearance="local"
                inputMode="numeric"
                value={s.altitude}
                maxLength={5}
                onChange={(e) => set("altitude", e.target.value.replace(/[^\d]/g, ""))}
                className={fieldCls("w-20 tabular-nums")}
              />
              <span className="text-[length:var(--aries-font-size-small)] text-foreground/55">{t("editor.meters")}</span>
            </Row>
          </Group>
        </div>

        {/* Right column — Notes + live preview */}
        <div className="flex flex-col gap-[var(--aries-dialog-gap)] px-[var(--aries-dialog-padding)] py-[var(--aries-dialog-padding)]">
          <Group title={t("editor.groupNotes")} className="flex-1">
            <textarea
              data-aries-control-appearance="local"
              value={s.notes}
              onChange={(e) => set("notes", e.target.value)}
              className={fieldCls("min-h-32 flex-1 resize-none leading-snug")}
              placeholder={t("editor.notesPlaceholder")}
            />
          </Group>
          <div className="rounded-md border border-border/40 px-[var(--aries-pane-header-compact-padding-x)] py-[var(--aries-form-group-gap)]">
            <p className="text-[length:var(--aries-font-size-section)] font-medium text-foreground/45">
              {t("editor.preview")}
            </p>
            <dl className="mt-1.5 space-y-1 text-[length:var(--aries-font-size-small)]">
              <div className="flex justify-between">
                <dt className="text-foreground/55">{t("editor.asc")}</dt>
                <dd className="tabular-nums">
                  {preview ? preview.asc.toFixed(4) + "°" : previewErr ? "—" : "…"}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-foreground/55">{t("editor.mc")}</dt>
                <dd className="tabular-nums">
                  {preview ? preview.mc.toFixed(4) + "°" : previewErr ? "—" : "…"}
                </dd>
              </div>
            </dl>
            {previewErr ? (
              <p className="mt-2 text-[length:var(--aries-font-size-section)] leading-snug text-destructive">{previewErr}</p>
            ) : null}
          </div>
        </div>
      </div>

      <footer className="flex items-center justify-between gap-[var(--aries-form-row-gap)] border-t border-border/40 px-[var(--aries-pane-wide-inset)] py-[var(--aries-form-row-gap)]">
        {/* Cursor/radix edits target the open daemon document directly; only
            create-from-editor needs a collection target picker. */}
        {cursorDocId || radixDocId ? (
          <span className="text-[length:var(--aries-font-size-section)] font-medium text-foreground/45">
            {cursorDocId ? t("editor.sessionCursor") : t("editor.openChart")}
          </span>
        ) : (
          <div className="flex items-center gap-[var(--aries-form-field-gap)]">
            <label className="text-[length:var(--aries-font-size-section)] font-medium text-foreground/45">
              {t("editor.saveTo")}
            </label>
            <Select
              value={collectionPath}
              options={collections.map((c) => ({
                value: c.path,
                label: `${c.name} (${c.count})`,
              }))}
              onChange={setCollectionPath}
              className="w-44"
            />
          </div>
        )}
        <div className="flex items-center gap-[var(--aries-form-field-gap)]">
          {saveError ? (
            <span className="max-w-56 truncate text-[length:var(--aries-font-size-small)] text-destructive">{saveError}</span>
          ) : null}
          <Button type="button" variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            {t("editor.cancel")}
          </Button>
          <Button type="submit" size="sm" disabled={saving}>
            {saving ? (cursorDocId ? t("editor.applying") : t("editor.saving")) : cursorDocId ? t("editor.apply") : isEdit ? t("editor.save") : t("editor.create")}
          </Button>
        </div>
      </footer>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Read Asc/MC from the build snapshot for the live preview — primaryChart.angles
// (ChartAngles) is the canonical renderer field set; we read it, never derive.
// ---------------------------------------------------------------------------
function readAscMc(snapshot: ChartRenderSnapshot): { asc: number; mc: number } | null {
  const angles = snapshot.primaryChart?.angles;
  if (!angles) return null;
  const { asc, mc } = angles;
  if (typeof asc !== "number" || typeof mc !== "number") return null;
  if (!Number.isFinite(asc) || !Number.isFinite(mc)) return null;
  return { asc, mc };
}

// Pull the readable message out of a daemon error. The daemon validates (e.g.
// rejects a bad date on the canonical chart.Time path) and returns FastAPI's
// `{"detail": "..."}` 400; the client wraps it as `"… failed: 400 <body>"`. We
// extract the `detail` so the form shows the daemon's message, not a JSON blob —
// the skin never re-derives the validation itself.
function humanizeDaemonError(err: unknown): string {
  const raw = String((err as Error)?.message ?? err);
  const match = raw.match(/\{[\s\S]*\}\s*$/);
  if (match) {
    try {
      const parsed = JSON.parse(match[0]) as { detail?: unknown };
      if (typeof parsed.detail === "string" && parsed.detail.trim()) {
        return parsed.detail;
      }
    } catch {
      /* fall through to the raw message */
    }
  }
  return raw;
}

// ---------------------------------------------------------------------------
// Dense form primitives: hairline groups, compact labels, flat zones,
// tabular-nums numbers.
// ---------------------------------------------------------------------------

function fieldCls(extra = ""): string {
  return (
    "h-[var(--aries-control-height-small)] rounded-[var(--aries-radius-ui-control-compact)] border border-border/60 bg-transparent px-[var(--aries-control-padding-x-compact)] text-[length:var(--aries-font-size-base)] " +
    "outline-none transition-colors placeholder:text-foreground/35 " +
    "focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/40 " +
    "disabled:opacity-40 " +
    extra
  );
}

function Group({
  title,
  children,
  className = "",
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={"flex flex-col gap-[var(--aries-form-group-gap)] " + className}>
      <h3 className="text-[length:var(--aries-font-size-section)] font-medium text-foreground/45">
        {title}
      </h3>
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-[var(--aries-form-row-gap)]">
      <FieldLabel className="w-[var(--aries-form-label-width)] shrink-0">{label}</FieldLabel>
      <div className="flex flex-1 items-center gap-[var(--aries-form-field-gap)]">{children}</div>
    </div>
  );
}

function FieldLabel({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span className={"text-[length:var(--aries-font-size-small)] text-foreground/55 " + className}>{children}</span>
  );
}

function NumField({
  label,
  value,
  maxLength,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  maxLength: number;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <label className="flex flex-col gap-[var(--aries-control-gap-compact)]">
      <span className="text-[length:var(--aries-font-size-section)] text-foreground/45">{label}</span>
      <input
        data-aries-control-appearance="local"
        inputMode="numeric"
        value={value}
        maxLength={maxLength}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value.replace(/[^\d]/g, ""))}
        className={fieldCls("w-16 tabular-nums")}
      />
    </label>
  );
}

function Checkbox({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <label
      className={
        "flex w-fit items-center gap-[var(--aries-form-field-gap)] text-[length:var(--aries-font-size-base)] " +
        (disabled ? "opacity-40" : "cursor-pointer")
      }
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="size-[var(--aries-control-icon-size)] accent-primary"
      />
      {label}
    </label>
  );
}

function RadioPair({
  value,
  options,
  onChange,
  inline,
}: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
  inline?: boolean;
}) {
  return (
    <div className={inline ? "flex items-center gap-[var(--aries-form-row-gap)]" : "flex flex-col gap-[var(--aries-control-gap-compact)]"}>
      {options.map((opt) => (
        <label key={opt.value} className="flex cursor-pointer items-center gap-[var(--aries-control-gap)] text-[length:var(--aries-font-size-base)]">
          <input
            type="radio"
            checked={value === opt.value}
            onChange={() => onChange(opt.value)}
            className="size-[var(--aries-control-icon-size)] accent-primary"
          />
          {opt.label}
        </label>
      ))}
    </div>
  );
}

function Select({
  value,
  options,
  onChange,
  disabled,
  className = "",
}: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <select
      data-aries-control-appearance="local"
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className={fieldCls("cursor-pointer pr-1 " + className)}
    >
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}

function LabeledSelect({
  label,
  ...rest
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex flex-col gap-[var(--aries-control-gap-compact)]">
      <span className="text-[length:var(--aries-font-size-section)] text-foreground/45">{label}</span>
      <Select {...rest} className="w-32" />
    </label>
  );
}

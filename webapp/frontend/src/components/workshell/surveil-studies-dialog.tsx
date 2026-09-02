// SPDX-FileCopyrightText: Morinus contributors
// SPDX-FileCopyrightText: 2026 Max Lange (Aries modifications)
// SPDX-License-Identifier: GPL-3.0-or-later
// Modified for Aries in 2026 by Max Lange.

"use client";

import * as React from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  fetchDocumentSnapshot,
  fetchSurveilMarks,
  fetchSurveilStudies,
  surveilClearStudy,
  surveilCreateStudy,
  surveilOpenSource,
  surveilRemoveMark,
  surveilSetActiveStudy,
  surveilSetMarkEnabled,
  type SurveilMarkRow,
  type SurveilStudySummary,
} from "@/lib/daemon/client";
import { useDaemonWorkspaceView } from "@/stores/daemon-workspace-adapter";
import { useDaemonWorkspaceStore } from "@/stores/daemon-workspace-store";
import { useSurveilStore } from "@/stores/surveil-store";
import { useT } from "@/lib/i18n/i18n";

const NEW_STUDY = "__new__";

/**
 * Surveil Studies — the wx onSurveilStudies dialog (morin.py:1702-1834) ported
 * to a native shadcn Dialog. Meaning migrated: study selector, New study,
 * per-mark enable toggle, remove, clear, and the per-row "Open Radix" action.
 * The wx wx.Choice/wx.CheckListBox widget plumbing is superseded by native
 * controls; the store (surveil_service) is the only brain.
 *
 * After any mutation the active chart snapshot is re-fetched so the renderer's
 * surveil marks (snapshot.primaryChart.surveilMarks) redraw immediately — the
 * webapp analogue of the wx _invalidate_surveil_render_caches + drawBkg fan-out
 * (morin.py:1619-1641), which has no per-session render cache here.
 */
export function SurveilStudiesDialog() {
  const t = useT();
  const open = useSurveilStore((s) => s.studiesDialogOpen);
  const setOpen = useSurveilStore((s) => s.setStudiesDialogOpen);
  const { activeDocument } = useDaemonWorkspaceView();
  const activeDocumentId = activeDocument?.id ?? null;
  const pushSteppedSnapshot = useDaemonWorkspaceStore((s) => s.pushSteppedSnapshot);

  const [studies, setStudies] = React.useState<SurveilStudySummary[]>([]);
  const [activeStudy, setActiveStudy] = React.useState<string>("");
  const [marks, setMarks] = React.useState<SurveilMarkRow[]>([]);
  const [newName, setNewName] = React.useState<string>("");
  const [creating, setCreating] = React.useState(false);

  const refreshActiveChart = React.useCallback(async () => {
    if (!activeDocumentId) return;
    try {
      const snapshot = await fetchDocumentSnapshot(activeDocumentId);
      pushSteppedSnapshot(activeDocumentId, snapshot);
    } catch {
      // The store mutation already landed; a stale wheel self-heals on the next
      // snapshot GET. Don't block the dialog on a transient chart refresh error.
    }
  }, [activeDocumentId, pushSteppedSnapshot]);

  const reload = React.useCallback(
    async (study?: string, signal?: AbortSignal) => {
      const list = await fetchSurveilStudies(signal);
      setStudies(list.studies);
      const target = study ?? list.activeStudy;
      setActiveStudy(target);
      const marksPayload = await fetchSurveilMarks(target, signal);
      setMarks(marksPayload.marks);
    },
    [],
  );

  React.useEffect(() => {
    if (!open) return;
    const ctrl = new AbortController();
    // Reset transient new-study UI and load the store. setState lives inside the
    // async reload chain (a microtask), never synchronously in the effect body
    // (React 19 set-state-in-effect rule).
    void Promise.resolve()
      .then(() => {
        setCreating(false);
        setNewName("");
        return reload(undefined, ctrl.signal);
      })
      .catch((err) => {
        if ((err as { name?: string }).name === "AbortError") return;
        setStudies([]);
        setMarks([]);
      });
    return () => ctrl.abort();
  }, [open, reload]);

  const onSelectStudy = async (value: string) => {
    if (value === NEW_STUDY) {
      setCreating(true);
      return;
    }
    setCreating(false);
    await surveilSetActiveStudy(value);
    await reload(value);
    await refreshActiveChart();
  };

  const confirmNewStudy = async () => {
    const name = newName.trim();
    if (!name) return;
    await surveilCreateStudy(name);
    setNewName("");
    setCreating(false);
    await reload(name);
    await refreshActiveChart();
  };

  const onToggleEnabled = async (mark: SurveilMarkRow) => {
    await surveilSetMarkEnabled(activeStudy, mark.id, !mark.enabled);
    await reload(activeStudy);
    await refreshActiveChart();
  };

  const onRemove = async (mark: SurveilMarkRow) => {
    await surveilRemoveMark(activeStudy, mark.id);
    await reload(activeStudy);
    await refreshActiveChart();
  };

  const onClear = async () => {
    await surveilClearStudy(activeStudy);
    await reload(activeStudy);
    await refreshActiveChart();
  };

  const onOpenSource = async (mark: SurveilMarkRow) => {
    if (!mark.openable) return;
    await surveilOpenSource(mark.sourceRef ?? null, mark.sourceName ?? "");
    setOpen(false);
  };

  const hasMarks = marks.length > 0;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>{t("studies.title")}</DialogTitle>
          <DialogDescription>
            {t("studies.description")}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-[var(--aries-form-row-gap)] py-[var(--aries-control-padding-y)]">
          <label className="flex flex-col gap-[var(--aries-control-gap-compact)] text-[length:var(--aries-font-size-small)] text-[color:var(--aries-text-primary)]">
            <span className="text-[color:var(--aries-text-muted)]">{t("studies.study")}</span>
            <select
              data-aries-control-appearance="local"
              value={creating ? NEW_STUDY : activeStudy}
              onChange={(e) => void onSelectStudy(e.currentTarget.value)}
              className="rounded-[var(--aries-radius-control-compact)] border border-[color:var(--aries-border-subtle)] bg-[color:var(--aries-surface)] px-[var(--aries-control-padding-x-compact)] py-[var(--aries-control-gap)] text-[color:var(--aries-text-primary)] outline-none focus:border-[color:var(--aries-focus-ring)]"
            >
              {studies.map((study) => (
                <option key={study.name} value={study.name}>
                  {study.name} ({study.enabledCount}/{study.count})
                </option>
              ))}
              <option value={NEW_STUDY}>{t("studies.newStudy")}</option>
            </select>
          </label>
          {creating ? (
            <label className="flex flex-col gap-[var(--aries-control-gap-compact)] text-[length:var(--aries-font-size-small)]">
              <span className="text-[color:var(--aries-text-muted)]">{t("studies.newStudyName")}</span>
              <div className="flex gap-[var(--aries-form-field-gap)]">
                <input
                  data-aries-control-appearance="local"
                  value={newName}
                  placeholder={t("studies.newStudyPlaceholder")}
                  autoFocus
                  onChange={(e) => setNewName(e.currentTarget.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void confirmNewStudy();
                    }
                  }}
                  className="flex-1 rounded-[var(--aries-radius-control-compact)] border border-[color:var(--aries-border-subtle)] bg-transparent px-[var(--aries-control-padding-x-compact)] py-[var(--aries-control-gap)] text-[color:var(--aries-text-primary)] outline-none focus:border-[color:var(--aries-focus-ring)]"
                />
                <Button disabled={!newName.trim()} onClick={() => void confirmNewStudy()}>
                  {t("studies.add")}
                </Button>
              </div>
            </label>
          ) : null}

          <div className="max-h-64 overflow-y-auto rounded border border-[color:var(--aries-border-subtle)]">
            {hasMarks ? (
              <ul className="divide-y divide-[color:var(--aries-border-subtle)]">
                {marks.map((mark) => (
                  <li
                    key={mark.id}
                    className="flex items-center gap-2 px-2 py-1.5 text-[length:var(--aries-font-size-small)]"
                  >
                    <input
                      type="checkbox"
                      checked={mark.enabled}
                      onChange={() => void onToggleEnabled(mark)}
                      aria-label={t("studies.enableMark", { label: mark.displayLabel })}
                    />
                    <span className="flex-1 truncate text-[color:var(--aries-text-primary)]">
                      {mark.displayLabel}
                    </span>
                    <button
                      type="button"
                      disabled={!mark.openable}
                      onClick={() => void onOpenSource(mark)}
                      className="rounded px-1.5 py-0.5 text-[color:var(--aries-text-muted)] hover:text-[color:var(--aries-text-primary)] disabled:opacity-40"
                      title={mark.openable ? t("studies.openSourceEnabled") : t("studies.openSourceDisabled")}
                    >
                      {t("studies.openRadix")}
                    </button>
                    <button
                      type="button"
                      onClick={() => void onRemove(mark)}
                      className="rounded px-1.5 py-0.5 text-[color:var(--aries-text-muted)] hover:text-[color:var(--aries-text-primary)]"
                      title={t("studies.removeMark")}
                    >
                      {t("studies.remove")}
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-2 py-4 text-center text-[length:var(--aries-font-size-small)] text-[color:var(--aries-text-muted)]">
                {t("studies.empty")}
              </p>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" disabled={!hasMarks} onClick={() => void onClear()}>
            {t("studies.clearStudy")}
          </Button>
          <Button onClick={() => setOpen(false)}>{t("studies.close")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

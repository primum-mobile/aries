// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { ArrowRightToLine, ChevronLeft, ChevronRight, CircleQuestionMark, MousePointer2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { workspaceOpenWalkthroughChart, type WorkspaceManifest } from "@/lib/daemon/client";
import { useLocale, useT, useTFallback } from "@/lib/i18n/i18n";
import { formatShortcutKeys, useAppleShortcuts, useShortcutModifierLabels } from "@/lib/shortcut-display";
import { resolveShellHost } from "@/lib/shell-host";
import { TOUR_ROW_LABELS, URANIA_STEPS, pressedKeyToken, tourShortcutEntries, tourShortcutParts, uraniaIllustration, type UraniaIllustration, type UraniaStep } from "@/lib/urania-tour";
import { runImmediateWorkspaceCommand } from "@/stores/daemon-workspace-adapter";
import { useDraggableOverlay } from "@/hooks/use-draggable-overlay";
import { useLicenseStateStore } from "@/stores/license-state-store";
import { useUraniaTourStore } from "@/stores/urania-tour-store";
import { collectShortcutRows } from "./help-dialog";
import { tourModalOpen, useTourGeometry, visibleTourElements } from "./urania-tour-geometry";
import styles from "./urania-walkthrough.module.css";

export function UraniaWalkthrough({ ready, manifest, docked }: {
  ready: boolean;
  manifest: WorkspaceManifest | null;
  /** Desktop: a draggable card starting at the lower right. Touch: a card under the title bar. */
  docked: boolean;
}) {
  const step = useUraniaTourStore((state) => state.step);
  const offered = useUraniaTourStore((state) => state.offered);
  const license = useLicenseStateStore((state) => state.status);

  React.useEffect(() => {
    if (!ready || offered) return;
    if (resolveShellHost().kind === "tauri" &&
      (!license || (license.required && !["active", "grace"].includes(license.state)))) return;
    let timer = 0;
    const offerWhenClear = () => {
      if (tourModalOpen()) {
        window.clearTimeout(timer);
        timer = 0;
        return;
      }
      if (timer) return;
      timer = window.setTimeout(() => {
        timer = 0;
        if (!tourModalOpen()) {
          void useUraniaTourStore.getState().offer(() =>
            runImmediateWorkspaceCommand(workspaceOpenWalkthroughChart()),
          ).catch((error) => console.error("[walkthrough-chart]", error));
        }
      }, 1200);
    };
    // Licensing, update offers and other startup dialogs keep precedence.
    const observer = new MutationObserver(offerWhenClear);
    observer.observe(document.body, {
      childList: true, subtree: true, attributes: true,
      attributeFilter: ["data-open", "data-closed", "aria-hidden"],
    });
    offerWhenClear();
    return () => { window.clearTimeout(timer); observer.disconnect(); };
  }, [license, offered, ready]);

  return step === null ? null : (
    <ActiveTour stepIndex={step} manifest={manifest} docked={docked} />
  );
}

function ActiveTour({ stepIndex, manifest, docked }: {
  stepIndex: number;
  manifest: WorkspaceManifest | null;
  docked: boolean;
}) {
  const showCharacter = useLocale() === "ja";
  const t = useT();
  const tf = useTFallback();
  const apple = useAppleShortcuts();
  const modifiers = useShortcutModifierLabels();
  const step = URANIA_STEPS[stepIndex];
  const geometry = useTourGeometry(step);
  const {
    overlayRef: guide,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handlePointerCancel,
    handleLostPointerCapture,
    handleDoubleClick,
  } = useDraggableOverlay({
    anchored: !docked,
    inset: 8,
    // The whole card is a handle; only its controls keep their own clicks.
    isBlockedTarget: (target) =>
      !(target instanceof Element) ||
      target.closest('button, a, input, select, textarea, [contenteditable="true"]') !== null,
  });
  const focusRequested = useUraniaTourStore((state) => state.focusRequested);
  const allRows = collectShortcutRows(manifest, tf, apple);
  const rowsFor = (id: UraniaStep["id"]) => tourShortcutEntries(id, manifest).flatMap((entry) => {
    const row = allRows.find(({ keys, actionId }) =>
      keys === entry.keys && actionId === (entry.commandId ?? entry.labelKey),
    );
    if (!row) return [];
    const briefKey = row.actionId ? TOUR_ROW_LABELS[row.actionId] : undefined;
    return [{ ...row, action: briefKey ? t(briefKey) : row.action }];
  });

  React.useEffect(() => {
    if (!focusRequested || !geometry.measured || geometry.paused) return;
    guide.current?.querySelector<HTMLButtonElement>('[data-urania-next]')?.focus({ preventScroll: true });
    useUraniaTourStore.getState().focusHandled();
  }, [focusRequested, geometry.measured, geometry.paused, guide]);

  React.useEffect(() => {
    // Light the keycaps the user is pressing. DOM attributes only: holding an
    // arrow to step the chart must not re-render the guide.
    const pressed = new Set<string>();
    const paint = (token: string, on: boolean) => {
      guide.current?.querySelectorAll<HTMLElement>(`kbd[data-key="${CSS.escape(token)}"]`).forEach((cap) => {
        if (on) cap.setAttribute("data-pressed", "");
        else cap.removeAttribute("data-pressed");
      });
    };
    const clear = () => {
      pressed.forEach((token) => paint(token, false));
      pressed.clear();
    };
    const down = (event: KeyboardEvent) => {
      const token = pressedKeyToken(event, apple);
      if (!token || pressed.has(token)) return;
      pressed.add(token);
      paint(token, true);
    };
    const up = (event: KeyboardEvent) => {
      // macOS sends no keyup for keys released while ⌘ is held.
      if (event.key === "Meta") return clear();
      const token = pressedKeyToken(event, apple);
      if (!token) return;
      pressed.delete(token);
      paint(token, false);
    };
    window.addEventListener("keydown", down, true);
    window.addEventListener("keyup", up, true);
    window.addEventListener("blur", clear);
    return () => {
      window.removeEventListener("keydown", down, true);
      window.removeEventListener("keyup", up, true);
      window.removeEventListener("blur", clear);
    };
  }, [apple, guide]);

  React.useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || tourModalOpen()) return;
      // Let a context menu consume Escape before dismissing the guide.
      if (visibleTourElements('[role="menu"], [role="listbox"]').length) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const returnFocus = document.activeElement?.closest('[data-urania-overlay]');
      useUraniaTourStore.getState().dismiss();
      if (returnFocus) document.querySelector<HTMLElement>('[data-workspace-focus-anchor]')?.focus({ preventScroll: true });
    };
    window.addEventListener("keydown", escape, true);
    return () => window.removeEventListener("keydown", escape, true);
  }, []);

  const act = (event: React.MouseEvent<HTMLButtonElement>, action: "back" | "next" | "dismiss" | number) => {
    const keyboard = event.detail === 0;
    const tour = useUraniaTourStore.getState();
    if (typeof action === "number") {
      // A chapter dot: the dot itself keeps keyboard focus across the jump.
      tour.go(action);
      if (!keyboard) event.currentTarget.blur();
      return;
    }
    tour[action]();
    // Mouse navigation leaves chart shortcuts usable immediately. Keyboard
    // navigation keeps focus in the tour until it is dismissed.
    if (!keyboard) event.currentTarget.blur();
    if (useUraniaTourStore.getState().step === null && keyboard) {
      document.querySelector<HTMLElement>('[data-workspace-focus-anchor]')?.focus({ preventScroll: true });
    } else if (keyboard) {
      guide.current?.querySelector<HTMLButtonElement>('[data-urania-next]')?.focus({ preventScroll: true });
    }
  };

  const hidden = geometry.paused || !geometry.measured;
  const rows = rowsFor(step.id);
  const illustration = uraniaIllustration(step);
  const card = (
    <div
      ref={guide}
      className={[
        styles.guide,
        showCharacter ? styles.guideWithCharacter : "",
        docked ? styles.guideDocked : "",
      ].filter(Boolean).join(" ")}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onLostPointerCapture={handleLostPointerCapture}
      onDoubleClick={handleDoubleClick}
    >
      {showCharacter ? (
        <div key={step.id} className={styles.character} aria-hidden="true">
          <div className={styles.pose} data-pose={step.pose} />
        </div>
      ) : null}
      <section
        className={styles.bubble}
        role="dialog"
        aria-modal="false"
        aria-label={t("urania.title")}
        onKeyDown={(event) => event.stopPropagation()}
      >
        <div className={styles.speech}>
          <p className="sr-only" aria-live="polite" aria-atomic="true">
            {t(step.title)}. {t(step.body)}
          </p>
          {/* Only the active step renders: the card is sized by it and, anchored
              at its bottom edge, grows upward so the buttons stay put. */}
          <div className={styles.heading}>
            <h2>{t(step.title)}</h2>
            {/* One dot per chapter: the current one is long, visited ones keep
                the signal tint, and each jumps to its chapter. */}
            <div className={styles.progress} role="group" aria-label={t("urania.progress", { current: stepIndex + 1, total: URANIA_STEPS.length })}>
              {URANIA_STEPS.map((chapter, index) => (
                <button
                  key={chapter.id}
                  type="button"
                  className={styles.dot}
                  data-visited={index < stepIndex ? "" : undefined}
                  aria-current={index === stepIndex ? "step" : undefined}
                  aria-label={t(chapter.title)}
                  title={t(chapter.title)}
                  onClick={(event) => act(event, index)}
                />
              ))}
            </div>
          </div>
          <div className={styles.copyRow}>
            <p className={styles.copy}>{t(step.body)}</p>
            {illustration ? <StepSketch illustration={illustration} /> : null}
          </div>
          {rows.length > 0 ? (
            <dl className={styles.shortcuts}>
              {rows.map((row) => (
                <div key={row.keys}>
                  <dt>
                    {tourShortcutParts(row.keys).map(({ key, separator }, partIndex) => (
                      <React.Fragment key={partIndex}>
                        {separator && <span>{separator}</span>}
                        <kbd className="aries-help-kbd" data-key={key === "⇥" ? "Tab" : key}>
                          {key === "Tab" || key === "⇥" ? (
                            <><span aria-hidden="true">⇥</span>{t("help.key.tab")}</>
                          ) : key === "Space" ? t("help.key.space") : (
                            formatShortcutKeys(key, apple, modifiers)
                          )}
                        </kbd>
                      </React.Fragment>
                    ))}
                  </dt>
                  <dd>{row.action}</dd>
                </div>
              ))}
            </dl>
          ) : null}
        </div>
        <div className={styles.controls}>
          <Button type="button" variant="ghost" size="sm" onClick={(event) => act(event, "dismiss")}>{t("urania.skip")}</Button>
          <div>
            {stepIndex > 0 ? <Button type="button" variant="ghost" size="sm" onClick={(event) => act(event, "back")}>{t("urania.back")}</Button> : null}
            <Button data-urania-next="" type="button" size="sm" onClick={(event) => act(event, "next")}>
              {t(stepIndex === URANIA_STEPS.length - 1 ? "urania.done" : "urania.next")}
            </Button>
          </div>
        </div>
      </section>
    </div>
  );

  const area = geometry.area;
  // One portal, two fixed layers in paint order: the washes sit below menus
  // and popovers (z 44); the card layer sits above them and above the chart's
  // navigation bar (z 70), below context menus (z 100). Modal dialogs pause
  // the tour, which hides both layers.
  return createPortal(
    <div data-urania-overlay="" className={styles.tour} style={{ visibility: hidden ? "hidden" : "visible" }}>
      <div className={styles.overlay}>
        {/* Keyed by the step it was measured for, so each step's washes
            arrive with one short pulse that draws the eye to them. */}
        {(geometry.stepId === step.id ? geometry.rects : []).map((rect, index) => (
          <div key={`${geometry.stepId}:${index}`} className={styles.wash} style={rect} aria-hidden="true" />
        ))}
      </div>
      {/* Desktop: the card layer covers exactly the main area, which is the
          card's start corner and its drag bounds (the hook clamps to the
          card's parent). Touch: the whole window, card under the title bar. */}
      <div
        className={docked ? `${styles.cardLayer} ${styles.dock}` : styles.cardLayer}
        style={docked && area ? { ...area, right: "auto", bottom: "auto" } : undefined}
      >
        {card}
      </div>
    </div>,
    document.body,
  );
}

/** One micro-diagram per step on a 96 x 64 canvas: theme tokens only, no text. */
function StepSketch({ illustration }: { illustration: UraniaIllustration }) {
  return (
    <svg className={styles.sketch} viewBox="0 0 96 64" aria-hidden="true" focusable="false">
      {SKETCHES[illustration]()}
    </svg>
  );
}

const delay = (seconds: number) => ({ animationDelay: `${seconds}s` });

const SKETCHES: Record<UraniaIllustration, () => React.ReactNode> = {
  // A window: sidebar, chart, right pane, lit in turn.
  areas: () => <>
    <rect className={styles.sketchMenu} x="2" y="4" width="92" height="56" rx="6" />
    <path className={styles.sketchLine} d="M2 15 H94" />
    {[6, 28, 72].map((x, index) => (
      <rect key={x} className={`${styles.sketchHighlight} ${styles.sketchFlash}`} style={delay(index * 0.35)}
        x={x} y="19" width={x === 28 ? 40 : 18} height="37" rx="3" />
    ))}
    <rect className={styles.sketchBar} x="9" y="24" width="12" height="3" rx="1.5" />
    <rect className={styles.sketchBar} x="9" y="31" width="9" height="3" rx="1.5" />
    <circle className={styles.sketchLine} cx="48" cy="37.5" r="13" />
    <rect className={styles.sketchBar} x="75" y="24" width="12" height="3" rx="1.5" />
    <rect className={styles.sketchBar} x="75" y="31" width="10" height="3" rx="1.5" />
  </>,
  contextMenu: () => <ContextMenuSketch />,
  // Tab swaps the wheel for its table view.
  viewSwap: () => <>
    <rect className={styles.sketchMenu} x="2" y="22" width="26" height="20" rx="4" />
    <ArrowRightToLine className={styles.sketchIcon} x="7" y="24" size={16} />
    <rect className={styles.sketchMenu} x="48" y="4" width="44" height="40" rx="4" />
    {[12, 20, 28].map((y) => <rect key={y} className={styles.sketchBar} x="54" y={y} width="32" height="3" rx="1.5" />)}
    <g className={styles.sketchSlide}>
      <rect className={styles.sketchMenu} x="38" y="18" width="44" height="42" rx="4" />
      <circle className={styles.sketchLine} cx="60" cy="39" r="14" />
    </g>
  </>,
  // R, T, D keys: one pressed opens the right pane.
  techniqueKeys: () => <>
    {[4, 22, 40].map((x) => (
      <rect key={x} className={x === 22 ? styles.sketchSignal : styles.sketchMenu} x={x} y="25" width="14" height="14" rx="3" />
    ))}
    <g className={styles.sketchSlide} style={delay(0.2)}>
      <rect className={styles.sketchMenu} x="62" y="4" width="32" height="56" rx="4" />
      {[12, 20, 28].map((y) => <rect key={y} className={styles.sketchBar} x="67" y={y} width={y === 20 ? 16 : 22} height="3" rx="1.5" />)}
    </g>
  </>,
  // The navigation bar at the chart's bottom edge steps a planet along.
  timeSteps: () => <>
    <circle className={styles.sketchLine} cx="48" cy="26" r="20" />
    <g className={styles.sketchOrbit}><circle className={styles.sketchSignal} cx="62" cy="12" r="3" /></g>
    <rect className={styles.sketchMenu} x="22" y="48" width="52" height="14" rx="7" />
    <ChevronLeft className={styles.sketchIcon} x="26" y="49" size={12} />
    <rect className={styles.sketchBar} x="40" y="54" width="16" height="2" rx="1" />
    <ChevronRight className={styles.sketchIcon} x="58" y="49" size={12} />
  </>,
  // Hovering a planet fills the Inspector at the right.
  hoverInspect: () => <>
    <circle className={styles.sketchLine} cx="24" cy="34" r="20" />
    <circle className={styles.sketchSignal} cx="30" cy="22" r="2.5" />
    <circle className={styles.sketchRing} cx="30" cy="22" r="6" />
    <path className={styles.sketchRing} d="M36 22 H58" />
    <MousePointer2 className={styles.sketchIcon} x="29" y="24" size={14} />
    <rect className={styles.sketchMenu} x="58" y="8" width="34" height="48" rx="4" />
    {[16, 26, 36].map((y, index) => (
      <rect key={y} className={`${styles.sketchBar} ${styles.sketchFlash}`} style={delay(0.3 + index * 0.2)}
        x="63" y={y} width={index === 1 ? 18 : 24} height="4" rx="2" />
    ))}
  </>,
  // The Help menu drops down from the menu bar.
  helpMenu: () => <>
    <rect className={styles.sketchMenu} x="2" y="4" width="92" height="12" rx="3" />
    {[8, 26].map((x) => <rect key={x} className={styles.sketchBar} x={x} y="8.5" width="12" height="3" rx="1.5" />)}
    <rect className={styles.sketchHighlight} x="42" y="6" width="20" height="8" rx="2" />
    <rect className={styles.sketchSignal} x="46" y="8.5" width="12" height="3" rx="1.5" />
    <g className={styles.sketchDrop}>
      <rect className={styles.sketchMenu} x="42" y="19" width="40" height="30" rx="4" />
      <rect className={styles.sketchBar} x="47" y="26" width="28" height="3" rx="1.5" />
      <rect className={styles.sketchBar} x="47" y="37" width="22" height="3" rx="1.5" />
    </g>
    <CircleQuestionMark className={styles.sketchIcon} x="6" y="30" size={24} />
  </>,
};

/** A right-click on a mouse opening a small menu. */
function ContextMenuSketch() {
  return (
    <>
      <rect className={styles.sketchLine} x="4" y="14" width="20" height="32" rx="10" />
      <path className={styles.sketchSignal} d="M14 14 A10 10 0 0 1 24 24 V28 H14 Z" />
      <path className={styles.sketchLine} d="M14 14 V28 M4 28 H24" />
      <rect className={styles.sketchMenu} x="32" y="4" width="60" height="56" rx="6" />
      <rect className={styles.sketchBar} x="40" y="13" width="34" height="4" rx="2" />
      <rect className={styles.sketchHighlight} x="35" y="22" width="54" height="12" rx="3" />
      <rect className={styles.sketchSignal} x="40" y="26" width="40" height="4" rx="2" />
      <rect className={styles.sketchBar} x="40" y="39" width="28" height="4" rx="2" />
      <rect className={styles.sketchBar} x="40" y="50" width="36" height="4" rx="2" />
    </>
  );
}

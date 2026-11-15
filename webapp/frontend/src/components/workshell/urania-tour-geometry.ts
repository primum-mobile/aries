// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import * as React from "react";
import { clampTourRect, type TourRect, type UraniaStep } from "@/lib/urania-tour";

export function visibleTourElements(selector: string): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(selector)).filter((element) =>
    !element.closest('[hidden], [inert], [aria-hidden="true"]') &&
    element.getClientRects().length > 0 &&
    getComputedStyle(element).visibility !== "hidden",
  );
}

export function tourModalOpen(): boolean {
  return visibleTourElements('[role="dialog"], [role="alertdialog"]')
    .some((element) => !element.closest('[data-urania-overlay]'));
}

/** The main area (SidebarInset): the docked card's start corner and drag bounds. */
const MAIN_AREA = '[data-slot="sidebar-inset"]';

/** Observers exist only while the tour is visible; no idle layout work. */
export function useTourGeometry(step: UraniaStep) {
  const [geometry, setGeometry] = React.useState<{
    stepId: UraniaStep["id"] | null; rects: TourRect[]; area: TourRect | null; paused: boolean; measured: boolean;
  }>({ stepId: null, rects: [], area: null, paused: false, measured: false });

  React.useEffect(() => {
    let frame = 0;
    let observed: Element[] = [];
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    const resize = new ResizeObserver(schedule);
    const measure = () => {
      frame = 0;
      const width = document.documentElement.clientWidth;
      const height = window.innerHeight;
      const clip = (element: HTMLElement) => clampTourRect(element.getBoundingClientRect(), width, height);
      let targets = [...new Set(step.targets.flatMap((selector) => visibleTourElements(selector)))];
      targets = targets.filter((element) => clip(element) !== null);
      if (!targets.length) targets = visibleTourElements(step.fallback).filter((element) => clip(element) !== null);
      const rects = targets.flatMap((element) => {
        const rect = clip(element);
        return rect ? [rect] : [];
      });
      const main = document.querySelector<HTMLElement>(MAIN_AREA);
      const mainRect = main?.getBoundingClientRect();
      const area = mainRect
        ? { left: mainRect.left, top: mainRect.top, width: mainRect.width, height: mainRect.height }
        : null;
      const nextObserved = [...targets, ...(main ? [main] : []), document.documentElement];
      if (nextObserved.length !== observed.length || nextObserved.some((element, index) => element !== observed[index])) {
        resize.disconnect();
        nextObserved.forEach((element) => resize.observe(element));
        observed = nextObserved;
      }
      const next = { stepId: step.id, rects, area, paused: tourModalOpen(), measured: true };
      setGeometry((previous) => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
    };
    const mutations = new MutationObserver((records) => {
      // The tour's own measurements and live announcements must not schedule
      // another measurement; chart/pane changes may replace the target nodes.
      if (records.some((record) => !(record.target instanceof Element) || !record.target.closest('[data-urania-overlay]'))) schedule();
    });
    mutations.observe(document.body, {
      childList: true, subtree: true, attributes: true,
      attributeFilter: ["aria-hidden", "data-state", "data-open", "data-closed", "data-right-pane-module"],
    });
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    document.addEventListener("transitionend", schedule);
    schedule();
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      mutations.disconnect();
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
      document.removeEventListener("transitionend", schedule);
    };
  }, [step]);
  return geometry;
}

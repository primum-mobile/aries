// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import * as React from "react";
import { ChevronUp } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n/i18n";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { useContentFitPanel } from "./content-fit-panel";

/**
 * Controls/results split; the results panel stays mounted when controls
 * close. The controls panel fits its content: it opens to all of it (capped to
 * whole lines that leave the results their minimum), never grows past it, and
 * its sash settles on whole lines. Drawer height is not persisted; `autoSaveId`
 * names the panel group. `onCloseControls` adds a close bar at the drawer's
 * bottom edge, beside the sash, so a tall drawer closes without reaching back
 * to its header button.
 */
export function ListPaneSplit({
  autoSaveId,
  label,
  controls,
  controlsClassName = "px-[var(--aries-pane-header-padding-x)] py-[var(--aries-pane-header-padding-y)]",
  onCloseControls,
  children,
}: {
  autoSaveId: string;
  label: string;
  controls?: React.ReactNode;
  controlsClassName?: string;
  onCloseControls?: () => void;
  children: React.ReactNode;
}) {
  const {
    panelRef: fitPanelRef,
    contentRef: fitContentRef,
    footerRef: fitFooterRef,
    handleProps: fitHandleProps,
    minSize: fitMinSize,
    maxSize: fitMaxSize,
    resultsMinSize: fitResultsMinSize,
  } = useContentFitPanel(Boolean(controls));
  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <ResizablePanelGroup
        id={autoSaveId}
        direction="vertical"
        className="min-h-0 min-w-0"
      >
        {controls ? (
          <React.Fragment key="controls">
            <ResizablePanel
              ref={fitPanelRef}
              id="list-controls"
              order={1}
              defaultSize={40}
              minSize={fitMinSize ?? 10}
              maxSize={fitMaxSize}
              className="min-h-0 min-w-0"
            >
              <div className="flex h-full min-h-0 flex-col">
                <div className="aries-list-scroller min-h-0 flex-1 overflow-auto">
                  <div ref={fitContentRef} className={controlsClassName}>{controls}</div>
                </div>
                {onCloseControls ? <DrawerCloseBar ref={fitFooterRef} onClose={onCloseControls} /> : null}
              </div>
            </ResizablePanel>
            <ResizableHandle aria-label={label} {...fitHandleProps} />
          </React.Fragment>
        ) : null}
        <ResizablePanel
          key="results"
          id="list-results"
          order={2}
          defaultSize={60}
          minSize={fitResultsMinSize ?? 20}
          className="min-h-0 min-w-0"
        >
          <div className="flex h-full min-h-0 flex-col">{children}</div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}

/** Close row pinned under a filter drawer's scroller, right above its sash. */
export function DrawerCloseBar({ ref, onClose }: { ref?: React.Ref<HTMLDivElement>; onClose: () => void }) {
  const t = useT();
  return (
    <div ref={ref} className="flex shrink-0 justify-end px-[var(--aries-pane-header-padding-x)] pb-[var(--aries-control-gap-compact)]">
      <Button type="button" size="xs" variant="ghost" onClick={onClose}>
        <ChevronUp className="size-[var(--aries-control-icon-size)]" />
        {t("search.closeFilters")}
      </Button>
    </div>
  );
}

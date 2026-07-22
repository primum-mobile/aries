"use client";

import * as React from "react";

import * as ResizablePrimitive from "react-resizable-panels";

import { cn } from "@/lib/utils";

function ResizablePanelGroup({
  className,
  ...props
}: React.ComponentProps<typeof ResizablePrimitive.PanelGroup>) {
  return (
    <ResizablePrimitive.PanelGroup
      data-slot="resizable-panel-group"
      className={cn(
        "flex h-full w-full data-[panel-group-direction=vertical]:flex-col",
        className,
      )}
      {...props}
    />
  );
}

function ResizablePanel({
  ...props
}: React.ComponentProps<typeof ResizablePrimitive.Panel>) {
  return <ResizablePrimitive.Panel data-slot="resizable-panel" {...props} />;
}

/**
 * Handle-less hairline resize sash.
 *
 * Mirrors the wx splitter idiom SetSashInvisible(True) + SetSashSize(1)
 * (workspace_shell.py:6107,6111): NO grip dots, NO GripVertical. The user
 * drags the panel border directly. A ~6px hit zone (the `after` pseudo) shows
 * cursor:col-resize / row-resize; the visible divider is the 1px element itself
 * (border/40), brightening to `border` on hover and while dragging.
 *
 * `withHandle` is accepted for source/API compatibility but intentionally
 * ignored — there is no handle in this design.
 */
function ResizableHandle({
  className,
  ...rest
}: React.ComponentProps<typeof ResizablePrimitive.PanelResizeHandle> & {
  withHandle?: boolean;
}) {
  // `withHandle` is part of the API for call-site compatibility but there is no
  // handle in this design — strip it so it never reaches the DOM element.
  const { withHandle: _withHandle, ...props } = rest;
  void _withHandle;
  return (
    <ResizablePrimitive.PanelResizeHandle
      data-slot="resizable-handle"
      className={cn(
        // 1px hairline divider (the element itself). Horizontal group: a
        // vertical 1px column; vertical group: a horizontal 1px row.
        "relative bg-[color:var(--aries-sash-panel-idle-color)] transition-colors",
        "w-[var(--aries-sash-rule-size)] data-[panel-group-direction=vertical]:h-[var(--aries-sash-rule-size)] data-[panel-group-direction=vertical]:w-full",
        // 6px hit zone straddling the hairline, cursor only (no visible mark).
        "after:absolute after:inset-y-0 after:left-1/2 after:w-1.5 after:-translate-x-1/2 after:cursor-col-resize after:content-['']",
        "data-[panel-group-direction=vertical]:after:inset-x-0 data-[panel-group-direction=vertical]:after:left-0 data-[panel-group-direction=vertical]:after:top-1/2 data-[panel-group-direction=vertical]:after:h-1.5 data-[panel-group-direction=vertical]:after:w-full data-[panel-group-direction=vertical]:after:-translate-y-1/2 data-[panel-group-direction=vertical]:after:translate-x-0 data-[panel-group-direction=vertical]:after:cursor-row-resize",
        // Brighten on hover and while dragging.
        "hover:bg-[color:var(--aries-sash-panel-hover-color)] data-[resize-handle-state=drag]:bg-[color:var(--aries-sash-panel-active-color)]",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        className,
      )}
      {...props}
    />
  );
}

export { ResizablePanelGroup, ResizablePanel, ResizableHandle };

// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import * as React from "react";

export type OverlayOffset = Readonly<{
  x: number;
  y: number;
}>;

type OverlayRect = Readonly<{
  left: number;
  right: number;
  top: number;
  bottom: number;
}>;

export type OverlayDragBounds = Readonly<{
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}>;

type ActiveOverlayDrag = Readonly<{
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startOffset: OverlayOffset;
  bounds: OverlayDragBounds;
}>;

type UseDraggableOverlayOptions = Readonly<{
  disabled?: boolean;
  inset?: number;
  resetKey?: string;
  isBlockedTarget?: (target: EventTarget | null) => boolean;
  onInteraction?: () => void;
  onPositionSettled?: (
    element: HTMLDivElement,
    offset: OverlayOffset,
  ) => void;
}>;

const ZERO_OFFSET: OverlayOffset = Object.freeze({ x: 0, y: 0 });

function clamp(value: number, minimum: number, maximum: number): number {
  if (minimum > maximum) return (minimum + maximum) / 2;
  return Math.min(maximum, Math.max(minimum, value));
}

export function overlayDragBounds(
  offset: OverlayOffset,
  overlayRect: OverlayRect,
  containerRect: OverlayRect,
  inset = 8,
): OverlayDragBounds {
  return {
    minX: offset.x + containerRect.left + inset - overlayRect.left,
    maxX: offset.x + containerRect.right - inset - overlayRect.right,
    minY: offset.y + containerRect.top + inset - overlayRect.top,
    maxY: offset.y + containerRect.bottom - inset - overlayRect.bottom,
  };
}

export function clampOverlayOffset(
  offset: OverlayOffset,
  bounds: OverlayDragBounds,
): OverlayOffset {
  return {
    x: clamp(offset.x, bounds.minX, bounds.maxX),
    y: clamp(offset.y, bounds.minY, bounds.maxY),
  };
}

/**
 * Moves an absolutely positioned overlay without putting pointermove traffic
 * through React state. Pointer capture owns the drag burst; animation frames
 * write only the native translation, while the rendered component and all of
 * its controls stay untouched for the entire interaction.
 */
export function useDraggableOverlay({
  disabled = false,
  inset = 8,
  resetKey = "",
  isBlockedTarget,
  onInteraction,
  onPositionSettled,
}: UseDraggableOverlayOptions = {}) {
  const overlayRef = React.useRef<HTMLDivElement | null>(null);
  const offsetRef = React.useRef<OverlayOffset>(ZERO_OFFSET);
  const pendingOffsetRef = React.useRef<OverlayOffset | null>(null);
  const activeDragRef = React.useRef<ActiveOverlayDrag | null>(null);
  const animationFrameRef = React.useRef<number | null>(null);

  const applyOffset = React.useCallback((offset: OverlayOffset) => {
    offsetRef.current = offset;
    const element = overlayRef.current;
    if (!element) return;
    element.style.translate = `${offset.x}px ${offset.y}px`;
  }, []);

  const flushPendingOffset = React.useCallback(() => {
    if (animationFrameRef.current !== null) {
      window.cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    const pending = pendingOffsetRef.current;
    pendingOffsetRef.current = null;
    if (pending) applyOffset(pending);
  }, [applyOffset]);

  const scheduleOffset = React.useCallback((offset: OverlayOffset) => {
    pendingOffsetRef.current = offset;
    if (animationFrameRef.current !== null) return;
    animationFrameRef.current = window.requestAnimationFrame(() => {
      animationFrameRef.current = null;
      const pending = pendingOffsetRef.current;
      pendingOffsetRef.current = null;
      if (pending) applyOffset(pending);
    });
  }, [applyOffset]);

  const resetPosition = React.useCallback(() => {
    pendingOffsetRef.current = null;
    if (animationFrameRef.current !== null) {
      window.cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    applyOffset(ZERO_OFFSET);
    const element = overlayRef.current;
    if (element) onPositionSettled?.(element, ZERO_OFFSET);
  }, [applyOffset, onPositionSettled]);

  const finishDrag = React.useCallback((
    pointerId: number,
    element: HTMLDivElement,
    releaseCapture: boolean,
  ) => {
    const activeDrag = activeDragRef.current;
    if (!activeDrag || activeDrag.pointerId !== pointerId) return;
    flushPendingOffset();
    activeDragRef.current = null;
    onPositionSettled?.(element, offsetRef.current);
    element.style.removeProperty("will-change");
    element.style.removeProperty("cursor");
    if (!releaseCapture || !element.hasPointerCapture(pointerId)) return;
    try {
      element.releasePointerCapture(pointerId);
    } catch {
      // The browser may have already released capture on cancellation.
    }
  }, [flushPendingOffset, onPositionSettled]);

  const handlePointerDown = React.useCallback((
    event: React.PointerEvent<HTMLDivElement>,
  ) => {
    if (
      disabled ||
      event.button !== 0 ||
      !event.isPrimary ||
      isBlockedTarget?.(event.target)
    ) {
      return;
    }
    flushPendingOffset();
    const element = event.currentTarget;
    const container = element.parentElement;
    if (!container) return;
    const startOffset = offsetRef.current;
    activeDragRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startOffset,
      bounds: overlayDragBounds(
        startOffset,
        element.getBoundingClientRect(),
        container.getBoundingClientRect(),
        inset,
      ),
    };
    element.style.willChange = "translate";
    element.style.cursor = "grabbing";
    onInteraction?.();
    try {
      element.setPointerCapture(event.pointerId);
    } catch {
      // Synthetic test events may not represent a capturable pointer.
    }
  }, [disabled, flushPendingOffset, inset, isBlockedTarget, onInteraction]);

  const handlePointerMove = React.useCallback((
    event: React.PointerEvent<HTMLDivElement>,
  ) => {
    const activeDrag = activeDragRef.current;
    if (!activeDrag || activeDrag.pointerId !== event.pointerId) return;
    event.preventDefault();
    scheduleOffset(clampOverlayOffset({
      x: activeDrag.startOffset.x + event.clientX - activeDrag.startClientX,
      y: activeDrag.startOffset.y + event.clientY - activeDrag.startClientY,
    }, activeDrag.bounds));
  }, [scheduleOffset]);

  const handlePointerUp = React.useCallback((
    event: React.PointerEvent<HTMLDivElement>,
  ) => {
    finishDrag(event.pointerId, event.currentTarget, true);
  }, [finishDrag]);

  const handlePointerCancel = React.useCallback((
    event: React.PointerEvent<HTMLDivElement>,
  ) => {
    finishDrag(event.pointerId, event.currentTarget, true);
  }, [finishDrag]);

  const handleLostPointerCapture = React.useCallback((
    event: React.PointerEvent<HTMLDivElement>,
  ) => {
    finishDrag(event.pointerId, event.currentTarget, false);
  }, [finishDrag]);

  const handleDoubleClick = React.useCallback((
    event: React.MouseEvent<HTMLDivElement>,
  ) => {
    if (disabled || isBlockedTarget?.(event.target)) return;
    event.preventDefault();
    onInteraction?.();
    resetPosition();
  }, [disabled, isBlockedTarget, onInteraction, resetPosition]);

  React.useEffect(() => {
    resetPosition();
  }, [resetKey, resetPosition]);

  React.useEffect(() => {
    const element = overlayRef.current;
    const container = element?.parentElement;
    if (!element || !container) return;

    const keepInsideContainer = () => {
      if (activeDragRef.current) return;
      const current = offsetRef.current;
      const next = clampOverlayOffset(
        current,
        overlayDragBounds(
          current,
          element.getBoundingClientRect(),
          container.getBoundingClientRect(),
          inset,
        ),
      );
      if (next.x !== current.x || next.y !== current.y) applyOffset(next);
      onPositionSettled?.(element, offsetRef.current);
    };

    const observer = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(keepInsideContainer);
    observer?.observe(element);
    observer?.observe(container);
    window.addEventListener("resize", keepInsideContainer);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", keepInsideContainer);
    };
  }, [applyOffset, inset, onPositionSettled]);

  React.useEffect(() => () => {
    if (animationFrameRef.current !== null) {
      window.cancelAnimationFrame(animationFrameRef.current);
    }
  }, []);

  return {
    overlayRef,
    resetPosition,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handlePointerCancel,
    handleLostPointerCapture,
    handleDoubleClick,
  };
}

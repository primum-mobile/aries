// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import * as React from "react";

export function captureSidebarTabDragPreview(source: HTMLElement): HTMLElement {
  const copy = source.cloneNode(true) as HTMLElement;
  const originals = [source, ...source.querySelectorAll<HTMLElement | SVGElement>("*")];
  const copies = [copy, ...copy.querySelectorAll<HTMLElement | SVGElement>("*")];

  // The overlay lives outside the sidebar. Freeze its inherited styles and
  // hover state so the actual tab, including its ellipsis, travels unchanged.
  originals.forEach((element, index) => {
    const style = window.getComputedStyle(element);
    const target = copies[index];
    for (let propertyIndex = 0; propertyIndex < style.length; propertyIndex++) {
      const property = style.item(propertyIndex);
      target.style.setProperty(property, style.getPropertyValue(property));
    }
    target.style.transition = "none";
    target.style.animation = "none";
    target.removeAttribute("id");
    target.removeAttribute("aria-describedby");
  });

  const rect = source.getBoundingClientRect();
  copy.style.boxSizing = "border-box";
  copy.style.width = `${rect.width}px`;
  copy.style.height = `${rect.height}px`;
  return copy;
}

export function SidebarTabDragPreview({ snapshot }: { snapshot: HTMLElement }) {
  const hostRef = React.useRef<HTMLDivElement>(null);
  React.useLayoutEffect(() => {
    const host = hostRef.current;
    host?.replaceChildren(snapshot);
    return () => host?.replaceChildren();
  }, [snapshot]);

  return (
    <div
      ref={hostRef}
      aria-hidden="true"
      inert
      className="pointer-events-none"
      style={{ opacity: "var(--aries-sidebar-drag-opacity)" }}
    />
  );
}

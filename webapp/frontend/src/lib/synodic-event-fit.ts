// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

export function observeSynodicEventFit(table: HTMLTableElement | null) {
  const viewport = table?.parentElement;
  if (!table || !viewport) return;

  const fit = () => {
    delete table.dataset.compactEvents;
    if (!table.querySelector('[data-synodic-event-label="short"]')) return;
    const style = getComputedStyle(viewport);
    const available = viewport.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    if (table.getBoundingClientRect().width > available + 0.5) {
      table.dataset.compactEvents = "true";
    }
  };
  fit();
  const resize = new ResizeObserver(fit);
  resize.observe(viewport);
  resize.observe(table);
  // A compact table can remain the same width when its virtual rows change.
  const rows = new MutationObserver(() => {
    if (table.dataset.compactEvents) fit();
  });
  rows.observe(table, { childList: true, characterData: true, subtree: true });
  document.fonts.addEventListener("loadingdone", fit);
  return () => {
    resize.disconnect();
    rows.disconnect();
    document.fonts.removeEventListener("loadingdone", fit);
  };
}

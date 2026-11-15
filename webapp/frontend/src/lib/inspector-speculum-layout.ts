// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

type SpeculumFitOptions = {
  angleColumns: readonly string[];
  onFit: (available: number, required: number) => void;
};

/** Fit the native table against its actual content box, including current fonts. */
export function observeInspectorSpeculumFit(
  container: HTMLElement,
  table: HTMLTableElement,
  options?: SpeculumFitOptions,
) {
  const viewport = table.parentElement ?? container;
  const setAngle = (column: string, precision: "seconds" | "minutes" | "degrees") => {
    if (!options) {
      container.dataset[`${column}Precision`] = precision;
      return;
    }
    for (const variant of table.querySelectorAll<HTMLElement>(
      `[data-speculum-angle="${CSS.escape(column)}"] > [data-speculum-variant]`,
    )) {
      variant.hidden = variant.dataset.speculumVariant !== precision;
    }
  };
  const angleColumns = options?.angleColumns ?? ["lat", "ra", "decl", "lon"];
  // Daily speed's seconds are as redundant as a coordinate's; longitude, the
  // column read most, keeps its seconds longest. Speed has no degree form and
  // is container state in both modes (`data-speed-precision`).
  const secondsColumns = angleColumns.includes("lon")
    ? [...angleColumns.filter((column) => column !== "lon"), "speed", "lon"]
    : [...angleColumns, "speed"];
  const setPrecision = (column: string, precision: "seconds" | "minutes" | "degrees") => {
    if (column === "speed") container.dataset.speedPrecision = precision;
    else setAngle(column, precision);
  };
  const fit = () => {
    container.dataset.fitHeadings = "false";
    container.dataset.hyphenateNames = "false";
    container.dataset.wrapSpeed = "false";
    for (const column of secondsColumns) setPrecision(column, "seconds");
    // The table's own viewport is the hard edge. The section's outer padding,
    // borders and any native scrollbar gutter are not usable column space.
    const style = getComputedStyle(viewport);
    const available = viewport.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    const overflows = () => table.getBoundingClientRect().width > available + 0.5;
    if (overflows()) container.dataset.fitHeadings = "true";
    // Seconds are the most redundant information, so they go before any word
    // breaks, one column at a time so a few pixels of overflow never strip
    // every column at once.
    for (const column of secondsColumns) {
      if (!overflows()) break;
      setPrecision(column, "minutes");
    }
    // Then speed values break and words hyphenate, before any minutes are lost.
    if (overflows()) container.dataset.wrapSpeed = "true";
    if (overflows()) container.dataset.hyphenateNames = "true";
    for (const column of angleColumns) {
      if (!overflows()) break;
      setAngle(column, "degrees");
    }
    options?.onFit(available, table.getBoundingClientRect().width);
  };
  fit();
  const observer = new ResizeObserver(fit);
  observer.observe(container);
  if (viewport !== container) observer.observe(viewport);
  observer.observe(table);
  document.fonts.addEventListener("loadingdone", fit);
  return () => {
    observer.disconnect();
    document.fonts.removeEventListener("loadingdone", fit);
  };
}

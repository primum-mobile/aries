// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

// Polyline decimation to the pixel (M4): inside one device-pixel column only
// the first, lowest, highest and last points can change what is painted, so a
// zoomed-out curve sends at most four points per column to the canvas while
// keeping every column's exact vertical extent.

export type PathSink = {
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
};

/** Streaming M4 path: feed points in increasing x; columns are
 * `columnsPerPx` per CSS px (the device pixel ratio for device columns). */
export class DecimatedPath {
  private column = Number.NaN;
  private count = 0;
  private fx = 0;
  private fy = 0;
  private minX = 0;
  private minY = 0;
  private minAt = 0;
  private maxX = 0;
  private maxY = 0;
  private maxAt = 0;
  private lx = 0;
  private ly = 0;
  private emittedX = Number.NaN;
  private emittedY = Number.NaN;
  private open = false;

  constructor(
    private readonly sink: PathSink,
    private readonly columnsPerPx: number,
  ) {}

  /** Start a new subpath (pen up, then down at x, y). */
  moveTo(x: number, y: number): void {
    this.flush();
    this.sink.moveTo(x, y);
    this.emittedX = x;
    this.emittedY = y;
    this.open = true;
    this.column = Math.floor(x * this.columnsPerPx);
    this.count = 0;
  }

  lineTo(x: number, y: number): void {
    if (!this.open) {
      this.moveTo(x, y);
      return;
    }
    const column = Math.floor(x * this.columnsPerPx);
    if (column !== this.column || this.count === 0) {
      if (column !== this.column) this.flush();
      this.column = column;
      this.count = 1;
      this.fx = this.minX = this.maxX = this.lx = x;
      this.fy = this.minY = this.maxY = this.ly = y;
      this.minAt = this.maxAt = 0;
      return;
    }
    const at = this.count++;
    if (y < this.minY) {
      this.minX = x;
      this.minY = y;
      this.minAt = at;
    }
    if (y > this.maxY) {
      this.maxX = x;
      this.maxY = y;
      this.maxAt = at;
    }
    this.lx = x;
    this.ly = y;
  }

  /** Emit the pending column (first, extremes in order, last). */
  flush(): void {
    if (this.count === 0) return;
    this.emit(this.fx, this.fy);
    if (this.count > 1) {
      const minFirst = this.minAt <= this.maxAt;
      if (minFirst) {
        this.emit(this.minX, this.minY);
        this.emit(this.maxX, this.maxY);
      } else {
        this.emit(this.maxX, this.maxY);
        this.emit(this.minX, this.minY);
      }
      this.emit(this.lx, this.ly);
    }
    this.count = 0;
  }

  /** Flush and close the subpath. */
  end(): void {
    this.flush();
    this.open = false;
  }

  private emit(x: number, y: number): void {
    if (x === this.emittedX && y === this.emittedY) return;
    this.sink.lineTo(x, y);
    this.emittedX = x;
    this.emittedY = y;
  }
}

/** Decimate one polyline (pure form, for tests and benchmarks). */
export function decimatePolyline(
  xs: ArrayLike<number>,
  ys: ArrayLike<number>,
  columnsPerPx: number,
): { xs: number[]; ys: number[] } {
  const outX: number[] = [];
  const outY: number[] = [];
  const sink: PathSink = {
    moveTo: (x, y) => {
      outX.push(x);
      outY.push(y);
    },
    lineTo: (x, y) => {
      outX.push(x);
      outY.push(y);
    },
  };
  const path = new DecimatedPath(sink, columnsPerPx);
  for (let i = 0; i < xs.length; i++) {
    if (i === 0) path.moveTo(xs[i], ys[i]);
    else path.lineTo(xs[i], ys[i]);
  }
  path.end();
  return { xs: outX, ys: outY };
}

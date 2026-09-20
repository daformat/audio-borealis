/*
 * The hills: one translucent curve per band, standing over the lobes.
 */

import { BAND_COUNT } from "./config.js";
import { bell, TAU } from "./math.js";
import type { BorealisFrame, Curve } from "./types.js";

/** The half width of the ceiling the hills stand under, in points at the app's size. */
export const CEILING_HALF_WIDTH = 170;
/** The height of that ceiling, in points at the app's size. */
export const CEILING_HEIGHT = 64;
/** How much of the width the soft layers' masks reach across. */
export const RANGE_WIDTH = 0.75;

/**
 * Of `count` hills, where the `index`th rests: the center-most first, the
 * rest alternating outward, the outermost at `span`.
 */
export const curveOffset = (
  index: number,
  count: number,
  span: number,
): number => {
  if (count < 2) {
    return 0;
  }
  const slots: number[] = [];
  for (let i = 0; i < count; i++) {
    slots.push(-span + (2 * span * i) / (count - 1));
  }
  slots.sort((a, b) => Math.abs(a) - Math.abs(b) || a - b);
  return slots[Math.min(index, count - 1)] ?? 0;
};

/** The band the `index`th of `count` hills stands on, low to high across them. */
export const curveBand = (index: number, count: number): number =>
  count < 2 ? 0 : Math.round((index * (BAND_COUNT - 1)) / (count - 1));

/**
 * The hills of `frame` over a box `width` by `height` px, `scaleX` and
 * `scaleY` the painter's scales, each sampled at `samples` steps across the
 * width. A point is `[x, y]`, x from the left edge and y the height above the
 * bottom edge.
 */
export const curves = (
  frame: BorealisFrame,
  width: number,
  height: number,
  scaleX: number,
  scaleY: number,
  samples = 40,
): Curve[] => {
  const c = frame.config;
  const ceiling = Math.min(
    height * c.curveCeiling,
    (CEILING_HEIGHT * frame.height + frame.lift) * c.curvePosition * scaleY,
  );
  const base = (c.curveOffset + c.curveBase * frame.bend) * scaleY;
  const steps = Math.max(1, samples);
  const count = Math.max(0, Math.floor(c.curveCount));
  const out: Curve[] = [];
  for (let k = 0; k < count; k++) {
    const b = Math.min(curveBand(k, count), frame.bands.length - 1);
    const apex = ceiling * (0.15 + 0.85 * (frame.bands[b] ?? 0));
    const offset = curveOffset(k, count, c.curveSpan);
    const wander = c.curveWander * Math.sin(TAU * frame.flow + k * 1.7);
    const center = width * (0.5 + offset + wander);
    const share =
      c.curveSpan > 0 ? Math.min(1, Math.abs(offset) / c.curveSpan) : 0;
    const half = Math.max(
      1,
      width *
        (c.curveWidthCentre + (c.curveWidthEdge - c.curveWidthCentre) * share),
    );
    const points: Curve = [];
    for (let i = 0; i <= steps; i++) {
      const x = (width * i) / steps;
      const t = Math.max(-1, Math.min(1, (x - center) / half));
      points.push([x, base + apex * bell(t, c.curveShape, c.curveSpread, 0)]);
    }
    out.push(points);
  }
  return out;
};

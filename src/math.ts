/*
 * The arithmetic the driver and the painter share. Every function is pure and
 * every number is the Subtitles app's.
 */

import type { Rgb } from "./types.js";

export const TAU = Math.PI * 2;

export const clamp01 = (value: number): number =>
  value < 0 ? 0 : value > 1 ? 1 : value;

/** `value` folded into `0..span`, negative values included. */
export const wrap = (value: number, span: number): number => {
  const m = value % span;
  return m < 0 ? m + span : m;
};

/** `x` folded into `-span/2..span/2`. */
export const wrapX = (x: number, span: number): number =>
  wrap(x + span / 2, span) - span / 2;

/**
 * A lobe's height near the wrap, 1 in the middle of the span and 0 at either
 * edge and beyond, so a lobe leaving one side is gone before it comes back on
 * the other.
 */
export const edgeEnvelope = (x: number, span: number): number => {
  const t = x / (span / 2 + 4);
  return Math.max(0, 1 - t * t);
};

/** 0 at a whole phase, 1 at a half, and back: a cosine, not a triangle. */
export const pingPong = (phase: number): number =>
  (1 - Math.cos(TAU * phase)) / 2;

/**
 * A noise gate then a soft saturation, so a shout rounds off instead of
 * clipping: nothing below `threshold`, and above it `1 - e^(-3t)` scaled to
 * end at 1.
 */
export const shape = (raw: number, threshold: number): number => {
  if (raw <= threshold) {
    return 0;
  }
  const t = (raw - threshold) / Math.max(0.001, 1 - threshold);
  return clamp01((1 - Math.exp(-3 * t)) / (1 - Math.exp(-3)));
};

/**
 * A one-pole follower: fast up on `attack`, slow down on `release`, both in
 * seconds, over a step of `dt` seconds.
 */
export const follow = (
  previous: number,
  target: number,
  dt: number,
  attack: number,
  release: number,
): number => {
  const tau = target > previous ? attack : release;
  return (
    previous + (target - previous) * (1 - Math.exp(-dt / Math.max(0.001, tau)))
  );
};

/**
 * A hill over `t` in -1..1: 1 at the center and exactly 0 at both ends, its
 * profile `p` (2 is a Gaussian bell, higher is flatter on top), its width
 * `sigma`, and `skew` leaning it to one side.
 */
export const bell = (
  t: number,
  p: number,
  sigma: number,
  skew: number,
): number => {
  const side = t < 0 ? 1 - skew : 1 + skew;
  const s = Math.max(0.05, sigma * side);
  const v = Math.exp(-Math.pow(Math.abs(t) / s, p));
  const tail = Math.exp(-Math.pow(1 / s, p));
  return Math.max(0, (v - tail) / (1 - tail));
};

/** Hue, saturation and brightness, each in 0..1, to sRGB channels in 0..1. */
export const hsbToRgb = (h: number, s: number, v: number): Rgb => {
  const sector = h * 6;
  const i = Math.floor(sector) % 6;
  const f = sector - Math.floor(sector);
  const p = v * (1 - s);
  const q = v * (1 - s * f);
  const t = v * (1 - s * (1 - f));
  const sectors: Rgb[] = [
    [v, t, p],
    [q, v, p],
    [p, v, t],
    [p, q, v],
    [t, p, v],
    [v, p, q],
  ];
  return sectors[i] ?? [v, t, p];
};

/** A color as the `rgba()` string a canvas takes, `alpha` to three places. */
export const rgba = (rgb: Rgb, alpha: number): string =>
  `rgba(${Math.round(rgb[0] * 255)}, ${Math.round(rgb[1] * 255)}, ${Math.round(rgb[2] * 255)}, ${alpha.toFixed(3)})`;

/** A number in 0..1 from two integers, the same one every time: no state. */
export const hash = (n: number, k: number): number => {
  const x = Math.sin(n * 127.1 + k * 311.7) * 43758.5453;
  return x - Math.floor(x);
};

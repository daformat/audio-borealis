/*
 * The driver: a loudness in, a frame out.
 *
 * A line-for-line port of the Subtitles app's AudioBorealis driver. The
 * loudness is gained, gated and rounded off, scaled to its own running peak
 * so a quiet voice fills the box as a loud one does, and followed with a fast
 * attack and a slow release. The bands go through the same, each on its own.
 * The rise that comes out is what everything else is scaled by, and the lobes
 * slide sideways in proportion to it.
 */

import { BAND_COUNT, BASE_GAIN, defaults, LOBE_SPAN, LOBES } from "./config.js";
import {
  clamp01,
  edgeEnvelope,
  follow,
  pingPong,
  shape,
  TAU,
  wrap,
  wrapX,
} from "./math.js";
import type { BorealisConfig, BorealisFrame, Levels } from "./types.js";

/** What the driver carries from one step to the next. */
export type DriverState = {
  level: number;
  bands: number[];
  levelPeak: number;
  bandPeak: number;
  phase: number;
  time: number;
};

export type Driver = {
  /** The knobs. Change them in place, or through `applyLook` and friends. */
  readonly config: BorealisConfig;
  /** The followed levels and the clocks, for a readout. */
  readonly state: Readonly<DriverState>;
  /** One step of `dt` seconds on what the source read. */
  step: (dt: number, levels: Levels) => BorealisFrame;
  /** Back to silence: every level and clock at 0. */
  reset: () => void;
};

/** A driver over `config`, the app's defaults when none is given. */
export const createDriver = (config: BorealisConfig = defaults()): Driver => {
  const s: DriverState = {
    level: 0,
    bands: new Array<number>(BAND_COUNT).fill(0),
    levelPeak: 0,
    bandPeak: 0,
    phase: 0,
    time: 0,
  };

  const reset = () => {
    s.level = 0;
    s.bands.fill(0);
    s.levelPeak = 0;
    s.bandPeak = 0;
    s.phase = 0;
    s.time = 0;
  };

  const step = (dt: number, levels: Levels): BorealisFrame => {
    s.time += dt;
    const c = config;
    const n = BAND_COUNT;
    const rawLevel = levels.loudness * BASE_GAIN * c.sensitivity;

    // The bands as read, or, without a reading, five shaped out of the
    // loudness with a wobble each, so a plain level still moves them apart.
    const rawBands = new Array<number>(n);
    const input = levels.bands;
    if (input && input.length === n) {
      for (let b = 0; b < n; b++) {
        rawBands[b] = input[b] ?? 0;
      }
    } else {
      const raw = clamp01(rawLevel);
      for (let b = 0; b < n; b++) {
        const wobble = Math.sin(s.time * (7.3 + 3.1 * b) + b * 1.9);
        rawBands[b] = raw * (0.55 + 0.45 * wobble) * (1 - 0.12 * b);
      }
    }

    let target = shape(rawLevel, c.threshold);
    const targets = new Array<number>(n);
    const gate = c.threshold * 0.6;
    for (let b = 0; b < n; b++) {
      targets[b] = clamp01(
        ((rawBands[b] ?? 0) - gate) / Math.max(0.001, 1 - gate),
      );
    }

    if (c.autoGain) {
      const decay = Math.exp(-dt / Math.max(0.05, c.autoGainRelease));
      const floor = Math.max(0.01, Math.min(1, c.autoGainFloor));
      s.levelPeak = Math.max(target, s.levelPeak * decay, floor);
      target = Math.min(1, target / s.levelPeak);
      s.bandPeak = Math.max(...targets, s.bandPeak * decay, floor);
      for (let b = 0; b < n; b++) {
        targets[b] = Math.min(1, (targets[b] ?? 0) / s.bandPeak);
      }
    }

    s.level = follow(s.level, target, dt, c.attack, c.release);
    for (let b = 0; b < n; b++) {
      s.bands[b] = follow(
        s.bands[b] ?? 0,
        targets[b] ?? 0,
        dt,
        c.attack,
        c.release * 1.15,
      );
    }

    const breathe = 0.5 + 0.5 * Math.sin((TAU * s.time) / c.breatheDuration);
    const effective = s.level + (1 - s.level) * c.idle * breathe;
    const rise = Math.pow(clamp01(effective), Math.max(0.1, c.curve));

    const span = LOBE_SPAN * c.lobeSpacing;
    if (c.flow !== 0) {
      s.phase = wrap(s.phase + c.flow * rise * dt, span);
    }
    const lobeX: number[] = [];
    const lobeAmplitude: number[] = [];
    for (const lobe of LOBES) {
      const x = wrapX(lobe.x * c.lobeSpacing + s.phase, span);
      lobeX.push(x);
      const band = s.bands[Math.min(lobe.band, n - 1)] ?? 0;
      lobeAmplitude.push((0.6 + 0.7 * band) * edgeEnvelope(x, span));
    }

    const hue =
      c.hueRange === 0
        ? 0
        : -c.hueRange + 2 * c.hueRange * pingPong(s.time / c.hueDuration);
    const lift = Math.max(0, c.bend * rise);

    return {
      config: c,
      level: s.level,
      bands: s.bands.slice(),
      glow: rise,
      height: c.reach * rise,
      width: 0.85 + c.spread * rise,
      hue,
      lift,
      bend: c.bend > 0 ? Math.min(1, lift / c.bend) : 0,
      flow: s.phase / Math.max(1, span),
      lobeX,
      lobeAmplitude,
    };
  };

  return { config, state: s, step, reset };
};

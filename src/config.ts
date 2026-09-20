/*
 * The knobs and the constants: the app's defaults, the seven lobes and the
 * bands they stand on, the colors' shares of the hue wheel, and the looks and
 * strengths the app's menu offers.
 */

import { clamp01, hsbToRgb, wrap } from "./math.js";
import type {
  BorealisConfig,
  Look,
  LookName,
  Rgb,
  StrengthName,
} from "./types.js";

/** The knobs, at the app's defaults. A fresh object each time, so a caller can change it. */
export const defaults = (): BorealisConfig => ({
  sensitivity: 3,
  threshold: 0.06,
  curve: 0.6,
  autoGain: true,
  autoGainFloor: 0.3,
  autoGainRelease: 4,
  attack: 0.05,
  release: 0.2,
  idle: 0,
  breatheDuration: 5.2,
  reach: 1.7,
  spread: 1.05,
  flow: 60,
  lobeSpacing: 0.85,
  hueRange: 24,
  hueDuration: 12,
  hueStart: 0,
  hueWidth: 360,
  saturation: 0.85,
  colorMode: "spectrum",
  opacity: 0.5,
  glowOpacity: 1,
  bend: 60,
  curveCount: 5,
  curveOpacity: 0.2,
  curveEdge: 0.35,
  curveFade: 0.35,
  curveBlend: "normal",
  curvePosition: 0.25,
  curveCeiling: 0.55,
  curveBase: 0,
  curveOffset: -1.5,
  curveShape: 1.75,
  curveSpread: 0.87,
  curveSpan: 0.5,
  curveWidthCentre: 0.55,
  curveWidthEdge: 0.32,
  curveWander: 0.084,
});

/** The bands of the voice, low to high. Five, as the app's meter splits them. */
export const BAND_COUNT = 5;

/**
 * A lobe: where it sits from the box's middle and how big it is, in points
 * at the app's size, and the band that drives it.
 */
export type Lobe = { x: number; w: number; h: number; band: number };

/**
 * Seven lobes: the center on the lows, its neighbors on the mids, the outer
 * pair on the highs and the far pair on the low mids.
 */
export const LOBES: readonly Lobe[] = [
  { x: 0, w: 74, h: 46, band: 0 },
  { x: -36, w: 54, h: 40, band: 2 },
  { x: 36, w: 54, h: 40, band: 2 },
  { x: -72, w: 48, h: 32, band: 4 },
  { x: 72, w: 48, h: 32, band: 4 },
  { x: -108, w: 42, h: 26, band: 1 },
  { x: 108, w: 42, h: 26, band: 1 },
];

/** The width the lobes wrap over, at a spacing of 1. */
export const LOBE_SPAN = 36 * LOBES.length;

/** The gain on the loudness under `sensitivity`. */
export const BASE_GAIN = 5;

/**
 * Where on the hue wheel each of the seven colors sits, as a share of
 * `hueWidth`, shuffled so neighbors contrast. The hills take the first ones,
 * low band to high.
 */
export const HUE_SHARES: readonly number[] = [
  0.94, 0.56, 0.76, 0.4, 0.08, 0.65, 0.49,
];

/** The looks the app's menu offers. */
export const LOOKS: Record<LookName, Look> = {
  rainbow: { colorMode: "spectrum", hueStart: 0, hueWidth: 360 },
  northernLights: { colorMode: "spectrum", hueStart: 100, hueWidth: 180 },
  autumn: { colorMode: "spectrum", hueStart: 310, hueWidth: 90 },
  whiteHaze: { colorMode: "white" },
};

/** The strengths the app's menu offers: the whole effect's opacity. */
export const STRENGTHS: Record<StrengthName, number> = {
  strong: 1,
  medium: 0.5,
  subtle: 0.35,
};

/** A look by its menu name, or one of your own passed through. */
export const resolveLook = (look: LookName | Look): Look =>
  typeof look === "string" ? LOOKS[look] : look;

/** A strength by its menu name, or an opacity in 0..1 passed through. */
export const resolveStrength = (strength: StrengthName | number): number =>
  typeof strength === "string" ? STRENGTHS[strength] : clamp01(strength);

/**
 * `config` with `look` applied to it, in place: the color mode and, for a
 * spectrum, where on the wheel it sits. A look that says nothing about the
 * wheel keeps the config's own start and width.
 */
export const applyLook = (
  config: BorealisConfig,
  look: LookName | Look,
): BorealisConfig => {
  const resolved = resolveLook(look);
  config.colorMode = resolved.colorMode;
  if (resolved.hueStart !== undefined) {
    config.hueStart = resolved.hueStart;
  }
  if (resolved.hueWidth !== undefined) {
    config.hueWidth = resolved.hueWidth;
  }
  return config;
};

/**
 * The `index`th of the seven colors: its share of the wheel from `hueStart`,
 * turned by `drift` degrees, at `saturation`; or white or black alone.
 */
export const color = (
  index: number,
  config: BorealisConfig,
  drift: number,
): Rgb => {
  if (config.colorMode === "white") {
    return [1, 1, 1];
  }
  if (config.colorMode === "black") {
    return [0, 0, 0];
  }
  const share = HUE_SHARES[index % HUE_SHARES.length] ?? 0;
  const hue = wrap(config.hueStart + config.hueWidth * share + drift, 360);
  return hsbToRgb(hue / 360, clamp01(config.saturation), 1);
};

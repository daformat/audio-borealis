/** A color as channels in 0..1, gamma-encoded sRGB. */
export type Rgb = [r: number, g: number, b: number];

/**
 * Where the colors come from: shares of the hue wheel between `hueStart` and
 * `hueStart + hueWidth`, or one tone alone.
 */
export type ColorMode = "spectrum" | "white" | "black";

/** How the hills lay over the lobes: painted over them, or added to them. */
export type CurveBlend = "normal" | "additive";

/**
 * Every knob the glow has. The defaults, from `defaults()`, are the Subtitles
 * app's own; the units are noted where they are not plain factors.
 */
export type BorealisConfig = {
  /** Gain on the loudness before anything else reads it. */
  sensitivity: number;
  /** The noise gate, on the gained loudness: nothing below it shows. */
  threshold: number;
  /** The rise's curve: below 1 the glow comes up fast and then eases. */
  curve: number;
  /** Scale every level to its own running peak, so a quiet voice fills the box too. */
  autoGain: boolean;
  /** The lowest the running peak is allowed to fall, so silence is not amplified into a shout. */
  autoGainFloor: number;
  /** Seconds for the running peak to decay. */
  autoGainRelease: number;
  /** Seconds for a level to rise toward a louder target. */
  attack: number;
  /** Seconds for a level to fall toward a quieter one. */
  release: number;
  /** How much the glow breathes on its own in silence, 0 for none. */
  idle: number;
  /** Seconds per breath, when `idle` is above 0. */
  breatheDuration: number;
  /** How tall the glow reaches at full level, as a factor. */
  reach: number;
  /** How much wider the glow gets at full level, as a factor. */
  spread: number;
  /** How fast the lobes slide sideways while a voice is heard, in lobe units per second. */
  flow: number;
  /** How far apart the lobes sit, 1 for the app's spacing. */
  lobeSpacing: number;
  /** How far the hue drifts either side of where it started, in degrees. 0 holds it still. */
  hueRange: number;
  /** Seconds for the hue to drift out and back. */
  hueDuration: number;
  /** Where the colors' share of the wheel begins, in degrees. */
  hueStart: number;
  /** How much of the wheel the seven colors share, in degrees. */
  hueWidth: number;
  /** The colors' saturation, 0..1. */
  saturation: number;
  colorMode: ColorMode;
  /** The whole effect's opacity, 0..1. */
  opacity: number;
  /** The lobes' own opacity, under `opacity`. 0 leaves the hills alone. */
  glowOpacity: number;
  /** How far the glow is lifted at full level, in points at the app's size. */
  bend: number;
  /** How many hills stand over the lobes, one per band from low to high. */
  curveCount: number;
  /** The hills' fill, at the bottom edge. */
  curveOpacity: number;
  /** The line along each hill's crest. */
  curveEdge: number;
  /** How much of the fill is left at the crest, as a share of `curveOpacity`. */
  curveFade: number;
  curveBlend: CurveBlend;
  /** How high the hills stand against the lobes' height. */
  curvePosition: number;
  /** The most of the box's height a hill may take, 0..1. */
  curveCeiling: number;
  /** How much the hills' base lifts with the glow. */
  curveBase: number;
  /** Where the hills' base sits against the bottom edge, in points; below it when negative. */
  curveOffset: number;
  /** The hills' profile: 2 is a bell, higher is flatter on top. */
  curveShape: number;
  /** How wide each hill's bell is over its half width. */
  curveSpread: number;
  /** How far from the center the outermost hills rest, as a share of the width. */
  curveSpan: number;
  /** A center hill's half width, as a share of the box's width. */
  curveWidthCentre: number;
  /** An outermost hill's half width, as a share of the box's width. */
  curveWidthEdge: number;
  /** How far the hills wander sideways as the lobes flow, as a share of the width. */
  curveWander: number;
};

/**
 * What a source reads off the sound: a loudness, and the level in each of the
 * five bands of the voice, low to high, each in 0..1. Without `bands`, the
 * driver shapes five of its own out of the loudness.
 */
export type Levels = {
  loudness: number;
  bands?: readonly number[] | null;
};

/** One frame of the glow, from the driver, for the painter. */
export type BorealisFrame = {
  config: BorealisConfig;
  /** The followed level, 0..1. */
  level: number;
  /** The followed level of each band, 0..1. */
  bands: number[];
  /** The rise, 0..1: how much of the glow shows. 0 is nothing to paint. */
  glow: number;
  /** The glow's height factor, `reach` at full rise. */
  height: number;
  /** The glow's width factor, `0.85 + spread` at full rise. */
  width: number;
  /** The hue drift this frame, in degrees. */
  hue: number;
  /** How far the glow is lifted, in points at the app's size. */
  lift: number;
  /** The lift as a share of `bend`, 0..1. */
  bend: number;
  /** Where the lobes are in their slide, 0..1 of a full wrap. */
  flow: number;
  /** Each lobe's center, in points at the app's size from the box's middle. */
  lobeX: number[];
  /** Each lobe's height factor this frame. */
  lobeAmplitude: number[];
};

/** The looks the app's menu offers. */
export type LookName = "rainbow" | "northernLights" | "autumn" | "whiteHaze";

/** A look of your own: a color mode and, for a spectrum, where on the wheel it sits. */
export type Look = Pick<BorealisConfig, "colorMode"> &
  Partial<Pick<BorealisConfig, "hueStart" | "hueWidth">>;

/** The strengths the app's menu offers: the whole effect's opacity. */
export type StrengthName = "strong" | "medium" | "subtle";

/** What each hill is drawn from: points as `[x, y]`, x from the box's left edge and y the height above its bottom edge, in the box's px. */
export type Curve = [x: number, y: number][];

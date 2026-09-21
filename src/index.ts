export type { AnalyserLike, AnalyserSource } from "./analyser.js";
export {
  BAND_EDGES,
  bandLevels,
  createAnalyserSource,
  rms,
} from "./analyser.js";
export type { AttachOptions, Borealis, Source } from "./attach.js";
export { attachBorealis } from "./attach.js";
export type { Lobe } from "./config.js";
export {
  applyLook,
  BAND_COUNT,
  BASE_GAIN,
  color,
  defaults,
  HUE_SHARES,
  inkFor,
  LOBE_SPAN,
  LOBES,
  LOOKS,
  resolveLook,
  resolveStrength,
  STRENGTHS,
} from "./config.js";
export {
  CEILING_HALF_WIDTH,
  CEILING_HEIGHT,
  curveBand,
  curveOffset,
  curves,
  RANGE_WIDTH,
} from "./curves.js";
export type { Driver, DriverState } from "./driver.js";
export { createDriver } from "./driver.js";
export {
  bell,
  clamp01,
  edgeEnvelope,
  follow,
  hsbToRgb,
  pingPong,
  shape,
} from "./math.js";
export type { MicrophoneOptions, MicrophoneSource } from "./microphone.js";
export { createMicrophoneSource } from "./microphone.js";
export type { MockVoice } from "./mock-voice.js";
export {
  createMockVoice,
  CYCLE,
  MOCK_GAIN,
  mockVoice,
  PER_CYCLE,
  SILENCE,
} from "./mock-voice.js";
export type { PaintBox, PaintContext, ScratchCanvas } from "./painter.js";
export {
  isBlank,
  LAYERS,
  paintFrame,
  roundedRect,
  scaleXFor,
  scaleYFor,
} from "./painter.js";
export type {
  BorealisConfig,
  BorealisFrame,
  ColorMode,
  Curve,
  CurveBlend,
  Levels,
  Look,
  LookName,
  Rgb,
  StrengthName,
} from "./types.js";

/*
 * Real sound: the levels off a Web Audio AnalyserNode, or off the arrays
 * one gives you.
 *
 * The loudness is the RMS of the waveform, which for a voice at an ordinary
 * microphone gain sits somewhere in 0.02..0.1: with the driver's gain of 15
 * that is the range its gate and its soft knee are drawn for. The bands are
 * the spectrum, in the analyser's own decibels, cut at five edges and each
 * averaged into 0..1 between the analyser's floor and ceiling. The driver
 * scales both to their own running peaks, so the exact numbers matter less
 * than their shape.
 */

import { BAND_COUNT } from "./config.js";
import { clamp01 } from "./math.js";
import type { Levels } from "./types.js";

/**
 * The edges of the five bands, low to high, in Hz: six numbers, the first
 * where the lows begin and the last where the highs end. A voice's
 * fundamental sits in the first band, its vowels in the next two, its
 * consonants above.
 */
export const BAND_EDGES: readonly number[] = [0, 300, 600, 1200, 2400, 8000];

/** The root mean square of a stretch of waveform, 0..1 for samples in -1..1. */
export const rms = (samples: ArrayLike<number>): number => {
  const n = samples.length;
  if (n === 0) {
    return 0;
  }
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const v = samples[i] ?? 0;
    sum += v * v;
  }
  return Math.sqrt(sum / n);
};

/**
 * The five bands out of a spectrum in decibels, as `getFloatFrequencyData`
 * fills one: bin `i` is `i * sampleRate / fftSize` Hz. Each band is the mean
 * of its bins mapped from `minDb..maxDb` into 0..1.
 */
export const bandLevels = (
  spectrum: ArrayLike<number>,
  sampleRate: number,
  fftSize: number,
  minDb: number,
  maxDb: number,
  edges: readonly number[] = BAND_EDGES,
): number[] => {
  const bands = new Array<number>(BAND_COUNT).fill(0);
  const hzPerBin = sampleRate / fftSize;
  const range = Math.max(1e-6, maxDb - minDb);
  for (let b = 0; b < BAND_COUNT; b++) {
    const low = edges[b] ?? 0;
    const high = edges[b + 1] ?? Infinity;
    const from = Math.max(0, Math.ceil(low / hzPerBin));
    const to = Math.min(spectrum.length - 1, Math.floor(high / hzPerBin));
    if (to < from) {
      continue;
    }
    let sum = 0;
    for (let i = from; i <= to; i++) {
      sum += clamp01(((spectrum[i] ?? minDb) - minDb) / range);
    }
    bands[b] = sum / (to - from + 1);
  }
  return bands;
};

/** What `createAnalyserSource` needs of an AnalyserNode. */
export type AnalyserLike = {
  fftSize: number;
  frequencyBinCount: number;
  minDecibels: number;
  maxDecibels: number;
  context: { sampleRate: number };
  getFloatTimeDomainData: (array: Float32Array<ArrayBuffer>) => void;
  getFloatFrequencyData: (array: Float32Array<ArrayBuffer>) => void;
};

export type AnalyserSource = {
  /** The levels now: read once a frame and hand to the driver. */
  read: () => Levels;
};

/**
 * A source over an AnalyserNode: connect whatever plays into it and read.
 *
 * ```ts
 * const analyser = audioContext.createAnalyser();
 * analyser.fftSize = 2048;
 * audioContext.createMediaStreamSource(stream).connect(analyser);
 * const mic = createAnalyserSource(analyser);
 * attachBorealis(box, { source: () => mic.read() });
 * ```
 */
export const createAnalyserSource = (
  analyser: AnalyserLike,
  options: { edges?: readonly number[] } = {},
): AnalyserSource => {
  const edges = options.edges ?? BAND_EDGES;
  let wave = new Float32Array(analyser.fftSize);
  let spectrum = new Float32Array(analyser.frequencyBinCount);
  return {
    read: () => {
      if (wave.length !== analyser.fftSize) {
        wave = new Float32Array(analyser.fftSize);
      }
      if (spectrum.length !== analyser.frequencyBinCount) {
        spectrum = new Float32Array(analyser.frequencyBinCount);
      }
      analyser.getFloatTimeDomainData(wave);
      analyser.getFloatFrequencyData(spectrum);
      return {
        loudness: rms(wave),
        bands: bandLevels(
          spectrum,
          analyser.context.sampleRate,
          analyser.fftSize,
          analyser.minDecibels,
          analyser.maxDecibels,
          edges,
        ),
      };
    },
  };
};

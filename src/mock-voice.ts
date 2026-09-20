/*
 * A voice that is not there, close enough to one that the meter would read
 * the same.
 *
 * Syllables of uneven length and loudness, some stressed, laid end to end
 * with a short gap now and then where a word ends, each with a spectral
 * shape of its own (a vowel sits low and in the mids, a consonant higher)
 * and a third of them opening on a burst of highs, a sibilant. Deterministic
 * in time, from a hash, so a loop repeats and nothing is stored: eight
 * syllables fill a cycle of fixed length, and the cycle's index reseeds
 * them.
 */

import { BAND_COUNT } from "./config.js";
import { hash } from "./math.js";
import type { Levels } from "./types.js";

/** Seconds per cycle of syllables. */
export const CYCLE = 1.7;
/** Syllables per cycle. */
export const PER_CYCLE = 8;
/** How loud the voice is, on the syllables as authored. */
export const MOCK_GAIN = 1.2;
/** The loudness of silence: under any gate. */
export const SILENCE = 0.0015;

const ease = (u: number) =>
  0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, u)));

/**
 * The voice at `t` seconds into its speech, or silence when not `speaking`.
 * Pure: the same `t` always gives the same reading.
 */
export const mockVoice = (t: number, speaking: boolean): Levels => {
  const bands = new Array<number>(BAND_COUNT).fill(0);
  if (!speaking) {
    return { loudness: SILENCE, bands };
  }
  const cycle = Math.floor(t / CYCLE);
  let local = t - cycle * CYCLE;

  // The cycle's syllables, their lengths scaled to fill it exactly.
  const spans: [duration: number, gap: number][] = [];
  let total = 0;
  for (let i = 0; i < PER_CYCLE; i++) {
    const n = cycle * PER_CYCLE + i;
    const duration = 0.14 + 0.16 * hash(n, 2);
    const gap = hash(n, 3) < 0.18 ? 0.04 + 0.07 * hash(n, 4) : 0.01;
    spans.push([duration, gap]);
    total += duration + gap;
  }
  const scale = CYCLE / total;

  let loudness = SILENCE;
  for (let i = 0; i < PER_CYCLE; i++) {
    const n = cycle * PER_CYCLE + i;
    const [span, pause] = spans[i] ?? [0, 0];
    const duration = span * scale;
    const gap = pause * scale;
    if (local < duration) {
      // Inside this syllable: a rounded rise, a slight sag, a rounded fall,
      // as a voice swells rather than switches; loud on the whole, as a
      // voice the meter reads is once the automatic gain has scaled it to
      // its own peaks. Where it sits in the spectrum crosses over from the
      // syllable before, so the bands glide rather than jump.
      const amp = n === 0 ? 1 : 0.7 + 0.3 * Math.pow(hash(n, 1), 0.7);
      const env =
        Math.min(ease(local / 0.07), ease((duration - local) / 0.09)) *
        (1 - 0.1 * (local / duration));
      const focusOf = (m: number) => 0.4 + 2.6 * Math.pow(hash(m, 5), 1.4);
      const focus =
        focusOf(n - 1) +
        (focusOf(n) - focusOf(n - 1)) * ease(local / (duration * 0.6));
      const burst = hash(n, 6) < 0.35 ? ease(1 - local / 0.09) * 0.7 : 0;
      for (let b = 0; b < BAND_COUNT; b++) {
        const d = b - focus;
        const shape = Math.exp(-(d * d) / 2);
        bands[b] = Math.min(
          1,
          amp * env * (0.15 + 0.85 * shape) + (b >= 3 ? burst : 0),
        );
      }
      loudness = SILENCE + (0.06 * amp * env + 0.015 * burst) * MOCK_GAIN;
      break;
    }
    local -= duration + gap;
  }
  return { loudness, bands };
};

export type MockVoice = {
  /**
   * The voice over the next `dt` seconds: speech from where it left off
   * while `speaking`, silence otherwise. Every stretch of speech starts the
   * voice over, so each one is said the same way, to the same peak.
   */
  read: (dt: number, speaking: boolean) => Levels;
  /** Seconds into the current stretch of speech, 0 in silence. */
  readonly time: number;
  reset: () => void;
};

/** A mock voice with a clock of its own, for a source. */
export const createMockVoice = (): MockVoice => {
  let time = 0;
  let wasSpeaking = false;
  return {
    read: (dt, speaking) => {
      if (speaking) {
        time = wasSpeaking ? time + dt : 0;
      } else {
        time = 0;
      }
      wasSpeaking = speaking;
      return mockVoice(time, speaking);
    },
    get time() {
      return time;
    },
    reset: () => {
      time = 0;
      wasSpeaking = false;
    },
  };
};

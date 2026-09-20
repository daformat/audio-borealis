/*
 * The microphone, as a source: asks for it, listens, and lets go.
 */

import { type AnalyserSource, createAnalyserSource } from "./analyser.js";
import type { Levels } from "./types.js";

export type MicrophoneSource = AnalyserSource & {
  /** The stream, to show a level elsewhere or to route it on. */
  readonly stream: MediaStream;
  readonly context: AudioContext;
  readonly analyser: AnalyserNode;
  /** Stop the tracks and close the context. `read` returns silence after. */
  stop: () => Promise<void>;
};

export type MicrophoneOptions = {
  /** Passed to `getUserMedia`. Echo cancellation and noise suppression are on by default, as a call would have them. */
  audio?: MediaTrackConstraints;
  /** The analyser's window, a power of two: 2048 by default. */
  fftSize?: number;
  /** Seconds the analyser smooths its spectrum over, 0..1 as the node takes it: 0.6 by default. */
  smoothing?: number;
  /** The band edges, see `BAND_EDGES`. */
  edges?: readonly number[];
};

/**
 * A source on the microphone. Rejects as `getUserMedia` does when the
 * browser has no microphone or the person says no, so call it from a click.
 *
 * ```ts
 * const mic = await createMicrophoneSource();
 * const glow = attachBorealis(box, { source: () => mic.read() });
 * // later
 * await mic.stop();
 * ```
 */
export const createMicrophoneSource = async (
  options: MicrophoneOptions = {},
): Promise<MicrophoneSource> => {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: options.audio ?? {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: false,
    },
  });
  const context = new AudioContext();
  const analyser = context.createAnalyser();
  analyser.fftSize = options.fftSize ?? 2048;
  analyser.smoothingTimeConstant = options.smoothing ?? 0.6;
  context.createMediaStreamSource(stream).connect(analyser);
  // A context made outside a click starts suspended in some browsers.
  if (context.state === "suspended") {
    await context.resume();
  }
  const source = createAnalyserSource(analyser, { edges: options.edges });
  let stopped = false;
  const silence: Levels = { loudness: 0, bands: null };
  return {
    stream,
    context,
    analyser,
    read: () => (stopped ? silence : source.read()),
    stop: async () => {
      stopped = true;
      for (const track of stream.getTracks()) {
        track.stop();
      }
      if (context.state !== "closed") {
        await context.close();
      }
    },
  };
};

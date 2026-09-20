import { describe, expect, it } from "vitest";

import { bandLevels, createAnalyserSource, rms } from "./analyser.js";
import {
  applyLook,
  BAND_COUNT,
  color,
  defaults,
  LOBES,
  LOOKS,
  resolveStrength,
  STRENGTHS,
} from "./config.js";
import { curveBand, curveOffset, curves } from "./curves.js";
import { createDriver } from "./driver.js";
import {
  bell,
  clamp01,
  edgeEnvelope,
  follow,
  hash,
  hsbToRgb,
  pingPong,
  rgba,
  shape,
  wrap,
  wrapX,
} from "./math.js";
import {
  createMockVoice,
  CYCLE,
  MOCK_GAIN,
  mockVoice,
  SILENCE,
} from "./mock-voice.js";
import {
  isBlank,
  type PaintContext,
  paintFrame,
  roundedRect,
  scaleXFor,
  scaleYFor,
  type ScratchCanvas,
} from "./painter.js";
import type { BorealisFrame, Levels } from "./types.js";

const DT = 1 / 60;

/** `seconds` of `levels` through `driver`, the last frame back. */
const run = (
  driver: ReturnType<typeof createDriver>,
  seconds: number,
  levels: Levels,
): BorealisFrame => {
  let frame = driver.step(DT, levels);
  for (let t = DT; t < seconds; t += DT) {
    frame = driver.step(DT, levels);
  }
  return frame;
};

describe("math", () => {
  it("clamps, wraps and folds", () => {
    expect(clamp01(-1)).toBe(0);
    expect(clamp01(2)).toBe(1);
    expect(clamp01(0.4)).toBe(0.4);
    expect(wrap(-1, 10)).toBe(9);
    expect(wrap(11, 10)).toBe(1);
    expect(wrapX(6, 10)).toBe(-4);
    expect(wrapX(-6, 10)).toBe(4);
  });

  it("fades a lobe out at the edge of its span", () => {
    expect(edgeEnvelope(0, 100)).toBe(1);
    expect(edgeEnvelope(54, 100)).toBe(0);
    expect(edgeEnvelope(80, 100)).toBe(0);
    expect(edgeEnvelope(25, 100)).toBeGreaterThan(0.5);
  });

  it("ping-pongs on a cosine", () => {
    expect(pingPong(0)).toBeCloseTo(0);
    expect(pingPong(0.5)).toBeCloseTo(1);
    expect(pingPong(1)).toBeCloseTo(0);
    expect(pingPong(0.25)).toBeCloseTo(0.5);
  });

  it("gates then rounds off", () => {
    expect(shape(0.05, 0.06)).toBe(0);
    expect(shape(0.06, 0.06)).toBe(0);
    expect(shape(1, 0.06)).toBeCloseTo(1);
    expect(shape(2, 0.06)).toBe(1);
    let previous = 0;
    for (let raw = 0.07; raw <= 1; raw += 0.01) {
      const value = shape(raw, 0.06);
      expect(value).toBeGreaterThan(previous);
      previous = value;
    }
    // The knee: halfway up the input is well past halfway up the output.
    expect(shape(0.53, 0.06)).toBeGreaterThan(0.7);
  });

  it("follows up faster than down", () => {
    const up = follow(0, 1, 0.05, 0.05, 0.2);
    const down = 1 - follow(1, 0, 0.05, 0.05, 0.2);
    expect(up).toBeCloseTo(1 - Math.exp(-1));
    expect(down).toBeCloseTo(1 - Math.exp(-0.25));
    expect(up).toBeGreaterThan(down);
  });

  it("draws a bell that is 1 at the center and exactly 0 at the ends", () => {
    expect(bell(0, 1.75, 0.87, 0)).toBeCloseTo(1);
    expect(bell(1, 1.75, 0.87, 0)).toBe(0);
    expect(bell(-1, 1.75, 0.87, 0)).toBe(0);
    expect(bell(0.4, 1.75, 0.87, 0)).toBeCloseTo(bell(-0.4, 1.75, 0.87, 0));
    expect(bell(0.4, 1.75, 0.87, 0.3)).toBeGreaterThan(
      bell(-0.4, 1.75, 0.87, 0.3),
    );
  });

  it("turns hue, saturation and brightness into sRGB", () => {
    expect(hsbToRgb(0, 1, 1)).toEqual([1, 0, 0]);
    expect(hsbToRgb(1 / 3, 1, 1).map((c) => Math.round(c))).toEqual([0, 1, 0]);
    expect(hsbToRgb(2 / 3, 1, 1).map((c) => Math.round(c))).toEqual([0, 0, 1]);
    expect(hsbToRgb(0.2, 0, 0.5)).toEqual([0.5, 0.5, 0.5]);
    expect(rgba([1, 0.5, 0], 0.25)).toBe("rgba(255, 128, 0, 0.250)");
  });

  it("hashes the same every time, into 0..1", () => {
    expect(hash(3, 2)).toBe(hash(3, 2));
    expect(hash(3, 2)).not.toBe(hash(4, 2));
    for (let n = 0; n < 200; n++) {
      const value = hash(n, 5);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});

describe("config", () => {
  it("hands out a fresh copy of the app's defaults", () => {
    const a = defaults();
    const b = defaults();
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
    expect(a.sensitivity).toBe(3);
    expect(a.opacity).toBe(0.5);
    expect(LOBES).toHaveLength(7);
    expect(BAND_COUNT).toBe(5);
  });

  it("applies a look without touching what it does not name", () => {
    const config = defaults();
    applyLook(config, "northernLights");
    expect(config.colorMode).toBe("spectrum");
    expect(config.hueStart).toBe(100);
    expect(config.hueWidth).toBe(180);
    applyLook(config, "whiteHaze");
    expect(config.colorMode).toBe("white");
    expect(config.hueStart).toBe(100);
    applyLook(config, { colorMode: "spectrum", hueStart: 200 });
    expect(config.hueStart).toBe(200);
    expect(config.hueWidth).toBe(180);
    expect(LOOKS.rainbow).toEqual({
      colorMode: "spectrum",
      hueStart: 0,
      hueWidth: 360,
    });
  });

  it("resolves a strength by name or clamps a number", () => {
    expect(resolveStrength("strong")).toBe(1);
    expect(resolveStrength("medium")).toBe(STRENGTHS.medium);
    expect(resolveStrength(0.42)).toBe(0.42);
    expect(resolveStrength(3)).toBe(1);
    expect(resolveStrength(-1)).toBe(0);
  });

  it("colors from the wheel, or white or black alone", () => {
    const config = defaults();
    // The first share of a full wheel is 338.4°: a red leaning to magenta.
    const [r, g, b] = color(0, config, 0);
    expect(r).toBe(1);
    expect(b).toBeGreaterThan(g);
    // A drift of 21.6° brings it round to plain red.
    expect(color(0, config, 21.6)[2]).toBeCloseTo(0.15, 5);
    expect(color(7, config, 0)).toEqual(color(0, config, 0));
    config.colorMode = "white";
    expect(color(3, config, 90)).toEqual([1, 1, 1]);
    config.colorMode = "black";
    expect(color(3, config, 90)).toEqual([0, 0, 0]);
  });
});

describe("driver", () => {
  const silence: Levels = { loudness: 0, bands: null };
  const loud: Levels = { loudness: 0.1, bands: null };

  it("shows nothing in silence", () => {
    const driver = createDriver();
    const frame = run(driver, 2, silence);
    expect(frame.glow).toBe(0);
    expect(frame.level).toBe(0);
    expect(frame.bands.every((band) => band === 0)).toBe(true);
    expect(isBlank(frame)).toBe(true);
  });

  it("rises on a voice and falls after it", () => {
    const driver = createDriver();
    const up = run(driver, 1, loud);
    expect(up.glow).toBeGreaterThan(0.95);
    expect(up.height).toBeCloseTo(driver.config.reach * up.glow);
    expect(up.width).toBeCloseTo(0.85 + driver.config.spread * up.glow);
    const down = run(driver, 1.5, silence);
    expect(down.glow).toBeLessThan(0.05);
    expect(down.glow).toBeLessThan(up.glow);
  });

  it("stays under the gate", () => {
    const driver = createDriver();
    // 0.06 / 15: the gained loudness sits exactly on the threshold.
    const frame = run(driver, 1, { loudness: 0.004, bands: null });
    expect(frame.glow).toBe(0);
  });

  it("scales a quiet voice up to its own peak with auto gain", () => {
    const quiet: Levels = { loudness: 0.03, bands: null };
    const withGain = run(createDriver(), 1, quiet);
    const config = defaults();
    config.autoGain = false;
    const without = run(createDriver(config), 1, quiet);
    expect(withGain.level).toBeGreaterThan(0.95);
    expect(without.level).toBeLessThan(0.8);
    expect(without.level).toBeGreaterThan(0.6);
  });

  it("takes the bands it is given and shapes its own otherwise", () => {
    const bands = [0, 0, 1, 0, 0];
    const given = run(createDriver(), 1, { loudness: 0.1, bands });
    expect(given.bands[2]).toBeGreaterThan(0.95);
    expect(given.bands[0]).toBe(0);
    expect(given.bands[4]).toBe(0);
    const shaped = run(createDriver(), 1, loud);
    expect(shaped.bands.some((band) => band > 0)).toBe(true);
    expect(shaped.bands).toHaveLength(BAND_COUNT);
    // Four bands are not five: they are ignored, and the level shapes them.
    const wrong = run(createDriver(), 1, {
      loudness: 0.1,
      bands: [1, 1, 1, 1],
    });
    expect(wrong.bands.some((band) => band > 0)).toBe(true);
  });

  it("slides the lobes while a voice is heard, and holds them in silence", () => {
    const driver = createDriver();
    const still = run(driver, 0.5, silence);
    expect(still.flow).toBe(0);
    const moving = run(driver, 0.5, loud);
    expect(moving.flow).toBeGreaterThan(0);
    const before = moving.flow;
    const later = run(driver, 0.5, loud);
    expect(later.flow).not.toBe(before);
    const config = defaults();
    config.flow = 0;
    const held = run(createDriver(config), 1, loud);
    expect(held.flow).toBe(0);
  });

  it("keeps every lobe inside the span and fades it at the edges", () => {
    const driver = createDriver();
    const span = 36 * LOBES.length * driver.config.lobeSpacing;
    for (let i = 0; i < 300; i++) {
      const frame = driver.step(DT, loud);
      expect(frame.lobeX).toHaveLength(LOBES.length);
      for (const x of frame.lobeX) {
        expect(Math.abs(x)).toBeLessThanOrEqual(span / 2);
      }
      for (const amplitude of frame.lobeAmplitude) {
        expect(amplitude).toBeGreaterThanOrEqual(0);
        expect(amplitude).toBeLessThanOrEqual(1.3);
      }
    }
  });

  it("drifts the hue out and back, or not at all", () => {
    const driver = createDriver();
    const range = driver.config.hueRange;
    let low = Infinity;
    let high = -Infinity;
    for (let t = 0; t < driver.config.hueDuration; t += DT) {
      const { hue } = driver.step(DT, silence);
      low = Math.min(low, hue);
      high = Math.max(high, hue);
    }
    expect(low).toBeCloseTo(-range, 0);
    expect(high).toBeCloseTo(range, 0);
    const config = defaults();
    config.hueRange = 0;
    expect(run(createDriver(config), 1, loud).hue).toBe(0);
  });

  it("breathes in silence when asked to", () => {
    const config = defaults();
    config.idle = 0.5;
    const driver = createDriver(config);
    const frames: number[] = [];
    for (let t = 0; t < config.breatheDuration; t += DT) {
      frames.push(driver.step(DT, silence).glow);
    }
    expect(Math.max(...frames)).toBeGreaterThan(0.5);
    expect(Math.min(...frames)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...frames) - Math.min(...frames)).toBeGreaterThan(0.3);
  });

  it("resets to silence", () => {
    const driver = createDriver();
    run(driver, 1, loud);
    driver.reset();
    expect(driver.state.level).toBe(0);
    expect(driver.state.phase).toBe(0);
    expect(driver.state.time).toBe(0);
    expect(driver.step(DT, silence).glow).toBe(0);
  });
});

describe("curves", () => {
  it("rests the hills center first, then outward in pairs", () => {
    expect([0, 1, 2, 3, 4].map((k) => curveOffset(k, 5, 0.5))).toEqual([
      0, -0.25, 0.25, -0.5, 0.5,
    ]);
    expect(curveOffset(0, 1, 0.5)).toBe(0);
    expect(curveOffset(9, 3, 0.5)).toBe(0.5);
  });

  it("stands the hills on the bands, low to high", () => {
    expect([0, 1, 2, 3, 4].map((k) => curveBand(k, 5))).toEqual([
      0, 1, 2, 3, 4,
    ]);
    expect([0, 1, 2].map((k) => curveBand(k, 3))).toEqual([0, 2, 4]);
    expect(curveBand(0, 1)).toBe(0);
  });

  it("samples one hill per band across the width, never below the base", () => {
    const driver = createDriver();
    const frame = run(driver, 1, { loudness: 0.1, bands: [1, 1, 1, 1, 1] });
    const hills = curves(frame, 400, 80, 1, 1, 40);
    expect(hills).toHaveLength(driver.config.curveCount);
    const base = driver.config.curveOffset;
    for (const hill of hills) {
      expect(hill).toHaveLength(41);
      expect(hill[0]?.[0]).toBe(0);
      expect(hill[40]?.[0]).toBe(400);
      for (const [, y] of hill) {
        expect(y).toBeGreaterThanOrEqual(base - 1e-9);
      }
      const crest = Math.max(...hill.map((p) => p[1]));
      expect(crest).toBeGreaterThan(base + 1);
      expect(crest).toBeLessThanOrEqual(
        80 * driver.config.curveCeiling + base + 1e-9,
      );
    }
    // The outermost hills rest at the span, so their far ends sit on the
    // base; the center one is wider than half the box and does not.
    const outer = hills[3];
    expect(outer?.[40]?.[1]).toBeCloseTo(base);
  });

  it("draws no hills at a count of 0", () => {
    const config = defaults();
    config.curveCount = 0;
    const frame = run(createDriver(config), 1, { loudness: 0.1, bands: null });
    expect(curves(frame, 400, 80, 1, 1)).toEqual([]);
  });
});

describe("mock voice", () => {
  it("is silent when not speaking", () => {
    const quiet = mockVoice(3.2, false);
    expect(quiet.loudness).toBe(SILENCE);
    expect(quiet.bands).toEqual([0, 0, 0, 0, 0]);
  });

  it("speaks the same way every time, within bounds", () => {
    expect(mockVoice(0.05, true)).toEqual(mockVoice(0.05, true));
    const ceiling = SILENCE + (0.06 + 0.015 * 0.7) * MOCK_GAIN;
    let loudest = 0;
    for (let t = 0; t < CYCLE * 3; t += 0.005) {
      const { loudness, bands } = mockVoice(t, true);
      expect(loudness).toBeGreaterThanOrEqual(SILENCE);
      expect(loudness).toBeLessThanOrEqual(ceiling + 1e-9);
      loudest = Math.max(loudest, loudness);
      for (const band of bands ?? []) {
        expect(band).toBeGreaterThanOrEqual(0);
        expect(band).toBeLessThanOrEqual(1);
      }
    }
    expect(loudest).toBeGreaterThan(0.05);
  });

  it("opens loud on its first syllable", () => {
    // n = 0 is stressed: full amplitude, so its peak is near the ceiling.
    let peak = 0;
    for (let t = 0; t < 0.2; t += 0.002) {
      peak = Math.max(peak, mockVoice(t, true).loudness);
    }
    expect(peak).toBeGreaterThan(0.05);
  });

  it("drives the glow up through the driver", () => {
    const driver = createDriver();
    const voice = createMockVoice();
    let frame = driver.step(DT, voice.read(DT, true));
    for (let t = 0; t < 1; t += DT) {
      frame = driver.step(DT, voice.read(DT, true));
    }
    expect(frame.glow).toBeGreaterThan(0.5);
  });

  it("starts over at every stretch of speech", () => {
    const voice = createMockVoice();
    voice.read(0.3, true);
    voice.read(0.3, true);
    expect(voice.time).toBeCloseTo(0.3);
    voice.read(0.1, false);
    expect(voice.time).toBe(0);
    const again = voice.read(0.5, true);
    expect(voice.time).toBe(0);
    expect(again).toEqual(mockVoice(0, true));
    voice.read(0.2, true);
    expect(voice.time).toBeCloseTo(0.2);
    voice.reset();
    expect(voice.time).toBe(0);
  });
});

describe("analyser", () => {
  it("measures a waveform's RMS", () => {
    expect(rms([])).toBe(0);
    expect(rms([0, 0, 0])).toBe(0);
    expect(rms([1, -1, 1, -1])).toBe(1);
    const sine = Float32Array.from({ length: 1000 }, (_, i) =>
      Math.sin((i / 1000) * Math.PI * 2),
    );
    expect(rms(sine)).toBeCloseTo(Math.SQRT1_2, 3);
  });

  it("splits a spectrum into five bands between the analyser's floor and ceiling", () => {
    const sampleRate = 48000;
    const fftSize = 2048;
    const bins = fftSize / 2;
    const floor = new Float32Array(bins).fill(-100);
    expect(bandLevels(floor, sampleRate, fftSize, -100, -30)).toEqual([
      0, 0, 0, 0, 0,
    ]);
    // One tone at 900 Hz: the third band, and only it.
    const tone = new Float32Array(bins).fill(-100);
    const bin = Math.round((900 * fftSize) / sampleRate);
    tone[bin] = -30;
    const bands = bandLevels(tone, sampleRate, fftSize, -100, -30);
    expect(bands[2]).toBeGreaterThan(0);
    expect(bands[0]).toBe(0);
    expect(bands[1]).toBe(0);
    expect(bands[3]).toBe(0);
    expect(bands[4]).toBe(0);
    const full = new Float32Array(bins).fill(-30);
    expect(bandLevels(full, sampleRate, fftSize, -100, -30)).toEqual([
      1, 1, 1, 1, 1,
    ]);
  });

  it("reads an analyser", () => {
    const source = createAnalyserSource({
      fftSize: 256,
      frequencyBinCount: 128,
      minDecibels: -100,
      maxDecibels: -30,
      context: { sampleRate: 48000 },
      getFloatTimeDomainData: (array) => array.fill(0.5),
      getFloatFrequencyData: (array) => array.fill(-65),
    });
    const levels = source.read();
    expect(levels.loudness).toBeCloseTo(0.5);
    expect(levels.bands).toHaveLength(5);
    for (const band of levels.bands ?? []) {
      expect(band).toBeCloseTo(0.5);
    }
  });
});

describe("painter", () => {
  class Gradient {
    stops: [number, string][] = [];
    addColorStop(at: number, color: string) {
      this.stops.push([at, color]);
    }
  }

  /** Enough of a 2D context to count what the painter asks of it. */
  const fakeContext = () => {
    const calls: string[] = [];
    const record =
      (name: string) =>
      (..._args: unknown[]) => {
        calls.push(name);
      };
    const ctx = {
      fillStyle: "",
      strokeStyle: "",
      lineWidth: 1,
      lineJoin: "miter",
      globalAlpha: 1,
      globalCompositeOperation: "source-over",
      save: record("save"),
      restore: record("restore"),
      translate: record("translate"),
      scale: record("scale"),
      setTransform: record("setTransform"),
      getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
      createRadialGradient: () => new Gradient(),
      createLinearGradient: () => new Gradient(),
      clearRect: record("clearRect"),
      fillRect: record("fillRect"),
      rect: record("rect"),
      beginPath: record("beginPath"),
      closePath: record("closePath"),
      moveTo: record("moveTo"),
      lineTo: record("lineTo"),
      arc: record("arc"),
      clip: record("clip"),
      fill: record("fill"),
      stroke: record("stroke"),
      drawImage: record("drawImage"),
    };
    return { ctx: ctx as unknown as PaintContext, calls };
  };

  const box = { width: 400, height: 80, radius: 12, fontSize: 24 };

  it("clears and stops on a blank frame", () => {
    const { ctx, calls } = fakeContext();
    const scratch = fakeContext();
    const frame = run(createDriver(), 1, { loudness: 0, bands: null });
    paintFrame(
      ctx,
      { getContext: () => scratch.ctx } as unknown as ScratchCanvas,
      frame,
      box,
    );
    expect(calls).toEqual(["clearRect"]);
    expect(scratch.calls).toEqual([]);
  });

  it("paints the lobes through the scratch canvas and the hills over them", () => {
    const { ctx, calls } = fakeContext();
    const scratch = fakeContext();
    const frame = run(createDriver(), 1, {
      loudness: 0.1,
      bands: [1, 1, 1, 1, 1],
    });
    paintFrame(
      ctx,
      { getContext: () => scratch.ctx } as unknown as ScratchCanvas,
      frame,
      box,
    );
    expect(calls[0]).toBe("clearRect");
    expect(calls.filter((call) => call === "drawImage")).toHaveLength(2);
    expect(scratch.calls.filter((call) => call === "clearRect")).toHaveLength(
      2,
    );
    // Seven lobes an ellipse each, per layer.
    expect(scratch.calls.filter((call) => call === "arc")).toHaveLength(14);
    // Five hills, each a fill and a stroke.
    expect(calls.filter((call) => call === "fillRect")).toHaveLength(5);
    expect(calls.filter((call) => call === "stroke")).toHaveLength(5);
    expect(calls.filter((call) => call === "save")).toHaveLength(
      calls.filter((call) => call === "restore").length,
    );
  });

  it("leaves the lobes out at a glow opacity of 0 and the hills at a count of 0", () => {
    const config = defaults();
    config.glowOpacity = 0;
    config.curveCount = 0;
    const { ctx, calls } = fakeContext();
    const scratch = fakeContext();
    const frame = run(createDriver(config), 1, { loudness: 0.1, bands: null });
    paintFrame(
      ctx,
      { getContext: () => scratch.ctx } as unknown as ScratchCanvas,
      frame,
      box,
    );
    expect(calls).not.toContain("drawImage");
    expect(calls).not.toContain("fillRect");
    expect(scratch.calls).toEqual([]);
  });

  it("scales with the box's width and type", () => {
    expect(scaleXFor(350)).toBe(1);
    expect(scaleXFor(100)).toBe(0.9);
    expect(scaleXFor(2000)).toBe(2.4);
    expect(scaleYFor(30)).toBe(1);
    expect(scaleYFor(60)).toBe(2);
    expect(scaleYFor(6)).toBe(0.5);
    expect(scaleYFor(30, 1.2)).toBeCloseTo(1.2);
  });

  it("traces a rounded rectangle with four arcs", () => {
    const { ctx, calls } = fakeContext();
    roundedRect(ctx, 0, 0, 100, 40, 500);
    expect(calls.filter((call) => call === "arc")).toHaveLength(4);
    expect(calls.at(-1)).toBe("closePath");
  });
});

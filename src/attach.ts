/*
 * The glow on an element: a canvas under its content, sized with it, fed
 * from a source each frame or from `feed()`, and painted only while there is
 * something to paint.
 *
 * One frame loop serves every glow on the page, and it runs only while a
 * glow is awake: on screen, in a visible tab, and either reading a source or
 * still fading. A glow with nothing to do costs nothing.
 */

import { applyLook, defaults, resolveStrength } from "./config.js";
import { createDriver, type Driver } from "./driver.js";
import { isBlank, paintFrame } from "./painter.js";
import type {
  BorealisConfig,
  BorealisFrame,
  Levels,
  Look,
  LookName,
  StrengthName,
} from "./types.js";

/**
 * What feeds the glow: called once a frame with the seconds since the last
 * one and the time in seconds, and returning the levels, or nothing for
 * silence.
 */
export type Source = (dt: number, time: number) => Levels | null | undefined;

export type AttachOptions = {
  /** The levels each frame. Leave it out to push them with `feed()` instead. */
  source?: Source;
  /** A look by its menu name, or one of your own. `rainbow` by default. */
  look?: LookName | Look;
  /** A strength by its menu name, or an opacity in 0..1. `medium` by default. */
  strength?: StrengthName | number;
  /** Any knob, over the app's defaults and under the look and strength. */
  config?: Partial<BorealisConfig>;
  /** See `PaintBox.scaleY`: 1 by default. */
  scaleY?: number;
  /** The most device pixels per CSS px the canvas is drawn at: 3 by default. */
  maxPixelRatio?: number;
  /** Run only while the element is on screen: true by default, where IntersectionObserver exists. */
  onScreenOnly?: boolean;
  /** Milliseconds a fed reading holds before it counts as silence: 120 by default. */
  feedHold?: number;
  /** A canvas of your own, placed as you like, instead of one made and laid under the element's content. */
  canvas?: HTMLCanvasElement;
  /** A class for the canvas that is made. */
  className?: string;
};

export type Borealis = {
  readonly element: HTMLElement;
  readonly canvas: HTMLCanvasElement;
  readonly driver: Driver;
  /** The last frame painted, or null before the first. */
  readonly frame: BorealisFrame | null;
  readonly paused: boolean;
  /** Push a reading, for a source that calls you rather than one you call. */
  feed: (levels: Levels) => void;
  setSource: (source: Source | null) => void;
  setLook: (look: LookName | Look) => void;
  setStrength: (strength: StrengthName | number) => void;
  /** Change any knobs in place. */
  configure: (config: Partial<BorealisConfig>) => void;
  /** Hold the glow where it is and stop reading. */
  pause: () => void;
  resume: () => void;
  /** Back to silence, at once. */
  reset: () => void;
  /** Take the canvas out and stop for good. */
  destroy: () => void;
};

type Entry = {
  tick: (dt: number, now: number) => boolean;
};

/* ---------- the one frame loop ---------- */

const entries = new Set<Entry>();
let raf = 0;
let last = 0;

const hidden = () => typeof document !== "undefined" && document.hidden;

const frameAll = (now: number) => {
  raf = 0;
  const dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60;
  last = now;
  let busy = false;
  for (const entry of entries) {
    if (entry.tick(dt, now)) {
      busy = true;
    }
  }
  if (busy && !hidden()) {
    raf = requestAnimationFrame(frameAll);
  } else {
    last = 0;
  }
};

/** Start the loop if it is not running. Every change that could show calls this. */
const wake = () => {
  if (!raf && !hidden() && typeof requestAnimationFrame === "function") {
    raf = requestAnimationFrame(frameAll);
  }
};

let listening = false;
const listen = () => {
  if (listening || typeof document === "undefined") {
    return;
  }
  listening = true;
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      wake();
    }
  });
};

/* ---------- one glow ---------- */

/** Lay a canvas under the element's content, on the element's own corners. */
const makeCanvas = (element: HTMLElement, className?: string) => {
  const canvas = document.createElement("canvas");
  if (className) {
    canvas.className = className;
  }
  canvas.setAttribute("aria-hidden", "true");
  const style = canvas.style;
  style.position = "absolute";
  style.inset = "0";
  style.width = "100%";
  style.height = "100%";
  style.borderRadius = "inherit";
  style.pointerEvents = "none";
  style.zIndex = "-1";
  // Under the content but over the element's own background takes a
  // stacking context on the element, and a position for the canvas to be
  // laid inside. Neither is touched where the element already has one.
  const computed = getComputedStyle(element);
  if (computed.position === "static") {
    element.style.position = "relative";
  }
  if (computed.isolation !== "isolate") {
    element.style.isolation = "isolate";
  }
  element.prepend(canvas);
  return canvas;
};

/**
 * The glow on `element`.
 *
 * ```ts
 * const voice = createMockVoice();
 * const glow = attachBorealis(box, {
 *   look: "northernLights",
 *   source: (dt) => voice.read(dt, isSpeaking()),
 * });
 * ```
 */
export const attachBorealis = (
  element: HTMLElement,
  options: AttachOptions = {},
): Borealis => {
  listen();
  const config = Object.assign(defaults(), options.config);
  applyLook(config, options.look ?? "rainbow");
  config.opacity = resolveStrength(options.strength ?? "medium");
  const driver = createDriver(config);

  const own = !options.canvas;
  const canvas = options.canvas ?? makeCanvas(element, options.className);
  const scratch = document.createElement("canvas");
  const maxDpr = options.maxPixelRatio ?? 3;
  const scaleY = options.scaleY ?? 1;
  const feedHold = options.feedHold ?? 120;

  let source: Source | null = options.source ?? null;
  let fed: Levels | null = null;
  let fedAt = -Infinity;
  let time = 0;
  let paused = false;
  let onScreen = true;
  let destroyed = false;
  let wasBlank = true;
  let lastFrame: BorealisFrame | null = null;

  let width = 0;
  let height = 0;
  let dpr = 1;
  let radius = 0;
  let fontSize = 30;

  // The element's own size, not its size on the page: an element inside a
  // scaled screen is laid out in its own px, and so is the canvas.
  const size = () => {
    const computed = getComputedStyle(element);
    width = Math.max(1, Math.round(element.offsetWidth));
    height = Math.max(1, Math.round(element.offsetHeight));
    dpr = Math.min(maxDpr, window.devicePixelRatio || 1);
    radius = parseFloat(computed.borderTopLeftRadius) || 0;
    fontSize = parseFloat(computed.fontSize) || 30;
    for (const el of [canvas, scratch]) {
      el.width = Math.round(width * dpr);
      el.height = Math.round(height * dpr);
    }
  };

  const draw = (frame: BorealisFrame) => {
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    paintFrame(ctx, scratch, frame, {
      width,
      height,
      radius,
      fontSize,
      scaleY,
    });
  };

  const clear = () => {
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  };

  size();

  // Sizing a canvas clears it, and a box resizes on every word: painted again
  // at once, in the resize callback, after layout and before the frame is
  // painted, so the glow never blinks out for a frame.
  const resizer =
    typeof ResizeObserver === "function"
      ? new ResizeObserver(() => {
          size();
          if (lastFrame && !wasBlank) {
            draw(lastFrame);
          }
          wake();
        })
      : null;
  resizer?.observe(element);

  const watcher =
    options.onScreenOnly !== false && typeof IntersectionObserver === "function"
      ? new IntersectionObserver((records) => {
          const record = records[records.length - 1];
          onScreen = record ? record.isIntersecting : true;
          if (onScreen) {
            wake();
          }
        })
      : null;
  watcher?.observe(element);

  const levelsNow = (dt: number, now: number): Levels => {
    if (source) {
      return source(dt, time) ?? { loudness: 0, bands: null };
    }
    if (fed && now - fedAt < feedHold) {
      return fed;
    }
    return { loudness: 0, bands: null };
  };

  const tick = (dt: number, now: number): boolean => {
    if (destroyed || paused || !onScreen) {
      return false;
    }
    time += dt;
    const frame = driver.step(dt, levelsNow(dt, now));
    lastFrame = frame;
    const blank = isBlank(frame);
    if (blank && wasBlank) {
      // Nothing to paint and nothing painted: keep the loop only for a
      // source, which could speak at any moment. A fed glow wakes on feed().
      return source !== null;
    }
    wasBlank = blank;
    draw(frame);
    return true;
  };

  const entry: Entry = { tick };
  entries.add(entry);
  wake();

  return {
    element,
    canvas,
    driver,
    get frame() {
      return lastFrame;
    },
    get paused() {
      return paused;
    },
    feed: (levels) => {
      fed = levels;
      fedAt = performance.now();
      wake();
    },
    setSource: (next) => {
      source = next;
      wake();
    },
    setLook: (look) => {
      applyLook(config, look);
      wake();
    },
    setStrength: (strength) => {
      config.opacity = resolveStrength(strength);
      wake();
    },
    configure: (partial) => {
      Object.assign(config, partial);
      wake();
    },
    pause: () => {
      paused = true;
    },
    resume: () => {
      paused = false;
      wake();
    },
    reset: () => {
      driver.reset();
      lastFrame = null;
      wasBlank = true;
      clear();
    },
    destroy: () => {
      destroyed = true;
      entries.delete(entry);
      resizer?.disconnect();
      watcher?.disconnect();
      if (own) {
        canvas.remove();
      } else {
        clear();
      }
    },
  };
};

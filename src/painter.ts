/*
 * The painter: a frame onto a canvas.
 *
 * Plain 2D calls every engine has: gradients, clips, destination-in for the
 * masks and lighter for the additive blend. No filters, no OffscreenCanvas,
 * no roundRect, so Chrome, Safari and Firefox draw the same picture.
 */

import { color, LOBES } from "./config.js";
import {
  CEILING_HALF_WIDTH,
  CEILING_HEIGHT,
  curves,
  RANGE_WIDTH,
} from "./curves.js";
import { clamp01, rgba, TAU } from "./math.js";
import type { BorealisFrame, Rgb } from "./types.js";

/** The subset of a 2D context the painter uses: a `CanvasRenderingContext2D` is one. */
export type PaintContext = Pick<
  CanvasRenderingContext2D,
  | "save"
  | "restore"
  | "translate"
  | "scale"
  | "setTransform"
  | "getTransform"
  | "createRadialGradient"
  | "createLinearGradient"
  | "fillStyle"
  | "strokeStyle"
  | "lineWidth"
  | "lineJoin"
  | "globalAlpha"
  | "globalCompositeOperation"
  | "clearRect"
  | "fillRect"
  | "rect"
  | "beginPath"
  | "closePath"
  | "moveTo"
  | "lineTo"
  | "arc"
  | "clip"
  | "fill"
  | "stroke"
  | "drawImage"
>;

/** The scratch canvas the masked layers are built on: the same size as the box's canvas. */
export type ScratchCanvas = CanvasImageSource & {
  getContext: (id: "2d") => PaintContext | null;
};

/** The box the frame is painted into, in CSS px. */
export type PaintBox = {
  width: number;
  height: number;
  /** The corner radius the glow is clipped to. */
  radius: number;
  /** The box's type size, which the glow's height is scaled by: the app's is 30. */
  fontSize: number;
  /**
   * An extra vertical factor over the app's own, 1 by default. A box drawn
   * smaller than its type would have it, inside a scaled-down screen say,
   * reads its glow shorter than the app does; 1.2 has the peaks clear the
   * last line as they do there.
   */
  scaleY?: number;
};

type Stops = [at: number, alpha: number][];

type Layer = {
  sizeX: number;
  sizeY: number;
  opacity: number;
  stops: Stops;
  mask: [halfWidth: number, height: number];
  maskStops: Stops;
};

/**
 * The two soft layers of lobes: a wide faint one and a tighter brighter one,
 * each masked to an ellipse of its own so it fades out before the lobes
 * would.
 */
export const LAYERS: readonly Layer[] = [
  {
    sizeX: 1.15 * 1.15,
    sizeY: 1.5 * 1.15,
    opacity: 0.5,
    stops: [
      [0, 0.5],
      [0.4, 0.22],
      [0.75, 0.05],
      [1, 0],
    ],
    mask: [200 * RANGE_WIDTH, 130],
    maskStops: [
      [0, 1],
      [0.35, 0.5],
      [0.8, 0.1],
      [1, 0],
    ],
  },
  {
    sizeX: 1,
    sizeY: 1.1,
    opacity: 0.6,
    stops: [
      [0, 0.6],
      [0.45, 0.3],
      [0.8, 0.06],
      [1, 0],
    ],
    mask: [CEILING_HALF_WIDTH * RANGE_WIDTH, CEILING_HEIGHT],
    maskStops: [
      [0, 1],
      [0.45, 0.5],
      [0.85, 0.2],
      [1, 0],
    ],
  },
];

const GLOW_WIDTH = 0.65;
const GLOW_HEIGHT = 1.25;

/** The horizontal scale: 1 at the app's box, about 350 wide, held within 0.9..2.4. */
export const scaleXFor = (width: number): number =>
  Math.min(2.4, Math.max(0.9, width / 350));

/** The vertical scale: 1 at the app's 30pt type, never below 0.5. */
export const scaleYFor = (fontSize: number, lift = 1): number =>
  Math.max(0.5, fontSize / 30) * lift;

/**
 * A radial gradient of one color squashed into an ellipse, its alpha over
 * the radius given by `stops`; `beyond` paints the last stop past the radius
 * too, for a mask that a clip bounds.
 */
const ellipse = (
  ctx: PaintContext,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  rgb: Rgb,
  stops: Stops,
  beyond: boolean,
) => {
  if (rx <= 0 || ry <= 0) {
    return;
  }
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(1, ry / rx);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
  for (const [at, alpha] of stops) {
    g.addColorStop(at, rgba(rgb, alpha));
  }
  ctx.fillStyle = g;
  if (beyond) {
    ctx.fillRect(-1e4, -1e4, 2e4, 2e4);
  } else {
    ctx.beginPath();
    ctx.arc(0, 0, rx, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
};

/** A rounded rectangle as a path, with arcs rather than roundRect, which Safari got late. */
export const roundedRect = (
  ctx: PaintContext,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) => {
  const rad = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.lineTo(x + w - rad, y);
  ctx.arc(x + w - rad, y + rad, rad, -Math.PI / 2, 0);
  ctx.lineTo(x + w, y + h - rad);
  ctx.arc(x + w - rad, y + h - rad, rad, 0, Math.PI / 2);
  ctx.lineTo(x + rad, y + h);
  ctx.arc(x + rad, y + h - rad, rad, Math.PI / 2, Math.PI);
  ctx.lineTo(x, y + rad);
  ctx.arc(x + rad, y + rad, rad, Math.PI, Math.PI * 1.5);
  ctx.closePath();
};

/** Whether a frame has anything to paint: a blank one clears the canvas and stops. */
export const isBlank = (frame: BorealisFrame): boolean => frame.glow <= 0.002;

/**
 * Paint `frame` on `ctx`, into `box`, with `scratch` a second canvas of the
 * same size the masked layers are built on. `ctx` is expected to carry the
 * device pixel ratio as its transform; the box is in CSS px, and canvas y
 * runs down, so the bottom edge is `y = box.height`.
 */
export const paintFrame = (
  ctx: PaintContext,
  scratch: ScratchCanvas,
  frame: BorealisFrame,
  box: PaintBox,
): void => {
  const c = frame.config;
  const { width: w, height: h, radius } = box;
  const opacity = clamp01(c.opacity);
  ctx.clearRect(0, 0, w, h);
  if (isBlank(frame) || opacity <= 0) {
    return;
  }
  const sx = scaleXFor(w);
  const sy = scaleYFor(box.fontSize, box.scaleY ?? 1);
  const cx = w / 2;
  const cy = h;
  ctx.save();
  roundedRect(ctx, 0, 0, w, h, radius);
  ctx.clip();

  // The two soft layers of lobes, each built on the scratch canvas, masked
  // to its ellipse there, and laid on at its opacity.
  if (c.glowOpacity > 0) {
    const sc = scratch.getContext("2d");
    if (sc) {
      for (const layer of LAYERS) {
        const alpha = Math.min(1, layer.opacity * frame.glow * c.glowOpacity);
        const rx = layer.mask[0] * frame.width * sx;
        const ry = (layer.mask[1] * frame.height + frame.lift) * sy;
        if (alpha <= 0 || rx <= 0.5 || ry <= 0.5) {
          continue;
        }
        sc.setTransform(ctx.getTransform());
        sc.clearRect(0, 0, w, h);
        sc.save();
        sc.beginPath();
        sc.rect(cx - rx, cy - ry, rx * 2, ry * 2);
        sc.clip();
        sc.globalCompositeOperation = "source-over";
        LOBES.forEach((lobe, i) => {
          const lrx = lobe.w * GLOW_WIDTH * layer.sizeX * frame.width * sx;
          const lry =
            lobe.h *
            GLOW_HEIGHT *
            layer.sizeY *
            frame.height *
            (frame.lobeAmplitude[i] ?? 0) *
            sy;
          if (lrx <= 0.5 || lry <= 0.5) {
            return;
          }
          ellipse(
            sc,
            cx + (frame.lobeX[i] ?? 0) * frame.width * sx,
            cy,
            lrx,
            lry,
            color(i, c, frame.hue),
            layer.stops,
            false,
          );
        });
        sc.globalCompositeOperation = "destination-in";
        ellipse(sc, cx, cy, rx, ry, [1, 1, 1], layer.maskStops, true);
        sc.restore();
        // Laid on at identity, pixel for pixel, the box's transform put back.
        const t = ctx.getTransform();
        ctx.globalAlpha = alpha * opacity;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.drawImage(scratch, 0, 0);
        ctx.setTransform(t);
        ctx.globalAlpha = 1;
        sc.setTransform(1, 0, 0, 1, 0, 0);
      }
    }
  }

  // The hills: one per band, filled from the bottom edge up to its curve,
  // the fill anchored at the edge and fading toward the crest, and a line
  // along the crest above the band it stands on.
  const fill = c.curveOpacity * opacity;
  const edge = c.curveEdge * opacity;
  if (fill > 0.003 || edge > 0.003) {
    const hills = curves(frame, w, h, sx, sy, 40);
    const base = (c.curveOffset + c.curveBase * frame.bend) * sy;
    hills.forEach((points, k) => {
      const first = points[0];
      const last = points[points.length - 1];
      if (!first || !last || !points.some((p) => p[1] > 0.3)) {
        return;
      }
      const rgb = color(k, c, frame.hue);
      const crest = Math.max(...points.map((p) => p[1]));
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(first[0], h + 4);
      for (const p of points) {
        ctx.lineTo(p[0], h - p[1]);
      }
      ctx.lineTo(last[0], h + 4);
      ctx.closePath();
      ctx.clip();
      ctx.globalCompositeOperation =
        c.curveBlend === "additive" ? "lighter" : "source-over";
      if (fill > 0.003) {
        const g = ctx.createLinearGradient(0, h, 0, h - Math.max(crest, 1));
        g.addColorStop(0, rgba(rgb, fill));
        g.addColorStop(1, rgba(rgb, fill * clamp01(c.curveFade)));
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h + 4);
      }
      ctx.restore();
      if (edge > 0.003 && crest > base + 1.5) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, 0, w, h - base - 1.5);
        ctx.clip();
        ctx.beginPath();
        points.forEach((p, i) => {
          if (i) {
            ctx.lineTo(p[0], h - p[1]);
          } else {
            ctx.moveTo(p[0], h - p[1]);
          }
        });
        ctx.strokeStyle = rgba(rgb, edge);
        ctx.lineWidth = 1;
        ctx.lineJoin = "round";
        ctx.stroke();
        ctx.restore();
      }
    });
  }
  ctx.restore();
};

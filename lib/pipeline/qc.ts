/**
 * Automatic quality checks on the cutout, plus shared pixel utilities for the
 * editor. Two failure modes are detected:
 *
 * 1. Skin left in the cutout (hand/arm holding the product) — YCbCr rule.
 * 2. Interior holes: transparent regions fully enclosed by the subject,
 *    typically a shoe interior "eaten" because shadow made it look like the
 *    background. Detected by flood-filling transparency from the image
 *    border: whatever transparency is left unreached is a hole.
 *
 * Both are heuristics: they flag images for review, never act on their own.
 */

const ANALYSIS_SIDE = 320;
const MIN_OPAQUE_PIXELS = 500;

export function isSkin(r: number, g: number, b: number): boolean {
  const y = 0.299 * r + 0.587 * g + 0.114 * b;
  const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
  const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
  return y > 40 && cb >= 77 && cb <= 127 && cr >= 133 && cr <= 173;
}

/**
 * Flood-fills transparency (alpha <= alphaMax) from the image border; every
 * transparent pixel it cannot reach is enclosed by the subject → a hole.
 * Shared by the QC (downscaled) and the editor's "fill holes" (full-res).
 */
export function interiorHoleMask(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  alphaMax = 8
): { mask: Uint8Array; holePixels: number; opaquePixels: number } {
  const total = width * height;
  const isTransparent = (p: number) => data[p * 4 + 3] <= alphaMax;
  const reached = new Uint8Array(total);
  const stack: number[] = [];
  const seed = (p: number) => {
    if (!reached[p] && isTransparent(p)) {
      reached[p] = 1;
      stack.push(p);
    }
  };
  for (let x = 0; x < width; x++) {
    seed(x);
    seed((height - 1) * width + x);
  }
  for (let y = 0; y < height; y++) {
    seed(y * width);
    seed(y * width + width - 1);
  }
  while (stack.length) {
    const p = stack.pop() as number;
    const x = p % width;
    if (x > 0) seed(p - 1);
    if (x < width - 1) seed(p + 1);
    if (p >= width) seed(p - width);
    if (p < total - width) seed(p + width);
  }
  const mask = new Uint8Array(total);
  let holePixels = 0;
  let opaquePixels = 0;
  for (let p = 0; p < total; p++) {
    if (data[p * 4 + 3] > 128) {
      opaquePixels += 1;
    } else if (isTransparent(p) && !reached[p]) {
      mask[p] = 1;
      holePixels += 1;
    }
  }
  return { mask, holePixels, opaquePixels };
}

export interface CutoutAnalysis {
  /** Fraction of opaque subject pixels that look like skin (0..1) */
  skinRatio: number;
  /** Interior hole area as a fraction of the subject area (0..1) */
  holeRatio: number;
}

/** Single-pass analysis on a downscaled copy of the cutout. */
export async function analyzeCutout(cutout: Blob): Promise<CutoutAnalysis> {
  const bitmap = await createImageBitmap(cutout);
  try {
    const scale = Math.min(1, ANALYSIS_SIDE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return { skinRatio: 0, holeRatio: 0 };
    ctx.drawImage(bitmap, 0, 0, width, height);
    const data = ctx.getImageData(0, 0, width, height).data;

    let opaque = 0;
    let skin = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] > 128) {
        opaque += 1;
        if (isSkin(data[i], data[i + 1], data[i + 2])) skin += 1;
      }
    }
    if (opaque < MIN_OPAQUE_PIXELS) return { skinRatio: 0, holeRatio: 0 };

    const { holePixels } = interiorHoleMask(data, width, height);
    return { skinRatio: skin / opaque, holeRatio: holePixels / opaque };
  } finally {
    bitmap.close();
  }
}

export const SKIN_WARN_THRESHOLD = 0.06;
export const HOLE_WARN_THRESHOLD = 0.03;
export const SKIN_WARNING_MESSAGE =
  "Possibile mano o braccio nel ritaglio: controlla il risultato";
export const HOLE_WARNING_MESSAGE =
  "Possibile parte interna del prodotto rimossa: aprila nell'editor e usa Riempi buchi";

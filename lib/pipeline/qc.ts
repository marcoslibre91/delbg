/**
 * Automatic quality check on the cutout: estimates how much of the subject
 * is skin-colored (YCbCr rule). A high ratio usually means a hand or arm
 * holding the product survived the background removal.
 *
 * Heuristic by design: tattooed or gloved skin can slip through, and
 * skin-toned products (tan suede) can trigger false positives — that is why
 * it only flags the image for review instead of acting on it.
 */

const ANALYSIS_SIDE = 320;
const MIN_OPAQUE_PIXELS = 500;

function isSkin(r: number, g: number, b: number): boolean {
  const y = 0.299 * r + 0.587 * g + 0.114 * b;
  const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
  const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
  return y > 40 && cb >= 77 && cb <= 127 && cr >= 133 && cr <= 173;
}

/** Fraction of opaque subject pixels that look like skin (0..1). */
export async function skinRatio(cutout: Blob): Promise<number> {
  const bitmap = await createImageBitmap(cutout);
  try {
    const scale = Math.min(1, ANALYSIS_SIDE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return 0;
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
    if (opaque < MIN_OPAQUE_PIXELS) return 0;
    return skin / opaque;
  } finally {
    bitmap.close();
  }
}

export const SKIN_WARN_THRESHOLD = 0.06;
export const SKIN_WARNING_MESSAGE =
  "Possibile mano o braccio nel ritaglio: controlla il risultato";

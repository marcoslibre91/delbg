import type { Settings } from "../types";

export interface CompositeResult {
  blob: Blob;
  width: number;
  height: number;
}

function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Esportazione JPG fallita"))),
      "image/jpeg",
      quality
    );
  });
}

/** Bounding box of pixels with alpha > threshold, or null if fully transparent. */
function alphaBoundingBox(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number
): { x: number; y: number; w: number; h: number } | null {
  const data = ctx.getImageData(0, 0, width, height).data;
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    const row = y * width * 4;
    for (let x = 0; x < width; x++) {
      if (data[row + x * 4 + 3] > 8) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

/**
 * Composites the PNG cutout over a uniform HEX background.
 * - "original": canvas keeps the source dimensions and the subject stays
 *   exactly where it was photographed (no crop, no recentering).
 * - "square": fixed square canvas, subject cropped to its bounding box,
 *   scaled to leave the configured margin and centered.
 */
export async function compositeCutout(cutout: Blob, settings: Settings): Promise<CompositeResult> {
  const bitmap = await createImageBitmap(cutout);
  try {
    if (settings.outputFormat === "original") {
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas 2D non disponibile");
      ctx.fillStyle = settings.backgroundColor;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(bitmap, 0, 0);
      return { blob: await toBlob(canvas, settings.jpegQuality), width: canvas.width, height: canvas.height };
    }

    // square mode: find the subject before placing it
    const scratch = document.createElement("canvas");
    scratch.width = bitmap.width;
    scratch.height = bitmap.height;
    const scratchCtx = scratch.getContext("2d", { willReadFrequently: true });
    if (!scratchCtx) throw new Error("Canvas 2D non disponibile");
    scratchCtx.drawImage(bitmap, 0, 0);
    const bbox = alphaBoundingBox(scratchCtx, bitmap.width, bitmap.height);
    if (!bbox) throw new Error("Nessun soggetto rilevato nell'immagine");

    const size = settings.squareSize;
    const content = size * (1 - (2 * settings.marginPercent) / 100);
    const scale = Math.min(content / bbox.w, content / bbox.h);
    const w = bbox.w * scale;
    const h = bbox.h * scale;

    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D non disponibile");
    ctx.fillStyle = settings.backgroundColor;
    ctx.fillRect(0, 0, size, size);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, bbox.x, bbox.y, bbox.w, bbox.h, (size - w) / 2, (size - h) / 2, w, h);
    return { blob: await toBlob(canvas, settings.jpegQuality), width: size, height: size };
  } finally {
    bitmap.close();
  }
}

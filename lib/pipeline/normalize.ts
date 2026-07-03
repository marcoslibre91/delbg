/**
 * Image normalization: any supported input (HEIC/JPG/PNG/WEBP) becomes an
 * EXIF-corrected RGB JPEG small enough to travel through the API proxy
 * (Vercel functions reject bodies over 4.5 MB).
 */

const MAX_UPLOAD_SIDE = 4096;
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
const THUMB_SIDE = 320;

export interface NormalizedImage {
  blob: Blob;
  width: number;
  height: number;
}

export function isHeic(file: File): boolean {
  const type = file.type.toLowerCase();
  if (type === "image/heic" || type === "image/heif") return true;
  return /\.(heic|heif)$/i.test(file.name);
}

export function isSupportedImage(file: File): boolean {
  if (isHeic(file)) return true;
  return /^image\/(jpeg|png|webp)$/.test(file.type.toLowerCase());
}

async function decode(file: File): Promise<ImageBitmap> {
  let blob: Blob = file;
  if (isHeic(file)) {
    const heic2any = (await import("heic2any")).default;
    const converted = await heic2any({ blob, toType: "image/jpeg", quality: 0.95 });
    blob = Array.isArray(converted) ? converted[0] : converted;
  }
  // imageOrientation: "from-image" applies the EXIF rotation during decode
  return createImageBitmap(blob, { imageOrientation: "from-image" });
}

function drawToCanvas(bitmap: ImageBitmap, width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D non disponibile");
  // white base so semi-transparent PNG/WEBP sources flatten predictably
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, 0, width, height);
  return canvas;
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Esportazione canvas fallita"))),
      type,
      quality
    );
  });
}

/** Full-size normalization used as pipeline input. */
export async function normalizeImage(file: File): Promise<NormalizedImage> {
  const bitmap = await decode(file);
  try {
    let { width, height } = bitmap;
    const longest = Math.max(width, height);
    if (longest > MAX_UPLOAD_SIDE) {
      const scale = MAX_UPLOAD_SIDE / longest;
      width = Math.round(width * scale);
      height = Math.round(height * scale);
    }
    const canvas = drawToCanvas(bitmap, width, height);
    let quality = 0.95;
    let blob = await canvasToBlob(canvas, "image/jpeg", quality);
    while (blob.size > MAX_UPLOAD_BYTES && quality > 0.7) {
      quality -= 0.05;
      blob = await canvasToBlob(canvas, "image/jpeg", quality);
    }
    return { blob, width, height };
  } finally {
    bitmap.close();
  }
}

/** Small preview thumbnail (works for HEIC too, which <img> cannot render natively). */
export async function makeThumbnail(file: File): Promise<Blob> {
  const bitmap = await decode(file);
  try {
    const scale = Math.min(1, THUMB_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = drawToCanvas(
      bitmap,
      Math.max(1, Math.round(bitmap.width * scale)),
      Math.max(1, Math.round(bitmap.height * scale))
    );
    return canvasToBlob(canvas, "image/jpeg", 0.8);
  } finally {
    bitmap.close();
  }
}

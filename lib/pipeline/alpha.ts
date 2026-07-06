/**
 * Alpha solidification for local model outputs.
 *
 * The in-browser models often leave "ghosts": regions removed only halfway,
 * with alpha around 30-60%. Composited on the background they show up as
 * washed-out arms/hands, and they break the pixel tools (skin removal and
 * hole filling see them as "present"). This curve forces every pixel to
 * commit: mostly-transparent → fully transparent, mostly-opaque → fully
 * opaque, with a short linear ramp to keep edges from turning jagged.
 */

const LOW = 90; // alpha <= LOW → 0
const HIGH = 166; // alpha >= HIGH → 255

export async function solidifyAlpha(cutout: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(cutout);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return cutout;
    ctx.drawImage(bitmap, 0, 0);
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = img.data;
    for (let i = 3; i < data.length; i += 4) {
      const a = data[i];
      if (a === 0 || a === 255) continue;
      if (a <= LOW) data[i] = 0;
      else if (a >= HIGH) data[i] = 255;
      else data[i] = Math.round(((a - LOW) / (HIGH - LOW)) * 255);
    }
    ctx.putImageData(img, 0, 0);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("Solidificazione alpha fallita"))),
        "image/png"
      );
    });
  } finally {
    bitmap.close();
  }
}

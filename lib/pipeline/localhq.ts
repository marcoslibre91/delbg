/**
 * "Locale HQ": in-browser background removal with BiRefNet (MIT license),
 * the strongest open-source model for dichotomous image segmentation —
 * markedly better than isnet on shaded interiors and hand-held products.
 *
 * Runs via transformers.js: WebGPU with fp16 when available, WASM fallback
 * otherwise (much slower). Model weights (~100-200 MB) are downloaded from
 * the Hugging Face hub on first use and cached by the browser.
 */

import { ProviderError } from "./providers";

const MODEL_ID = "onnx-community/BiRefNet_lite";

interface LoadedModel {
  model: {
    (inputs: Record<string, unknown>): Promise<Record<string, unknown>>;
  };
  processor: (image: unknown) => Promise<{ pixel_values: unknown }>;
  RawImage: {
    fromBlob(blob: Blob): Promise<{ width: number; height: number }>;
    fromTensor(tensor: unknown): { resize(w: number, h: number): Promise<{ data: Uint8Array | Uint8ClampedArray }> };
  };
}

let loader: Promise<LoadedModel> | null = null;

async function loadModel(): Promise<LoadedModel> {
  if (!loader) {
    loader = (async () => {
      const { AutoModel, AutoProcessor, RawImage } = await import("@huggingface/transformers");
      const hasWebGPU = typeof navigator !== "undefined" && "gpu" in navigator;
      const model = await AutoModel.from_pretrained(MODEL_ID, {
        device: hasWebGPU ? "webgpu" : "wasm",
        dtype: hasWebGPU ? "fp16" : "q8",
      });
      const processor = await AutoProcessor.from_pretrained(MODEL_ID, {});
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return { model, processor, RawImage } as any as LoadedModel;
    })().catch((err) => {
      loader = null; // allow a retry on the next batch
      throw err;
    });
  }
  return loader;
}

export async function removeBackgroundHQ(image: Blob): Promise<Blob> {
  let lib: LoadedModel;
  try {
    lib = await loadModel();
  } catch (err) {
    throw new ProviderError(
      `Modello Locale HQ non caricato (${err instanceof Error ? err.message.slice(0, 120) : "errore"}). ` +
        "Serve una connessione a huggingface.co per il primo download (~150 MB) e un browser recente.",
      "fatal"
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const RawImage = lib.RawImage as any;
  const source = await RawImage.fromBlob(image);
  const { pixel_values } = await lib.processor(source);
  const outputs = await lib.model({ input_image: pixel_values });
  const outputTensor =
    (outputs as Record<string, unknown>).output_image ?? Object.values(outputs)[0];
  if (!outputTensor) {
    throw new ProviderError("Locale HQ: output del modello non riconosciuto", "fatal");
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const maskTensor = (outputTensor as any)[0].sigmoid().mul(255).to("uint8");
  const mask = await RawImage.fromTensor(maskTensor).resize(source.width, source.height);

  // apply the mask as alpha over the original pixels
  const bitmap = await createImageBitmap(image);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new ProviderError("Canvas 2D non disponibile", "skip");
    ctx.drawImage(bitmap, 0, 0);
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const maskData = mask.data as Uint8Array;
    for (let p = 0; p < maskData.length; p++) {
      img.data[p * 4 + 3] = maskData[p];
    }
    ctx.putImageData(img, 0, 0);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new ProviderError("Export PNG fallito", "skip"))),
        "image/png"
      );
    });
  } finally {
    bitmap.close();
  }
}

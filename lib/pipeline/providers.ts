import type { Provider, ProviderErrorKind, Settings } from "../types";

export class ProviderError extends Error {
  kind: ProviderErrorKind;
  retryAfterMs: number | null;

  constructor(message: string, kind: ProviderErrorKind, retryAfterMs: number | null = null) {
    super(message);
    this.name = "ProviderError";
    this.kind = kind;
    this.retryAfterMs = retryAfterMs;
  }
}

function classifyStatus(status: number): ProviderErrorKind {
  if (status === 402 || status === 401 || status === 403) return "fatal"; // key/credits: retry is wasted money
  if (status === 429) return "retryable";
  if (status >= 500) return "retryable";
  return "skip"; // 4xx like "could not identify foreground": same input → same failure
}

/**
 * Returns a PNG cutout (subject with alpha channel). Compositing always
 * happens locally so the final output is pixel-identical across providers.
 */
export async function removeBackgroundWith(
  provider: Provider,
  image: Blob,
  settings: Settings,
  signal: AbortSignal
): Promise<Blob> {
  if (provider === "local") {
    const { removeBackground } = await import("@imgly/background-removal");
    // model assets are self-hosted from public/imgly (populated by
    // scripts/copy-model.mjs at build time); NEXT_PUBLIC_IMGLY_PATH can
    // point to a CDN instead
    let publicPath = process.env.NEXT_PUBLIC_IMGLY_PATH || "/imgly/";
    if (publicPath.startsWith("/")) {
      publicPath = `${window.location.origin}${publicPath}`;
    }
    return removeBackground(image, {
      publicPath,
      model: settings.localModel ?? "medium",
      output: { format: "image/png", quality: 1 },
    });
  }

  const form = new FormData();
  form.append("image_file", image, "image.jpg");

  const headers: Record<string, string> = {};
  const key = provider === "photoroom" ? settings.photoroomKey : settings.removebgKey;
  if (key.trim()) headers["x-provider-key"] = key.trim();

  let response: Response;
  try {
    response = await fetch(`/api/segment?provider=${provider}`, {
      method: "POST",
      body: form,
      headers,
      signal,
    });
  } catch (err) {
    if (signal.aborted) throw err;
    throw new ProviderError("Errore di rete verso il proxy API", "retryable");
  }

  if (!response.ok) {
    let message = `Errore ${response.status} da ${provider}`;
    try {
      const data = (await response.json()) as { message?: string };
      if (data.message) message = data.message;
    } catch {
      // non-JSON error body: keep the generic message
    }
    const retryAfter = response.headers.get("retry-after");
    throw new ProviderError(
      message,
      classifyStatus(response.status),
      retryAfter ? Number(retryAfter) * 1000 : null
    );
  }

  return response.blob();
}

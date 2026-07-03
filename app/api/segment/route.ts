import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Thin proxy so provider API keys never live in the browser.
 * Key resolution: server env var first (production), then the
 * `x-provider-key` header (key pasted in the UI, kept in localStorage).
 * Always requests a PNG cutout with alpha — compositing happens client-side.
 */

interface ProviderTarget {
  url: string;
  keyHeader: string;
  envVar: string;
  extraFields: Record<string, string>;
}

const TARGETS: Record<string, ProviderTarget> = {
  photoroom: {
    url: "https://sdk.photoroom.com/v1/segment",
    keyHeader: "x-api-key",
    envVar: "PHOTOROOM_API_KEY",
    extraFields: { format: "png" },
  },
  removebg: {
    url: "https://api.remove.bg/v1.0/removebg",
    keyHeader: "X-Api-Key",
    envVar: "REMOVEBG_API_KEY",
    extraFields: { format: "png", size: "auto" },
  },
};

function errorJson(status: number, message: string, retryAfter?: string | null) {
  const headers = new Headers({ "content-type": "application/json" });
  if (retryAfter) headers.set("retry-after", retryAfter);
  return new NextResponse(JSON.stringify({ message }), { status, headers });
}

export async function POST(request: NextRequest) {
  const provider = request.nextUrl.searchParams.get("provider") ?? "";
  const target = TARGETS[provider];
  if (!target) {
    return errorJson(400, `Provider sconosciuto: "${provider}"`);
  }

  const apiKey = process.env[target.envVar] || request.headers.get("x-provider-key");
  if (!apiKey) {
    return errorJson(
      401,
      `Chiave API ${provider} mancante: inseriscila nelle impostazioni oppure configura ${target.envVar} sul server`
    );
  }

  let image: FormDataEntryValue | null;
  try {
    const form = await request.formData();
    image = form.get("image_file");
  } catch {
    return errorJson(400, "Body non valido: atteso multipart/form-data con image_file");
  }
  if (!(image instanceof File)) {
    return errorJson(400, "Campo image_file mancante");
  }

  const outbound = new FormData();
  outbound.append("image_file", image, image.name || "image.jpg");
  for (const [field, value] of Object.entries(target.extraFields)) {
    outbound.append(field, value);
  }

  let upstream: Response;
  try {
    upstream = await fetch(target.url, {
      method: "POST",
      headers: { [target.keyHeader]: apiKey },
      body: outbound,
    });
  } catch {
    return errorJson(502, `Impossibile raggiungere ${provider}`);
  }

  if (!upstream.ok) {
    let message = `${provider} ha risposto ${upstream.status}`;
    try {
      const body = await upstream.text();
      try {
        const data = JSON.parse(body) as {
          detail?: string;
          errors?: Array<{ title?: string; detail?: string }>;
        };
        message =
          data.detail ||
          data.errors?.map((e) => e.detail || e.title).filter(Boolean).join("; ") ||
          message;
      } catch {
        if (body) message = `${message}: ${body.slice(0, 300)}`;
      }
    } catch {
      // upstream body unreadable: keep the status-based message
    }
    return errorJson(upstream.status, message, upstream.headers.get("retry-after"));
  }

  return new NextResponse(upstream.body, {
    status: 200,
    headers: { "content-type": "image/png", "cache-control": "no-store" },
  });
}

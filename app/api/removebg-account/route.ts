import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

interface RemoveBgAccount {
  data?: {
    attributes?: {
      credits?: { total?: number; subscription?: number; payg?: number };
      api?: { free_calls?: number };
    };
  };
}

/**
 * Free credit check against remove.bg /account: shows the remaining balance
 * in the UI before spending anything. Uses the server key when configured,
 * otherwise the key pasted in the browser (x-provider-key header).
 */
export async function GET(request: NextRequest) {
  if (
    process.env.APP_PASSWORD &&
    request.headers.get("x-app-password") !== process.env.APP_PASSWORD
  ) {
    return NextResponse.json({ message: "Password dell'app mancante o errata" }, { status: 401 });
  }

  const serverKey = process.env.REMOVEBG_API_KEY;
  const apiKey = serverKey || request.headers.get("x-provider-key");
  if (!apiKey) {
    return NextResponse.json({ message: "Nessuna chiave remove.bg configurata" }, { status: 404 });
  }

  let upstream: Response;
  try {
    upstream = await fetch("https://api.remove.bg/v1.0/account", {
      headers: { "X-Api-Key": apiKey },
      cache: "no-store",
    });
  } catch {
    return NextResponse.json({ message: "Impossibile raggiungere remove.bg" }, { status: 502 });
  }

  if (!upstream.ok) {
    const message =
      upstream.status === 403
        ? "Chiave remove.bg non valida"
        : `remove.bg ha risposto ${upstream.status}`;
    return NextResponse.json({ message }, { status: upstream.status });
  }

  const account = (await upstream.json()) as RemoveBgAccount;
  const attributes = account.data?.attributes;
  return NextResponse.json(
    {
      credits: attributes?.credits?.total ?? 0,
      freeCalls: attributes?.api?.free_calls ?? 0,
      source: serverKey ? "server" : "browser",
    },
    { headers: { "cache-control": "no-store" } }
  );
}

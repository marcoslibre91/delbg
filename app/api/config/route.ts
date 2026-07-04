import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * Tells the client whether a password gate is active, whether the provided
 * password is valid, and (only once authorized) which providers have a key
 * configured server-side — so the UI badges never lie.
 */
export async function GET(request: NextRequest) {
  const required = Boolean(process.env.APP_PASSWORD);
  const authorized =
    !required || request.headers.get("x-app-password") === process.env.APP_PASSWORD;

  return NextResponse.json(
    {
      passwordRequired: required,
      authorized,
      serverKeys: authorized
        ? {
            photoroom: Boolean(process.env.PHOTOROOM_API_KEY),
            removebg: Boolean(process.env.REMOVEBG_API_KEY),
          }
        : null,
    },
    { headers: { "cache-control": "no-store" } }
  );
}

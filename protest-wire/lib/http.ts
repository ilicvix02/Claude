// Small helpers shared by the API routes.
import { NextResponse } from "next/server";

export function ok(data: unknown, cacheSeconds = 0): NextResponse {
  return NextResponse.json(data, {
    headers: {
      "cache-control": cacheSeconds > 0 ? `public, s-maxage=${cacheSeconds}, stale-while-revalidate=${cacheSeconds * 3}` : "no-store",
    },
  });
}

export function fail(status: number, error: string): NextResponse {
  return NextResponse.json({ error }, { status, headers: { "cache-control": "no-store" } });
}

export async function body<T>(req: Request): Promise<Partial<T>> {
  try {
    const text = await req.text();
    if (text.length > 20_000) return {};
    return JSON.parse(text) as Partial<T>;
  } catch {
    return {};
  }
}

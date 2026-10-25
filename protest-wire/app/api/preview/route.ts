import { fail, ok } from "@/lib/http.ts";
import { extractUrl } from "@/lib/platforms.ts";
import { preview, resolveLink } from "@/lib/sources/oembed.ts";

export const dynamic = "force-dynamic";

// Shows the submitter what we'll embed before they send it.
export async function GET(req: Request) {
  const raw = extractUrl(new URL(req.url).searchParams.get("url") ?? "");
  const link = raw ? await resolveLink(raw) : null;
  if (!link) return fail(400, "unsupported link");
  return ok({ link, meta: await preview(link) }, 300);
}

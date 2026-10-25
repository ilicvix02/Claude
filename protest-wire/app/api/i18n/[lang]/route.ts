import { ok, fail } from "@/lib/http.ts";
import { isLocale } from "@/lib/i18n.ts";
import { dictionaryChain } from "@/lib/locales.ts";

// UI strings for one language (fetched when someone switches language).
export async function GET(_req: Request, ctx: { params: Promise<{ lang: string }> }) {
  const { lang } = await ctx.params;
  if (!isLocale(lang)) return fail(404, "unknown language");
  return ok({ lang, chain: dictionaryChain(lang) }, 3600);
}

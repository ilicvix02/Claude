import { App } from "@/components/App.tsx";
import { homeData } from "@/lib/data.ts";
import { dictionaryChain } from "@/lib/locales.ts";
import { extractUrl } from "@/lib/platforms.ts";
import { serverLang } from "@/lib/serverLang.ts";

export const dynamic = "force-dynamic";

// Share target: on Android, "Share → Protest Wire" from TikTok or Instagram opens this with the link.
export default async function Drop({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const q = await searchParams;
  const url = extractUrl([q.url, q.text, q.title].filter(Boolean).join(" ")) ?? "";
  const lang = await serverLang();
  return <App lang={lang} chain={dictionaryChain(lang)} data={await homeData(lang)} dropUrl={url} />;
}

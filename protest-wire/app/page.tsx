import type { Metadata } from "next";
import { App } from "@/components/App.tsx";
import { homeData } from "@/lib/data.ts";
import { dictionaryChain } from "@/lib/locales.ts";
import { serverLang } from "@/lib/serverLang.ts";

export const dynamic = "force-dynamic";

type Search = Promise<Record<string, string | string[] | undefined>>;

// Invite links (/?from=rs-belgrade&n=4812) get their own share image.
export async function generateMetadata({ searchParams }: { searchParams: Search }): Promise<Metadata> {
  const q = await searchParams;
  const from = typeof q.from === "string" ? q.from : "";
  const n = typeof q.n === "string" && /^\d{1,9}$/.test(q.n) ? q.n : "";
  if (!from && !n) return {};
  const img = `/api/og?${new URLSearchParams({ ...(from ? { from } : {}), ...(n ? { n } : {}) })}`;
  return { openGraph: { images: [img] }, twitter: { card: "summary_large_image", images: [img] } };
}

export default async function Home() {
  const lang = await serverLang();
  const data = await homeData(lang);
  return <App lang={lang} chain={dictionaryChain(lang)} data={data} />;
}

import type { Metadata } from "next";
import { App } from "@/components/App.tsx";
import { homeData } from "@/lib/data.ts";
import { getDb } from "@/lib/db.ts";
import { dictionaryChain } from "@/lib/locales.ts";
import { getClip } from "@/lib/repo.ts";
import { serverLang } from "@/lib/serverLang.ts";

export const dynamic = "force-dynamic";

type Params = Promise<{ id: string }>;

// A shared clip: link previews show the clip; the page opens the feed at that clip.
export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { id } = await params;
  const clip = await getClip(await getDb(), decodeURIComponent(id));
  if (!clip || clip.status !== "approved") return {};
  const title = clip.caption || clip.title.split("\n")[0] || "Protest Wire";
  const img = `/api/og?clip=${encodeURIComponent(clip.id)}`;
  return {
    title: `${title} · Protest Wire`,
    description: [clip.place, clip.authorHandle].filter(Boolean).join(" · "),
    openGraph: { title, images: [img], type: "video.other" },
    twitter: { card: "summary_large_image", title, images: [img] },
  };
}

export default async function ClipPage({ params }: { params: Params }) {
  const { id } = await params;
  const lang = await serverLang();
  return <App lang={lang} chain={dictionaryChain(lang)} data={await homeData(lang)} openClip={decodeURIComponent(id)} />;
}

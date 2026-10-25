import { ImageResponse } from "next/og";
import { getDb } from "@/lib/db.ts";
import { city as cityByKey, country as countryByCode, flag } from "@/lib/geo.ts";
import { getClip, getSettings } from "@/lib/repo.ts";

export const dynamic = "force-dynamic";

const LIME = "#D4F94E";
const INK = "#0A0B0A";

/** Fetch just the glyphs we need from Google Fonts (works for Latin, Cyrillic and Greek text). */
async function font(text: string): Promise<ArrayBuffer | null> {
  try {
    const css = await (await fetch(`https://fonts.googleapis.com/css2?family=Inter+Tight:wght@800&text=${encodeURIComponent(text)}`, {
      headers: { "user-agent": "Mozilla/5.0 (Windows NT 6.1) AppleWebKit/534.30 (KHTML, like Gecko) Safari/534.30" },
    })).text();
    const url = css.match(/src: url\((.+?)\) format\('(?:truetype|opentype)'\)/)?.[1];
    return url ? await (await fetch(url)).arrayBuffer() : null;
  } catch {
    return null;
  }
}

function Mark({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64">
      <path d="M32 3 57 17.5v29L32 61 7 46.5v-29Z" fill="none" stroke={LIME} strokeWidth="4" strokeLinejoin="round" />
      <path d="M19 42 32 31l13 11M19 33 32 22l13 11M19 24 32 13l13 11" fill="none" stroke={LIME} strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const db = await getDb();
  let kicker = "● LIVE · THE WORLD IS RISING";
  let big = "THE STREETS ARE SPEAKING.";
  let small = "Raw videos from the people in the streets. Count yourself in.";
  let bg: string | null = null;

  const clipId = q.get("clip");
  const from = cityByKey(q.get("from"));
  const n = q.get("n");
  if (clipId) {
    const c = await getClip(db, clipId);
    if (c && c.status === "approved") {
      kicker = `● ${[c.place, countryByCode(c.country)?.en].filter(Boolean).join(", ").toUpperCase() || "FROM THE STREETS"}`;
      big = (c.caption || c.title.split("\n")[0] || "From the streets").slice(0, 110);
      small = `${c.authorHandle || c.authorName} · tap to watch`;
      bg = c.thumbnail || null;
    }
  } else if (from || n) {
    kicker = from ? `${flag(from.country)} ${from.en.toUpperCase()} IS IN` : "● JOIN THE MOVEMENT";
    big = n && /^\d{1,9}$/.test(n) ? `I'M #${Number(n).toLocaleString("en-US")}. ARE YOU IN?` : "ARE YOU IN?";
    small = "No account. No tracking. Just your city on the map.";
  } else {
    const s = await getSettings(db);
    if (s.headline) big = s.headline.replace(/\*/g, "");
  }

  const fontData = await font(`${kicker}${big}${small}PROTESTWIRE0123456789#·`);
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: INK, color: "#fff", padding: 64, position: "relative", fontFamily: fontData ? "Inter Tight" : undefined }}>
        {bg && <img src={bg} width={1200} height={630} style={{ position: "absolute", inset: 0, objectFit: "cover", opacity: 0.45 }} alt="" />}
        <div style={{ position: "absolute", inset: 0, display: "flex", background: `radial-gradient(ellipse at 50% 0%, rgba(212,249,78,.35), transparent 60%), linear-gradient(180deg, rgba(10,11,10,.2), ${INK} 90%)` }} />
        <div style={{ display: "flex", alignItems: "center", gap: 18, position: "relative" }}>
          <Mark size={64} />
          <div style={{ display: "flex", fontSize: 36, fontWeight: 800, letterSpacing: 2 }}>PROTEST<span style={{ color: LIME }}>WIRE</span></div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 18, position: "relative" }}>
          <div style={{ display: "flex", alignSelf: "flex-start", color: LIME, fontSize: 28, fontWeight: 800, border: `3px solid ${LIME}`, borderRadius: 999, padding: "8px 22px" }}>{kicker}</div>
          <div style={{ display: "flex", fontSize: big.length > 60 ? 58 : 76, fontWeight: 800, lineHeight: 1.02, letterSpacing: -2 }}>{big}</div>
          <div style={{ display: "flex", fontSize: 30, color: "rgba(255,255,255,.8)" }}>{small}</div>
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
      fonts: fontData ? [{ name: "Inter Tight", data: fontData, weight: 800, style: "normal" }] : undefined,
      headers: { "cache-control": "public, s-maxage=600, stale-while-revalidate=3600" },
    },
  );
}

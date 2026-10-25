"use client";

import { useCallback, useEffect, useState } from "react";
import { postJson } from "@/lib/client.ts";
import { CITIES, flag } from "@/lib/geo.ts";
import { PLATFORM_NAMES } from "@/lib/platforms.ts";
import type { Clip, Item, Poll, Settings } from "@/lib/repo.ts";

const TAGS = ["incident", "alert", "turnout", "results", "rally", "official"] as const;

interface AdminData {
  pending: Clip[];
  review: Clip[];
  approved: Clip[];
  live: Clip[];
  items: Item[];
  settings: Settings;
  poll: Poll | null;
  runs: Array<{ startedAt: string; finishedAt: string; ok: boolean | null; stats: Record<string, unknown> }>;
  usage: { aiUsd: number; aiBudget: number; ytUnits: number; ytQuota: number };
  features: { db: string; ai: boolean; youtube: boolean; instagram: boolean; autoApprove: string };
}

function when(iso: string): string {
  return iso ? new Date(iso).toLocaleString() : "–";
}

function CitySelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <select className="input" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">City…</option>
      {CITIES.map((c) => <option key={c.key} value={c.key}>{flag(c.country)} {c.en}</option>)}
    </select>
  );
}

function Login({ onDone }: { onDone: () => void }) {
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  return (
    <form className="admin-login" onSubmit={async (e) => {
      e.preventDefault();
      try { await postJson("/api/admin/login", { password: pw }); onDone(); } catch (x) { setErr((x as Error).message); }
    }}>
      <h1>Protest Wire · Admin</h1>
      <input className="input" type="password" autoComplete="current-password" placeholder="Admin password" value={pw} onChange={(e) => setPw(e.target.value)} />
      {err && <p className="error">{err}</p>}
      <button className="cta">Log in</button>
    </form>
  );
}

function ClipRow({ c, act }: { c: Clip; act: (a: Record<string, unknown>) => Promise<void> }) {
  const [caption, setCaption] = useState(c.caption);
  const [city, setCity] = useState("");
  return (
    <li className="admin-clip">
      <a href={c.url} target="_blank" rel="noopener noreferrer" className="admin-thumb" style={c.thumbnail ? { backgroundImage: `url("${c.thumbnail}")` } : undefined}>
        <span className={`plat plat-${c.platform}`}>{PLATFORM_NAMES[c.platform]}</span>
      </a>
      <div className="admin-clip-body">
        <p className="admin-small">
          <b>{c.origin}</b> · {c.authorHandle || c.authorName || "?"} · {when(c.postedAt)} · {flag(c.country)} {c.place || "no place"}
          {c.firsthand === false && <span className="warn"> · AI: not first-hand</span>}
          {c.reports > 0 && <span className="warn"> · {c.reports} reports</span>}
          {c.isLive && <span className="warn"> · LIVE</span>}
        </p>
        {c.title && <p className="admin-orig">“{c.title.slice(0, 300)}”</p>}
        {c.note && <p className="admin-small">Note: {c.note}</p>}
        <textarea className="input" rows={2} value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="Caption (English)" />
        <div className="admin-actions">
          <CitySelect value={city} onChange={setCity} />
          <button className="btn" onClick={() => void act({ action: "clip.update", id: c.id, caption, city })}>Save</button>
          {c.status !== "approved" && <button className="btn ok" onClick={() => void act({ action: "clip.status", id: c.id, status: "approved" })}>Approve</button>}
          {c.status !== "rejected" && <button className="btn bad" onClick={() => void act({ action: "clip.status", id: c.id, status: "rejected" })}>Reject</button>}
          {c.status === "approved" && <button className="btn" onClick={() => void act({ action: "clip.pin", id: c.id, pinned: !c.pinned })}>{c.pinned ? "Unpin" : "Pin to top"}</button>}
        </div>
      </div>
    </li>
  );
}

function ItemRow({ it, act }: { it: Item; act: (a: Record<string, unknown>) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ title: it.title, body: it.body, tag: it.tag, place: it.place, country: it.country });
  return (
    <li className={`admin-item ${it.hidden ? "hidden" : ""}`}>
      <p className="admin-small">
        {when(it.publishedAt)} · {it.tag} · {flag(it.country)} {it.place} · {it.sources.map((s) => s.name).join(", ")}
        {it.hidden && <b className="warn"> · HIDDEN</b>}
        {it.reviewReason && <span className="warn"> · {it.reviewReason}</span>}
      </p>
      <p><b>{it.title}</b></p>
      {open ? (
        <div className="admin-form">
          <input className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
          <textarea className="input" rows={3} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} />
          <div className="admin-actions">
            <select className="input" value={f.tag} onChange={(e) => setF({ ...f, tag: e.target.value as Item["tag"] })}>{TAGS.map((t) => <option key={t}>{t}</option>)}</select>
            <input className="input" value={f.place} placeholder="Place" onChange={(e) => setF({ ...f, place: e.target.value })} />
            <input className="input short" value={f.country} placeholder="CC" maxLength={2} onChange={(e) => setF({ ...f, country: e.target.value })} />
            <button className="btn ok" onClick={() => void act({ action: "item.update", id: it.id, ...f }).then(() => setOpen(false))}>Save</button>
          </div>
        </div>
      ) : (
        <div className="admin-actions">
          <button className="btn" onClick={() => setOpen(true)}>Edit</button>
          <button className="btn" onClick={() => void act({ action: "item.update", id: it.id, hidden: !it.hidden })}>{it.hidden ? "Publish" : "Hide"}</button>
          {it.sources[0] && <a className="btn" href={it.sources[0].url} target="_blank" rel="noopener noreferrer">Source ↗</a>}
        </div>
      )}
    </li>
  );
}

export function Admin() {
  const [data, setData] = useState<AdminData | null>(null);
  const [need, setNeed] = useState(false);
  const [msg, setMsg] = useState("");
  const [tab, setTab] = useState<"queue" | "live" | "wire" | "site">("queue");
  const [settings, setSettings] = useState<Settings | null>(null);
  const [addUrl, setAddUrl] = useState("");
  const [addCity, setAddCity] = useState("");
  const [streamUrl, setStreamUrl] = useState("");
  const [poll, setPoll] = useState({ question: "", options: ["", "", "", ""] });

  const load = useCallback(async () => {
    const r = await fetch("/api/admin/data", { cache: "no-store" });
    if (r.status === 401) { setNeed(true); return; }
    const j = (await r.json()) as AdminData;
    setNeed(false);
    setData(j);
    setSettings((cur) => cur ?? j.settings);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const act = useCallback(async (a: Record<string, unknown>) => {
    setMsg("Working…");
    try {
      const r = await postJson<{ stats?: unknown }>("/api/admin/action", a);
      setMsg(r.stats ? `Run finished: ${JSON.stringify(r.stats)}` : "Saved ✓");
      await load();
    } catch (e) {
      setMsg(`Error: ${(e as Error).message}`);
    }
  }, [load]);

  if (need) return <Login onDone={() => void load()} />;
  if (!data || !settings) return <p className="admin-wrap">Loading…</p>;
  const last = data.runs[0];

  return (
    <div className="admin-wrap">
      <header className="admin-head">
        <h1>Protest Wire · Admin</h1>
        <div className="admin-actions">
          <a className="btn" href="/">View site</a>
          <button className="btn" onClick={() => void act({ action: "run" })}>Run pipeline now</button>
          <button className="btn" onClick={async () => { await postJson("/api/admin/logout", {}); location.reload(); }}>Log out</button>
        </div>
      </header>
      <p className="admin-small">
        DB: <b>{data.features.db}</b> · AI: <b>{data.features.ai ? "on" : "off"}</b> (${data.usage.aiUsd.toFixed(3)} of ${data.usage.aiBudget} today) ·
        YouTube: <b>{data.features.youtube ? "on" : "off"}</b> ({data.usage.ytUnits} / {data.usage.ytQuota} units) ·
        Instagram: <b>{data.features.instagram ? "on" : "off"}</b> · Submissions: <b>{data.features.autoApprove}</b> ·
        Last run: {last ? `${when(last.finishedAt || last.startedAt)} ${last.ok ? "✓" : "⚠"}` : "never"}
      </p>
      {last && Array.isArray(last.stats.errors) && (last.stats.errors as string[]).length > 0 && (
        <details className="admin-small"><summary>Last run errors ({(last.stats.errors as string[]).length})</summary><ul>{(last.stats.errors as string[]).map((e) => <li key={e}>{e}</li>)}</ul></details>
      )}
      {msg && <p className="admin-msg">{msg}</p>}

      <nav className="tabs">
        {(["queue", "live", "wire", "site"] as const).map((t) => (
          <button key={t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>
            {t === "queue" ? `Clips (${data.pending.length + data.review.length} waiting)` : t === "live" ? `Live (${data.live.length})` : t === "wire" ? "Wire" : "Site & Pulse"}
          </button>
        ))}
      </nav>

      {tab === "queue" && (
        <>
          <h2>Add a clip</h2>
          <div className="admin-actions">
            <input className="input" placeholder="TikTok / Instagram / X / YouTube / Bluesky / Mastodon link" value={addUrl} onChange={(e) => setAddUrl(e.target.value)} />
            <CitySelect value={addCity} onChange={setAddCity} />
            <button className="btn ok" onClick={() => void act({ action: "clip.add", url: addUrl, city: addCity }).then(() => setAddUrl(""))}>Add (approved)</button>
          </div>
          <h2>Reported ({data.review.length})</h2>
          <ul className="admin-list">{data.review.map((c) => <ClipRow key={c.id} c={c} act={act} />)}</ul>
          <h2>Waiting for review ({data.pending.length})</h2>
          <ul className="admin-list">{data.pending.map((c) => <ClipRow key={c.id} c={c} act={act} />)}</ul>
          <h2>Recently approved</h2>
          <ul className="admin-list">{data.approved.map((c) => <ClipRow key={c.id} c={c} act={act} />)}</ul>
        </>
      )}

      {tab === "live" && (
        <>
          <h2>Pin a live stream</h2>
          <p className="admin-small">Paste a YouTube live link from someone on the ground. It goes to the top of the player.</p>
          <div className="admin-actions">
            <input className="input" placeholder="https://www.youtube.com/watch?v=…" value={streamUrl} onChange={(e) => setStreamUrl(e.target.value)} />
            <button className="btn ok" onClick={() => void act({ action: "stream.pin", url: streamUrl }).then(() => setStreamUrl(""))}>Pin</button>
          </div>
          <ul className="admin-list">
            {data.live.map((c) => (
              <li key={c.id} className="admin-item">
                <p><b>{c.authorName}</b> · {c.title.split("\n")[0]} · {c.liveViewers ?? "?"} watching {c.pinned && <b className="warn">PINNED</b>}</p>
                <div className="admin-actions">
                  <a className="btn" href={c.url} target="_blank" rel="noopener noreferrer">Open ↗</a>
                  <button className="btn" onClick={() => void act({ action: "stream.unpin", id: c.id })}>Remove from live</button>
                  <button className="btn bad" onClick={() => void act({ action: "clip.status", id: c.id, status: "rejected" })}>Block</button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {tab === "wire" && (
        <ul className="admin-list">
          {[...data.items].sort((a, b) => Number(b.hidden && !!b.reviewReason) - Number(a.hidden && !!a.reviewReason)).map((it) => <ItemRow key={it.id} it={it} act={act} />)}
        </ul>
      )}

      {tab === "site" && (
        <>
          <h2>Hero & announcement</h2>
          <div className="admin-form">
            <label className="label">Headline (wrap words in *asterisks* to make them lime; empty = default)</label>
            <input className="input" value={settings.headline} onChange={(e) => setSettings({ ...settings, headline: e.target.value })} />
            <label className="label">Lede</label>
            <textarea className="input" rows={2} value={settings.lede} onChange={(e) => setSettings({ ...settings, lede: e.target.value })} />
            <label className="label">Live pill (e.g. "Belgrade · Slavija"; empty = latest places)</label>
            <input className="input" value={settings.event} onChange={(e) => setSettings({ ...settings, event: e.target.value })} />
            <label className="label">Top bar announcement (the single most important update)</label>
            <input className="input" value={settings.announcement} onChange={(e) => setSettings({ ...settings, announcement: e.target.value })} />
            <label className="label">Announcement link (optional)</label>
            <input className="input" value={settings.announcementUrl} onChange={(e) => setSettings({ ...settings, announcementUrl: e.target.value })} />
            <label className="label">Global Minute, daily time in UTC (HH:MM)</label>
            <input className="input short" value={settings.minuteUtc} onChange={(e) => setSettings({ ...settings, minuteUtc: e.target.value })} />
            <label className="label">Extra hashtags to promote (comma separated)</label>
            <input className="input" value={settings.hashtags.join(", ")} onChange={(e) => setSettings({ ...settings, hashtags: e.target.value.split(",").map((s) => s.trim().replace(/^#/, "")).filter(Boolean) })} />
            <p className="admin-small">Write in English: every other language is translated automatically.</p>
            <button className="cta" onClick={() => void act({ action: "settings.save", settings })}>Save</button>
          </div>
          <h2>The People's Pulse</h2>
          {data.poll && (
            <div className="admin-item">
              <p><b>{data.poll.question}</b> · {data.poll.total} votes</p>
              <p className="admin-small">{data.poll.options.map((o, i) => `${o}: ${data.poll!.counts[i]}`).join(" · ")}</p>
              <button className="btn" onClick={() => void act({ action: "poll.close" })}>Close poll</button>
            </div>
          )}
          <div className="admin-form">
            <input className="input" placeholder="Question" value={poll.question} onChange={(e) => setPoll({ ...poll, question: e.target.value })} />
            {poll.options.map((o, i) => (
              <input key={i} className="input" placeholder={`Option ${i + 1}${i > 1 ? " (optional)" : ""}`} value={o} onChange={(e) => setPoll({ ...poll, options: poll.options.map((x, k) => (k === i ? e.target.value : x)) })} />
            ))}
            <button className="btn ok" onClick={() => void act({ action: "poll.create", ...poll }).then(() => setPoll({ question: "", options: ["", "", "", ""] }))}>Start new poll</button>
          </div>
          <h2>Recent runs</h2>
          <ul className="admin-list">
            {data.runs.map((r) => (
              <li key={r.startedAt} className="admin-small">{when(r.startedAt)} · {r.ok === null ? "running/aborted" : r.ok ? "ok" : "with errors"} · {JSON.stringify({ ...r.stats, errors: undefined })}</li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

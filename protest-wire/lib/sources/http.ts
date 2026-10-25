const UA = "Mozilla/5.0 (compatible; ProtestWire/1.0; +https://github.com/ilicvix02/claude)";

export async function fetchText(url: string, opts: { timeoutMs?: number; headers?: Record<string, string>; method?: string } = {}): Promise<{ status: number; text: string; finalUrl: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 12_000);
  try {
    const res = await fetch(url, {
      method: opts.method ?? "GET",
      headers: { "user-agent": UA, accept: "*/*", ...opts.headers },
      signal: ctrl.signal,
      redirect: "follow",
      cache: "no-store",
    });
    const text = opts.method === "HEAD" ? "" : await res.text();
    return { status: res.status, text, finalUrl: res.url || url };
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchJson<T>(url: string, opts: { timeoutMs?: number; headers?: Record<string, string> } = {}): Promise<T> {
  const r = await fetchText(url, { ...opts, headers: { accept: "application/json", ...opts.headers } });
  if (r.status < 200 || r.status >= 300) throw new Error(`HTTP ${r.status} for ${new URL(url).host}: ${r.text.slice(0, 160)}`);
  return JSON.parse(r.text) as T;
}

/** Run async jobs with limited concurrency, collecting results and errors separately. */
export async function pool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<Array<{ item: T; value?: R; error?: unknown }>> {
  const out: Array<{ item: T; value?: R; error?: unknown }> = [];
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const item = items[i++];
      try { out.push({ item, value: await fn(item) }); } catch (error) { out.push({ item, error }); }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

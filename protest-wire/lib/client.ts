"use client";
// Browser-only helpers. Storage access is wrapped: private windows and blocked storage must not break the page.

export function store(key: string, value?: string | null): string | null {
  try {
    if (value === undefined) return localStorage.getItem(key);
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // ignore
  }
  return value ?? null;
}

/** Random anonymous id for this device (never linked to a person; hashed again on the server). */
export function deviceId(): string {
  let id = store("pw-device");
  if (!id || !/^[A-Za-z0-9_-]{16,64}$/.test(id)) {
    const bytes = new Uint8Array(18);
    crypto.getRandomValues(bytes);
    id = btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    store("pw-device", id);
  }
  return id;
}

export function setLangCookie(lang: string): void {
  document.cookie = `pw-lang=${encodeURIComponent(lang)}; path=/; max-age=31536000; samesite=lax`;
}

export async function postJson<T>(url: string, data: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data) });
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}

export function siteOrigin(): string {
  return window.location.origin;
}

export function inviteUrl(cityKey: string | null, n?: number): string {
  const u = new URL("/", siteOrigin());
  if (cityKey) u.searchParams.set("from", cityKey);
  if (n) u.searchParams.set("n", String(n));
  return u.toString();
}

export async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Share text + link with the native share sheet; falls back to copying the link. */
export async function shareLink(text: string, url: string): Promise<"shared" | "copied" | "failed"> {
  try {
    if (navigator.share) {
      await navigator.share({ text, url });
      return "shared";
    }
  } catch (err) {
    if ((err as Error).name === "AbortError") return "failed";
  }
  return (await copy(`${text} ${url}`)) ? "copied" : "failed";
}

/** Share an image (Instagram / TikTok Stories pick it up from the share sheet); falls back to download. */
export async function shareImage(canvas: HTMLCanvasElement, filename: string, text: string, url?: string): Promise<"shared" | "saved"> {
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
  if (!blob) return "saved";
  const file = new File([blob], filename, { type: "image/png" });
  try {
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], text: url ? `${text} ${url}` : text });
      return "shared";
    }
  } catch (err) {
    if ((err as Error).name === "AbortError") return "shared";
  }
  downloadBlob(blob, filename);
  return "saved";
}

export function downloadBlob(blob: Blob, filename: string): void {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

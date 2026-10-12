// Breaking alerts: asks for notification permission shortly after the app loads (once), then
// notifies when a conflict newly turns critical or starts escalating between data refreshes.
(function () {
  const I18N = window.WP_I18N, tr = (k) => I18N.t(k);
  const ASKED = "wp.notify.asked", SEEN = "wp.notify.seen";
  const get = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } };
  const set = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
  const supported = "Notification" in window && "serviceWorker" in navigator;

  function sheet() {
    if (document.getElementById("notify-sheet")) return;
    const box = document.createElement("div");
    box.id = "notify-sheet";
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-labelledby", "notify-h");
    box.innerHTML = `<div class="ns-card"><h2 id="notify-h"></h2><p></p><div class="ns-actions"><button class="ns-yes"></button><button class="ns-no"></button></div></div>`;
    box.querySelector("h2").textContent = tr("notify.title");
    box.querySelector("p").textContent = tr("notify.text");
    const yes = box.querySelector(".ns-yes"), no = box.querySelector(".ns-no");
    yes.textContent = tr("notify.allow"); no.textContent = tr("notify.later");
    const close = () => box.remove();
    yes.onclick = () => { close(); Notification.requestPermission().then((p) => { if (p === "granted") check(true); }); };
    no.onclick = close;
    document.body.append(box);
    yes.focus();
  }

  function ask() {
    if (!supported || Notification.permission !== "default" || get(ASKED, false)) return;
    set(ASKED, true);
    sheet();
  }

  async function check(first) {
    if (!supported || Notification.permission !== "granted") return;
    try {
      const r = await fetch("api/v1/conflicts.json", { cache: "no-cache" });
      const ts = ((await r.json()).data || {}).theaters || [];
      const seen = get(SEEN, {}), now = {};
      const reg = await navigator.serviceWorker.ready;
      for (const t of ts) {
        const hot = t.status === "critical" || t.trend === "escalating";
        now[t.id] = hot;
        if (hot && !seen[t.id] && !first && Object.keys(seen).length) {
          const name = (t.i18n && t.i18n[I18N.dict] && t.i18n[I18N.dict].name) || t.name;
          reg.showNotification(`${name}: ${tr(t.status === "critical" ? "notify.critical" : "notify.escalating")}`,
            { body: tr("notify.body"), icon: "icons/icon-192.png", badge: "icons/icon-192.png", tag: `wp-${t.id}`, data: { url: `#/conflict/${t.id}` } });
        }
      }
      set(SEEN, now);
    } catch {}
  }

  setTimeout(ask, 2500);
  check(false);
  setInterval(() => check(false), 15 * 60 * 1000);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") check(false); });
})();

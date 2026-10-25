"use client";

import { useEffect, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";
import { city as cityByKey } from "@/lib/geo.ts";
import type { MapLine, MapPoint } from "@/lib/repo.ts";
import { useApp } from "./AppContext.tsx";
import { Section, SectionHead } from "./Chrome.tsx";

/** Points along a gentle arc between two places, so solidarity lines look like flight paths. */
function arc(a: [number, number], b: [number, number], steps = 24): Array<[number, number]> {
  const [lat1, lon1] = a;
  const [lat2, lon2] = b;
  const dist = Math.hypot(lat2 - lat1, lon2 - lon1);
  const out: Array<[number, number]> = [];
  for (let i = 0; i <= steps; i++) {
    const f = i / steps;
    const bump = Math.sin(Math.PI * f) * dist * 0.18;
    out.push([lat1 + (lat2 - lat1) * f + bump, lon1 + (lon2 - lon1) * f]);
  }
  return out;
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);
}

export function MapSection() {
  const { t } = useApp();
  const el = useRef<HTMLDivElement>(null);
  const [data, setData] = useState<{ points: MapPoint[]; lines: MapLine[] } | null>(null);
  const [visible, setVisible] = useState(false);
  const [land, setLand] = useState<GeoJSON.FeatureCollection | null>(null);

  // Only load the map library and tiles once the section scrolls into view.
  useEffect(() => {
    if (!el.current) return;
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setVisible(true); io.disconnect(); } }, { rootMargin: "300px" });
    io.observe(el.current);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) return;
    void fetch("/land.json").then((r) => r.json()).then(setLand).catch(() => undefined);
    const load = () => fetch("/api/map").then((r) => r.json()).then(setData).catch(() => undefined);
    void load();
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, [visible]);

  useEffect(() => {
    if (!visible || !data || !land || !el.current) return;
    let map: import("leaflet").Map | null = null;
    let cancelled = false;
    void import("leaflet").then((L) => {
      if (cancelled || !el.current) return;
      map = L.map(el.current, { zoomControl: false, attributionControl: true, worldCopyJump: true, scrollWheelZoom: false, minZoom: 1, maxZoom: 7 }).setView([30, 15], 1);
      map.attributionControl.setPrefix("Natural Earth");
      // No tile server: the land outlines are drawn locally, so no third party sees who is looking at the map.
      if (land) L.geoJSON(land, { style: { stroke: false, fillColor: "#1c2116", fillOpacity: 1 }, interactive: false }).addTo(map);
      for (const l of data.lines) {
        const a = cityByKey(l.from);
        const b = cityByKey(l.to);
        if (!a || !b) continue;
        L.polyline(arc([a.lat, a.lon], [b.lat, b.lon]), { color: "#D4F94E", weight: Math.min(1 + l.n * 0.5, 5), opacity: 0.55, className: "solidarity-line" }).addTo(map);
      }
      for (const p of data.points) {
        const size = Math.min(6 + Math.sqrt(p.people + p.clips * 3) * 2.2, 34);
        L.circleMarker([p.lat, p.lon], { radius: size, color: "#D4F94E", weight: 2, fillColor: "#D4F94E", fillOpacity: 0.35, className: "map-dot" })
          .bindTooltip(`<b>${esc(p.name)}</b><br>${p.people ? `👊 ${p.people} ${esc(t("map.legend_people"))}` : ""}${p.people && p.clips ? " · " : ""}${p.clips ? `▶ ${p.clips} ${esc(t("map.legend_clips"))}` : ""}`)
          .addTo(map);
      }
    });
    return () => { cancelled = true; map?.remove(); };
  }, [visible, data, land, t]);

  return (
    <Section id="map">
      <SectionHead kicker="🌍 LIVE MAP" title={t("map.title")} lede={t("map.lede")} />
      <div className="map" ref={el} />
      <p className="legend">
        <span><i className="lg-dot" /> {t("map.legend_people")} / {t("map.legend_clips")}</span>
        <span><i className="lg-line" /> {t("map.legend_lines")}</span>
      </p>
    </Section>
  );
}

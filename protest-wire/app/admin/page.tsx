import type { Metadata } from "next";
import { Admin } from "@/components/Admin.tsx";

export const metadata: Metadata = { title: "Admin · Protest Wire", robots: { index: false, follow: false } };

export default function AdminPage() {
  return <Admin />;
}

import { cookies, headers } from "next/headers";
import { isLocale, matchLocale } from "./i18n.ts";

/** Language for server rendering: the saved choice (cookie), else the browser's Accept-Language. */
export async function serverLang(): Promise<string> {
  const saved = (await cookies()).get("pw-lang")?.value;
  if (isLocale(saved)) return saved;
  return matchLocale(((await headers()).get("accept-language") ?? "").split(","));
}

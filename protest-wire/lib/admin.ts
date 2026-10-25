import { cookies } from "next/headers";
import { ADMIN_COOKIE, isValidSession } from "./auth.ts";

export async function isAdmin(): Promise<boolean> {
  const jar = await cookies();
  return isValidSession(jar.get(ADMIN_COOKIE)?.value);
}

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";

export async function getSession() {
  return auth.api.getSession({ headers: await headers() });
}

export async function requireUser() {
  const session = await getSession();
  if (!session) return null;
  return session.user;
}

/** For pages: pages render concurrently with the layout, so a missing
 * session must redirect here too, not just in the layout — otherwise the
 * page body throws on `user.id` before the layout's redirect lands. */
export async function requirePageUser() {
  const user = await requireUser();
  if (!user) redirect("/login");
  return user;
}

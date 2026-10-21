import { jwtVerify } from "jose";
import { cookies } from "next/headers";

export type SessionUser = { id: string; email: string; role: "member" | "manager" | "admin" };

const secret = new TextEncoder().encode(process.env.AUTH_SECRET);

export async function getSessionUser(): Promise<SessionUser | null> {
  const token = (await cookies()).get("crew_session")?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret);
    return payload as unknown as SessionUser;
  } catch {
    return null;
  }
}

export async function requireAdmin(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user || user.role !== "admin") throw new Response("Forbidden", { status: 403 });
  return user;
}

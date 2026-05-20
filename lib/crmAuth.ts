import { jwtVerify } from "jose";

export function getJwtSecret(): Uint8Array {
  const secret = process.env.CRM_JWT_SECRET;
  if (!secret) throw new Error("Falta CRM_JWT_SECRET");
  return new TextEncoder().encode(secret);
}

export async function requireCrmAuth(
  req: Request,
): Promise<{ sub: string } | null> {
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return null;

  const token = auth.slice("Bearer ".length).trim();
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, getJwtSecret());
    const sub = typeof payload.sub === "string" ? payload.sub : "";
    if (!sub) return null;
    return { sub };
  } catch {
    return null;
  }
}

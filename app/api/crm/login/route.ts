import { compare } from "bcryptjs";
import { SignJWT } from "jose";
import { z } from "zod";

import { getJwtSecret } from "@/lib/crmAuth";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function POST(req: Request): Promise<Response> {
  try {
    const body = await req.json();
    const parsed = LoginSchema.safeParse(body);

    if (!parsed.success) {
      return Response.json({ error: "Body inválido" }, { status: 400 });
    }

    const email = parsed.data.email.trim().toLowerCase();
    const password = parsed.data.password;

    const supabase = getSupabaseAdmin();
    const { data: advisor, error } = await supabase
      .from("advisors")
      .select("id, email, password_hash, nombre, activo")
      .eq("email", email)
      .maybeSingle();

    if (error) {
      console.error("[CRM login] Error consultando asesor:", error);
      return Response.json({ error: "Error interno" }, { status: 500 });
    }

    if (!advisor || advisor.activo !== true) {
      return Response.json({ error: "Credenciales inválidas" }, { status: 401 });
    }

    const ok = await compare(password, advisor.password_hash);
    if (!ok) {
      return Response.json({ error: "Credenciales inválidas" }, { status: 401 });
    }

    const token = await new SignJWT({
      sub: advisor.id,
      email: advisor.email,
      role: "advisor",
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("7d")
      .sign(getJwtSecret());

    return Response.json({ token, nombre: advisor.nombre }, { status: 200 });
  } catch (err) {
    console.error("[CRM login] Error:", err);
    return Response.json({ error: "Error interno" }, { status: 500 });
  }
}

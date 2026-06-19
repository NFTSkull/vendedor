import { z } from "zod";

import { requireCrmAuth } from "@/lib/crmAuth";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

const PatchSchema = z
  .object({
    estado: z.enum(["nuevo", "contactado", "no_interesado"]).optional(),
    nota: z.string().trim().min(1).max(1500).optional(),
    fecha_contacto: z.string().datetime().nullable().optional(),
  })
  .refine(
    (data) => data.estado !== undefined || data.fecha_contacto !== undefined,
    { message: "Debe enviar estado o fecha_contacto" },
  );

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, ctx: Ctx): Promise<Response> {
  try {
    const auth = await requireCrmAuth(req);
    if (!auth) {
      return Response.json({ error: "No autorizado" }, { status: 401 });
    }

    const { id } = await ctx.params;
    const supabase = getSupabaseAdmin();

    const { data, error } = await supabase
      .from("leads")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (error) {
      console.error("[CRM lead GET] Error:", error);
      return Response.json({ error: "Error interno" }, { status: 500 });
    }

    if (!data) {
      return Response.json({ error: "Lead no encontrado" }, { status: 404 });
    }

    return Response.json(data, { status: 200 });
  } catch (err) {
    console.error("[CRM lead GET] Error:", err);
    return Response.json({ error: "Error interno" }, { status: 500 });
  }
}

export async function PATCH(req: Request, ctx: Ctx): Promise<Response> {
  try {
    const auth = await requireCrmAuth(req);
    if (!auth) {
      return Response.json({ error: "No autorizado" }, { status: 401 });
    }

    const body = await req.json();
    const parsed = PatchSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json({ error: "Body inválido" }, { status: 400 });
    }

    const { id } = await ctx.params;
    const { estado, nota, fecha_contacto } = parsed.data;
    const supabase = getSupabaseAdmin();

    const updatePayload: {
      estado?: typeof estado;
      fecha_contacto?: string | null;
    } = {};

    if (estado !== undefined) {
      updatePayload.estado = estado;
    }
    if (fecha_contacto !== undefined) {
      updatePayload.fecha_contacto = fecha_contacto;
    }

    const { data: updated, error: updateError } = await supabase
      .from("leads")
      .update(updatePayload)
      .eq("id", id)
      .select("*")
      .maybeSingle();

    if (updateError) {
      console.error("[CRM lead PATCH] Error actualizando lead:", updateError);
      return Response.json({ error: "Error interno" }, { status: 500 });
    }

    if (!updated) {
      return Response.json({ error: "Lead no encontrado" }, { status: 404 });
    }

    if (estado !== undefined) {
      const { error: actionError } = await supabase.from("lead_actions").insert({
        lead_id: id,
        advisor_id: auth.sub,
        accion: estado,
        nota: nota ?? null,
      });

      if (actionError) {
        console.error("[CRM lead PATCH] Error insertando acción:", actionError);
        return Response.json(
          { error: "Lead actualizado pero falló historial de acciones" },
          { status: 500 },
        );
      }
    }

    return Response.json(updated, { status: 200 });
  } catch (err) {
    console.error("[CRM lead PATCH] Error:", err);
    return Response.json({ error: "Error interno" }, { status: 500 });
  }
}

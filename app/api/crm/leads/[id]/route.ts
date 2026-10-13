import { z } from "zod";

import { autorizarLeadCrm, conAlcance } from "@/lib/crmAcceso";
import { COLUMNAS_LEAD_DETALLE, leadDetalleParaCrm } from "@/lib/crmLeadDetalle";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

const PatchSchema = z
  .object({
    estado: z.enum(["nuevo", "contactado", "no_interesado"]).optional(),
    nota: z.string().trim().min(1).max(1500).optional(),
    fecha_contacto: z.string().datetime().nullable().optional(),
    fecha_contacto_origen: z
      .enum(["manual", "automatico_alta", "automatico_media"])
      .optional(),
  })
  .refine(
    (data) => data.estado !== undefined || data.fecha_contacto !== undefined,
    { message: "Debe enviar estado o fecha_contacto" },
  );

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, ctx: Ctx): Promise<Response> {
  try {
    const { id } = await ctx.params;
    const acceso = await autorizarLeadCrm(req, id, COLUMNAS_LEAD_DETALLE);
    if ("respuesta" in acceso) return acceso.respuesta;

    return Response.json(leadDetalleParaCrm(acceso.lead), { status: 200 });
  } catch (err) {
    console.error("[CRM lead GET] Error:", err);
    return Response.json({ error: "Error interno" }, { status: 500 });
  }
}

export async function PATCH(req: Request, ctx: Ctx): Promise<Response> {
  try {
    const { id } = await ctx.params;
    const acceso = await autorizarLeadCrm(req, id, "id");
    if ("respuesta" in acceso) return acceso.respuesta;
    const { asesor } = acceso;

    const body = await req.json().catch(() => null);
    const parsed = PatchSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json({ error: "Body inválido" }, { status: 400 });
    }

    const { estado, nota, fecha_contacto, fecha_contacto_origen } = parsed.data;
    const supabase = getSupabaseAdmin();

    const updatePayload: {
      estado?: typeof estado;
      fecha_contacto?: string | null;
      fecha_contacto_origen?: string;
    } = {};

    if (estado !== undefined) {
      updatePayload.estado = estado;
    }
    if (fecha_contacto !== undefined) {
      updatePayload.fecha_contacto = fecha_contacto;
      updatePayload.fecha_contacto_origen = fecha_contacto_origen ?? "manual";
    }

    const { data: updated, error: updateError } = await conAlcance(
      supabase.from("leads").update(updatePayload).eq("id", id),
      asesor,
    )
      .select(COLUMNAS_LEAD_DETALLE)
      .maybeSingle();

    if (updateError) {
      console.error("[CRM lead PATCH] Error actualizando lead:", updateError);
      return Response.json({ error: "Error interno" }, { status: 500 });
    }

    if (!updated) {
      return Response.json({ error: "Sin permisos sobre este lead" }, { status: 403 });
    }

    if (estado !== undefined) {
      const { error: actionError } = await supabase.from("lead_actions").insert({
        lead_id: id,
        advisor_id: asesor.id,
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

    return Response.json(leadDetalleParaCrm(updated as unknown as Record<string, unknown>), {
      status: 200,
    });
  } catch (err) {
    console.error("[CRM lead PATCH] Error:", err);
    return Response.json({ error: "Error interno" }, { status: 500 });
  }
}

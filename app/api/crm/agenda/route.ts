import { autorizarAsesorCrm, conAlcance } from "@/lib/crmAcceso";
import {
  agruparLeadsEnAgenda,
  type LeadAgendaInput,
} from "@/lib/crmAgendaBuckets";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export async function GET(req: Request): Promise<Response> {
  try {
    const sesion = await autorizarAsesorCrm(req);
    if ("respuesta" in sesion) return sesion.respuesta;

    const { searchParams } = new URL(req.url);
    const producto = searchParams.get("producto");

    const supabase = getSupabaseAdmin();

    let query = supabase
      .from("leads")
      .select(
        "id, whatsapp_phone, producto, estado, fecha_contacto, fecha_contacto_origen, horario, nota, advisor_id, created_at",
      )
      .in("estado", ["nuevo", "contactado"]);

    if (producto) {
      query = query.eq("producto", producto);
    }

    query = conAlcance(query, sesion.asesor);

    const { data, error } = await query;

    if (error) {
      console.error("[CRM agenda GET] Error:", error);
      return Response.json({ error: "Error interno" }, { status: 500 });
    }

    const leads = (data ?? []) as LeadAgendaInput[];
    const agenda = agruparLeadsEnAgenda(leads, new Date());

    return Response.json(agenda, { status: 200 });
  } catch (err) {
    console.error("[CRM agenda GET] Error:", err);
    return Response.json({ error: "Error interno" }, { status: 500 });
  }
}

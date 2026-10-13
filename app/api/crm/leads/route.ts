import { autorizarAsesorCrm, conAlcance } from "@/lib/crmAcceso";
import {
  enriquecerLeadConUltimoMensaje,
  mapUltimosMensajesPorLead,
  ordenarLeadsPorActividad,
} from "@/lib/crmLeadsList";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

/** Lo que muestra la bandeja (`app/crm/leads/page.tsx`); sin NSS, precalificación ni trámite. */
const COLUMNAS_BANDEJA = "id, whatsapp_phone, horario, estado, producto, created_at, tiene_mensaje_nuevo";

export async function GET(req: Request): Promise<Response> {
  try {
    const sesion = await autorizarAsesorCrm(req);
    if ("respuesta" in sesion) return sesion.respuesta;

    const { searchParams } = new URL(req.url);
    const producto = searchParams.get("producto");

    const supabase = getSupabaseAdmin();

    let query = supabase.from("leads").select(COLUMNAS_BANDEJA);

    if (producto) {
      query = query.eq("producto", producto);
    }

    query = conAlcance(query, sesion.asesor);

    const { data, error } = await query;

    if (error) {
      console.error("[CRM leads GET] Error:", error);
      return Response.json({ error: "Error interno" }, { status: 500 });
    }

    const leads = data ?? [];
    const leadIds = leads.map((l) => l.id as string);
    const ultimosPorLead = await mapUltimosMensajesPorLead(supabase, leadIds);

    const enriquecidos = leads.map((lead) =>
      enriquecerLeadConUltimoMensaje(
        { ...lead, id: lead.id as string, created_at: lead.created_at as string },
        ultimosPorLead,
      ),
    );

    return Response.json(ordenarLeadsPorActividad(enriquecidos), { status: 200 });
  } catch (err) {
    console.error("[CRM leads GET] Error:", err);
    return Response.json({ error: "Error interno" }, { status: 500 });
  }
}

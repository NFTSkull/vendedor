import { requireCrmAuth } from "@/lib/crmAuth";
import {
  agruparLeadsEnAgenda,
  type LeadAgendaInput,
} from "@/lib/crmAgendaBuckets";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export async function GET(req: Request): Promise<Response> {
  try {
    const auth = await requireCrmAuth(req);
    if (!auth) {
      return Response.json({ error: "No autorizado" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const producto = searchParams.get("producto");

    const supabase = getSupabaseAdmin();

    const { data: advisor, error: advisorError } = await supabase
      .from("advisors")
      .select("email")
      .eq("id", auth.sub)
      .maybeSingle();

    if (advisorError) {
      console.error("[CRM agenda GET] Error consultando asesor:", advisorError);
      return Response.json({ error: "Error interno" }, { status: 500 });
    }

    let query = supabase
      .from("leads")
      .select(
        "id, whatsapp_phone, producto, estado, fecha_contacto, fecha_contacto_origen, horario, nota, advisor_id, created_at",
      )
      .in("estado", ["nuevo", "contactado"]);

    if (producto) {
      query = query.eq("producto", producto);
    }

    const esAdmin = advisor?.email?.toLowerCase() === "admin@mejoravit.com";
    if (esAdmin) {
      query = query.is("advisor_id", null);
    } else {
      query = query.eq("advisor_id", auth.sub);
    }

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

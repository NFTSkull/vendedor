import { requireCrmAuth } from "@/lib/crmAuth";
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
      console.error("[CRM leads GET] Error consultando asesor:", advisorError);
      return Response.json({ error: "Error interno" }, { status: 500 });
    }

    let query = supabase
      .from("leads")
      .select("*")
      .order("created_at", { ascending: false });

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
      console.error("[CRM leads GET] Error:", error);
      return Response.json({ error: "Error interno" }, { status: 500 });
    }

    return Response.json(data ?? [], { status: 200 });
  } catch (err) {
    console.error("[CRM leads GET] Error:", err);
    return Response.json({ error: "Error interno" }, { status: 500 });
  }
}

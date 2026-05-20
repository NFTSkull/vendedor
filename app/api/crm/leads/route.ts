import { requireCrmAuth } from "@/lib/crmAuth";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export async function GET(req: Request): Promise<Response> {
  try {
    const auth = await requireCrmAuth(req);
    if (!auth) {
      return Response.json({ error: "No autorizado" }, { status: 401 });
    }

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("leads")
      .select("*")
      .order("created_at", { ascending: false });

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

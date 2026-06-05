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
    let query = supabase
      .from("leads")
      .select("*")
      .order("created_at", { ascending: false });

    if (producto) {
      query = query.eq("producto", producto);
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

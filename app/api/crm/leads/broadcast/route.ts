import { requireCrmAuth } from "@/lib/crmAuth";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { enviarMensajeTextoWa } from "@/lib/whatsappCloud";
import { guardarMensaje } from "@/lib/messagesDb";

const DELAY_MS = 1200; // delay between messages to avoid Meta rate limits

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function GET(req: Request): Promise<Response> {
  // Returns count and list of eligible leads (preview before sending)
  try {
    const auth = await requireCrmAuth(req);
    if (!auth) return Response.json({ error: "No autorizado" }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const producto = searchParams.get("producto") ?? null;

    const supabase = getSupabaseAdmin();

    // Get advisor info
    const { data: advisor } = await supabase
      .from("advisors")
      .select("email")
      .eq("id", auth.sub)
      .maybeSingle();

    // Leads that have NOT been contacted by an advisor
    // (no mensaje_asesor or archivo_asesor in lead_actions)
    const { data: intervenidos } = await supabase
      .from("lead_actions")
      .select("lead_id")
      .in("accion", ["mensaje_asesor", "archivo_asesor"]);

    const idsIntervenidos = (intervenidos ?? []).map((r: { lead_id: string }) => r.lead_id);

    let query = supabase
      .from("leads")
      .select("id, whatsapp_phone, estado, advisor_id, producto")
      .in("estado", ["nuevo", "contactado"]);

    if (producto) query = query.eq("producto", producto);

    const esAdmin = advisor?.email?.toLowerCase() === "admin@mejoravit.com";
    if (esAdmin) {
      query = query.is("advisor_id", null);
    } else {
      query = query.eq("advisor_id", auth.sub);
    }

    const { data: leads, error } = await query;
    if (error) return Response.json({ error: "Error interno" }, { status: 500 });

    const elegibles = (leads ?? []).filter(
      (l: { id: string }) => !idsIntervenidos.includes(l.id),
    );

    return Response.json({
      total: elegibles.length,
      leads: elegibles.map((l: { id: string; whatsapp_phone: string; estado: string }) => ({
        id: l.id,
        telefono: l.whatsapp_phone,
        estado: l.estado,
      })),
    });
  } catch (err) {
    console.error("[broadcast GET]", err);
    return Response.json({ error: "Error interno" }, { status: 500 });
  }
}

export async function POST(req: Request): Promise<Response> {
  try {
    const auth = await requireCrmAuth(req);
    if (!auth) return Response.json({ error: "No autorizado" }, { status: 401 });

    const body = await req.json();
    const mensaje: string = body.mensaje?.trim();
    const producto: string | null = body.producto ?? null;

    if (!mensaje || mensaje.length < 5) {
      return Response.json({ error: "Mensaje muy corto" }, { status: 400 });
    }
    if (mensaje.length > 1000) {
      return Response.json({ error: "Mensaje muy largo (máx 1000 caracteres)" }, { status: 400 });
    }

    const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    const graphVersion = process.env.WHATSAPP_GRAPH_API_VERSION ?? process.env.GRAPH_API_VERSION;

    if (!accessToken || !phoneNumberId) {
      return Response.json({ error: "Credenciales WhatsApp no configuradas" }, { status: 500 });
    }

    const supabase = getSupabaseAdmin();

    const { data: advisor } = await supabase
      .from("advisors")
      .select("email")
      .eq("id", auth.sub)
      .maybeSingle();

    const { data: intervenidos } = await supabase
      .from("lead_actions")
      .select("lead_id")
      .in("accion", ["mensaje_asesor", "archivo_asesor"]);

    const idsIntervenidos = (intervenidos ?? []).map((r: { lead_id: string }) => r.lead_id);

    let query = supabase
      .from("leads")
      .select("id, whatsapp_phone, estado, advisor_id")
      .in("estado", ["nuevo", "contactado"]);

    if (producto) query = query.eq("producto", producto);

    const esAdmin = advisor?.email?.toLowerCase() === "admin@mejoravit.com";
    if (esAdmin) {
      query = query.is("advisor_id", null);
    } else {
      query = query.eq("advisor_id", auth.sub);
    }

    const { data: leads, error } = await query;
    if (error) return Response.json({ error: "Error interno" }, { status: 500 });

    const elegibles = (leads ?? []).filter(
      (l: { id: string }) => !idsIntervenidos.includes(l.id),
    );

    let enviados = 0;
    let fallidos = 0;
    const errores: string[] = [];

    for (const lead of elegibles) {
      try {
        const envio = await enviarMensajeTextoWa({
          phoneNumberId,
          accessToken,
          graphVersion,
          to: lead.whatsapp_phone,
          body: mensaje,
        });

        if (envio.ok) {
          enviados++;
          await guardarMensaje({
            leadId: lead.id,
            direccion: "saliente",
            contenido: mensaje,
            origen: "asesor",
            advisorId: auth.sub,
          });
          // Register in lead_actions
          await supabase.from("lead_actions").insert({
            lead_id: lead.id,
            advisor_id: auth.sub,
            accion: "mensaje_asesor",
            nota: `[MASIVO] ${mensaje}`,
          });
        } else {
          fallidos++;
          errores.push(lead.whatsapp_phone);
        }
      } catch (err) {
        fallidos++;
        errores.push(lead.whatsapp_phone);
        console.error("[broadcast] Error enviando a", lead.whatsapp_phone, err);
      }

      // Rate limit protection
      await sleep(DELAY_MS);
    }

    return Response.json({
      ok: true,
      enviados,
      fallidos,
      errores: errores.slice(0, 10), // max 10 shown
    });
  } catch (err) {
    console.error("[broadcast POST]", err);
    return Response.json({ error: "Error interno" }, { status: 500 });
  }
}

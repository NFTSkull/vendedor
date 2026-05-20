import { z } from "zod";

import { requireCrmAuth } from "@/lib/crmAuth";
import { guardarMensaje, listarMensajesPorLead } from "@/lib/messagesDb";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { enviarMensajeTextoWa } from "@/lib/whatsappCloud";

const PostSchema = z.object({
  mensaje: z.string().trim().min(1).max(4000),
});

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, ctx: Ctx): Promise<Response> {
  try {
    const auth = await requireCrmAuth(req);
    if (!auth) {
      return Response.json({ error: "No autorizado" }, { status: 401 });
    }

    const { id } = await ctx.params;
    const mensajes = await listarMensajesPorLead(id);

    return Response.json(mensajes, { status: 200 });
  } catch (err) {
    console.error("[CRM messages GET] Error:", err);
    return Response.json({ error: "Error interno" }, { status: 500 });
  }
}

export async function POST(req: Request, ctx: Ctx): Promise<Response> {
  try {
    const auth = await requireCrmAuth(req);
    if (!auth) {
      return Response.json({ error: "No autorizado" }, { status: 401 });
    }

    const body = await req.json();
    const parsed = PostSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json({ error: "Body inválido" }, { status: 400 });
    }

    const { id: leadId } = await ctx.params;
    const mensaje = parsed.data.mensaje;

    const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    const graphVersion =
      process.env.WHATSAPP_GRAPH_API_VERSION ?? process.env.GRAPH_API_VERSION;

    if (!accessToken || !phoneNumberId) {
      return Response.json(
        { error: "Faltan credenciales de WhatsApp en el servidor" },
        { status: 500 },
      );
    }

    const supabase = getSupabaseAdmin();
    const { data: lead, error: leadError } = await supabase
      .from("leads")
      .select("id, whatsapp_phone, estado")
      .eq("id", leadId)
      .maybeSingle();

    if (leadError) {
      console.error("[CRM messages POST] Error lead:", leadError);
      return Response.json({ error: "Error interno" }, { status: 500 });
    }

    if (!lead) {
      return Response.json({ error: "Lead no encontrado" }, { status: 404 });
    }

    const envio = await enviarMensajeTextoWa({
      phoneNumberId,
      accessToken,
      graphVersion,
      to: lead.whatsapp_phone,
      body: mensaje,
    });

    if (!envio.ok) {
      console.error("[CRM messages POST] WhatsApp error:", envio.status, envio.data);
      return Response.json(
        { error: "No se pudo enviar el mensaje por WhatsApp" },
        { status: 502 },
      );
    }

    const guardado = await guardarMensaje({
      leadId,
      direccion: "saliente",
      contenido: mensaje,
    });

    if (!guardado) {
      return Response.json(
        { error: "Mensaje enviado pero no se guardó en historial" },
        { status: 500 },
      );
    }

    const { error: actionError } = await supabase.from("lead_actions").insert({
      lead_id: leadId,
      advisor_id: auth.sub,
      accion: "mensaje_asesor",
      nota: mensaje,
    });

    if (actionError) {
      console.error("[CRM messages POST] Error lead_actions:", actionError);
    }

    return Response.json({ ok: true }, { status: 200 });
  } catch (err) {
    console.error("[CRM messages POST] Error:", err);
    return Response.json({ error: "Error interno" }, { status: 500 });
  }
}

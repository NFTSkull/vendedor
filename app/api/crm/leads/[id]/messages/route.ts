import { z } from "zod";

import { autorizarLeadCrm, conAlcance } from "@/lib/crmAcceso";
import { guardarMensaje, listarMensajesPorLead } from "@/lib/messagesDb";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { enviarMensajeTextoWa, errorGraphParaLog } from "@/lib/whatsappCloud";

const PostSchema = z.object({
  mensaje: z.string().trim().min(1).max(4000),
});
const ESTADOS_PERMITIDOS_CHAT = new Set(["nuevo", "contactado", "no_interesado"]);

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, ctx: Ctx): Promise<Response> {
  try {
    const { id } = await ctx.params;
    const acceso = await autorizarLeadCrm(req, id, "id");
    if ("respuesta" in acceso) return acceso.respuesta;

    const mensajes = await listarMensajesPorLead(id);

    return Response.json(mensajes, { status: 200 });
  } catch (err) {
    console.error("[CRM messages GET] Error:", err);
    return Response.json({ error: "Error interno" }, { status: 500 });
  }
}

export async function POST(req: Request, ctx: Ctx): Promise<Response> {
  try {
    const { id: leadId } = await ctx.params;
    const acceso = await autorizarLeadCrm<{ whatsapp_phone: string; estado: string }>(
      req,
      leadId,
      "id, whatsapp_phone, estado",
    );
    if ("respuesta" in acceso) return acceso.respuesta;
    const { asesor, lead } = acceso;

    const body = await req.json().catch(() => null);
    const parsed = PostSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json({ error: "Body inválido" }, { status: 400 });
    }

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
    if (!ESTADOS_PERMITIDOS_CHAT.has(lead.estado)) {
      return Response.json(
        { error: "El estado del lead no permite enviar mensajes" },
        { status: 400 },
      );
    }

    const envio = await enviarMensajeTextoWa({
      phoneNumberId,
      accessToken,
      graphVersion,
      to: lead.whatsapp_phone,
      body: mensaje,
    });

    if (!envio.ok) {
      console.error("[CRM messages POST] WhatsApp error:", envio.status, errorGraphParaLog(envio.data));
      return Response.json(
        { error: "No se pudo enviar el mensaje por WhatsApp" },
        { status: 502 },
      );
    }

    const guardado = await guardarMensaje({
      leadId,
      direccion: "saliente",
      contenido: mensaje,
      origen: "asesor",
      advisorId: asesor.id,
    });

    if (!guardado) {
      return Response.json(
        { error: "Mensaje enviado pero no se guardó en historial" },
        { status: 500 },
      );
    }

    const { error: actionError } = await supabase.from("lead_actions").insert({
      lead_id: leadId,
      advisor_id: asesor.id,
      accion: "mensaje_asesor",
      nota: mensaje,
    });

    if (actionError) {
      console.error("[CRM messages POST] Error lead_actions:", actionError);
    }

    // Advisor replied → mark as contactado + clear unread indicator
    // Only transition nuevo → contactado (never touch no_interesado)
    if (lead.estado === "nuevo") {
      await conAlcance(
        supabase
          .from("leads")
          .update({ estado: "contactado", tiene_mensaje_nuevo: false })
          .eq("id", leadId),
        asesor,
      );

      await supabase.from("lead_actions").insert({
        lead_id: leadId,
        advisor_id: asesor.id,
        accion: "cambio_estado_automatico",
        nota: "Marcado como contactado (asesor respondió)",
      });
    } else {
      await conAlcance(
        supabase.from("leads").update({ tiene_mensaje_nuevo: false }).eq("id", leadId),
        asesor,
      );
    }

    return Response.json({ ok: true }, { status: 200 });
  } catch (err) {
    console.error("[CRM messages POST] Error:", err);
    return Response.json({ error: "Error interno" }, { status: 500 });
  }
}

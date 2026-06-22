import { requireCrmAuth } from "@/lib/crmAuth";
import {
  MAX_ARCHIVO_CHAT_BYTES,
  mimePermitidoEnChat,
  MSG_ERROR_VENTANA_24H_WHATSAPP,
  validarTamanoArchivoChat,
} from "@/lib/crmMediaUpload";
import { guardarMensaje } from "@/lib/messagesDb";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import {
  enviarMediaWa,
  esErrorVentana24hWhatsApp,
  resolverTipoWaMedia,
  subirMediaWa,
} from "@/lib/whatsappCloud";

export const maxDuration = 60;

const ESTADOS_PERMITIDOS_CHAT = new Set(["nuevo", "contactado", "no_interesado"]);

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, ctx: Ctx): Promise<Response> {
  try {
    const auth = await requireCrmAuth(req);
    if (!auth) {
      return Response.json({ error: "No autorizado" }, { status: 401 });
    }

    const { id: leadId } = await ctx.params;

    let formData: FormData;
    try {
      formData = await req.formData();
    } catch {
      return Response.json({ error: "Body inválido" }, { status: 400 });
    }

    const fileEntry = formData.get("file");
    if (!fileEntry || !(fileEntry instanceof File) || fileEntry.size === 0) {
      return Response.json({ error: "Archivo requerido" }, { status: 400 });
    }

    const file = fileEntry;
    const captionRaw = formData.get("caption");
    const caption =
      typeof captionRaw === "string" && captionRaw.trim()
        ? captionRaw.trim().slice(0, 1000)
        : undefined;

    if (!validarTamanoArchivoChat(file.size)) {
      if (file.size > MAX_ARCHIVO_CHAT_BYTES) {
        return Response.json(
          { error: "El archivo supera el límite de 4 MB" },
          { status: 413 },
        );
      }
      return Response.json({ error: "Archivo vacío" }, { status: 400 });
    }

    const mimeType = file.type || "application/octet-stream";
    if (!mimePermitidoEnChat(mimeType)) {
      return Response.json(
        { error: "Tipo de archivo no permitido" },
        { status: 400 },
      );
    }

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
      console.error("[CRM media POST] Error lead:", leadError);
      return Response.json({ error: "Error interno" }, { status: 500 });
    }

    if (!lead) {
      return Response.json({ error: "Lead no encontrado" }, { status: 404 });
    }
    if (!ESTADOS_PERMITIDOS_CHAT.has(lead.estado)) {
      return Response.json(
        { error: "El estado del lead no permite enviar mensajes" },
        { status: 400 },
      );
    }

    const buffer = await file.arrayBuffer();
    const filename = file.name || "archivo";

    const subida = await subirMediaWa({
      phoneNumberId,
      accessToken,
      graphVersion,
      buffer,
      mimeType,
      filename,
    });

    if (!subida.ok) {
      console.error("[CRM media POST] Error subiendo media:", subida.status, subida.data);
      if (esErrorVentana24hWhatsApp(subida.data)) {
        return Response.json({ error: MSG_ERROR_VENTANA_24H_WHATSAPP }, { status: 502 });
      }
      return Response.json(
        { error: "No se pudo subir el archivo a WhatsApp" },
        { status: 502 },
      );
    }

    const tipoWa = resolverTipoWaMedia(mimeType);
    const envio = await enviarMediaWa({
      phoneNumberId,
      accessToken,
      graphVersion,
      to: lead.whatsapp_phone,
      mediaId: subida.mediaId,
      tipo: tipoWa,
      filename: tipoWa === "document" ? filename : undefined,
      caption,
    });

    if (!envio.ok) {
      console.error("[CRM media POST] WhatsApp send error:", envio.status, envio.data);
      if (esErrorVentana24hWhatsApp(envio.data)) {
        return Response.json({ error: MSG_ERROR_VENTANA_24H_WHATSAPP }, { status: 502 });
      }
      return Response.json(
        { error: "No se pudo enviar el archivo por WhatsApp" },
        { status: 502 },
      );
    }

    const contenidoHistorial = caption ?? `📎 ${filename}`;

    const guardado = await guardarMensaje({
      leadId,
      direccion: "saliente",
      contenido: contenidoHistorial,
      origen: "asesor",
      advisorId: auth.sub,
    });

    if (!guardado) {
      return Response.json(
        { error: "Archivo enviado pero no se guardó en historial" },
        { status: 500 },
      );
    }

    const { error: actionError } = await supabase.from("lead_actions").insert({
      lead_id: leadId,
      advisor_id: auth.sub,
      accion: "archivo_asesor",
      nota: filename,
    });

    if (actionError) {
      console.error("[CRM media POST] Error lead_actions:", actionError);
    }

    return Response.json({ ok: true, filename }, { status: 200 });
  } catch (err) {
    console.error("[CRM media POST] Error:", err);
    return Response.json({ error: "Error interno" }, { status: 500 });
  }
}

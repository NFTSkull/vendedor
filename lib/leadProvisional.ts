import { getConversation, setConversation } from "@/lib/conversationMemory";
import { detectarProducto } from "@/lib/detectarProducto";
import { buscarLeadPorTelefono } from "@/lib/messagesDb";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export type EnsureLeadProvisionalOptions = {
  phoneNumberId?: string;
  primerMensaje?: string;
  advisorId?: string | null;
};

export async function ensureLeadProvisional(
  phone: string,
  options?: EnsureLeadProvisionalOptions,
): Promise<string | null> {
  const conv = await getConversation(phone);
  const phoneNumberId =
    options?.phoneNumberId?.trim() ||
    process.env.WHATSAPP_PHONE_NUMBER_ID?.trim() ||
    "";
  const primerMensaje = options?.primerMensaje ?? "";

  if (conv.lead_id) return conv.lead_id;

  const existing = await buscarLeadPorTelefono(phone);
  if (existing) {
    if (options?.advisorId && !existing.advisor_id) {
      await asignarAdvisorSiVacio(existing.id, options.advisorId);
    }
    const productoDetectado = detectarProducto({ phoneNumberId, primerMensaje });
    await setConversation(phone, {
      state: conv.state,
      lead_id: existing.id,
      producto: productoDetectado,
    });
    return existing.id;
  }

  const producto = detectarProducto({ phoneNumberId, primerMensaje });
  const advisorId = options?.advisorId?.trim() || null;

  try {
    const supabase = getSupabaseAdmin();
    const insertPayload: Record<string, unknown> = {
      whatsapp_phone: phone,
      estado: "nuevo",
      nss: "",
      horario: "",
      producto,
    };
    if (advisorId) {
      insertPayload.advisor_id = advisorId;
    }

    const { data, error } = await supabase
      .from("leads")
      .insert(insertPayload)
      .select("id")
      .single();

    if (error || !data?.id) {
      if (error) {
        const existingAfterInsert = await buscarLeadPorTelefono(phone);
        if (existingAfterInsert) {
          await setConversation(phone, {
            state: conv.state,
            lead_id: existingAfterInsert.id,
          });
          return existingAfterInsert.id;
        }
      }
      console.error("[leadProvisional] Error creando lead provisional:", error);
      return null;
    }

    await setConversation(phone, {
      state: conv.state,
      lead_id: data.id,
      producto,
    });
    console.log("[leadProvisional] Lead provisional creado:", {
      phone,
      leadId: data.id,
      producto,
      advisorId,
    });
    return data.id;
  } catch (err) {
    console.error("[leadProvisional] Error:", err);
    return null;
  }
}

async function asignarAdvisorSiVacio(
  leadId: string,
  advisorId: string,
): Promise<void> {
  try {
    const supabase = getSupabaseAdmin();
    const { error } = await supabase
      .from("leads")
      .update({ advisor_id: advisorId })
      .eq("id", leadId)
      .is("advisor_id", null);
    if (error) {
      console.error("[leadProvisional] Error asignando advisor_id:", error);
    }
  } catch (err) {
    console.error("[leadProvisional] Error asignando advisor_id:", err);
  }
}

export async function actualizarLeadPorConversacion(
  phone: string,
  campos: Record<string, unknown>,
): Promise<boolean> {
  const conv = await getConversation(phone);
  let leadId = conv.lead_id;
  if (!leadId) {
    const existing = await buscarLeadPorTelefono(phone);
    if (existing) {
      leadId = existing.id;
      await setConversation(phone, { state: conv.state, lead_id: leadId });
    }
  }
  if (!leadId) {
    leadId = await ensureLeadProvisional(phone);
  }
  if (!leadId) return false;

  try {
    const supabase = getSupabaseAdmin();
    const { error } = await supabase.from("leads").update(campos).eq("id", leadId);
    if (error) {
      console.error("[leadProvisional] Error actualizando lead:", error);
      return false;
    }
    return true;
  } catch (err) {
    console.error("[leadProvisional] Error:", err);
    return false;
  }
}

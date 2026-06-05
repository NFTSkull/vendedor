import { getConversation, setConversation } from "@/lib/conversationMemory";
import { detectarProducto } from "@/lib/detectarProducto";
import { buscarLeadPorTelefono } from "@/lib/messagesDb";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export type EnsureLeadProvisionalOptions = {
  phoneNumberId?: string;
  primerMensaje?: string;
};

export async function ensureLeadProvisional(
  phone: string,
  options?: EnsureLeadProvisionalOptions,
): Promise<string | null> {
  const conv = await getConversation(phone);
  if (conv.lead_id) return conv.lead_id;

  const existing = await buscarLeadPorTelefono(phone);
  if (existing) {
    await setConversation(phone, { state: conv.state, lead_id: existing.id });
    return existing.id;
  }

  const phoneNumberId =
    options?.phoneNumberId?.trim() ||
    process.env.WHATSAPP_PHONE_NUMBER_ID?.trim() ||
    "";
  const primerMensaje = options?.primerMensaje ?? "";
  const producto = detectarProducto({ phoneNumberId, primerMensaje });

  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("leads")
      .insert({
        whatsapp_phone: phone,
        estado: "nuevo",
        nss: "",
        horario: "",
        producto,
      })
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
    });
    return data.id;
  } catch (err) {
    console.error("[leadProvisional] Error:", err);
    return null;
  }
}

export async function actualizarLeadPorConversacion(
  phone: string,
  campos: Record<string, unknown>,
): Promise<boolean> {
  const conv = await getConversation(phone);
  const leadId = conv.lead_id ?? (await ensureLeadProvisional(phone));
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

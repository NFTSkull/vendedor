import { getConversation, setConversation } from "@/lib/conversationMemory";
import { buscarLeadPorTelefono } from "@/lib/messagesDb";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export async function ensureLeadProvisional(phone: string): Promise<string | null> {
  const conv = await getConversation(phone);
  if (conv.lead_id) return conv.lead_id;

  const existing = await buscarLeadPorTelefono(phone);
  if (existing) {
    await setConversation(phone, { state: conv.state, lead_id: existing.id });
    return existing.id;
  }

  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("leads")
      .insert({
        whatsapp_phone: phone,
        estado: "nuevo",
        nss: null,
        horario: null,
      })
      .select("id")
      .single();

    if (error || !data?.id) {
      console.error("[leadProvisional] Error creando lead provisional:", error);
      return null;
    }

    await setConversation(phone, { state: conv.state, lead_id: data.id });
    console.log("[leadProvisional] Lead provisional creado:", {
      phone,
      leadId: data.id,
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

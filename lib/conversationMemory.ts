import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export type BotRuntimeState =
  | "inicio"
  | "esperando_labor_vigente"
  | "esperando_infonavit"
  | "esperando_credito_activo"
  | "esperando_datos"
  | "esperando_horario"
  | "finalizado";

export type ConversationValue = {
  state: BotRuntimeState;
  name: string | null;
  nss: string | null;
  lead_id: string | null;
  producto?: string;
  data?: Record<string, unknown>;
};

// Map local como caché para la misma request
export const conversationMemory = new Map<string, ConversationValue>();

export async function getConversation(
  phone: string,
): Promise<ConversationValue> {
  try {
    const supabase = getSupabaseAdmin();
    const { data } = await supabase
      .from("conversations")
      .select("state, nss, lead_id, producto, data")
      .eq("whatsapp_phone", phone)
      .maybeSingle();

    if (data) {
      const val: ConversationValue = {
        state: data.state as BotRuntimeState,
        name: null,
        nss: data.nss ?? null,
        lead_id: data.lead_id ?? null,
      };
      if (data.producto != null) {
        val.producto = data.producto;
      }
      if (
        data.data != null &&
        typeof data.data === "object" &&
        !Array.isArray(data.data)
      ) {
        val.data = data.data as Record<string, unknown>;
      }
      conversationMemory.set(phone, val);
      return val;
    }

    conversationMemory.delete(phone);
  } catch (err) {
    console.error("[conversationMemory] Error leyendo Supabase:", err);
  }

  return { state: "inicio", name: null, nss: null, lead_id: null };
}

export async function setConversation(
  phone: string,
  patch: Partial<ConversationValue> & Pick<ConversationValue, "state">,
): Promise<void> {
  const cached = conversationMemory.get(phone);
  const base: ConversationValue = cached ?? {
    state: "inicio",
    name: null,
    nss: null,
    lead_id: null,
  };
  const merged: ConversationValue = {
    state: patch.state,
    name: patch.name ?? base.name,
    nss: patch.nss !== undefined ? patch.nss : base.nss,
    lead_id: patch.lead_id !== undefined ? patch.lead_id : base.lead_id,
  };
  if (patch.producto !== undefined) {
    merged.producto = patch.producto;
  } else if (base.producto !== undefined) {
    merged.producto = base.producto;
  }
  if (patch.data !== undefined) {
    merged.data = { ...(base.data ?? {}), ...patch.data };
  } else if (base.data !== undefined) {
    merged.data = base.data;
  }
  conversationMemory.set(phone, merged);
  try {
    const supabase = getSupabaseAdmin();
    const row: Record<string, unknown> = {
      whatsapp_phone: phone,
      state: merged.state,
      nss: merged.nss,
      lead_id: merged.lead_id,
      updated_at: new Date().toISOString(),
    };
    if (patch.producto !== undefined) {
      row.producto = merged.producto;
    }
    if (patch.data !== undefined) {
      row.data = merged.data ?? {};
    }
    await supabase.from("conversations").upsert(row);
  } catch (err) {
    console.error("[conversationMemory] Error escribiendo Supabase:", err);
  }
}

export async function deleteConversation(phone: string): Promise<void> {
  conversationMemory.delete(phone);
  try {
    const supabase = getSupabaseAdmin();
    await supabase.from("conversations").delete().eq("whatsapp_phone", phone);
  } catch (err) {
    console.error("[conversationMemory] Error borrando Supabase:", err);
  }
}

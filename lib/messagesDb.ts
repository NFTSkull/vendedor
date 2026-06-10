import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export type MessageDireccion = "entrante" | "saliente";

export type LeadRow = {
  id: string;
  whatsapp_phone: string;
  estado: string;
  advisor_id?: string | null;
};

export type MessageRow = {
  id: string;
  lead_id: string;
  direccion: MessageDireccion;
  contenido: string;
  created_at: string;
};

const ESTADOS_CHAT = ["contactado", "no_interesado"] as const;

export async function buscarLeadPorId(leadId: string): Promise<LeadRow | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("leads")
      .select("id, whatsapp_phone, estado, advisor_id")
      .eq("id", leadId)
    .maybeSingle();

  if (error) {
    console.error("[messages] Error buscando lead por id:", error);
    return null;
  }

  return data;
}

export async function buscarLeadPorTelefono(
  phone: string,
): Promise<LeadRow | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("leads")
      .select("id, whatsapp_phone, estado, advisor_id")
      .eq("whatsapp_phone", phone)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("[messages] Error buscando lead:", error);
    return null;
  }

  return data;
}

export function leadEnModoChat(estado: string): boolean {
  return ESTADOS_CHAT.includes(estado as (typeof ESTADOS_CHAT)[number]);
}

export async function guardarMensaje(args: {
  leadId: string;
  direccion: MessageDireccion;
  contenido: string;
}): Promise<boolean> {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from("messages").insert({
    lead_id: args.leadId,
    direccion: args.direccion,
    contenido: args.contenido,
  });

  if (error) {
    console.error("[messages] Error guardando mensaje:", error);
    return false;
  }

  return true;
}

export async function listarMensajesPorLead(
  leadId: string,
): Promise<MessageRow[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("messages")
    .select("id, lead_id, direccion, contenido, created_at")
    .eq("lead_id", leadId)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("[messages] Error listando mensajes:", error);
    return [];
  }

  return (data ?? []) as MessageRow[];
}

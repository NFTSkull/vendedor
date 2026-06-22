import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export type MessageDireccion = "entrante" | "saliente";
export type MessageOrigen = "cliente" | "bot" | "asesor";

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
  origen: MessageOrigen;
  contenido: string;
  created_at: string;
  advisor_id?: string | null;
  advisor_nombre?: string | null;
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
  origen?: MessageOrigen;
  advisorId?: string | null;
}): Promise<boolean> {
  const supabase = getSupabaseAdmin();
  const origen = args.origen ?? "bot";
  const payload: {
    lead_id: string;
    direccion: MessageDireccion;
    contenido: string;
    origen: MessageOrigen;
    advisor_id?: string;
  } = {
    lead_id: args.leadId,
    direccion: args.direccion,
    contenido: args.contenido,
    origen,
  };

  if (origen === "asesor" && args.advisorId) {
    payload.advisor_id = args.advisorId;
  }

  const { error } = await supabase.from("messages").insert(payload);

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
    .select(
      "id, lead_id, direccion, origen, contenido, created_at, advisor_id",
    )
    .eq("lead_id", leadId)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("[messages] Error listando mensajes:", error);
    return [];
  }

  const rows = data ?? [];
  if (rows.length === 0) return [];

  const advisorIds = [
    ...new Set(
      rows
        .map((row) => row.advisor_id)
        .filter((id): id is string => typeof id === "string" && id.length > 0),
    ),
  ];

  const nombresPorAdvisorId = new Map<string, string>();

  if (advisorIds.length > 0) {
    const { data: advisors, error: advisorsError } = await supabase
      .from("advisors")
      .select("id, nombre")
      .in("id", advisorIds);

    if (advisorsError) {
      console.error("[messages] Error listando nombres de asesores:", advisorsError);
    } else {
      for (const advisor of advisors ?? []) {
        if (advisor.id && advisor.nombre) {
          nombresPorAdvisorId.set(advisor.id, advisor.nombre);
        }
      }
    }
  }

  return rows.map((row) => ({
    id: row.id,
    lead_id: row.lead_id,
    direccion: row.direccion,
    origen: row.origen,
    contenido: row.contenido,
    created_at: row.created_at,
    advisor_id: row.advisor_id ?? null,
    advisor_nombre: row.advisor_id
      ? (nombresPorAdvisorId.get(row.advisor_id) ?? null)
      : null,
  }));
}

import type { SupabaseClient } from "@supabase/supabase-js";

export type UltimoMensajeLead = {
  ultimo_mensaje: string | null;
  ultimo_mensaje_fecha: string | null;
  ultimo_mensaje_direccion: "entrante" | "saliente" | null;
  ultima_actividad_at: string;
  tiene_mensaje_sin_leer: boolean;
};

type MensajeRow = {
  lead_id: string;
  contenido: string;
  created_at: string;
  direccion: "entrante" | "saliente";
};

type LeadConCreatedAt = { id: string; created_at: string };

/**
 * Una sola consulta a messages (orden created_at DESC) y deduplicación en memoria
 * equivalente a DISTINCT ON (lead_id).
 */
export async function mapUltimosMensajesPorLead(
  supabase: SupabaseClient,
  leadIds: string[],
): Promise<Map<string, Omit<UltimoMensajeLead, "ultima_actividad_at">>> {
  const map = new Map<string, Omit<UltimoMensajeLead, "ultima_actividad_at">>();
  if (leadIds.length === 0) return map;

  const { data, error } = await supabase
    .from("messages")
    .select("lead_id, contenido, created_at, direccion")
    .in("lead_id", leadIds)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[crmLeadsList] Error consultando últimos mensajes:", error);
    return map;
  }

  const lastEntrante = new Map<string, MensajeRow>();
  const lastSaliente = new Map<string, MensajeRow>();
  const lastAny = new Map<string, MensajeRow>();

  for (const row of (data ?? []) as MensajeRow[]) {
    if (!lastAny.has(row.lead_id)) lastAny.set(row.lead_id, row);
    if (row.direccion === "entrante" && !lastEntrante.has(row.lead_id)) {
      lastEntrante.set(row.lead_id, row);
    }
    if (row.direccion === "saliente" && !lastSaliente.has(row.lead_id)) {
      lastSaliente.set(row.lead_id, row);
    }
  }

  for (const [leadId, last] of lastAny.entries()) {
    const entrante = lastEntrante.get(leadId);
    const saliente = lastSaliente.get(leadId);

    const tiene_mensaje_sin_leer =
      entrante != null &&
      (saliente == null ||
        new Date(entrante.created_at).getTime() >
          new Date(saliente.created_at).getTime());

    map.set(leadId, {
      ultimo_mensaje: last.contenido,
      ultimo_mensaje_fecha: last.created_at,
      ultimo_mensaje_direccion: last.direccion,
      tiene_mensaje_sin_leer,
    });
  }

  return map;
}

export function calcularUltimaActividadAt(
  lead: LeadConCreatedAt & {
    ultimo_mensaje_fecha?: string | null;
  },
): string {
  return lead.ultimo_mensaje_fecha ?? lead.created_at;
}

export function enriquecerLeadConUltimoMensaje<T extends LeadConCreatedAt>(
  lead: T,
  ultimos: Map<string, Omit<UltimoMensajeLead, "ultima_actividad_at">>,
): T & UltimoMensajeLead {
  const ultimo = ultimos.get(lead.id);
  const ultimo_mensaje_fecha = ultimo?.ultimo_mensaje_fecha ?? null;
  return {
    ...lead,
    ultimo_mensaje: ultimo?.ultimo_mensaje ?? null,
    ultimo_mensaje_fecha,
    ultimo_mensaje_direccion: ultimo?.ultimo_mensaje_direccion ?? null,
    ultima_actividad_at: calcularUltimaActividadAt({
      ...lead,
      ultimo_mensaje_fecha,
    }),
    tiene_mensaje_sin_leer: ultimo?.tiene_mensaje_sin_leer ?? false,
  };
}

/** Orden estilo WhatsApp: COALESCE(último mensaje, created_at) DESC. */
export function ordenarLeadsPorActividad<T extends LeadConCreatedAt & UltimoMensajeLead>(
  leads: T[],
): T[] {
  return [...leads].sort((a, b) => {
    const aTs = new Date(a.ultima_actividad_at).getTime();
    const bTs = new Date(b.ultima_actividad_at).getTime();
    return bTs - aTs;
  });
}

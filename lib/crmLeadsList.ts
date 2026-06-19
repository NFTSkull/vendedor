import type { SupabaseClient } from "@supabase/supabase-js";

export type UltimoMensajeLead = {
  ultimo_mensaje: string | null;
  ultimo_mensaje_fecha: string | null;
  ultimo_mensaje_direccion: "entrante" | "saliente" | null;
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
): Promise<Map<string, UltimoMensajeLead>> {
  const map = new Map<string, UltimoMensajeLead>();
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

  for (const row of (data ?? []) as MensajeRow[]) {
    if (map.has(row.lead_id)) continue;
    map.set(row.lead_id, {
      ultimo_mensaje: row.contenido,
      ultimo_mensaje_fecha: row.created_at,
      ultimo_mensaje_direccion: row.direccion,
    });
  }

  return map;
}

export function enriquecerLeadConUltimoMensaje<T extends LeadConCreatedAt>(
  lead: T,
  ultimos: Map<string, UltimoMensajeLead>,
): T & UltimoMensajeLead {
  const ultimo = ultimos.get(lead.id);
  return {
    ...lead,
    ultimo_mensaje: ultimo?.ultimo_mensaje ?? null,
    ultimo_mensaje_fecha: ultimo?.ultimo_mensaje_fecha ?? null,
    ultimo_mensaje_direccion: ultimo?.ultimo_mensaje_direccion ?? null,
  };
}

export function ordenarLeadsPorActividad<T extends LeadConCreatedAt & UltimoMensajeLead>(
  leads: T[],
): T[] {
  return [...leads].sort((a, b) => {
    const aHas = !!a.ultimo_mensaje_fecha;
    const bHas = !!b.ultimo_mensaje_fecha;

    if (aHas && bHas) {
      return (
        new Date(b.ultimo_mensaje_fecha!).getTime() -
        new Date(a.ultimo_mensaje_fecha!).getTime()
      );
    }
    if (aHas && !bHas) return -1;
    if (!aHas && bHas) return 1;

    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });
}

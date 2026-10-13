import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import type { TramiteMejoravit } from "@/lib/tramiteMejoravit";

export type LeadConTramite = {
  tramite: TramiteMejoravit | null;
  nss: string | null;
  precalificacionStatus: string | null;
  precalificacionResultado: unknown;
  precalificadoAt: string | null;
  /** Saldo guardado por el flujo anterior (texto original del scraper). */
  saldoSubcuenta: string | null;
};

/** El CRM aún no muestra el trámite: no se expone (CURP, referencias, domicilio) en sus respuestas. */
export function sinTramiteMejoravit<T extends Record<string, unknown>>(lead: T): Omit<T, "tramite_mejoravit"> {
  const { tramite_mejoravit: _omitido, ...resto } = lead;
  void _omitido;
  return resto;
}

function esTramite(valor: unknown): valor is TramiteMejoravit {
  if (!valor || typeof valor !== "object" || Array.isArray(valor)) return false;
  const v = valor as Record<string, unknown>;
  return v.esquema === 1 && typeof v.version === "number" && typeof v.etapa === "string";
}

/** Solo registra códigos técnicos: nunca datos del trámite. */
function registrarError(contexto: string, leadId: string, error: unknown) {
  const code =
    error && typeof error === "object" && "code" in error
      ? String((error as { code: unknown }).code)
      : error instanceof Error
        ? error.name
        : "desconocido";
  console.error(`[tramite] ${contexto}`, { lead_id: leadId, code });
}

export async function leerLeadConTramite(leadId: string): Promise<LeadConTramite | null> {
  try {
    const { data, error } = await getSupabaseAdmin()
      .from("leads")
      .select(
        "tramite_mejoravit, nss, precalificacion_status, precalificacion_resultado, precalificado_at, saldo_subcuenta",
      )
      .eq("id", leadId)
      .maybeSingle();
    if (error) {
      registrarError("Error leyendo trámite", leadId, error);
      return null;
    }
    if (!data) return null;
    return {
      tramite: esTramite(data.tramite_mejoravit) ? data.tramite_mejoravit : null,
      nss: typeof data.nss === "string" && data.nss.trim() ? data.nss.trim() : null,
      precalificacionStatus:
        typeof data.precalificacion_status === "string" ? data.precalificacion_status : null,
      precalificacionResultado: data.precalificacion_resultado ?? null,
      precalificadoAt: typeof data.precalificado_at === "string" ? data.precalificado_at : null,
      saldoSubcuenta:
        data.saldo_subcuenta === null || data.saldo_subcuenta === undefined
          ? null
          : String(data.saldo_subcuenta),
    };
  } catch (err) {
    registrarError("Error leyendo trámite", leadId, err);
    return null;
  }
}

/**
 * Guarda el trámite con concurrencia optimista: el UPDATE solo aplica si la versión en
 * la base sigue siendo la que se leyó. Si otro mensaje (otra instancia de Vercel) ganó,
 * se relee y se recalcula sobre la versión nueva, así ningún dato capturado se pierde.
 * `extrasLead` se escribe en el mismo UPDATE (una sola llamada a Supabase).
 */
export async function guardarTramiteMejoravit<R extends { tramite: TramiteMejoravit }>(
  leadId: string,
  leido: TramiteMejoravit | null,
  calcular: (actual: TramiteMejoravit | null) => R,
  extrasLead: Record<string, unknown> = {},
  maxIntentos = 3,
): Promise<R | null> {
  let actual = leido;
  for (let intento = 0; intento < maxIntentos; intento++) {
    const resultado = calcular(actual);
    const siguiente: TramiteMejoravit = {
      ...resultado.tramite,
      version: (actual?.version ?? 0) + 1,
    };
    try {
      let query = getSupabaseAdmin()
        .from("leads")
        .update({ ...extrasLead, tramite_mejoravit: siguiente })
        .eq("id", leadId);
      query = actual
        ? query.eq("tramite_mejoravit->>version", String(actual.version))
        : query.is("tramite_mejoravit", null);
      const { data, error } = await query.select("id");
      if (error) {
        registrarError("Error guardando trámite", leadId, error);
        return null;
      }
      if (Array.isArray(data) && data.length > 0) {
        return { ...resultado, tramite: siguiente };
      }
    } catch (err) {
      registrarError("Error guardando trámite", leadId, err);
      return null;
    }
    const releido = await leerLeadConTramite(leadId);
    if (!releido) return null;
    actual = releido.tramite;
  }
  console.error("[tramite] Conflicto de versión sin resolver", { lead_id: leadId });
  return null;
}

import { claudeDisponible, interpretarMensajeTramite } from "@/lib/claudeAssistant";
import { buscarLeadPorTelefono } from "@/lib/messagesDb";
import { estimarCreditoMejoravit } from "@/lib/mejoravitCredito";
import { extraerDatosPortal } from "@/lib/precalificacionScraper";
import {
  avanzarTramite,
  contextoParaInterpretacion,
  necesitaInterpretacion,
  normalizarTelefonoMx,
  prepararTramiteTrasPrecalificacion,
  type TramiteMejoravit,
} from "@/lib/tramiteMejoravit";
import {
  guardarTramiteMejoravit,
  leerLeadConTramite,
  type LeadConTramite,
} from "@/lib/tramiteMejoravitRepo";

export const MSG_TRAMITE_NO_DISPONIBLE =
  "Tuvimos un problema temporal para continuar con tu trámite. Tu avance está guardado; escríbeme en unos minutos y seguimos.";

export function urlAvisoPrivacidad(): string {
  return process.env.AVISO_PRIVACIDAD_URL?.trim() || "https://vendedor-beta.vercel.app/privacidad";
}

type ResultadoScraperGuardado = {
  califica?: unknown;
  success?: unknown;
  datos?: { saldoSubcuenta?: unknown };
};

export function saldoDePrecalificacion(resultado: unknown): number {
  const r = (resultado ?? {}) as ResultadoScraperGuardado;
  const bruto = r.datos?.saldoSubcuenta;
  const n =
    typeof bruto === "number"
      ? bruto
      : typeof bruto === "string"
        ? Number(bruto.replace(/[^0-9.]/g, ""))
        : 0;
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function esPrecalificacionAprobada(resultado: unknown): boolean {
  const r = (resultado ?? {}) as ResultadoScraperGuardado;
  return (r.califica === true || r.success === true) && saldoDePrecalificacion(resultado) > 0;
}

/**
 * Crea o actualiza el trámite tras una precalificación aprobada y guarda en el mismo
 * UPDATE las columnas de precalificación del lead (`extrasLead`).
 */
export async function iniciarTramiteTrasPrecalificacion(args: {
  leadId: string;
  phone: string;
  nss: string;
  resultado: unknown;
  extrasLead: Record<string, unknown>;
}): Promise<TramiteMejoravit | null> {
  const lead = await leerLeadConTramite(args.leadId);
  const credito = estimarCreditoMejoravit(saldoDePrecalificacion(args.resultado));
  const portal = extraerDatosPortal(args.resultado);
  const ahora = new Date().toISOString();
  const guardado = await guardarTramiteMejoravit(
    args.leadId,
    lead?.tramite ?? null,
    (actual) => ({
      tramite: prepararTramiteTrasPrecalificacion(actual, {
        nss: args.nss,
        credito,
        portal,
        celularWhatsapp: normalizarTelefonoMx(args.phone),
        ahora,
      }),
    }),
    args.extrasLead,
  );
  return guardado?.tramite ?? null;
}

/** Si el trámite no se pudo guardar al precalificar, se reconstruye con la precalificación guardada en el lead. */
async function reconstruirTramite(
  leadId: string,
  phone: string,
  lead: LeadConTramite,
  nssConversacion: string | null,
): Promise<TramiteMejoravit | null> {
  const resultadoNss = (lead.precalificacionResultado as { nss?: unknown } | null)?.nss;
  if (
    lead.precalificacionStatus !== "aprobado" ||
    !nssConversacion ||
    resultadoNss !== nssConversacion ||
    !esPrecalificacionAprobada(lead.precalificacionResultado)
  ) {
    return null;
  }
  return iniciarTramiteTrasPrecalificacion({
    leadId,
    phone,
    nss: nssConversacion,
    resultado: lead.precalificacionResultado,
    extrasLead: {},
  });
}

export async function procesarTramiteMejoravit(args: {
  phone: string;
  texto: string;
  leadId: string | null;
  /** NSS que el cliente escribió en este chat; solo con él se reconstruye un trámite faltante. */
  nssConversacion?: string | null;
}): Promise<string> {
  const leadId = args.leadId ?? (await buscarLeadPorTelefono(args.phone))?.id ?? null;
  if (!leadId) return MSG_TRAMITE_NO_DISPONIBLE;

  const lead = await leerLeadConTramite(leadId);
  if (!lead) return MSG_TRAMITE_NO_DISPONIBLE;
  const tramite =
    lead.tramite ??
    (await reconstruirTramite(leadId, args.phone, lead, args.nssConversacion ?? null));
  if (!tramite) return MSG_TRAMITE_NO_DISPONIBLE;

  const interpretacion =
    claudeDisponible() && necesitaInterpretacion(tramite, args.texto)
      ? await interpretarMensajeTramite({
          textoUsuario: args.texto,
          contexto: contextoParaInterpretacion(tramite),
        })
      : null;

  const entrada = {
    texto: args.texto,
    interpretacion,
    preguntasAgrupadas: claudeDisponible(),
    urlAvisoPrivacidad: urlAvisoPrivacidad(),
    ahora: new Date().toISOString(),
  };
  const resultado = await guardarTramiteMejoravit(leadId, tramite, (actual) =>
    avanzarTramite(actual ?? tramite, entrada),
  );
  if (!resultado) return MSG_TRAMITE_NO_DISPONIBLE;

  console.log("[tramite] Avance", {
    lead_id: leadId,
    etapa: resultado.tramite.etapa,
    campo: resultado.tramite.campoActual,
    claude: interpretacion !== null,
  });
  return resultado.respuesta;
}

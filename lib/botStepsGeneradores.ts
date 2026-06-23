import {
  claudeDisponible,
  interpretarRespuestaGenerador,
} from "@/lib/claudeAssistant";
import type { ConversationValue } from "@/lib/conversationMemory";
import { getConversation, setConversation } from "@/lib/conversationMemory";
import { actualizarLeadPorConversacion } from "@/lib/leadProvisional";
import { interpretarHorarioConClaude } from "@/lib/interpretarHorarioContacto";
import { esComandoReinicio } from "@/lib/botStepsCore";
import { esNegativo } from "@/lib/normalizeText";

const PREGUNTA_TIPO =
  "¿El generador es para uso industrial o residencial?";
const PREGUNTA_EQUIPOS = "¿Qué equipos necesitas respaldar?";
const PREGUNTA_HORARIO = "¿En qué día y horario te podemos contactar?";
const MSG_CIERRE =
  "¡Listo! Un asesor de Energrum te contactará en el día y horario que indicaste para cotizar tu generador. ⚡";
const MSG_POST_FINALIZADO =
  "Gracias a usted, en un momento le contactamos. ⚡";

type GenStep = "tipo" | "equipos" | "horario";

/** Sin letras ni dígitos → no es respuesta utilizable al paso */
function esContenidoInsignificante(texto: string): boolean {
  return !/[\p{L}\p{N}]/u.test(texto);
}

function genStepDeData(data: Record<string, unknown> | undefined): GenStep | null {
  const step = data?.genStep;
  if (step === "tipo" || step === "equipos" || step === "horario") {
    return step;
  }
  return null;
}

function preguntaPorGenStep(genStep: GenStep): string {
  if (genStep === "tipo") return PREGUNTA_TIPO;
  if (genStep === "equipos") return PREGUNTA_EQUIPOS;
  return PREGUNTA_HORARIO;
}

function preguntaSiguientePorGenStep(genStep: GenStep): string | null {
  if (genStep === "tipo") return PREGUNTA_EQUIPOS;
  if (genStep === "equipos") return PREGUNTA_HORARIO;
  return null;
}

function respuestaAgradecePendiente(preguntaActual: string): string {
  return `¡Con gusto! Solo para terminar: ${preguntaActual}`;
}

const PATRONES_TIPO_RESIDENCIAL: RegExp[] = [
  /\bresidencial\b/i,
  /\bhogar\b/i,
  /\bdepa\b/i,
  /\bdepartamento\b/i,
  /\bcasa\b/i,
  /mi\s+casa/i,
];

const PATRONES_TIPO_INDUSTRIAL: RegExp[] = [
  /\bindustrial\b/i,
  /\bf[aá]brica\b/i,
  /\bnegocio\b/i,
  /\bcomercio\b/i,
  /\bempresa\b/i,
  /\btaller\b/i,
  /\bbodega\b/i,
];

function coincideAlguno(texto: string, patrones: RegExp[]): boolean {
  return patrones.some((p) => p.test(texto));
}

/** Detección determinística de tipo antes de Claude. */
export function detectarTipoDirectoEnTexto(
  texto: string,
): "residencial" | "industrial" | null {
  const t = texto.trim();
  if (!t) return null;

  const esResidencial = coincideAlguno(t, PATRONES_TIPO_RESIDENCIAL);
  const esIndustrial = coincideAlguno(t, PATRONES_TIPO_INDUSTRIAL);

  if (esResidencial && esIndustrial) return null;
  if (esResidencial) return "residencial";
  if (esIndustrial) return "industrial";
  return null;
}

/**
 * Detección conservadora de lista de equipos (solo casos claros).
 * Requiere conector de lista y al menos un indicio de equipo/cantidad.
 */
export function detectarEquiposDirectoEnTexto(texto: string): string | null {
  const t = texto.trim();
  if (t.length < 8) return null;

  const tieneConectorLista = /,|\s+y\s+|\s+m[aá]s\s+/i.test(t);
  if (!tieneConectorLista) return null;

  const pareceListaEquipos =
    /\b(minisplit|mini\s*split|aire|refrigerador|lavadora|computadora|luz|bombas?|equipos?|b[aá]sicos?|\d+\s+[\p{L}\p{N}])/iu.test(
      t,
    );
  if (!pareceListaEquipos) return null;

  return t;
}

type ResultadoAnalisis =
  | { accion: "avanzar"; valor: string }
  | { accion: "repetir"; respuesta: string }
  | { accion: "avanzar_con_retomo"; valor: string; respuesta: string };

async function analizarPasoGenerador(args: {
  phone: string;
  genStep: GenStep;
  texto: string;
}): Promise<ResultadoAnalisis> {
  const preguntaActual = preguntaPorGenStep(args.genStep);

  if (esContenidoInsignificante(args.texto)) {
    return {
      accion: "repetir",
      respuesta: preguntaActual,
    };
  }

  if (esNegativo(args.texto)) {
    return {
      accion: "repetir",
      respuesta: `Entendido. ${preguntaActual}`,
    };
  }

  if (!claudeDisponible()) {
    return { accion: "avanzar", valor: args.texto };
  }

  const interp = await interpretarRespuestaGenerador({
    phone: args.phone,
    genStep: args.genStep,
    preguntaActual,
    textoUsuario: args.texto,
  });

  if (!interp) {
    return { accion: "avanzar", valor: args.texto };
  }

  if (interp.tipo === "fuera_tema") {
    const valorExtra = interp.valorNormalizado?.trim();
    if (valorExtra) {
      const retomo = interp.respuestaRetomo?.trim() || preguntaActual;
      const siguiente = preguntaSiguientePorGenStep(args.genStep);
      const respuesta = siguiente ? `${retomo} ${siguiente}` : retomo;
      return { accion: "avanzar_con_retomo", valor: valorExtra, respuesta };
    }
    return {
      accion: "repetir",
      respuesta: interp.respuestaRetomo?.trim() || preguntaActual,
    };
  }

  if (interp.tipo === "agradece") {
    return {
      accion: "repetir",
      respuesta: respuestaAgradecePendiente(preguntaActual),
    };
  }

  return {
    accion: "avanzar",
    valor: interp.valorNormalizado?.trim() || args.texto,
  };
}

async function persistirPaso(
  phone: string,
  conv: ConversationValue,
  data: Record<string, unknown>,
): Promise<void> {
  await setConversation(phone, {
    state: conv.state,
    lead_id: conv.lead_id,
    nss: conv.nss,
    producto: conv.producto,
    data,
  });
}

const INTERPRETACION_CLAUDE_TIMEOUT_MS = 4000;

/** Interpreta horario con Claude y persiste fecha_contacto si confianza alta/media. */
export async function aplicarFechaContactoInterpretada(
  phone: string,
  horarioTexto: string,
): Promise<void> {
  try {
    const interp = await interpretarHorarioConClaude(horarioTexto);
    if (!interp?.fecha_contacto) return;
    if (interp.confianza !== "alta" && interp.confianza !== "media") return;

    const fecha_contacto_origen =
      interp.confianza === "alta" ? "automatico_alta" : "automatico_media";

    const ok = await actualizarLeadPorConversacion(phone, {
      fecha_contacto: interp.fecha_contacto,
      fecha_contacto_origen,
    });
    if (!ok) {
      console.error("[generadores] Error guardando fecha_contacto interpretada:", {
        phone,
      });
    }
  } catch (err) {
    console.error("[generadores] interpretarHorarioContacto:", err);
  }
}

async function esperarInterpretacionConTimeout(
  phone: string,
  horarioTexto: string,
): Promise<void> {
  await Promise.race([
    aplicarFechaContactoInterpretada(phone, horarioTexto),
    new Promise<void>((resolve) => {
      setTimeout(() => {
        console.warn(
          "[generadores] Timeout interpretación Claude, lead sin fecha_contacto",
        );
        resolve();
      }, INTERPRETACION_CLAUDE_TIMEOUT_MS);
    }),
  ]);
}

export async function procesarYEvolucionarGeneradores(args: {
  phone: string;
  textoUsuario: string;
}): Promise<string | null> {
  const texto = args.textoUsuario.trim();
  if (!texto) return null;

  const phone = args.phone;
  const conv = await getConversation(phone);

  if (conv.state === "finalizado") {
    return MSG_POST_FINALIZADO;
  }

  if (esComandoReinicio(texto)) {
    await setConversation(phone, {
      state: conv.state,
      lead_id: conv.lead_id,
      nss: conv.nss,
      producto: conv.producto,
      data: { ...(conv.data ?? {}), genStep: "tipo" },
    });
    return PREGUNTA_TIPO;
  }

  const genStep = genStepDeData(conv.data);

  if (!genStep) {
    await setConversation(phone, {
      state: conv.state,
      lead_id: conv.lead_id,
      nss: conv.nss,
      producto: conv.producto,
      data: { ...(conv.data ?? {}), genStep: "tipo" },
    });
    return PREGUNTA_TIPO;
  }

  if (genStep === "tipo") {
    const tipoDirecto = detectarTipoDirectoEnTexto(texto);
    if (tipoDirecto) {
      await persistirPaso(phone, conv, {
        ...(conv.data ?? {}),
        gen_tipo: tipoDirecto,
        genStep: "equipos",
      });
      return PREGUNTA_EQUIPOS;
    }

    const resultado = await analizarPasoGenerador({ phone, genStep, texto });
    if (resultado.accion === "repetir") {
      return resultado.respuesta;
    }
    if (resultado.accion === "avanzar_con_retomo") {
      await persistirPaso(phone, conv, {
        ...(conv.data ?? {}),
        gen_tipo: resultado.valor,
        genStep: "equipos",
      });
      return resultado.respuesta;
    }
    await persistirPaso(phone, conv, {
      ...(conv.data ?? {}),
      gen_tipo: resultado.valor,
      genStep: "equipos",
    });
    return PREGUNTA_EQUIPOS;
  }

  if (genStep === "equipos") {
    const equiposDirecto = detectarEquiposDirectoEnTexto(texto);
    if (equiposDirecto) {
      await persistirPaso(phone, conv, {
        ...(conv.data ?? {}),
        gen_equipos: equiposDirecto,
        genStep: "horario",
      });
      return PREGUNTA_HORARIO;
    }

    const resultado = await analizarPasoGenerador({ phone, genStep, texto });
    if (resultado.accion === "repetir") {
      return resultado.respuesta;
    }
    if (resultado.accion === "avanzar_con_retomo") {
      await persistirPaso(phone, conv, {
        ...(conv.data ?? {}),
        gen_equipos: resultado.valor,
        genStep: "horario",
      });
      return resultado.respuesta;
    }
    await persistirPaso(phone, conv, {
      ...(conv.data ?? {}),
      gen_equipos: resultado.valor,
      genStep: "horario",
    });
    return PREGUNTA_HORARIO;
  }

  const resultado = await analizarPasoGenerador({ phone, genStep: "horario", texto });
  if (resultado.accion === "repetir") {
    return resultado.respuesta;
  }

  const horarioFinal = resultado.valor;
  const genTipo =
    typeof conv.data?.gen_tipo === "string" ? conv.data.gen_tipo : "";
  const genEquipos =
    typeof conv.data?.gen_equipos === "string" ? conv.data.gen_equipos : "";

  const nota = `Generador — Uso: ${genTipo || "N/D"}. Equipos a respaldar: ${genEquipos || "N/D"}.`;

  const ok = await actualizarLeadPorConversacion(phone, {
    estado: "nuevo",
    horario: horarioFinal,
    nota,
  });
  if (!ok) {
    console.error("[generadores] Error actualizando lead:", { phone });
  }

  await esperarInterpretacionConTimeout(phone, horarioFinal);

  await setConversation(phone, {
    state: "finalizado",
    lead_id: conv.lead_id,
    nss: conv.nss,
    producto: conv.producto,
    data: {
      ...(conv.data ?? {}),
      gen_horario: horarioFinal,
      genStep: "horario",
    },
  });

  return MSG_CIERRE;
}

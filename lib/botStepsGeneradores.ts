import {
  claudeDisponible,
  interpretarRespuestaGenerador,
} from "@/lib/claudeAssistant";
import type { ConversationValue } from "@/lib/conversationMemory";
import { getConversation, setConversation } from "@/lib/conversationMemory";
import { actualizarLeadPorConversacion } from "@/lib/leadProvisional";
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

function respuestaAgradecePendiente(preguntaActual: string): string {
  return `¡Con gusto! Solo para terminar: ${preguntaActual}`;
}

type ResultadoAnalisis =
  | { accion: "avanzar"; valor: string }
  | { accion: "repetir"; respuesta: string };

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
    const resultado = await analizarPasoGenerador({ phone, genStep, texto });
    if (resultado.accion === "repetir") {
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
    const resultado = await analizarPasoGenerador({ phone, genStep, texto });
    if (resultado.accion === "repetir") {
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

import {
  claudeDisponible,
  interpretarRespuestaUsuario,
  limpiarHistorialClaude,
  limpiarMarkdown,
  naturalizarMensajeBot,
  type InterpretacionUsuario,
} from "@/lib/claudeAssistant";
import { getConversation } from "@/lib/conversationMemory";
import { procesarYEvolucionarGeneradores } from "@/lib/botStepsGeneradores";
import { procesarYEvolucionarPaneles } from "@/lib/botStepsPaneles";
import {
  ejecutarPasoCore,
  esComandoReinicio,
  esOptOut,
  manejarOptOut,
  MSG_REINTENTO_HORARIO,
  preguntaDelEstado,
  reiniciarFlujoCore,
  tipoEsperadoDelEstado,
  type BotState,
  type EntradaInterpretada,
  type ResultadoPaso,
} from "@/lib/botStepsCore";

export type { BotState } from "@/lib/botStepsCore";

const ESTADOS_CON_CLAUDE: ReadonlySet<BotState> = new Set([
  "esperando_labor_vigente",
  "esperando_infonavit",
  "esperando_credito_activo",
  "esperando_datos",
  "esperando_horario",
]);

async function estadoActivo(phone: string): Promise<BotState> {
  const conv = await getConversation(phone);
  return conv.state;
}

function estadoParaPregunta(state: BotState): BotState {
  return state === "inicio" ? "esperando_labor_vigente" : state;
}

function interpretacionAEntrada(
  interp: InterpretacionUsuario,
): EntradaInterpretada | undefined {
  switch (interp.tipo) {
    case "si":
      return { esSi: true };
    case "no":
      return { esNo: true };
    case "nss":
      return { nss: interp.nss ?? null };
    case "horario":
      return { esHorarioValido: true };
    default:
      return undefined;
  }
}

async function aplicarClaudeSalida(
  phone: string,
  resultado: ResultadoPaso,
  contextoPaso: string,
): Promise<string> {
  if (resultado.exacto || !claudeDisponible()) {
    return limpiarMarkdown(resultado.texto);
  }
  return limpiarMarkdown(
    await naturalizarMensajeBot({
      phone,
      mensajeBase: resultado.texto,
      contextoPaso,
    }),
  );
}

/**
 * Evoluciona el estado en memoria y devuelve el texto a enviar al usuario.
 * Capa Claude opcional: interpretación y naturalización sin cambiar el flujo.
 */
export async function procesarYEvolucionar(args: {
  phone: string;
  textoUsuario: string;
}): Promise<string | null> {
  const texto = args.textoUsuario.trim();
  if (!texto) return null;

  const phone = args.phone;
  const conv = await getConversation(phone);
  const estadoActual = conv.state;
  const producto = conv.producto ?? "mejoravit";

  // Router por producto
  if (producto === "paneles") {
    return procesarYEvolucionarPaneles({ phone, textoUsuario: texto });
  }
  if (producto === "generadores") {
    return procesarYEvolucionarGeneradores({ phone, textoUsuario: texto });
  }
  // producto === 'mejoravit' → flujo actual sin cambios

  if (esComandoReinicio(texto)) {
    limpiarHistorialClaude(phone);
    const reinicio = await reiniciarFlujoCore(phone);
    return aplicarClaudeSalida(phone, reinicio, "reinicio");
  }

  if (estadoActual !== "inicio" && esOptOut(texto)) {
    const resultadoOptOut = await manejarOptOut(phone);
    return resultadoOptOut.texto;
  }

  if (estadoActual === "inicio") {
    const resultadoInicio = await ejecutarPasoCore({
      phone,
      textoUsuario: texto,
    });
    return resultadoInicio.texto;
  }

  if (estadoActual === "finalizado") {
    const resultado = await ejecutarPasoCore({
      phone,
      textoUsuario: texto,
    });
    return resultado.texto;
  }

  const state = estadoActual;
  const statePregunta = estadoParaPregunta(state);
  console.log("[FLUJO] estado:", state, "texto:", texto);

  let entrada: EntradaInterpretada | undefined;

  // Solo llamar a Claude si NO es una pregunta de sí/no.
  // Para sí/no, normalizeText es suficiente y más confiable.
  if (
    claudeDisponible() &&
    ESTADOS_CON_CLAUDE.has(state)
  ) {
    const interp = await interpretarRespuestaUsuario({
      phone,
      state: statePregunta,
      textoUsuario: texto,
      preguntaActual: preguntaDelEstado(statePregunta),
      tipoEsperado: tipoEsperadoDelEstado(statePregunta),
    });
    console.log("[FLUJO] interpretacion Claude:", interp?.tipo);

    if (interp?.tipo === "fuera_tema") {
      if (state === "esperando_horario" && texto.length >= 3) {
        entrada = { esHorarioValido: true };
      } else {
        return limpiarMarkdown(
          interp.respuestaRetomo ?? preguntaDelEstado(statePregunta),
        );
      }
    }

    if (interp?.tipo === "reiniciar") {
      limpiarHistorialClaude(phone);
      const reinicio = await reiniciarFlujoCore(phone);
      return reinicio.texto;
    }

    if (interp?.tipo === "ambiguo" || interp?.tipo === "invalido") {
      if (state === "esperando_horario" && interp.respuestaRetomo) {
        return limpiarMarkdown(interp.respuestaRetomo);
      }
      if (state === "esperando_horario") {
        return MSG_REINTENTO_HORARIO;
      }
      return preguntaDelEstado(statePregunta);
    }

    if (
      interp &&
      (interp.tipo === "si" ||
        interp.tipo === "no" ||
        interp.tipo === "nss" ||
        interp.tipo === "horario")
    ) {
      entrada = interpretacionAEntrada(interp);
    }
  }

  console.log("[FLUJO] entrada generada:", JSON.stringify(entrada));

  const resultado = await ejecutarPasoCore({
    phone,
    textoUsuario: texto,
    entrada,
  });

  const contexto = await estadoActivo(phone);
  return aplicarClaudeSalida(phone, resultado, contexto);
}

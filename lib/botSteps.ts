import {
  claudeDisponible,
  interpretarRespuestaUsuario,
  limpiarHistorialClaude,
  naturalizarMensajeBot,
  type InterpretacionUsuario,
} from "@/lib/claudeAssistant";
import { getConversation } from "@/lib/conversationMemory";
import {
  ejecutarPasoCore,
  esComandoReinicio,
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
  "esperando_centro_trabajo",
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
    return resultado.texto;
  }
  return naturalizarMensajeBot({
    phone,
    mensajeBase: resultado.texto,
    contextoPaso,
  });
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

  if (esComandoReinicio(texto)) {
    limpiarHistorialClaude(phone);
    const reinicio = await reiniciarFlujoCore(phone);
    return aplicarClaudeSalida(phone, reinicio, "reinicio");
  }

  if (estadoActual === "inicio") {
    const resultadoInicio = await ejecutarPasoCore({
      phone,
      textoUsuario: texto,
    });
    return resultadoInicio.texto;
  }

  if (estadoActual === "finalizado") {
    limpiarHistorialClaude(phone);
    const reinicio = await reiniciarFlujoCore(phone);
    return reinicio.texto;
  }

  const state = estadoActual;
  const statePregunta = estadoParaPregunta(state);
  const tipoEsperado = tipoEsperadoDelEstado(state);
  console.log("[FLUJO] estado:", state, "texto:", texto);

  let entrada: EntradaInterpretada | undefined;

  // Solo llamar a Claude si NO es una pregunta de sí/no.
  // Para sí/no, normalizeText es suficiente y más confiable.
  if (
    claudeDisponible() &&
    ESTADOS_CON_CLAUDE.has(state) &&
    tipoEsperado !== "si_no"
  ) {
    const interp = await interpretarRespuestaUsuario({
      phone,
      state: statePregunta,
      textoUsuario: texto,
      preguntaActual: preguntaDelEstado(statePregunta),
      tipoEsperado,
    });
    console.log("[FLUJO] interpretacion Claude:", interp?.tipo);

    if (interp?.tipo === "fuera_tema" && interp.respuestaRetomo) {
      return interp.respuestaRetomo;
    }

    if (interp?.tipo === "reiniciar") {
      limpiarHistorialClaude(phone);
      const reinicio = await reiniciarFlujoCore(phone);
      return aplicarClaudeSalida(phone, reinicio, "reinicio");
    }

    if (interp?.tipo === "ambiguo") {
      entrada = undefined;
    }

    if (
      interp &&
      interp.tipo !== "invalido" &&
      interp.tipo !== "ambiguo" &&
      interp.tipo !== "fuera_tema"
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

  // Para si_no: si hubo reintento, pedimos ayuda a Claude para fuera de tema
  if (claudeDisponible() && tipoEsperado === "si_no") {
    const preguntaActual = preguntaDelEstado(statePregunta);
    const fueReintento =
      resultado.texto === preguntaActual || resultado.texto.includes("No entendí");

    if (fueReintento) {
      const interp = await interpretarRespuestaUsuario({
        phone,
        state: statePregunta,
        textoUsuario: texto,
        preguntaActual,
        tipoEsperado: "si_no",
      });
      if (interp?.tipo === "fuera_tema" && interp.respuestaRetomo) {
        return interp.respuestaRetomo;
      }
    }
  }

  const contexto = await estadoActivo(phone);
  return aplicarClaudeSalida(phone, resultado, contexto);
}

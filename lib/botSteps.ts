import {
  claudeDisponible,
  interpretarRespuestaUsuario,
  limpiarHistorialClaude,
  naturalizarMensajeBot,
  type InterpretacionUsuario,
} from "@/lib/claudeAssistant";
import { conversationMemory } from "@/lib/conversationMemory";
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

function estadoActivo(phone: string): BotState {
  const raw = conversationMemory.get(phone)?.state;
  return (raw ?? "inicio") as BotState;
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

  if (esComandoReinicio(texto)) {
    limpiarHistorialClaude(phone);
    const reinicio = reiniciarFlujoCore(phone);
    return aplicarClaudeSalida(phone, reinicio, "reinicio");
  }

  const state = estadoActivo(phone);
  const statePregunta = estadoParaPregunta(state);

  let entrada: EntradaInterpretada | undefined;

  if (claudeDisponible() && state !== "finalizado") {
    const interp = await interpretarRespuestaUsuario({
      phone,
      state: statePregunta,
      textoUsuario: texto,
      preguntaActual: preguntaDelEstado(statePregunta),
      tipoEsperado: tipoEsperadoDelEstado(statePregunta),
    });

    if (interp?.tipo === "fuera_tema" && interp.respuestaRetomo) {
      return interp.respuestaRetomo;
    }

    if (interp?.tipo === "reiniciar") {
      limpiarHistorialClaude(phone);
      const reinicio = reiniciarFlujoCore(phone);
      return aplicarClaudeSalida(phone, reinicio, "reinicio");
    }

    if (
      interp &&
      interp.tipo !== "invalido" &&
      interp.tipo !== "fuera_tema"
    ) {
      entrada = interpretacionAEntrada(interp);
    }
  }

  const resultado = ejecutarPasoCore({
    phone,
    textoUsuario: texto,
    entrada,
  });

  const contexto = estadoActivo(phone);
  return aplicarClaudeSalida(phone, resultado, contexto);
}

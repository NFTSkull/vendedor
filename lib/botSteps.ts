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

    if (interp?.tipo === "fuera_tema" && interp.respuestaRetomo) {
      return interp.respuestaRetomo;
    }

    if (interp?.tipo === "reiniciar") {
      limpiarHistorialClaude(phone);
      const reinicio = await reiniciarFlujoCore(phone);
      return reinicio.texto;
    }

    if (interp && interp.tipo !== "invalido") {
      entrada = interpretacionAEntrada(interp);
    }
  }

  console.log("[FLUJO] entrada generada:", JSON.stringify(entrada));

  const resultado = await ejecutarPasoCore({
    phone,
    textoUsuario: texto,
    entrada,
  });

  if (resultado.texto === "__POST_FLUJO__") {
    try {
      const Anthropic = (await import("@anthropic-ai/sdk")).default;
      const client = new Anthropic({
        apiKey: process.env.ANTHROPIC_API_KEY,
      });
      const response = await client.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 200,
        messages: [
          {
            role: "user",
            content: `El usuario completó el registro de Mejoravit y escribió: "${texto}". 
Responde en máximo 2 líneas, tono profesional, sin emojis:
- Si agradece → responde cordialmente
- Si pregunta cuándo le contactan → pronto en el horario indicado
- Si pregunta dónde están → Monterrey, Nuevo León  
- Si pregunta qué es Mejoravit → crédito de mejora del hogar con Infonavit
- Si pregunta algo más → responde brevemente, el asesor aclarará
- Si se despide → despídete cordialmente
NUNCA reinicies el flujo.`,
          },
        ],
      });
      const respuesta = response.content
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("");
      return respuesta || "Con gusto. Un asesor le contactará pronto.";
    } catch {
      return "Con gusto. Un asesor se pondrá en contacto contigo pronto.";
    }
  }

  const contexto = await estadoActivo(phone);
  return aplicarClaudeSalida(phone, resultado, contexto);
}

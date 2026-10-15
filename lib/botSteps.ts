import {
  claudeDisponible,
  interpretarRespuestaUsuario,
  limpiarHistorialClaude,
  limpiarMarkdown,
  naturalizarMensajeBot,
  type InterpretacionUsuario,
} from "@/lib/claudeAssistant";
import {
  CONTEXTO_PRECALIFICACION,
  detectarConsultaConCasa,
  esConsultaBreve,
  MSG_SIN_INFORMACION_CONFIRMADA,
  respuestaDudaPermitida,
  responderConsultaConCasa,
  type ConsultaConCasa,
} from "@/lib/conocimientoConCasa";
import { getConversation } from "@/lib/conversationMemory";
import { normalizarTexto } from "@/lib/normalizeText";
import { procesarYEvolucionarCompraCasa } from "@/lib/botStepsCompraCasa";
import { procesarYEvolucionarGeneradores } from "@/lib/botStepsGeneradores";
import { procesarYEvolucionarPaneles } from "@/lib/botStepsPaneles";
import { procesarMenuProducto } from "@/lib/menuProducto";
import { procesarTramiteMejoravit } from "@/lib/botStepsTramite";
import {
  ejecutarPasoCore,
  esComandoReinicio,
  esOptOut,
  manejarOptOut,
  nssPendienteDeConsulta,
  preguntaDelEstado,
  reiniciarFlujoCore,
  retomoDelEstado,
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

/** Dependen de un trámite en curso: fuera de la precalificación activa no se contestan con su contexto. */
const CONSULTAS_DE_TRAMITE_EN_CURSO: ReadonlySet<ConsultaConCasa> = new Set([
  "avance",
  "que_sigue",
  "aprobado",
]);

function unir(...partes: Array<string | null>): string {
  return partes.filter((p): p is string => Boolean(p?.trim())).join("\n\n");
}

function respuestaConsultaPrevia(id: ConsultaConCasa): string {
  return responderConsultaConCasa(id, CONTEXTO_PRECALIFICACION);
}

function contienePregunta(texto: string, pregunta: string): boolean {
  const limpiar = (s: string) =>
    normalizarTexto(s).replace(/[^a-z0-9ñ ]/g, " ").replace(/\s+/g, " ").trim();
  return limpiar(texto).includes(limpiar(pregunta));
}

/** Respuesta de Claude a una duda de la precalificación: verificada y terminada en la pregunta pendiente. */
function respuestaFueraDeTema(
  texto: string,
  retomoClaude: string | undefined,
  pregunta: string,
): string {
  const retomo = retomoClaude ? limpiarMarkdown(retomoClaude).trim() : "";
  if (retomo && respuestaDudaPermitida(retomo)) {
    return contienePregunta(retomo, pregunta) ? retomo : unir(retomo, pregunta);
  }
  const consulta = detectarConsultaConCasa(texto);
  if (consulta) return unir(respuestaConsultaPrevia(consulta), pregunta);
  return retomo ? unir(MSG_SIN_INFORMACION_CONFIRMADA, pregunta) : pregunta;
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
  if (producto === "compra_casa") {
    return procesarYEvolucionarCompraCasa({ phone, textoUsuario: texto });
  }
  if (producto === "sin_clasificar") {
    const menu = await procesarMenuProducto({ phone, textoUsuario: texto });
    if (menu.tipo === "respuesta") return menu.texto;
    return procesarYEvolucionar({ phone, textoUsuario: texto });
  }
  // producto === 'mejoravit' → flujo actual sin cambios

  if (esComandoReinicio(texto)) {
    limpiarHistorialClaude(phone);
    const reinicio = await reiniciarFlujoCore(phone);
    return aplicarClaudeSalida(phone, reinicio, "reinicio");
  }

  // El trámite maneja sus propios rechazos y pausas sin borrar el avance ni marcar el lead.
  if (estadoActual === "tramite_mejoravit") {
    return limpiarMarkdown(
      await procesarTramiteMejoravit({
        phone,
        texto,
        leadId: conv.lead_id,
        nssConversacion: typeof conv.data?.nss === "string" ? conv.data.nss : null,
      }),
    );
  }

  // Una pregunta informativa se responde con la base de ConCasa sin Claude y sin tocar el estado.
  const consultaBreve = esConsultaBreve(texto) ? detectarConsultaConCasa(texto) : null;
  if (consultaBreve && ESTADOS_CON_CLAUDE.has(estadoActual)) {
    return unir(respuestaConsultaPrevia(consultaBreve), retomoDelEstado(estadoActual, conv.data));
  }
  const consultaSinTramite =
    consultaBreve && !CONSULTAS_DE_TRAMITE_EN_CURSO.has(consultaBreve) ? consultaBreve : null;
  if (consultaSinTramite && estadoActual === "finalizado") {
    return respuestaConsultaPrevia(consultaSinTramite);
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
    return consultaBreve
      ? unir(respuestaConsultaPrevia(consultaBreve), resultadoInicio.texto)
      : resultadoInicio.texto;
  }

  if (estadoActual === "finalizado" || estadoActual === "esperando_horario") {
    const resultado = await ejecutarPasoCore({
      phone,
      textoUsuario: texto,
    });
    return consultaSinTramite
      ? unir(respuestaConsultaPrevia(consultaSinTramite), resultado.texto)
      : resultado.texto;
  }

  const state = estadoActual;
  const statePregunta = estadoParaPregunta(state);
  console.log("[FLUJO] estado:", state);

  let entrada: EntradaInterpretada | undefined;

  // Solo llamar a Claude si NO es una pregunta de sí/no.
  // Para sí/no, normalizeText es suficiente y más confiable.
  // Con un NSS pendiente de consulta, cualquier mensaje reintenta sin volver a pedirlo.
  const reintentoConNssPendiente =
    state === "esperando_datos" && nssPendienteDeConsulta(conv.data) !== null;
  if (
    claudeDisponible() &&
    ESTADOS_CON_CLAUDE.has(state) &&
    !reintentoConNssPendiente
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
      return respuestaFueraDeTema(
        texto,
        interp.respuestaRetomo,
        retomoDelEstado(statePregunta, conv.data),
      );
    }

    if (interp?.tipo === "reiniciar") {
      limpiarHistorialClaude(phone);
      const reinicio = await reiniciarFlujoCore(phone);
      return reinicio.texto;
    }

    if (interp?.tipo === "ambiguo" || interp?.tipo === "invalido") {
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
  const salida = await aplicarClaudeSalida(phone, resultado, contexto);
  // Respuesta y pregunta en el mismo mensaje ("sí, ¿dónde están?"): el paso avanza igual y la duda se responde primero.
  const consultaMixta = /[?¿]/.test(texto) ? detectarConsultaConCasa(texto) : null;
  return consultaMixta && !CONSULTAS_DE_TRAMITE_EN_CURSO.has(consultaMixta)
    ? unir(respuestaConsultaPrevia(consultaMixta), salida)
    : salida;
}

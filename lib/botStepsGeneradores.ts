import {
  claudeDisponible,
  interpretarRespuestaGenerador,
} from "@/lib/claudeAssistant";
import type { ConversationValue } from "@/lib/conversationMemory";
import { getConversation, setConversation } from "@/lib/conversationMemory";
import { actualizarLeadPorConversacion } from "@/lib/leadProvisional";
import { interpretarHorarioConClaude } from "@/lib/interpretarHorarioContacto";
import { esComandoReinicio } from "@/lib/botStepsCore";
import { esNegativo, normalizarTexto } from "@/lib/normalizeText";

const PREGUNTA_TIPO =
  "¿El generador es para uso industrial o residencial?";
const PREGUNTA_EQUIPOS = "¿Qué equipos necesitas respaldar?";
const PREGUNTA_HORARIO = "¿En qué día y horario te podemos contactar?";
const MSG_CIERRE =
  "¡Listo! Un asesor de Energrum te contactará en el día y horario que indicaste para cotizar tu generador. ⚡";
const MSG_POST_FINALIZADO =
  "Gracias a usted, en un momento le contactamos. ⚡";

const MSG_DESINTERES =
  "Entendido, no hay problema. Si en algún momento decides retomar el tema, aquí estaremos. ¡Que tenga buen día! 😊";

const MSG_PENDIENTE_DECISION =
  "Entendido, no hay problema. Cuando lo hayan decidido con gusto les atendemos. Si necesitan más información, aquí estamos. ¡Que tengan buen día! 😊";

const MSG_REENGAGEMENT =
  "Hola, ¿sigues interesado en proteger tu hogar con un generador? Podemos ayudarte a encontrar la opción ideal. ⚡";

const CATALOGO_GENERADORES = {
  gp3600: {
    modelo: "GENERAC GP3600 110V",
    precio: "$12,186.00",
    msg: "Buenas tardes.\nPara respaldar electrodomésticos, iluminación y refrigerador puede ser suficiente un generador GENERAC GP3600 110V.\nPrecio: $12,186.00 💡",
  },
  gp6500: {
    modelo: "GENERAC GP6500 110V/220V 2 fases",
    precio: "$21,270.00",
    msg: "Buenas tardes.\nPara respaldar electrodomésticos, iluminación y un minisplit puede ser suficiente un generador GENERAC GP6500 110V/220V 2 fases.\nPrecio: $21,270.00 ❄️",
  },
  gp8500e: {
    modelo: "GENERAC GP8500E 110V/220V 2 fases",
    precio: "$23,000.00",
    msg: "Buenas tardes.\nPara respaldar electrodomésticos, iluminación y dos minisplits puede ser suficiente un generador GENERAC GP8500E 110V/220V 2 fases.\nPrecio: $23,000.00 ❄️❄️",
  },
} as const;

type ModeloKey = keyof typeof CATALOGO_GENERADORES;

const MSG_DESGLOSE_COMPLETO = `Buenas tardes.
Aquí te comparto las opciones según lo que necesites respaldar:

1️⃣ GENERAC GP3600 110V — $12,186.00
   Cubre: electrodomésticos básicos, iluminación y refrigerador.

2️⃣ GENERAC GP6500 110V/220V 2 fases — $21,270.00
   Cubre: electrodomésticos, iluminación y 1 minisplit.

3️⃣ GENERAC GP8500E 110V/220V 2 fases — $23,000.00
   Cubre: electrodomésticos, iluminación y 2 minisplits.

¿Cuál se ajusta mejor a lo que necesitas?`;

const MSG_PRECIO_GENERICO =
  "Los generadores para uso residencial rondan entre $12,186 y $23,000 dependiendo de lo que quieras respaldar.\n\nTenemos desde opciones para refrigerador y lo básico del hogar ($12,186) hasta modelos que cubren minisplit y todos los electrodomésticos ($23,000).\n\n¿Qué equipos te interesa respaldar?";

type GenStep = "tipo" | "equipos" | "cotizacion" | "horario";

/** Sin letras ni dígitos → no es respuesta utilizable al paso */
function esContenidoInsignificante(texto: string): boolean {
  return !/[\p{L}\p{N}]/u.test(texto);
}

function genStepDeData(data: Record<string, unknown> | undefined): GenStep | null {
  const step = data?.genStep;
  if (
    step === "tipo" ||
    step === "equipos" ||
    step === "cotizacion" ||
    step === "horario"
  ) {
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
  /casa\s+habitaci[oó]n/i,
  /\bhabitaci[oó]n\b/i,
  /\bvivienda\b/i,
  /\bdomicilio\b/i,
  /\bpredio\b/i,
  /\bfinca\b/i,
  /\branchito\b/i,
  /\brancho\b/i,
  /\bcasita\b/i,
  /\bapartamento\b/i,
  /\bcondo\b/i,
  /\bcondominio\b/i,
  /uso\s+personal/i,
  /uso\s+doméstico/i,
  /uso\s+domestico/i,
  /para\s+mi\s+hogar/i,
  /en\s+mi\s+casa/i,
  /de\s+mi\s+casa/i,
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

export function detectarEquiposEnTexto(
  texto: string,
): ModeloKey | "desglose" | "precio" | null {
  const n = texto
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  const soloPrecio =
    /\b(precio|cuanto cuesta|cuanto vale|costo|cuanto cobran|cuanto es)\b/.test(
      n,
    ) &&
    !/\b(minisplit|mini split|aire|refrigerador|refri|toda|todo|casa|hogar)\b/.test(
      n,
    );
  if (soloPrecio) return "precio";

  const todoLaCasa =
    /\b(toda la casa|todo el hogar|todo|toda|completo|completa|general|no se|no sé|no tengo idea|basico|básico)\b/.test(
      n,
    );
  if (todoLaCasa) return "desglose";

  const dosMinisplit =
    /\b(dos|2)\s*(minisplit|mini\s*split|aires|minisplits|climas|splits)\b/.test(n) ||
    /\bminisplits\b/.test(n) ||
    /\bclimas\b/.test(n) ||
    /\bsplits\b/.test(n);
  if (dosMinisplit) return "gp8500e";

  const unMinisplit =
    /\b(un|1|el|mi)\s*(minisplit|mini\s*split|aire|clima|split)\b/.test(n) ||
    /\b(minisplit|mini\s*split|aire acondicionado|clima|split)\b/.test(n);
  if (unMinisplit) return "gp6500";

  const refri =
    /\b(refrigerador|refri|nevera|heladera)\b/.test(n) ||
    /\b(lo basico|basico|basica|iluminacion|luces?|electrodomesticos? basicos?)\b/.test(
      n,
    );
  if (refri) return "gp3600";

  return null;
}

export function detectarInteresEnTexto(
  texto: string,
  opciones?: { excluirAgradecimientoCotizacion?: boolean },
): "interes" | "desinteres" | null {
  const n = texto
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  const agradecimientoCotizacion =
    "gracias por la informacion|gracias por la información|por la informacion|por la información|muchas gracias|mil gracias|ok gracias|okey gracias|a ok gracias";

  const desinteresBase =
    "caro|muy caro|sale caro|es caro|esta caro|esta muy caro|no me interesa|no gracias|no por ahora|no tengo presupuesto|fuera de mi presupuesto|no puedo|no cuento con|no tengo el dinero|no tengo dinero|sin dinero|no tengo lana|no tengo recursos|por lo pronto no|ahorita no cuento|no alcanza|no me alcanza|lo pensare|lo pensaré|despues|después|ahorita no|ya no|no quiero|solo queria saber|solo quería saber|nada mas queria|nada más quería|solo curiosidad|era curiosidad|solo preguntaba|solo pregunta|le voy a comentar|voy a comentar|lo comento|lo consulto|consultar con|hablar con mi|decirle a mi|preguntarle a|no soy el que decide|no soy quien decide|no decido yo|decide mi|lo decide mi|deja checo|deja que checo|voy a checar|dejame checar|déjame checar|deja chequeo|lo checo|ahorita checo|nomas checo|nomás checo|voy a pensarlo|lo pienso|lo platico";

  const desinteresPatron = opciones?.excluirAgradecimientoCotizacion
    ? desinteresBase
    : `${desinteresBase}|${agradecimientoCotizacion}`;

  const desinteres = new RegExp(`\\b(${desinteresPatron})\\b`).test(n);
  if (desinteres) return "desinteres";

  const interes =
    /\b(me interesa|si me interesa|si quiero|quiero|perfecto|excelente|bien|ok|okay|dale|adelante|como le hago|cuando|a que hora|que sigue|procedemos|lo quiero|me gusta|suena bien|esta bien|como procedo)\b/.test(
      n,
    ) ||
    /^(si|sí|yes|claro|orale|órale|va)\b/.test(n);
  if (interes) return "interes";

  return null;
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
  genStep: "tipo" | "equipos" | "horario";
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

async function manejarCotizacion(
  phone: string,
  conv: ConversationValue,
  resultado: ModeloKey | "desglose" | "precio",
  textoOriginal: string,
): Promise<string> {
  let mensajeCotizacion: string;
  let modeloGuardado: string;

  if (resultado === "desglose") {
    mensajeCotizacion = MSG_DESGLOSE_COMPLETO;
    modeloGuardado = "desglose";
  } else if (resultado === "precio") {
    mensajeCotizacion = MSG_PRECIO_GENERICO;
    modeloGuardado = "precio";
  } else {
    mensajeCotizacion = CATALOGO_GENERADORES[resultado].msg;
    modeloGuardado = resultado;
  }

  await persistirPaso(phone, conv, {
    ...(conv.data ?? {}),
    gen_equipos: textoOriginal,
    gen_modelo: modeloGuardado,
    genStep: "cotizacion",
  });

  return mensajeCotizacion;
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
    const equiposDetectado = detectarEquiposEnTexto(texto);
    if (equiposDetectado) {
      return manejarCotizacion(phone, conv, equiposDetectado, texto);
    }

    const equiposDirecto = detectarEquiposDirectoEnTexto(texto);
    if (equiposDirecto) {
      const reDetectado = detectarEquiposEnTexto(equiposDirecto);
      return manejarCotizacion(
        phone,
        conv,
        reDetectado ?? "desglose",
        equiposDirecto,
      );
    }

    const resultado = await analizarPasoGenerador({ phone, genStep, texto });
    if (resultado.accion === "repetir") {
      return resultado.respuesta;
    }
    const valorFinal = resultado.valor;
    const reDetectado = detectarEquiposEnTexto(valorFinal);
    return manejarCotizacion(phone, conv, reDetectado ?? "desglose", valorFinal);
  }

  if (genStep === "cotizacion") {
    const n = texto.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

    // Step 1: detect clear technical question BEFORE checking desinteres
    // If the message contains a question word and no disinterest signal, let Claude handle it
    const esPreguntaTecnica =
      /\b(como|cómo|cuanto|cuánto|cuantas|cuántas|cuantos|cuántos|que tan|qué tan|sirve|funciona|consume|dura|aguanta|alcanza|incluye|tiene|trae|viene|pesa|mide|ruido|ruidos|decibeles|garantia|garantía|instalacion|instalación|financiamiento|credito|crédito|meses|mensualidades|combustible|gasolina|litros|tanque|autonomia|autonomía|voltaje|watts|potencia|arranque|electrico|eléctrico|portatil|portátil|manual|automatico|automático)\b/.test(n) &&
      !/\b(no me interesa|no gracias|no quiero|no puedo|no tengo|caro|muy caro|sin dinero)\b/.test(n);

    if (esPreguntaTecnica && claudeDisponible()) {
      const modeloActual = conv.data?.gen_modelo;
      const precioActual =
        typeof modeloActual === "string" && modeloActual in CATALOGO_GENERADORES
          ? CATALOGO_GENERADORES[modeloActual as ModeloKey].precio
          : "$12,186–$23,000";

      const interp = await interpretarRespuestaGenerador({
        phone,
        genStep: "equipos",
        preguntaActual: `El cliente acaba de ver la cotización del ${
          typeof modeloActual === "string" && modeloActual in CATALOGO_GENERADORES
            ? CATALOGO_GENERADORES[modeloActual as ModeloKey].modelo
            : "generador"
        } (${precioActual}). Está haciendo una pregunta técnica. Respóndela con tu conocimiento y pregunta si le gustaría que un asesor le contacte para más detalles.`,
        textoUsuario: texto,
      });

      if (interp?.tipo === "fuera_tema" && interp.respuestaRetomo) {
        return interp.respuestaRetomo;
      }
      if (interp?.tipo === "valida") {
        // Claude detected interest while answering
        await persistirPaso(phone, conv, {
          ...(conv.data ?? {}),
          gen_interes: "si",
          genStep: "horario",
        });
        return PREGUNTA_HORARIO;
      }
    }

    // Step 2: check desinteres
    const reaccion = detectarInteresEnTexto(texto);

    if (reaccion === "desinteres") {
      const esPendienteDecision = /\b(le voy a comentar|voy a comentar|lo comento|lo consulto|consultar con|hablar con mi|decirle a mi|preguntarle a|no soy el que decide|no soy quien decide|no decido yo|decide mi|lo decide mi|deja checo|deja que checo|voy a checar|dejame checar|déjame checar|deja chequeo|lo checo|ahorita checo|nomas checo|nomás checo|voy a pensarlo|lo pienso|lo platico)\b/.test(normalizarTexto(texto));

      await actualizarLeadPorConversacion(phone, {
        estado: "no_interesado",
        nota: `Generador — Uso: ${conv.data?.gen_tipo ?? "N/D"}. Equipos: ${conv.data?.gen_equipos ?? "N/D"}. Modelo: ${conv.data?.gen_modelo ?? "N/D"}. ${esPendienteDecision ? "Cliente pendiente de decisión." : "Cliente indicó desinterés por precio."}`,
      });
      await setConversation(phone, {
        state: "finalizado",
        lead_id: conv.lead_id,
        nss: conv.nss,
        producto: conv.producto,
        data: { ...(conv.data ?? {}), gen_interes: "no" },
      });
      return esPendienteDecision ? MSG_PENDIENTE_DECISION : MSG_DESINTERES;
    }

    // Step 3: check interes
    if (reaccion === "interes") {
      await persistirPaso(phone, conv, {
        ...(conv.data ?? {}),
        gen_interes: "si",
        genStep: "horario",
      });
      return PREGUNTA_HORARIO;
    }

    // Step 4: Claude for ambiguous cases
    if (claudeDisponible()) {
      const modeloActual = conv.data?.gen_modelo;
      const precioActual =
        typeof modeloActual === "string" && modeloActual in CATALOGO_GENERADORES
          ? CATALOGO_GENERADORES[modeloActual as ModeloKey].precio
          : "$12,186–$23,000";

      const interp = await interpretarRespuestaGenerador({
        phone,
        genStep: "equipos",
        preguntaActual: `El cliente acaba de ver la cotización (${precioActual}). ¿Muestra interés en continuar o desinterés por el precio?`,
        textoUsuario: texto,
      });

      if (interp?.tipo === "valida") {
        const val = (interp.valorNormalizado ?? "").toLowerCase();
        if (val.includes("desinteres") || val === "no") {
          await actualizarLeadPorConversacion(phone, {
            estado: "no_interesado",
            nota: `Generador — Uso: ${conv.data?.gen_tipo ?? "N/D"}. Equipos: ${conv.data?.gen_equipos ?? "N/D"}. Modelo: ${conv.data?.gen_modelo ?? "N/D"}. Cliente indicó desinterés.`,
          });
          await setConversation(phone, {
            state: "finalizado",
            lead_id: conv.lead_id,
            nss: conv.nss,
            producto: conv.producto,
            data: { ...(conv.data ?? {}), gen_interes: "no" },
          });
          return MSG_DESINTERES;
        }
        await persistirPaso(phone, conv, {
          ...(conv.data ?? {}),
          gen_interes: "si",
          genStep: "horario",
        });
        return PREGUNTA_HORARIO;
      }

      if (interp?.tipo === "fuera_tema" && interp.respuestaRetomo) {
        return interp.respuestaRetomo;
      }
    }

    // Step 5: no clear signal
    const modeloActual = conv.data?.gen_modelo;
    const precioMostrado =
      typeof modeloActual === "string" && modeloActual in CATALOGO_GENERADORES
        ? CATALOGO_GENERADORES[modeloActual as ModeloKey].precio
        : "$12,186–$23,000";
    return `¿Te gustaría que un asesor te contacte para darte más información? El generador ronda los ${precioMostrado} 😊`;
  }

  // Detect late disinterest — client changed their mind after cotizacion
  const desinteresHorario = detectarInteresEnTexto(texto, {
    excluirAgradecimientoCotizacion: true,
  });
  if (desinteresHorario === "desinteres") {
    await actualizarLeadPorConversacion(phone, {
      estado: "no_interesado",
      nota: `Generador — Uso: ${conv.data?.gen_tipo ?? "N/D"}. Equipos: ${conv.data?.gen_equipos ?? "N/D"}. Modelo: ${conv.data?.gen_modelo ?? "N/D"}. Cliente indicó falta de presupuesto en paso horario.`,
    });
    await setConversation(phone, {
      state: "finalizado",
      lead_id: conv.lead_id,
      nss: conv.nss,
      producto: conv.producto,
      data: { ...(conv.data ?? {}), gen_interes: "no" },
    });
    const esPendienteDecision =
      /\b(le voy a comentar|voy a comentar|lo comento|lo consulto|consultar con|hablar con mi|decirle a mi|preguntarle a|no soy el que decide|no soy quien decide|no decido yo|decide mi|lo decide mi|deja checo|deja que checo|voy a checar|voy a ver|dejame checar|déjame checar|deja chequeo|lo checo|lo veo|lo reviso|ahorita checo|nomas checo|nomás checo|voy a pensarlo|lo pienso|lo platico)\b/.test(
        normalizarTexto(texto),
      );
    return esPendienteDecision ? MSG_PENDIENTE_DECISION : MSG_DESINTERES;
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

export function getMsgReengagement(): string {
  return MSG_REENGAGEMENT;
}

export function debeMandarsReengagement(conv: ConversationValue): boolean {
  return conv.data?.genStep === "cotizacion" && conv.state !== "finalizado";
}

import {
  claudeDisponible,
  interpretarRespuestaCompraCasa,
  type CasaStepClaude,
} from "@/lib/claudeAssistant";
import type { ConversationValue } from "@/lib/conversationMemory";
import { getConversation, setConversation } from "@/lib/conversationMemory";
import { actualizarLeadPorConversacion } from "@/lib/leadProvisional";
import { esComandoReinicio } from "@/lib/botStepsCore";
import { esAfirmativo, esNegativo } from "@/lib/normalizeText";

export type CasaStep =
  | "municipio"
  | "colonia"
  | "recamaras"
  | "banos"
  | "tipo_propiedad"
  | "nivel_depto"
  | "pisos_casa"
  | "individual_duplex"
  | "pagada"
  | "acreedor"
  | "monto_adeudado"
  | "imagen";

const PREGUNTA_MUNICIPIO = "¿En qué municipio se encuentra?";
const PREGUNTA_COLONIA = "¿En qué colonia se encuentra?";
const PREGUNTA_RECAMARAS = "¿Cuántas recámaras tiene?";
const PREGUNTA_BANOS = "¿Cuántos baños tiene?";
const PREGUNTA_TIPO = "¿Es casa o departamento?";
const PREGUNTA_NIVEL_DEPTO = "¿En qué nivel se encuentra?";
const PREGUNTA_PISOS_CASA = "¿De cuántos pisos es la casa?";
const PREGUNTA_INDIVIDUAL_DUPLEX = "¿Es individual o dúplex?";
const PREGUNTA_PAGADA = "¿La propiedad está pagada?";
const PREGUNTA_ACREEDOR = "¿A quién le debe?";
const PREGUNTA_MONTO = "¿Cuánto debe?";
const PREGUNTA_IMAGEN =
  "¿Tienes alguna imagen de la propiedad? Puedes mandarla ahora o más adelante.";
const MSG_CIERRE =
  "¡Listo! Un asesor se comunicará contigo para hacerte una oferta 😊";
const MSG_POST_FINALIZADO =
  "Gracias, un asesor se comunicará contigo pronto 😊";

const NUMEROS_ESCRITOS: Record<string, string> = {
  uno: "1",
  una: "1",
  dos: "2",
  tres: "3",
  cuatro: "4",
  cinco: "5",
  seis: "6",
  siete: "7",
  ocho: "8",
  nueve: "9",
  diez: "10",
};

function preguntaPorCasaStep(step: CasaStep): string {
  switch (step) {
    case "municipio":
      return PREGUNTA_MUNICIPIO;
    case "colonia":
      return PREGUNTA_COLONIA;
    case "recamaras":
      return PREGUNTA_RECAMARAS;
    case "banos":
      return PREGUNTA_BANOS;
    case "tipo_propiedad":
      return PREGUNTA_TIPO;
    case "nivel_depto":
      return PREGUNTA_NIVEL_DEPTO;
    case "pisos_casa":
      return PREGUNTA_PISOS_CASA;
    case "individual_duplex":
      return PREGUNTA_INDIVIDUAL_DUPLEX;
    case "pagada":
      return PREGUNTA_PAGADA;
    case "acreedor":
      return PREGUNTA_ACREEDOR;
    case "monto_adeudado":
      return PREGUNTA_MONTO;
    case "imagen":
      return PREGUNTA_IMAGEN;
  }
}

function casaStepDeData(
  data: Record<string, unknown> | undefined,
): CasaStep | null {
  const step = data?.casaStep;
  const validos: CasaStep[] = [
    "municipio",
    "colonia",
    "recamaras",
    "banos",
    "tipo_propiedad",
    "nivel_depto",
    "pisos_casa",
    "individual_duplex",
    "pagada",
    "acreedor",
    "monto_adeudado",
    "imagen",
  ];
  if (typeof step === "string" && (validos as string[]).includes(step)) {
    return step as CasaStep;
  }
  return null;
}

function esContenidoInsignificante(texto: string): boolean {
  return !/[\p{L}\p{N}]/u.test(texto);
}

function extraerCantidad(texto: string): string | null {
  const digitos = texto.match(/\d+/);
  if (digitos) return digitos[0];
  const n = texto
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
  for (const [palabra, valor] of Object.entries(NUMEROS_ESCRITOS)) {
    if (new RegExp(`\\b${palabra}\\b`).test(n)) return valor;
  }
  return null;
}

function detectarTipoPropiedad(texto: string): "casa" | "departamento" | null {
  const n = texto
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
  if (/\b(depa|departamento|depto|condominio|apartamento)\b/.test(n)) {
    return "departamento";
  }
  if (/\bcasa\b/.test(n)) return "casa";
  return null;
}

function detectarIndividualDuplex(
  texto: string,
): "individual" | "duplex" | null {
  const n = texto
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
  if (/\bindividual\b/.test(n)) return "individual";
  if (/\bduplex\b/.test(n)) return "duplex";
  return null;
}

function respuestaAgradecePendiente(preguntaActual: string): string {
  return `¡Con gusto! Solo para terminar: ${preguntaActual}`;
}

type ResultadoAnalisis =
  | { accion: "avanzar"; valor: string }
  | { accion: "repetir"; respuesta: string };

async function analizarPasoCompraCasa(args: {
  phone: string;
  casaStep: CasaStep;
  texto: string;
}): Promise<ResultadoAnalisis> {
  const preguntaActual = preguntaPorCasaStep(args.casaStep);

  if (esContenidoInsignificante(args.texto)) {
    return { accion: "repetir", respuesta: preguntaActual };
  }

  if (!claudeDisponible()) {
    return { accion: "avanzar", valor: args.texto };
  }

  const interp = await interpretarRespuestaCompraCasa({
    phone: args.phone,
    casaStep: args.casaStep as CasaStepClaude,
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

function construirNota(data: Record<string, unknown>): string {
  const municipio = String(data.municipio ?? "N/D");
  const colonia = String(data.colonia ?? "N/D");
  const recamaras = String(data.recamaras ?? "N/D");
  const banos = String(data.banos ?? "N/D");
  const tipoPropiedad = String(data.tipoPropiedad ?? "N/D");
  const pagada = String(data.pagada ?? "N/D");

  let detalleTipo = "";
  if (tipoPropiedad === "departamento" && data.nivelDepto) {
    detalleTipo = `. Nivel ${data.nivelDepto}`;
  } else if (tipoPropiedad === "casa") {
    const partes: string[] = [];
    if (data.pisosCasa) partes.push(`${data.pisosCasa} pisos`);
    if (data.tipoCasa) partes.push(String(data.tipoCasa));
    if (partes.length > 0) detalleTipo = `. ${partes.join(", ")}`;
  }

  let detalleDeuda = "";
  if (pagada === "no") {
    const acreedor = String(data.acreedor ?? "N/D");
    const monto = String(data.montoAdeudado ?? "N/D");
    detalleDeuda = `. Debe a: ${acreedor}, Monto: ${monto}`;
  }

  return `Compra de Casa — Municipio: ${municipio}. Colonia: ${colonia}. Recámaras: ${recamaras}. Baños: ${banos}. Tipo: ${tipoPropiedad}${detalleTipo}. Pagada: ${pagada}${detalleDeuda}.`;
}

async function cerrarFlujo(
  phone: string,
  conv: ConversationValue,
  data: Record<string, unknown>,
): Promise<string> {
  const nota = construirNota(data);
  const ok = await actualizarLeadPorConversacion(phone, {
    estado: "nuevo",
    nota,
  });
  if (!ok) {
    console.error("[compra_casa] Error actualizando lead:", { phone });
  }
  await setConversation(phone, {
    state: "finalizado",
    lead_id: conv.lead_id,
    nss: conv.nss,
    producto: conv.producto,
    data,
  });
  return MSG_CIERRE;
}

async function resolverValorPaso(args: {
  phone: string;
  casaStep: CasaStep;
  texto: string;
}): Promise<{ ok: true; valor: string } | { ok: false; respuesta: string }> {
  const pregunta = preguntaPorCasaStep(args.casaStep);
  const texto = args.texto;

  if (args.casaStep === "recamaras" || args.casaStep === "banos") {
    const cantidad = extraerCantidad(texto);
    if (cantidad) return { ok: true, valor: cantidad };
    const analisis = await analizarPasoCompraCasa(args);
    if (analisis.accion === "repetir") {
      return { ok: false, respuesta: analisis.respuesta };
    }
    const desdeClaude = extraerCantidad(analisis.valor) ?? analisis.valor;
    return { ok: true, valor: desdeClaude };
  }

  if (args.casaStep === "tipo_propiedad") {
    const tipo = detectarTipoPropiedad(texto);
    if (tipo) return { ok: true, valor: tipo };
    const analisis = await analizarPasoCompraCasa(args);
    if (analisis.accion === "repetir") {
      return { ok: false, respuesta: analisis.respuesta };
    }
    const tipoClaude = detectarTipoPropiedad(analisis.valor);
    return { ok: true, valor: tipoClaude ?? analisis.valor };
  }

  if (args.casaStep === "pagada") {
    if (esAfirmativo(texto)) return { ok: true, valor: "si" };
    if (esNegativo(texto)) return { ok: true, valor: "no" };
    const analisis = await analizarPasoCompraCasa(args);
    if (analisis.accion === "repetir") {
      return { ok: false, respuesta: analisis.respuesta };
    }
    if (esAfirmativo(analisis.valor)) return { ok: true, valor: "si" };
    if (esNegativo(analisis.valor)) return { ok: true, valor: "no" };
    return { ok: true, valor: analisis.valor };
  }

  if (args.casaStep === "individual_duplex") {
    const tipo = detectarIndividualDuplex(texto);
    if (tipo) return { ok: true, valor: tipo };
    const analisis = await analizarPasoCompraCasa(args);
    if (analisis.accion === "repetir") {
      return { ok: false, respuesta: analisis.respuesta };
    }
    const tipoClaude = detectarIndividualDuplex(analisis.valor);
    return { ok: true, valor: tipoClaude ?? analisis.valor };
  }

  // municipio, colonia, acreedor, monto_adeudado, nivel_depto, pisos_casa, imagen:
  // siempre Claude decide (sin atajo local de parecePregunta)
  if (
    args.casaStep === "municipio" ||
    args.casaStep === "colonia" ||
    args.casaStep === "acreedor" ||
    args.casaStep === "monto_adeudado" ||
    args.casaStep === "nivel_depto" ||
    args.casaStep === "pisos_casa" ||
    args.casaStep === "imagen"
  ) {
    const analisis = await analizarPasoCompraCasa(args);
    if (analisis.accion === "repetir") {
      return { ok: false, respuesta: analisis.respuesta };
    }
    return { ok: true, valor: analisis.valor };
  }

  return { ok: false, respuesta: pregunta };
}

export async function procesarYEvolucionarCompraCasa(args: {
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
      data: { ...(conv.data ?? {}), casaStep: "municipio" },
    });
    return PREGUNTA_MUNICIPIO;
  }

  const casaStep = casaStepDeData(conv.data);

  if (!casaStep) {
    await setConversation(phone, {
      state: conv.state,
      lead_id: conv.lead_id,
      nss: conv.nss,
      producto: conv.producto,
      data: { ...(conv.data ?? {}), casaStep: "municipio" },
    });
    return PREGUNTA_MUNICIPIO;
  }

  const resuelto = await resolverValorPaso({ phone, casaStep, texto });
  if (!resuelto.ok) return resuelto.respuesta;

  const valor = resuelto.valor;
  const dataBase = { ...(conv.data ?? {}) };

  if (casaStep === "municipio") {
    await persistirPaso(phone, conv, {
      ...dataBase,
      municipio: valor,
      casaStep: "colonia",
    });
    return PREGUNTA_COLONIA;
  }

  if (casaStep === "colonia") {
    await persistirPaso(phone, conv, {
      ...dataBase,
      colonia: valor,
      casaStep: "recamaras",
    });
    return PREGUNTA_RECAMARAS;
  }

  if (casaStep === "recamaras") {
    await persistirPaso(phone, conv, {
      ...dataBase,
      recamaras: valor,
      casaStep: "banos",
    });
    return PREGUNTA_BANOS;
  }

  if (casaStep === "banos") {
    await persistirPaso(phone, conv, {
      ...dataBase,
      banos: valor,
      casaStep: "tipo_propiedad",
    });
    return PREGUNTA_TIPO;
  }

  if (casaStep === "tipo_propiedad") {
    const tipo =
      detectarTipoPropiedad(valor) ??
      (valor === "casa" || valor === "departamento" ? valor : null);
    if (!tipo) {
      return PREGUNTA_TIPO;
    }
    if (tipo === "departamento") {
      await persistirPaso(phone, conv, {
        ...dataBase,
        tipoPropiedad: "departamento",
        casaStep: "nivel_depto",
      });
      return PREGUNTA_NIVEL_DEPTO;
    }
    await persistirPaso(phone, conv, {
      ...dataBase,
      tipoPropiedad: "casa",
      casaStep: "pisos_casa",
    });
    return PREGUNTA_PISOS_CASA;
  }

  if (casaStep === "nivel_depto") {
    await persistirPaso(phone, conv, {
      ...dataBase,
      nivelDepto: valor,
      casaStep: "pagada",
    });
    return PREGUNTA_PAGADA;
  }

  if (casaStep === "pisos_casa") {
    await persistirPaso(phone, conv, {
      ...dataBase,
      pisosCasa: valor,
      casaStep: "individual_duplex",
    });
    return PREGUNTA_INDIVIDUAL_DUPLEX;
  }

  if (casaStep === "individual_duplex") {
    const tipoCasa =
      detectarIndividualDuplex(valor) ??
      (valor === "individual" || valor === "duplex" ? valor : valor);
    await persistirPaso(phone, conv, {
      ...dataBase,
      tipoCasa,
      casaStep: "pagada",
    });
    return PREGUNTA_PAGADA;
  }

  if (casaStep === "pagada") {
    const pagada =
      valor === "si" || valor === "no"
        ? valor
        : esAfirmativo(valor)
          ? "si"
          : esNegativo(valor)
            ? "no"
            : null;
    if (!pagada) return PREGUNTA_PAGADA;
    if (pagada === "si") {
      await persistirPaso(phone, conv, {
        ...dataBase,
        pagada: "si",
        casaStep: "imagen",
      });
      return PREGUNTA_IMAGEN;
    }
    await persistirPaso(phone, conv, {
      ...dataBase,
      pagada: "no",
      casaStep: "acreedor",
    });
    return PREGUNTA_ACREEDOR;
  }

  if (casaStep === "acreedor") {
    await persistirPaso(phone, conv, {
      ...dataBase,
      acreedor: valor,
      casaStep: "monto_adeudado",
    });
    return PREGUNTA_MONTO;
  }

  if (casaStep === "monto_adeudado") {
    await persistirPaso(phone, conv, {
      ...dataBase,
      montoAdeudado: valor,
      casaStep: "imagen",
    });
    return PREGUNTA_IMAGEN;
  }

  // imagen → cierre (solo si Claude clasificó como valida)
  return cerrarFlujo(phone, conv, {
    ...dataBase,
    mencionaImagen: valor,
    casaStep: "imagen",
  });
}

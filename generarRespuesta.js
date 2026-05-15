function normalizarTexto(texto) {
  return String(texto || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function esSaludo(t) {
  const n = normalizarTexto(t);
  return (
    /^(hola|buen(os|as)\s*d[ií]as|buenas\s*tardes|buenas\s*noches|hey|qu[eé]\s*tal|saludos|buenas)\b/.test(
      n
    ) || n === "hola" || n.startsWith("hola ")
  );
}

/** Texto ya normalizado (minúsculas, sin acentos, trim). */
function esRespuestaAfirmativaNormalizada(n) {
  if (!n) return false;
  if (esRespuestaNegativaNormalizada(n)) return false;

  if (n.includes("si trabajo y cotizo")) return true;
  if (n.includes("si trabajo en monterrey")) return true;
  if (n.includes("si en monterrey")) return true;
  if (n.includes("si cotizo")) return true;
  if (n.includes("si trabajo")) return true;
  if (n.includes("claro")) return true;
  if (n.includes("trabajo")) return true;
  if (n.includes("si")) return true;

  const otros = [
    "ok",
    "okay",
    "dale",
    "por favor",
    "me interesa",
    "quiero",
    "adelante",
    "listo",
    "perfecto",
    "va"
  ];
  for (const x of otros) {
    if (n.includes(x)) return true;
  }

  if (n === "s" || n === "y") return true;
  return false;
}

function esRespuestaNegativaNormalizada(n) {
  if (!n) return false;
  if (n.includes("no trabajo")) return true;
  if (n.includes("no cotizo")) return true;
  if (n.includes("no en monterrey")) return true;
  if (/\b(no|nop|nel|nah)\b/.test(n)) return true;
  if (n.includes("mejor no") || n.includes("ahorita no") || n.includes("no gracias")) return true;
  return false;
}

function esAfirmativo(t) {
  return esRespuestaAfirmativaNormalizada(normalizarTexto(t));
}

function esNegativo(t) {
  return esRespuestaNegativaNormalizada(normalizarTexto(t));
}

function esDudaBasica(t) {
  const n = normalizarTexto(t);
  return (
    /\b(que\s*es|qu[eé]\s*es|como\s*funciona|c[oó]mo\s*funciona|es\s*seguro|me\s*afecta|cobra|costo|comisi[oó]n|enga[nñ]o|riesgo)\b/.test(
      n
    )
  );
}

function extraerNssSiValido(texto) {
  const soloDigitos = String(texto || "").replace(/\D/g, "");
  if (soloDigitos.length >= 10 && soloDigitos.length <= 13) return soloDigitos;
  return null;
}

function pareceNss(t) {
  return extraerNssSiValido(t) !== null;
}

function logInterpretacionEtapa(estado, mensaje) {
  const n = normalizarTexto(mensaje);
  const af = esAfirmativo(mensaje);
  const neg = esNegativo(mensaje);
  console.log("[generarRespuesta]", {
    estado,
    textoNormalizado: n,
    afirmativo: af,
    negativo: neg
  });
}

function faqCorta(estado) {
  return (
    "Con gusto te aclaro 👍 " +
    "Es un esquema formal del IMSS/Mejoravit; yo solo te oriento paso a paso. " +
    "Para seguir, dime: ¿actualmente tienes una relación laboral vigente en Nuevo León?"
  );
}

function generarRespuesta(mensaje, estado) {
  const msg = String(mensaje || "");
  const e = String(estado || "inicio");
  const textoNormalizado = normalizarTexto(msg);

  // 🔥 PRIORIDAD MÁXIMA: reinicio
  if (
    textoNormalizado.includes("hola") ||
    textoNormalizado.includes("buenas") ||
    textoNormalizado === "info"
  ) {
    return {
      respuesta:
        "Buenas tardes, gracias por contactarnos.\n" +
        "¿Actualmente tienes una relación laboral vigente en Nuevo León?",
      nuevoEstado: "relacion_laboral"
    };
  }

  logInterpretacionEtapa(e, msg);

  if (e === "fin" || e === "terminado") {
    return {
      respuesta:
        "Listo, quedo atento por aquí 🙌 Si más adelante quieres retomarlo, escríbeme “hola”.",
      nuevoEstado: e === "fin" ? "fin" : "terminado"
    };
  }

  if (esDudaBasica(msg) && e !== "terminado" && e !== "fin") {
    return { respuesta: faqCorta(e), nuevoEstado: e };
  }

  if (e === "inicio") {
    if (esSaludo(msg) || msg.trim().length > 0) {
      return {
        respuesta:
          "Buenas tardes, gracias por contactarnos.\n" +
          "¿Actualmente tienes una relación laboral vigente en Nuevo León?",
        nuevoEstado: "relacion_laboral"
      };
    }
  }

  if (e === "interes" || e === "relacion_laboral") {
    if (esAfirmativo(msg)) {
      return {
        respuesta: "¿Actualmente estás dado de alta en INFONAVIT?",
        nuevoEstado: "alta_infonavit"
      };
    }
    if (esNegativo(msg)) {
      return {
        respuesta:
          "Lo sentimos, este es un requisito indispensable para obtener el crédito.",
        nuevoEstado: "fin"
      };
    }
    return {
      respuesta:
        "Para continuar, necesito confirmación con sí o no.\n" +
        "¿Actualmente tienes una relación laboral vigente en Nuevo León?",
      nuevoEstado: "relacion_laboral"
    };
  }

  if (e === "alta_infonavit") {
    if (esAfirmativo(msg)) {
      return {
        respuesta: "¿Tienes un crédito INFONAVIT activo?",
        nuevoEstado: "credito_activo"
      };
    }
    if (esNegativo(msg)) {
      return {
        respuesta:
          "Lo sentimos, este es un requisito indispensable para obtener el crédito.",
        nuevoEstado: "fin"
      };
    }
    return {
      respuesta:
        "Por favor respóndeme con sí o no.\n" +
        "¿Actualmente estás dado de alta en INFONAVIT?",
      nuevoEstado: "alta_infonavit"
    };
  }

  if (e === "credito_activo") {
    if (esAfirmativo(msg)) {
      return {
        respuesta:
          "Es necesario que termines de pagar tu crédito para continuar.",
        nuevoEstado: "fin"
      };
    }
    if (esNegativo(msg)) {
      return {
        respuesta: "¿Tu centro de trabajo está en Nuevo León?",
        nuevoEstado: "centro_trabajo_nl"
      };
    }
    return {
      respuesta:
        "Para continuar, confírmame con sí o no.\n" +
        "¿Tienes un crédito INFONAVIT activo?",
      nuevoEstado: "credito_activo"
    };
  }

  if (e === "filtro" || e === "centro_trabajo_nl") {
    if (esAfirmativo(msg)) {
      return {
        respuesta: "Compárteme tu número de seguro social para darte el monto autorizado.",
        nuevoEstado: "nss"
      };
    }
    if (esNegativo(msg)) {
      return {
        respuesta:
          "Lo sentimos, este es un requisito indispensable para obtener el crédito.",
        nuevoEstado: "fin"
      };
    }
    return {
      respuesta:
        "Para continuar, respóndeme con sí o no.\n" +
        "¿Tu centro de trabajo está en Nuevo León?",
      nuevoEstado: "centro_trabajo_nl"
    };
  }

  if (e === "nss") {
    if (pareceNss(msg)) {
      return {
        respuesta:
          "Tu monto autorizado es aproximado de $XX,XXX.\n" +
          "¿En qué día y horario te podemos contactar para darte más detalles?",
        nuevoEstado: "contacto"
      };
    }
    return {
      respuesta:
        "Para continuar, compárteme tu número de seguridad social (solo números).",
      nuevoEstado: "nss"
    };
  }

  if (e === "contacto") {
    return {
      respuesta:
        "Perfecto, gracias. Con esa información te contactamos para continuar.",
      nuevoEstado: "terminado"
    };
  }

  // fallback
  return {
    respuesta:
      "Buenas tardes, gracias por contactarnos.\n" +
      "¿Actualmente tienes una relación laboral vigente en Nuevo León?",
    nuevoEstado: "relacion_laboral"
  };
}

module.exports = { generarRespuesta, extraerNssSiValido };

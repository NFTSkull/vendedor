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
    "Para seguir, dime: ¿trabajas en Monterrey y cotizas al IMSS?"
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
      respuesta: "Hola 👋 ¿Te interesa utilizar tu crédito mejoravit?",
      nuevoEstado: "interes"
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
          "Hola 👋 vi que te interesa el crédito Mejoravit\n" +
          "¿quieres que revise si puedes utilizarlo?",
        nuevoEstado: "interes"
      };
    }
  }

  if (e === "interes") {
    if (esAfirmativo(msg)) {
      return {
        respuesta:
          "Perfecto 👍\n" +
          "¿Trabajas en Monterrey y cotizas al IMSS?",
        nuevoEstado: "filtro"
      };
    }
    if (esNegativo(msg)) {
      return {
        respuesta:
          "Entendido 🙌 Sin problema. Si cambias de opinión, aquí estoy; solo mándame un “hola”.",
        nuevoEstado: "terminado"
      };
    }
    return {
      respuesta:
        "Para poder ayudarte, ¿quieres que revise si puedes utilizar tu Mejoravit?",
      nuevoEstado: "interes"
    };
  }

  if (e === "filtro") {
    console.log("ENTRANDO A FILTRO");

    const negativo = esNegativo(msg);
    const afirmativo = esAfirmativo(msg);

    if (negativo) {
      console.log("RESPUESTA NEGATIVA DETECTADA");
      return {
        respuesta:
          "Por el momento este apoyo aplica solo para personas que trabajan y cotizan en Monterrey 🙏",
        nuevoEstado: "fin"
      };
    }

    if (afirmativo) {
      console.log("RESPUESTA AFIRMATIVA DETECTADA");
      return {
        respuesta: "Perfecto 🙌 compárteme tu número de seguro social para revisarlo",
        nuevoEstado: "nss"
      };
    }

    const n = normalizarTexto(msg);
    const alt = (n.length + (n.codePointAt(0) || 0)) % 2 === 0;
    return {
      respuesta: alt
        ? "Para poder seguir, confírmame con un sí o un no: ¿trabajas en Monterrey y cotizas al IMSS? Si quieres, también puedes explicarme en una sola frase."
        : "Solo para ubicarnos bien: ¿trabajas en Monterrey y cotizas al IMSS? Con un “sí” o un “no” me alcanza; si prefieres, detalla en una frase.",
      nuevoEstado: "filtro"
    };
  }

  if (e === "nss") {
    if (pareceNss(msg)) {
      return {
        respuesta:
          "Dame un segundo mientras lo reviso...\n\n" +
          "Listo ✅\n" +
          "Puedes acceder a un monto aproximado para utilizar tu crédito\n" +
          "¿te explico cómo funciona?",
        nuevoEstado: "cierre"
      };
    }
    return {
      respuesta:
        "Para continuar, compárteme tu NSS (solo números). " +
        "Si prefieres no hacerlo ahora, dime “después” y lo vemos con calma.",
      nuevoEstado: "nss"
    };
  }

  if (e === "cierre") {
    if (esAfirmativo(msg)) {
      return {
        respuesta:
          "Te explico rápido 👇\n" +
          "Se utiliza directamente y el pago se descuenta poco a poco\n" +
          "¿te gustaría avanzar con el proceso?",
        nuevoEstado: "cierre_propuesta"
      };
    }
    if (esNegativo(msg)) {
      return {
        respuesta:
          "Perfecto, sin presión 🙂 Si quieres retomarlo, escríbeme cuando te quede bien.",
        nuevoEstado: "terminado"
      };
    }
    return {
      respuesta:
        "¿Te late que te explique en 2 minutos cómo se usa y cómo se paga, sin compromiso?",
      nuevoEstado: "cierre"
    };
  }

  if (e === "cierre_propuesta") {
    if (esAfirmativo(msg)) {
      return {
        respuesta:
          "Perfecto 🙌 Con gusto te acompaño en el siguiente paso.\n" +
          "Te voy indicando por aquí lo que sigue, con calma y sin compromiso.",
        nuevoEstado: "terminado"
      };
    }
    if (esNegativo(msg)) {
      return {
        respuesta:
          "Va, lo dejamos aquí sin compromiso 🙂 Cuando quieras retomarlo, escríbeme “hola”.",
        nuevoEstado: "terminado"
      };
    }
    return {
      respuesta:
        "¿Te gustaría avanzar con el proceso? Puedes decirme “sí” o “no” y te guío con calma.",
      nuevoEstado: "cierre_propuesta"
    };
  }

  // fallback
  return {
    respuesta:
      "Hola 👋 vi que te interesa el crédito Mejoravit\n" +
      "¿quieres que revise si puedes utilizarlo?",
    nuevoEstado: "interes"
  };
}

module.exports = { generarRespuesta, extraerNssSiValido };

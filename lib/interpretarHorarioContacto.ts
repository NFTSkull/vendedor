import {
  clienteAnthropic,
  claudeDisponible,
  MODELO,
} from "@/lib/claudeAssistant";

export type ConfianzaHorarioContacto = "alta" | "media" | "baja";

export type InterpretacionHorarioContacto = {
  fecha_contacto: string | null;
  confianza: ConfianzaHorarioContacto;
  razon: string;
};

const ZONA_MX = "America/Mexico_City";

function ymdEnMexico(fecha: Date): string {
  return fecha.toLocaleDateString("en-CA", { timeZone: ZONA_MX });
}

function isoReferenciaMx(fecha: Date): string {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: ZONA_MX,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(fecha);

  const get = (tipo: Intl.DateTimeFormatPartTypes) =>
    partes.find((p) => p.type === tipo)?.value ?? "00";

  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}-06:00`;
}

function contextoFechasMx(ahora: Date): { hoyYmd: string; mananaYmd: string; ahoraIso: string } {
  const hoyYmd = ymdEnMexico(ahora);
  const mananaYmd = ymdEnMexico(new Date(ahora.getTime() + 24 * 60 * 60 * 1000));
  return {
    hoyYmd,
    mananaYmd,
    ahoraIso: isoReferenciaMx(ahora),
  };
}

function buildSystemPrompt(ahora: Date): string {
  const { hoyYmd, mananaYmd, ahoraIso } = contextoFechasMx(ahora);
  return `Eres un asistente que interpreta horarios en lenguaje natural (español de México) y los convierte en fechas concretas para agendar una llamada de ventas.

Hoy es ${hoyYmd} (${ahoraIso}, zona México UTC-6).
Mañana es ${mananaYmd}.

Devuelve SIEMPRE JSON válido sin markdown ni texto adicional.

Niveles de confianza:
- "alta": día y hora específicos o muy claros (ej. "hoy 6:30pm", "el 24 a las 10am", "martes a las 3 de la tarde"). fecha_contacto = ISO 8601 con offset -06:00.
- "media": día claro pero hora aproximada o implícita. Estima hora razonable:
  * "mañana por la mañana" → 10:00
  * "esta tarde" / "por la tarde" → 17:00
  * "el jueves" sin hora → próximo jueves a las 10:00
  fecha_contacto = ISO con hora estimada.
- "baja": ambiguo, recurrente o sin día concreto (ej. "todas las tardes", "cuando puedan", "después", "esta semana" sin día). fecha_contacto = null.

Formato de respuesta:
{"fecha_contacto": "2026-06-23T10:00:00-06:00" o null, "confianza": "alta"|"media"|"baja", "razon": "breve explicación"}`;
}

function parseJsonHorario(raw: string): InterpretacionHorarioContacto | null {
  try {
    const limpio = raw
      .replace(/^```json\s*/i, "")
      .replace(/```\s*$/i, "")
      .trim();
    const parsed = JSON.parse(limpio) as {
      fecha_contacto?: string | null;
      confianza?: ConfianzaHorarioContacto;
      razon?: string;
    };
    if (
      parsed.confianza !== "alta" &&
      parsed.confianza !== "media" &&
      parsed.confianza !== "baja"
    ) {
      return null;
    }
    return {
      fecha_contacto:
        typeof parsed.fecha_contacto === "string" ? parsed.fecha_contacto : null,
      confianza: parsed.confianza,
      razon: typeof parsed.razon === "string" ? parsed.razon.trim() : "",
    };
  } catch {
    return null;
  }
}

const RESULTADO_ERROR: InterpretacionHorarioContacto = {
  fecha_contacto: null,
  confianza: "baja",
  razon: "Error",
};

/**
 * Interpreta texto libre de horario del cliente a fecha_contacto ISO.
 * Devuelve null si Claude no está disponible (no rompe el flujo del bot).
 */
export async function interpretarHorarioConClaude(
  textoCliente: string,
  ahora: Date = new Date(),
): Promise<InterpretacionHorarioContacto | null> {
  if (!claudeDisponible()) return null;

  const anthropic = clienteAnthropic();
  if (!anthropic) return null;

  const texto = textoCliente.trim();
  if (!texto) {
    return {
      fecha_contacto: null,
      confianza: "baja",
      razon: "Texto vacío",
    };
  }

  const prompt = `Texto del cliente sobre cuándo contactarlo:
"""
${texto}
"""

Interpreta según las reglas del system prompt.`;

  try {
    const res = await anthropic.messages.create({
      model: MODELO,
      max_tokens: 256,
      system: buildSystemPrompt(ahora),
      messages: [{ role: "user", content: prompt }],
    });

    const bloque = res.content.find((b) => b.type === "text");
    if (!bloque || bloque.type !== "text") return RESULTADO_ERROR;

    const parsed = parseJsonHorario(bloque.text);
    if (!parsed) return RESULTADO_ERROR;

    if (parsed.confianza === "baja") {
      return { ...parsed, fecha_contacto: null };
    }

    return parsed;
  } catch (err) {
    console.error("[interpretarHorarioContacto]", err);
    return RESULTADO_ERROR;
  }
}

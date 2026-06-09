import Anthropic from "@anthropic-ai/sdk";

import type { BotState } from "@/lib/botStepsCore";

const SYSTEM_PROMPT = `Eres el asistente de calificación de Mejoravit en WhatsApp.
Tu único trabajo es interpretar lo que escribe el usuario
en el contexto de la pregunta actual del flujo.

PREGUNTA ACTUAL: {preguntaActual}
TIPO DE RESPUESTA ESPERADA: {tipoEsperado}

REGLAS DE INTERPRETACIÓN:

Para preguntas de SÍ/NO:
Marca tipo 'si' si el usuario expresa afirmación de CUALQUIER
forma: 'si', 'sí', 'sip', 'claro', 'correcto', 'así es',
'si tengo', 'si cuento', 'si trabajo', 'tengo trabajo',
'efectivamente', 'por supuesto', 'afirmativo', 'trabaj...',
'llevo trabajando', 'estoy trabajando', cualquier frase que
implique que SÍ cumple con lo que se pregunta.

Marca tipo 'no' si el usuario expresa negación: 'no', 'nel',
'nop', 'no tengo', 'no cuento', 'tampoco', 'actualmente no',
cualquier frase que implique que NO cumple.

Marca tipo 'fuera_tema' SOLO si el mensaje no tiene NINGUNA
relación con la pregunta. En ese caso genera respuestaRetomo
profesional que explique brevemente y retome la pregunta exacta.

Para NSS:
Marca tipo 'nss' si hay 11 dígitos en el mensaje (ignora
espacios y guiones). Extrae solo los dígitos en campo 'nss'.

Para horario:
Marca tipo 'horario' si el usuario da cualquier indicación
de día y/o hora: 'mañana', 'martes', 'en la tarde', '10am',
'por las mañanas', etc.

IMPORTANTE:
- Nunca uses emojis
- Respuestas profesionales y cordiales
- Máximo 2 líneas cuando respondas fuera de tema
- Siempre termina retomando la pregunta actual con texto exacto
- Responde en texto plano sin markdown, sin asteriscos, sin símbolos de formato`;

export function limpiarMarkdown(texto: string): string {
  return texto
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/\*(.*?)\*/g, "$1");
}

const MODELO = "claude-haiku-4-5-20251001";
const MAX_HISTORIAL = 12;

export type InterpretacionTipo =
  | "si"
  | "no"
  | "nss"
  | "horario"
  | "reiniciar"
  | "fuera_tema"
  | "invalido"
  | "ambiguo";

export type InterpretacionUsuario = {
  tipo: InterpretacionTipo;
  nss?: string | null;
  respuestaRetomo?: string;
};

type HistorialMsg = { role: "user" | "assistant"; content: string };

const historialClaude = new Map<string, HistorialMsg[]>();

function clienteAnthropic(): Anthropic | null {
  console.log(
    "[Claude] API key disponible:",
    Boolean(process.env.ANTHROPIC_API_KEY?.trim()),
  );
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  if (!key) return null;
  return new Anthropic({ apiKey: key });
}

export function claudeDisponible(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
}

export function limpiarHistorialClaude(phone: string): void {
  historialClaude.delete(phone);
}

function pushHistorial(phone: string, role: HistorialMsg["role"], content: string): void {
  const prev = historialClaude.get(phone) ?? [];
  prev.push({ role, content });
  while (prev.length > MAX_HISTORIAL) prev.shift();
  historialClaude.set(phone, prev);
}

function parseJson<T>(raw: string): T | null {
  try {
    const limpio = raw
      .replace(/^```json\s*/i, "")
      .replace(/```\s*$/i, "")
      .trim();
    return JSON.parse(limpio) as T;
  } catch {
    return null;
  }
}

export async function interpretarRespuestaUsuario(args: {
  phone: string;
  state: BotState;
  textoUsuario: string;
  preguntaActual: string;
  tipoEsperado: "si_no" | "nss" | "horario" | "libre";
}): Promise<InterpretacionUsuario | null> {
  const anthropic = clienteAnthropic();
  if (!anthropic) return null;

  const prompt = `Paso actual del flujo: ${args.state}
Pregunta que debe responder el usuario:
"""
${args.preguntaActual}
"""
Tipo de respuesta esperada: ${args.tipoEsperado}
Mensaje del usuario:
"""
${args.textoUsuario}
"""

Devuelve SOLO JSON válido (sin markdown) con esta forma:
{
  "tipo": "si" | "no" | "nss" | "horario" | "reiniciar" | "fuera_tema" | "invalido" | "ambiguo",
  "nss": "11 dígitos solo si tipo es nss, si no null",
  "respuestaRetomo": "solo si tipo es fuera_tema: respuesta profesional y cordial (máx. 2-3 líneas) que termine con el texto EXACTO de la pregunta actual, copiado literalmente"
}

Reglas:
- "claro", "sip", "ajá", "correcto" => si
- "nop", "para nada" => no
- Si pregunta NSS y hay 11 dígitos en el mensaje => nss
- Si pide horario y da día/hora => horario
- Si habla de otra cosa (precio, broma, saludo random fuera de contexto) => fuera_tema
- Ejemplos de respuestas afirmativas para preguntas de sí/no:
- 'si tengo trabajo' => si
- 'llevo 5 años trabajando' => si
- 'trabajo en Monterrey' => si
- 'tengo Infonavit' => si
- 'no tengo crédito' => no
- 'nunca he sacado crédito' => no
- 'a que te refieres' => fuera_tema
- 'que es eso' => fuera_tema
- 'tengo 35 años' => fuera_tema (no responde la pregunta)
- reiniciar solo si pide empezar de nuevo explícitamente
- invalido si no se puede interpretar`;

  try {
    const res = await anthropic.messages.create({
      model: MODELO,
      max_tokens: 256,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: prompt }],
    });

    const bloque = res.content.find((b) => b.type === "text");
    if (!bloque || bloque.type !== "text") return null;

    const parsed = parseJson<{
      tipo: InterpretacionTipo;
      nss?: string | null;
      respuestaRetomo?: string;
    }>(bloque.text);

    if (!parsed?.tipo) return null;

    pushHistorial(args.phone, "user", args.textoUsuario);
    if (parsed.respuestaRetomo) {
      pushHistorial(args.phone, "assistant", parsed.respuestaRetomo);
    }

    return {
      tipo: parsed.tipo,
      nss: parsed.nss ?? null,
      respuestaRetomo: parsed.respuestaRetomo
        ? limpiarMarkdown(parsed.respuestaRetomo)
        : undefined,
    };
  } catch (err) {
    console.error("[claude interpretar]", err);
    return null;
  }
}

export async function naturalizarMensajeBot(args: {
  phone: string;
  mensajeBase: string;
  contextoPaso?: string;
}): Promise<string> {
  const anthropic = clienteAnthropic();
  if (!anthropic) return args.mensajeBase;

  const prompt = `Reescribe este mensaje del bot para WhatsApp de forma más natural y cálida.
Mantén el mismo significado y datos obligatorios.
NO inventes montos ni promesas.
Máximo 2-3 líneas cortas salvo que el original sea más largo por listas Sí/No.
Si aparece "___" debes conservarlo exactamente igual.
Si hay opciones "Sí" y "No", consérvalas al final.

Contexto del paso: ${args.contextoPaso ?? "flujo Mejoravit"}

Mensaje base:
"""
${args.mensajeBase}
"""

Responde SOLO con el texto final para el usuario, sin comillas ni JSON.
Usa texto plano sin markdown, sin asteriscos, sin símbolos de formato.`;

  try {
    const historial = historialClaude.get(args.phone) ?? [];
    const res = await anthropic.messages.create({
      model: MODELO,
      max_tokens: 400,
      system: SYSTEM_PROMPT,
      messages: [...historial.slice(-6), { role: "user", content: prompt }],
    });

    const bloque = res.content.find((b) => b.type === "text");
    if (!bloque || bloque.type !== "text") return args.mensajeBase;

    const natural = limpiarMarkdown(bloque.text.trim());
    if (!natural) return args.mensajeBase;

    pushHistorial(args.phone, "assistant", natural);

    if (args.mensajeBase.includes("___") && !natural.includes("___")) {
      return natural.replace(/_{2,}/g, "___");
    }

    return natural;
  } catch (err) {
    console.error("[claude naturalizar]", err);
    return args.mensajeBase;
  }
}

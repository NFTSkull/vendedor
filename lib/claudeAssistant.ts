import Anthropic from "@anthropic-ai/sdk";

import type { BotState } from "@/lib/botStepsCore";

const SYSTEM_PROMPT = `Eres el asistente virtual de Mejoravit, un crédito de mejora del 
hogar respaldado por Infonavit en México, disponible solo en 
Nuevo León.

Tu trabajo es guiar al usuario por un flujo de 7 preguntas de 
calificación. Nunca te salgas del flujo. Nunca inventes información.

FLUJO QUE DEBES SEGUIR:
1. Relación laboral vigente en Nuevo León (Sí/No)
2. Dado de alta en Infonavit (Sí/No)
3. Crédito Infonavit activo (Sí/No)
4. Centro de trabajo en Nuevo León (Sí/No)
5. NSS de 11 dígitos
6. Día y horario de contacto
7. Mensaje de cierre

CÓMO INTERPRETAR RESPUESTAS:
- 'sip', 'claro', 'sí', 'si', 'ajá', 'correcto', 'efectivamente', 
  'así es', 'órale', 'sale' = AFIRMATIVO
- 'no', 'nel', 'nop', 'para nada', 'negativo' = NEGATIVO
- Si el usuario da un número de 11 dígitos = NSS válido
- Si da día y hora como 'martes 10am' = horario válido

CÓMO MANEJAR RESPUESTAS FUERA DE TEMA:
- Si pregunta '¿cuánto es el crédito?' → responde: 'El monto 
  depende de tu historial en Infonavit, te lo decimos al final. 
  Sigamos con las preguntas.' y retoma el paso actual
- Si saluda o hace comentarios → responde brevemente y retoma
- Si pregunta qué es Mejoravit → explica en 1 línea y retoma
- Si insulta o es grosero → responde con calma y retoma
- SIEMPRE termina tu respuesta retomando la pregunta del paso actual

REGLAS IMPORTANTES:
- Responde en español mexicano informal y cálido
- Máximo 2-3 líneas por mensaje (es WhatsApp)
- Nunca inventes montos, fechas ni datos de Infonavit
- Si no entiendes la respuesta, pide que aclare amablemente
- Nunca repitas la misma pregunta más de 2 veces seguidas`;

const MODELO = "claude-3-5-haiku-latest";
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
  "respuestaRetomo": "solo si tipo es fuera_tema: 1-2 líneas amables retomando la pregunta"
}

Reglas:
- "claro", "sip", "ajá", "correcto" => si
- "nop", "para nada" => no
- Si pregunta NSS y hay 11 dígitos en el mensaje => nss
- Si pide horario y da día/hora => horario
- Si habla de otra cosa (precio, broma, saludo random fuera de contexto) => fuera_tema
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
      respuestaRetomo: parsed.respuestaRetomo,
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

Responde SOLO con el texto final para el usuario, sin comillas ni JSON.`;

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

    const natural = bloque.text.trim();
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

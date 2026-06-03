/** Mensaje de texto entrante normalizado desde el webhook de Meta */
export interface WhatsAppTextInbound {
  from: string;
  body: string;
  wamid: string | null;
  /** metadata.phone_number_id del change que originó el mensaje */
  phoneNumberId: string | null;
}

function extraerPhoneNumberIdDeValue(value: Record<string, unknown>): string | null {
  const metadata = value.metadata;
  if (!metadata || typeof metadata !== "object") return null;
  const id = (metadata as Record<string, unknown>).phone_number_id;
  return typeof id === "string" && id.trim() ? id.trim() : null;
}

function recolectarValor(
  value: Record<string, unknown>,
  phoneNumberId: string | null,
): WhatsAppTextInbound[] {
  const out: WhatsAppTextInbound[] = [];
  const messages = value.messages;
  if (!Array.isArray(messages)) return out;

  for (const raw of messages) {
    if (!raw || typeof raw !== "object") continue;
    const m = raw as Record<string, unknown>;
    const from = m.from;
    if (typeof from !== "string" || !from.trim()) continue;
    const type = m.type;
    if (type !== "text") continue;
    const text = m.text;
    if (!text || typeof text !== "object") continue;
    const body = (text as Record<string, unknown>).body;
    if (typeof body !== "string" || !body.trim()) continue;
    const wamid = typeof m.id === "string" ? m.id : null;
    out.push({ from: from.trim(), body: body.trim(), wamid, phoneNumberId });
  }
  return out;
}

function changeTieneEcos(value: Record<string, unknown>, field: unknown): boolean {
  if (field === "smb_message_echoes") return true;
  if (Array.isArray(value.message_echoes) && value.message_echoes.length > 0) return true;
  if (Array.isArray(value.smb_message_echoes) && value.smb_message_echoes.length > 0) {
    return true;
  }
  return false;
}

/**
 * true cuando el payload trae ecos (message_echoes / smb_message_echoes) sin mensajes de texto entrantes.
 * Usado en multi-número para responder 200 sin invocar al bot.
 */
export function payloadDebeIgnorarPorEcos(body: unknown): boolean {
  if (!body || typeof body !== "object") return false;
  const entry = (body as Record<string, unknown>).entry;
  if (!Array.isArray(entry)) return false;

  let tieneEcos = false;
  for (const ent of entry) {
    if (!ent || typeof ent !== "object") continue;
    const changes = (ent as Record<string, unknown>).changes;
    if (!Array.isArray(changes)) continue;
    for (const ch of changes) {
      if (!ch || typeof ch !== "object") continue;
      const value = (ch as Record<string, unknown>).value;
      const field = (ch as Record<string, unknown>).field;
      if (!value || typeof value !== "object") continue;
      if (changeTieneEcos(value as Record<string, unknown>, field)) {
        tieneEcos = true;
      }
    }
  }

  if (!tieneEcos) return false;
  return extraerTextosEntrantes(body).length === 0;
}

export function extraerTextosEntrantes(body: unknown): WhatsAppTextInbound[] {
  if (!body || typeof body !== "object") return [];
  const payload = body as Record<string, unknown>;
  const entry = payload.entry;
  if (!Array.isArray(entry)) return [];

  const result: WhatsAppTextInbound[] = [];
  for (const ent of entry) {
    if (!ent || typeof ent !== "object") continue;
    const changes = (ent as Record<string, unknown>).changes;
    if (!Array.isArray(changes)) continue;
    for (const ch of changes) {
      if (!ch || typeof ch !== "object") continue;
      const value = (ch as Record<string, unknown>).value;
      if (value && typeof value === "object") {
        console.log(
          "[PARSE] tipo de evento recibido:",
          JSON.stringify(Object.keys(value as Record<string, unknown>)),
        );
      }
      const field = (ch as Record<string, unknown>).field;
      if (field !== "messages") continue;
      if (!value || typeof value !== "object") continue;
      const phoneNumberId = extraerPhoneNumberIdDeValue(value as Record<string, unknown>);
      result.push(...recolectarValor(value as Record<string, unknown>, phoneNumberId));
    }
  }
  return result;
}

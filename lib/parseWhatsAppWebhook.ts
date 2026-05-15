/** Mensaje de texto entrante normalizado desde el webhook de Meta */
export interface WhatsAppTextInbound {
  from: string;
  body: string;
}

function recolectarValor(value: Record<string, unknown>): WhatsAppTextInbound[] {
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
    out.push({ from: from.trim(), body: body.trim() });
  }
  return out;
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
      const field = (ch as Record<string, unknown>).field;
      if (field !== "messages") continue;
      const value = (ch as Record<string, unknown>).value;
      if (!value || typeof value !== "object") continue;
      result.push(...recolectarValor(value as Record<string, unknown>));
    }
  }
  return result;
}

/** Límite Opción A: archivo pasa por servidor a Meta, sin copia en Storage. */
export const MAX_ARCHIVO_CHAT_BYTES = 4 * 1024 * 1024;

export const MIME_PERMITIDOS_CHAT = [
  "image/jpeg",
  "image/png",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
] as const;

export type MimePermitidoChat = (typeof MIME_PERMITIDOS_CHAT)[number];

const MIME_SET = new Set<string>(MIME_PERMITIDOS_CHAT);

export const ACCEPT_ARCHIVOS_CHAT = MIME_PERMITIDOS_CHAT.join(",");

export function mimePermitidoEnChat(mimeType: string): boolean {
  return MIME_SET.has(mimeType);
}

export function validarTamanoArchivoChat(size: number): boolean {
  return size > 0 && size <= MAX_ARCHIVO_CHAT_BYTES;
}

export const MSG_ERROR_VENTANA_24H_WHATSAPP =
  "No se pudo enviar: es posible que hayan pasado más de 24h desde el último mensaje del cliente";

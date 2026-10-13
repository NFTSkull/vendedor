import { createHmac, timingSafeEqual } from "node:crypto";

/** Valida `X-Hub-Signature-256` (HMAC-SHA256 del cuerpo crudo con el App Secret de Meta). */
export function firmaMetaValida(
  rawBody: Buffer,
  firmaHeader: string | null,
  appSecret: string | undefined,
): boolean {
  const secret = appSecret?.trim();
  if (!secret || !firmaHeader) return false;

  const match = firmaHeader.trim().match(/^sha256=([0-9a-fA-F]{64})$/);
  if (!match) return false;

  const esperada = createHmac("sha256", secret).update(rawBody).digest();
  return timingSafeEqual(Buffer.from(match[1], "hex"), esperada);
}

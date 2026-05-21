/** Devuelve NSS solo cuando el mensaje contiene exactamente 11 dígitos. */
export function extraerNssOnceDigitos(body: string): string | null {
  const raw = String(body || "");

  const digits = raw.replace(/\D/g, "");
  if (digits.length === 11) return digits;
  return null;
}

/** Quita caracteres no numéricos y devuelve NSS si son exactamente 11 dígitos. */
export function extraerNssOnceDigitos(body: string): string | null {
  const digits = String(body || "").replace(/\D/g, "");
  return digits.length === 11 ? digits : null;
}

/** Devuelve el primer NSS de exactamente 11 dígitos encontrado en el texto. */
export function extraerNssOnceDigitos(body: string): string | null {
  const raw = String(body || "");

  const partes = raw.split(/\D+/).filter(Boolean);
  const bloqueExacto = partes.find((p) => p.length === 11);
  if (bloqueExacto) return bloqueExacto;

  const digits = raw.replace(/\D/g, "");
  if (digits.length === 11) return digits;

  const match = digits.match(/\d{11}/);
  return match?.[0] ?? null;
}

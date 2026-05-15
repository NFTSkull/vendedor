export function normalizarTexto(texto: string): string {
  return String(texto || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function esAfirmativo(texto: string): boolean {
  const n = normalizarTexto(texto);
  if (!n) return false;
  if (esNegativo(texto)) return false;
  if (/\b(si|sip|claro|ok|okay|vale|correcto)\b/.test(n)) return true;
  return n === "s" || n === "y";
}

export function esNegativo(texto: string): boolean {
  const n = normalizarTexto(texto);
  if (!n) return false;
  if (/\b(no|nop|nel)\b/.test(n)) return true;
  if (n.includes("mejor no") || n.includes("no es")) return true;
  return false;
}

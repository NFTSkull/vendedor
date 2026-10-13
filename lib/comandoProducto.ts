import { limpiarHistorialClaude } from "@/lib/claudeAssistant";
import {
  getConversation,
  reemplazarConversacion,
} from "@/lib/conversationMemory";
import {
  COMPRA_CASA_PHONE_NUMBER_ID,
  type ProductoForzado,
} from "@/lib/detectarProducto";
import { normalizarTexto } from "@/lib/normalizeText";

const REGEX_COMANDO =
  /^(?:activa|activar|activame|modo|(?:cambia|cambiar|cambiame|cambiate|pasa|pasar)\s+al?)\s+(?:(?:el|al)\s+)?(?:(?:flujo|modo)\s+)?(?:de\s+)?(mejoravit|casas?|compra de casas?)$/;

const MSG_CONFIRMACION: Record<ProductoForzado, string> = {
  mejoravit:
    "Listo, a partir de ahora estamos para ayudarte con tu crédito Mejoravit.",
  compra_casa:
    "Listo, a partir de ahora estamos para ayudarte con la venta de tu propiedad.",
};

export function esNumeroConComandoProducto(
  phoneNumberId: string | null | undefined,
): boolean {
  return phoneNumberId?.trim() === COMPRA_CASA_PHONE_NUMBER_ID;
}

/** Solo reconoce el mensaje completo como comando, para no dispararse dentro de frases normales. */
export function detectarComandoProducto(texto: string): ProductoForzado | null {
  const n = normalizarTexto(texto)
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const match = n.match(REGEX_COMANDO);
  if (!match) return null;
  return match[1] === "mejoravit" ? "mejoravit" : "compra_casa";
}

export async function aplicarComandoProducto(
  phone: string,
  producto: ProductoForzado,
): Promise<string> {
  const conv = await getConversation(phone);
  await reemplazarConversacion(phone, {
    state: "inicio",
    nss: null,
    lead_id: conv.lead_id,
    producto,
    data: { productoForzado: producto },
  });
  limpiarHistorialClaude(phone);
  return MSG_CONFIRMACION[producto];
}

import { getConversation, setConversation } from "@/lib/conversationMemory";
import type { ProductoForzado } from "@/lib/detectarProducto";
import { normalizarTexto } from "@/lib/normalizeText";
import { sincronizarProductoLead } from "@/lib/productoLead";

export const MSG_MENU_PRODUCTO =
  "¿En qué te podemos ayudar?\n1) Crédito Mejoravit (Infonavit)\n2) Vender tu casa";

const REGEX_OPCION_1 =
  /^(?:(?:la )?opcion )?(?:1|uno|primera|la primera)$|\b(?:mejoravit|credito|infonavit|prestamos?|nss)\b/;
const REGEX_OPCION_2 =
  /^(?:(?:la )?opcion )?(?:2|dos|segunda|la segunda)$|\b(?:vender|venta|vendo|vende)\b/;

/** Respuesta al menú → producto; vacía, ambigua o con ambas opciones → null. */
export function interpretarOpcionMenu(texto: string): ProductoForzado | null {
  const n = normalizarTexto(texto)
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!n) return null;
  const opcion1 = REGEX_OPCION_1.test(n);
  const opcion2 = REGEX_OPCION_2.test(n);
  if (opcion1 === opcion2) return null;
  return opcion1 ? "mejoravit" : "compra_casa";
}

export type ResultadoMenuProducto =
  | { tipo: "respuesta"; texto: string }
  | { tipo: "elegido"; producto: ProductoForzado };

/**
 * Conversación `sin_clasificar`: el primer mensaje solo recibe el menú (no se interpreta, para
 * no saltarse la clasificación estricta); las respuestas posteriores fijan el producto en la
 * conversación y en el lead.
 */
export async function procesarMenuProducto(args: {
  phone: string;
  textoUsuario: string;
}): Promise<ResultadoMenuProducto> {
  const conv = await getConversation(args.phone);

  if (conv.data?.menuProductoEnviado !== true) {
    await setConversation(args.phone, {
      state: conv.state,
      data: { menuProductoEnviado: true },
    });
    return { tipo: "respuesta", texto: MSG_MENU_PRODUCTO };
  }

  const producto = interpretarOpcionMenu(args.textoUsuario);
  if (!producto) {
    return { tipo: "respuesta", texto: MSG_MENU_PRODUCTO };
  }

  await setConversation(args.phone, { state: conv.state, producto });
  if (conv.lead_id) {
    await sincronizarProductoLead(conv.lead_id, producto, "menu");
  }
  return { tipo: "elegido", producto };
}

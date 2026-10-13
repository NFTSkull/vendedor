import { esOptOut } from "@/lib/botStepsCore";
import { detectarInteresEnTexto } from "@/lib/botStepsGeneradores";
import { esPausaExplicita } from "@/lib/tramiteMejoravit";

/**
 * El último mensaje del cliente rechaza, pide no recibir mensajes o pausa la atención.
 * Reutiliza los detectores del bot de cada producto.
 */
export function clientePausoORechazo(
  producto: "mejoravit" | "generadores",
  texto: string,
): boolean {
  if (!texto.trim()) return false;
  if (esOptOut(texto) || esPausaExplicita(texto)) return true;
  return producto === "generadores" && detectarInteresEnTexto(texto) === "desinteres";
}

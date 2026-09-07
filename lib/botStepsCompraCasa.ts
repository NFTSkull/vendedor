// Fase 1: stub temporal. El flujo completo (7 preguntas + ramificaciones
// casa/depto y pagada/no pagada) se agrega en la Fase 2.
export async function procesarYEvolucionarCompraCasa(args: {
  phone: string;
  textoUsuario: string;
}): Promise<string | null> {
  void args;
  return "Gracias por tu interés en vender tu propiedad. Un asesor te contactará pronto.";
}

import { minutosDesde } from "@/lib/reengagement";

export type GenStep = "tipo" | "equipos" | "horario";
export type GenReengagementTouch = 1 | 2;

/** Toque 1: 3 h desde último entrante (ventana amplia para cron cada minuto). */
export const GEN_TOQUE_1_MIN_MINUTES = 180;
export const GEN_TOQUE_1_WINDOW_MINUTES = 10;

/** Toque 2: 20 h desde último entrante. */
export const GEN_TOQUE_2_MIN_MINUTES = 1200;
export const GEN_TOQUE_2_WINDOW_MINUTES = 10;

/** Límite ventana WhatsApp (mensaje libre dentro de 24 h). */
export const GEN_WHATSAPP_VENTANA_MAX_MINUTES = 1440;

const MENSAJES_POR_PASO: Record<GenStep, string> = {
  tipo:
    "¡Hola! Seguimos por aquí 😊 Para ayudarte con tu generador, cuéntame: ¿es para uso industrial o residencial?",
  equipos:
    "¡Hola! Para continuar con la información de tu generador, ¿qué equipos necesitas respaldar?",
  horario:
    "¡Hola! Solo falta un dato para que un asesor de Energrum te contacte: ¿en qué día y horario te conviene?",
};

export function parseGenStep(data: unknown): GenStep | null {
  if (data == null || typeof data !== "object" || Array.isArray(data)) {
    return null;
  }
  const step = (data as Record<string, unknown>).genStep;
  if (step === "tipo" || step === "equipos" || step === "horario") {
    return step;
  }
  return null;
}

export function conversacionElegibleGeneradores(args: {
  producto: string | null | undefined;
  state: string | null | undefined;
  genStep: GenStep | null;
  leadEstado: string | null | undefined;
}): boolean {
  if (args.leadEstado !== "nuevo") return false;
  if (args.producto !== "generadores") return false;
  if (args.state === "finalizado") return false;
  return args.genStep != null;
}

export function dentroVentana24hWhatsApp(minutesSinceLastIncoming: number): boolean {
  return minutesSinceLastIncoming < GEN_WHATSAPP_VENTANA_MAX_MINUTES;
}

export function elegibleParaToqueGeneradores(args: {
  touch: GenReengagementTouch;
  minutesSinceLastIncoming: number;
  genReengagement1SentAt: string | null;
  genReengagement2SentAt: string | null;
}): boolean {
  if (!dentroVentana24hWhatsApp(args.minutesSinceLastIncoming)) {
    return false;
  }

  if (args.touch === 1) {
    if (args.genReengagement1SentAt) return false;
    return (
      args.minutesSinceLastIncoming >= GEN_TOQUE_1_MIN_MINUTES &&
      args.minutesSinceLastIncoming <
        GEN_TOQUE_1_MIN_MINUTES + GEN_TOQUE_1_WINDOW_MINUTES
    );
  }

  if (!args.genReengagement1SentAt || args.genReengagement2SentAt) {
    return false;
  }

  return (
    args.minutesSinceLastIncoming >= GEN_TOQUE_2_MIN_MINUTES &&
    args.minutesSinceLastIncoming <
      GEN_TOQUE_2_MIN_MINUTES + GEN_TOQUE_2_WINDOW_MINUTES
  );
}

export function resolverToquePendienteGeneradores(args: {
  minutesSinceLastIncoming: number;
  genReengagement1SentAt: string | null;
  genReengagement2SentAt: string | null;
}): GenReengagementTouch | null {
  if (
    elegibleParaToqueGeneradores({
      touch: 1,
      minutesSinceLastIncoming: args.minutesSinceLastIncoming,
      genReengagement1SentAt: args.genReengagement1SentAt,
      genReengagement2SentAt: args.genReengagement2SentAt,
    })
  ) {
    return 1;
  }

  if (
    elegibleParaToqueGeneradores({
      touch: 2,
      minutesSinceLastIncoming: args.minutesSinceLastIncoming,
      genReengagement1SentAt: args.genReengagement1SentAt,
      genReengagement2SentAt: args.genReengagement2SentAt,
    })
  ) {
    return 2;
  }

  return null;
}

export function construirMensajeReengagementGeneradores(
  genStep: GenStep,
): string {
  return MENSAJES_POR_PASO[genStep];
}

export function minutosDesdeUltimoEntrante(
  ultimoEntranteAt: string,
  nowMs = Date.now(),
): number {
  return minutosDesde(ultimoEntranteAt, nowMs);
}

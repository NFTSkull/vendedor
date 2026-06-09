import type { BotRuntimeState } from "@/lib/conversationMemory";

export type ReengagementTouch = 1 | 2;

export const MSG_CONTACTO_HORARIO =
  "¿Te podemos contactar ahorita mismo para darte todos los detalles? " +
  "Si no, ¿en qué horario te viene mejor? 📞";

const ESTADOS_REENGAGEMENT = new Set<BotRuntimeState>([
  "esperando_labor_vigente",
  "esperando_infonavit",
  "esperando_credito_activo",
  "esperando_datos",
  "esperando_horario",
]);

export type LeadReengagement = {
  monto_aprobado_min?: number | string | null;
  monto_aprobado_max?: number | string | null;
};

export function autorizadoCron(req: Request): boolean {
  if (req.headers.get("x-vercel-cron") === "1") return true;

  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return false;

  return auth.slice("Bearer ".length).trim() === secret;
}

export function normalizarMonto(
  value: number | string | null | undefined,
): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }
  if (typeof value !== "string") return 0;

  const limpio = value.replace(/[^0-9.]/g, "");
  const parsed = Number(limpio);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function formatearMonto(
  value: number | string | null | undefined,
): string {
  const monto = Math.floor(normalizarMonto(value));
  if (monto <= 0) return "";
  return `$${monto.toLocaleString("es-MX")}`;
}

export function leadTieneMonto(lead: LeadReengagement): boolean {
  return (
    normalizarMonto(lead.monto_aprobado_min) > 0 &&
    normalizarMonto(lead.monto_aprobado_max) > 0
  );
}

export function minutosDesde(isoDate: string, nowMs = Date.now()): number {
  return Math.floor((nowMs - new Date(isoDate).getTime()) / 60_000);
}

export function leadActualizadoRecientemente(
  updatedAt: string,
  nowMs = Date.now(),
): boolean {
  return nowMs - new Date(updatedAt).getTime() < 2 * 60_000;
}

export function elegibleParaToque(args: {
  touch: ReengagementTouch;
  minutesSinceLastIncoming: number;
  reengagement1SentAt: string | null;
  reengagement2SentAt: string | null;
  leadUpdatedAt: string;
  nowMs?: number;
}): boolean {
  const nowMs = args.nowMs ?? Date.now();

  if (leadActualizadoRecientemente(args.leadUpdatedAt, nowMs)) {
    return false;
  }

  if (args.touch === 1) {
    if (args.reengagement1SentAt) return false;
    return (
      args.minutesSinceLastIncoming >= 5 &&
      args.minutesSinceLastIncoming < 6
    );
  }

  if (!args.reengagement1SentAt || args.reengagement2SentAt) return false;
  return (
    args.minutesSinceLastIncoming >= 20 &&
    args.minutesSinceLastIncoming < 21
  );
}

export function estadoPermiteReengagement(
  state: string,
): state is BotRuntimeState {
  return ESTADOS_REENGAGEMENT.has(state as BotRuntimeState);
}

export function construirMensajeReengagement(
  touch: ReengagementTouch,
  state: BotRuntimeState,
  _lead: LeadReengagement,
): string | null {
  void _lead;
  if (!ESTADOS_REENGAGEMENT.has(state)) return null;

  if (touch === 1) {
    switch (state) {
      case "esperando_labor_vigente":
        return (
          "¡Hola! 👋 Vi que nos escribiste hace un momento. " +
          "Solo necesito saber si actualmente trabajas en Nuevo León " +
          "para ver si calificas para el crédito. ¿Sí o no?"
        );
      case "esperando_infonavit":
        return (
          "¡Hola de nuevo! 😊 Ya casi terminamos. Solo dime: " +
          "¿estás dado de alta en el Infonavit? Con eso puedo " +
          "decirte si calificas para el crédito Mejoravit."
        );
      case "esperando_credito_activo":
        return (
          "Hola, seguimos aquí para ayudarte 🏠 Una pregunta rápida: " +
          "¿actualmente estás pagando algún crédito del Infonavit? " +
          "Responde Sí o No y te digo si calificas."
        );
      case "esperando_datos":
        return (
          "¡Hola! 👋 Para darte tu monto autorizado de crédito " +
          "Mejoravit solo necesito tu Número de Seguro Social (NSS) " +
          "de 11 dígitos. ¿Me lo compartes?"
        );
      case "esperando_horario":
        return MSG_CONTACTO_HORARIO;
      default:
        return null;
    }
  }

  switch (state) {
    case "esperando_labor_vigente":
    case "esperando_infonavit":
    case "esperando_credito_activo":
      return (
        "Hola, te escribimos de Mejoravit 🏠 " +
        "Muchas personas en Nuevo León ya obtuvieron su crédito " +
        "para mejorar su casa. Si tienes 2 minutos, con gusto " +
        "te decimos si calificas. ¿Seguimos?"
      );
    case "esperando_datos":
      return (
        "Hola de nuevo 👋 Tu crédito Mejoravit está a un paso. " +
        "Solo necesito tu NSS (11 dígitos) para calcular " +
        "tu monto autorizado al instante. ¿Me lo compartes? 🏡"
      );
    case "esperando_horario":
      return MSG_CONTACTO_HORARIO;
    default:
      return null;
  }
}

export function resolverToquePendiente(args: {
  minutesSinceLastIncoming: number;
  reengagement1SentAt: string | null;
  reengagement2SentAt: string | null;
  leadUpdatedAt: string;
  nowMs?: number;
}): ReengagementTouch | null {
  if (
    elegibleParaToque({
      touch: 1,
      minutesSinceLastIncoming: args.minutesSinceLastIncoming,
      reengagement1SentAt: args.reengagement1SentAt,
      reengagement2SentAt: args.reengagement2SentAt,
      leadUpdatedAt: args.leadUpdatedAt,
      nowMs: args.nowMs,
    })
  ) {
    return 1;
  }

  if (
    elegibleParaToque({
      touch: 2,
      minutesSinceLastIncoming: args.minutesSinceLastIncoming,
      reengagement1SentAt: args.reengagement1SentAt,
      reengagement2SentAt: args.reengagement2SentAt,
      leadUpdatedAt: args.leadUpdatedAt,
      nowMs: args.nowMs,
    })
  ) {
    return 2;
  }

  return null;
}

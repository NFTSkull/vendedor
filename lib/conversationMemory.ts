export type BotRuntimeState =
  | "inicio"
  | "esperando_labor_vigente"
  | "esperando_infonavit"
  | "esperando_credito_activo"
  | "esperando_centro_trabajo"
  | "esperando_datos"
  | "esperando_horario"
  | "finalizado";

/** Estado en memoria por número WhatsApp dentro del mismo proceso Node. */
export type ConversationValue = {
  state: BotRuntimeState;
  name: string | null;
  nss: string | null;
};

export const conversationMemory = new Map<string, ConversationValue>();

export type BotRuntimeState =
  | "inicio"
  | "esperando_nombre"
  | "esperando_nss"
  | "confirmando"
  | "finalizado";

/** Estado en memoria por número WhatsApp dentro del mismo proceso Node. */
export type ConversationValue = {
  state: BotRuntimeState;
  name: string | null;
  nss: string | null;
};

export const conversationMemory = new Map<string, ConversationValue>();

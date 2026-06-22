import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  mockEnviarWa: vi.fn(),
  mockGuardarMensaje: vi.fn(),
  mockFrom: vi.fn(),
  getConversation: vi.fn(),
  setConversation: vi.fn(),
  actualizarLeadPorConversacion: vi.fn(),
  claudeDisponible: vi.fn(),
  interpretarRespuestaGenerador: vi.fn(),
  conversationUpdates: [] as unknown[],
  leadUpdates: [] as unknown[],
}));

vi.mock("@/lib/whatsappCloud", () => ({
  enviarMensajeTextoWa: (...args: unknown[]) => mocks.mockEnviarWa(...args),
}));

vi.mock("@/lib/messagesDb", () => ({
  guardarMensaje: (...args: unknown[]) => mocks.mockGuardarMensaje(...args),
}));

vi.mock("@/lib/supabaseAdmin", () => ({
  getSupabaseAdmin: () => ({ from: mocks.mockFrom }),
}));

vi.mock("@/lib/conversationMemory", () => ({
  getConversation: mocks.getConversation,
  setConversation: mocks.setConversation,
}));

vi.mock("@/lib/leadProvisional", () => ({
  actualizarLeadPorConversacion: mocks.actualizarLeadPorConversacion,
}));

vi.mock("@/lib/claudeAssistant", () => ({
  claudeDisponible: mocks.claudeDisponible,
  interpretarRespuestaGenerador: mocks.interpretarRespuestaGenerador,
}));

import { procesarYEvolucionarGeneradores } from "@/lib/botStepsGeneradores";
import {
  construirMensajeReengagementGeneradores,
  GEN_TOQUE_1_MIN_MINUTES,
} from "@/lib/reengagementGeneradores";
import { ejecutarReengagementGeneradoresCron } from "@/lib/reengagementGeneradoresCron";

const NOW = new Date("2026-06-10T15:00:00.000Z").getTime();
const PHONE = "5215559999999";
const LEAD_ID = "lead-gen-equipos";
const PREGUNTA_HORARIO = "¿En qué día y horario te podemos contactar?";
const PREGUNTA_EQUIPOS = "¿Qué equipos necesitas respaldar?";

function isoHaceMinutos(minutos: number): string {
  return new Date(NOW - minutos * 60_000).toISOString();
}

type ConvRow = {
  whatsapp_phone: string;
  state: string;
  producto: string;
  data: { genStep: string; gen_tipo?: string; gen_equipos?: string };
};

function configurarSupabase(args: {
  leads: unknown[];
  convs: ConvRow[];
  ultimoEntranteAt: string | null;
}) {
  mocks.conversationUpdates = [];
  mocks.leadUpdates = [];

  mocks.mockFrom.mockImplementation((table: string) => {
    if (table === "leads") {
      return {
        select: () => ({
          eq: (col: string, val: unknown) => {
            if (col === "estado" && val === "nuevo") {
              return {
                eq: () =>
                  Promise.resolve({
                    data: args.leads.filter(
                      (l) =>
                        (l as { estado?: string }).estado === "nuevo",
                    ),
                    error: null,
                  }),
              };
            }
            return { eq: () => Promise.resolve({ data: [], error: null }) };
          },
        }),
        update: (patch: unknown) => {
          mocks.leadUpdates.push(patch);
          return {
            eq: () => Promise.resolve({ error: null }),
          };
        },
      };
    }

    if (table === "conversations") {
      return {
        select: () => ({
          in: () => ({
            eq: () => ({
              neq: () => Promise.resolve({ data: args.convs, error: null }),
            }),
          }),
        }),
        update: (patch: unknown) => {
          mocks.conversationUpdates.push(patch);
          return {
            eq: () => Promise.resolve({ error: null }),
          };
        },
      };
    }

    if (table === "messages") {
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              order: () => ({
                limit: () => ({
                  maybeSingle: () =>
                    Promise.resolve({
                      data: args.ultimoEntranteAt
                        ? { created_at: args.ultimoEntranteAt }
                        : null,
                      error: null,
                    }),
                }),
              }),
            }),
          }),
        }),
      };
    }

    return {};
  });
}

describe("escenario completo: recordatorio en equipos → usuario responde", () => {
  let convsEnDb: ConvRow[];

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.conversationUpdates = [];
    mocks.leadUpdates = [];
    process.env.WHATSAPP_ACCESS_TOKEN = "token-test";
    process.env.WHATSAPP_PHONE_NUMBER_ID = "1177472778778882";
    mocks.mockEnviarWa.mockResolvedValue({ ok: true, status: 200, data: {} });
    mocks.mockGuardarMensaje.mockResolvedValue(true);
    mocks.actualizarLeadPorConversacion.mockResolvedValue(true);
    mocks.claudeDisponible.mockReturnValue(true);

    convsEnDb = [
      {
        whatsapp_phone: PHONE,
        state: "inicio",
        producto: "generadores",
        data: { genStep: "equipos", gen_tipo: "uso industrial" },
      },
    ];
  });

  afterEach(() => {
    delete process.env.WHATSAPP_ACCESS_TOKEN;
    delete process.env.WHATSAPP_PHONE_NUMBER_ID;
  });

  it("recordatorio no altera genStep; respuesta válida avanza equipos→horario; fuera de tema no rompe", async () => {
    configurarSupabase({
      leads: [
        {
          id: LEAD_ID,
          whatsapp_phone: PHONE,
          estado: "nuevo",
          producto: "generadores",
          gen_reengagement_1_sent_at: null,
          gen_reengagement_2_sent_at: null,
        },
      ],
      convs: convsEnDb,
      ultimoEntranteAt: isoHaceMinutos(GEN_TOQUE_1_MIN_MINUTES),
    });

    const cronRes = await ejecutarReengagementGeneradoresCron(NOW);

    expect(cronRes.enviados).toBe(1);
    expect(cronRes.resultados[0]).toMatchObject({
      lead_id: LEAD_ID,
      estado: "enviado",
      touch: 1,
      genStep: "equipos",
    });
    expect(mocks.mockEnviarWa).toHaveBeenCalledOnce();
    expect(mocks.mockEnviarWa.mock.calls[0][0].body).toBe(
      construirMensajeReengagementGeneradores("equipos"),
    );
    expect(mocks.mockGuardarMensaje).toHaveBeenCalledWith({
      leadId: LEAD_ID,
      direccion: "saliente",
      contenido: construirMensajeReengagementGeneradores("equipos"),
      origen: "bot",
    });
    expect(mocks.leadUpdates).toEqual([
      { gen_reengagement_1_sent_at: expect.any(String) },
    ]);

    expect(convsEnDb[0].data.genStep).toBe("equipos");
    expect(convsEnDb[0].data.gen_tipo).toBe("uso industrial");
    expect(convsEnDb[0].data.gen_equipos).toBeUndefined();
    expect(mocks.conversationUpdates).toHaveLength(0);

    mocks.getConversation.mockResolvedValue({
      state: "inicio",
      name: null,
      nss: null,
      lead_id: LEAD_ID,
      producto: "generadores",
      data: { ...convsEnDb[0].data },
    });
    mocks.interpretarRespuestaGenerador.mockResolvedValue({
      tipo: "valida",
      valorNormalizado: "aires y refrigeración",
    });

    const botRes = await procesarYEvolucionarGeneradores({
      phone: PHONE,
      textoUsuario: "los aires acondicionados y el refrigerador",
    });

    expect(botRes).toBe(PREGUNTA_HORARIO);
    expect(mocks.setConversation).toHaveBeenCalledWith(
      PHONE,
      expect.objectContaining({
        data: expect.objectContaining({
          genStep: "horario",
          gen_tipo: "uso industrial",
          gen_equipos: "aires y refrigeración",
        }),
      }),
    );
    expect(mocks.actualizarLeadPorConversacion).not.toHaveBeenCalled();

    vi.clearAllMocks();
    mocks.actualizarLeadPorConversacion.mockResolvedValue(true);
    mocks.claudeDisponible.mockReturnValue(true);
    mocks.getConversation.mockResolvedValue({
      state: "inicio",
      name: null,
      nss: null,
      lead_id: LEAD_ID,
      producto: "generadores",
      data: { genStep: "equipos", gen_tipo: "uso industrial" },
    });
    mocks.interpretarRespuestaGenerador.mockResolvedValue({
      tipo: "fuera_tema",
      respuestaRetomo:
        "Te cotizamos en la llamada. ¿Qué equipos necesitas respaldar?",
    });

    const offTopic = await procesarYEvolucionarGeneradores({
      phone: PHONE,
      textoUsuario: "¿cuánto cuesta el generador?",
    });

    expect(offTopic).toBe(
      "Te cotizamos en la llamada. ¿Qué equipos necesitas respaldar?",
    );
    expect(mocks.setConversation).not.toHaveBeenCalled();
    expect(mocks.actualizarLeadPorConversacion).not.toHaveBeenCalled();
    expect(mocks.interpretarRespuestaGenerador).toHaveBeenCalledWith(
      expect.objectContaining({
        genStep: "equipos",
        textoUsuario: "¿cuánto cuesta el generador?",
      }),
    );

    vi.clearAllMocks();
    mocks.claudeDisponible.mockReturnValue(false);
    mocks.getConversation.mockResolvedValue({
      state: "inicio",
      name: null,
      nss: null,
      lead_id: LEAD_ID,
      producto: "generadores",
      data: { genStep: "equipos", gen_tipo: "uso industrial" },
    });

    const fallback = await procesarYEvolucionarGeneradores({
      phone: PHONE,
      textoUsuario: "👍",
    });

    expect(fallback).toBe(PREGUNTA_EQUIPOS);
    expect(mocks.setConversation).not.toHaveBeenCalled();
    expect(mocks.interpretarRespuestaGenerador).not.toHaveBeenCalled();
  });
});

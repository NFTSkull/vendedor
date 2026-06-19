import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockEnviarWa = vi.fn();
const mockGuardarMensaje = vi.fn();
const mockFrom = vi.fn();

vi.mock("@/lib/whatsappCloud", () => ({
  enviarMensajeTextoWa: (...args: unknown[]) => mockEnviarWa(...args),
}));

vi.mock("@/lib/messagesDb", () => ({
  guardarMensaje: (...args: unknown[]) => mockGuardarMensaje(...args),
}));

vi.mock("@/lib/supabaseAdmin", () => ({
  getSupabaseAdmin: () => ({ from: mockFrom }),
}));

import { ejecutarReengagementGeneradoresCron } from "@/lib/reengagementGeneradoresCron";
import {
  GEN_TOQUE_1_MIN_MINUTES,
  GEN_TOQUE_2_MIN_MINUTES,
} from "@/lib/reengagementGeneradores";

const NOW = new Date("2026-06-10T15:00:00.000Z").getTime();

function isoHaceMinutos(minutos: number): string {
  return new Date(NOW - minutos * 60_000).toISOString();
}

function configurarSupabase(args: {
  leads: unknown[];
  convs: unknown[];
  ultimoEntranteAt: string | null;
  updateError?: boolean;
}) {
  mockFrom.mockImplementation((table: string) => {
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
        update: () => ({
          eq: () =>
            args.updateError
              ? Promise.resolve({ error: { message: "update fail" } })
              : Promise.resolve({ error: null }),
        }),
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

describe("ejecutarReengagementGeneradoresCron", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.WHATSAPP_ACCESS_TOKEN = "token-test";
    process.env.WHATSAPP_PHONE_NUMBER_ID = "1177472778778882";
    mockEnviarWa.mockResolvedValue({ ok: true, status: 200, data: {} });
    mockGuardarMensaje.mockResolvedValue(true);
  });

  afterEach(() => {
    delete process.env.WHATSAPP_ACCESS_TOKEN;
    delete process.env.WHATSAPP_PHONE_NUMBER_ID;
  });

  it("envía toque 1 y marca gen_reengagement_1_sent_at", async () => {
    configurarSupabase({
      leads: [
        {
          id: "lead-1",
          whatsapp_phone: "5215551111111",
          estado: "nuevo",
          producto: "generadores",
          gen_reengagement_1_sent_at: null,
          gen_reengagement_2_sent_at: null,
        },
      ],
      convs: [
        {
          whatsapp_phone: "5215551111111",
          state: "inicio",
          producto: "generadores",
          data: { genStep: "tipo" },
        },
      ],
      ultimoEntranteAt: isoHaceMinutos(GEN_TOQUE_1_MIN_MINUTES),
    });

    const res = await ejecutarReengagementGeneradoresCron(NOW);

    expect(res.enviados).toBe(1);
    expect(mockEnviarWa).toHaveBeenCalledOnce();
    expect(mockEnviarWa.mock.calls[0][0]).toMatchObject({
      phoneNumberId: "1177472778778882",
      to: "5215551111111",
    });
    expect(mockGuardarMensaje).toHaveBeenCalledOnce();
  });

  it("omite lead contactado (query solo trae estado=nuevo)", async () => {
    configurarSupabase({
      leads: [
        {
          id: "lead-2",
          whatsapp_phone: "5215552222222",
          estado: "contactado",
          producto: "generadores",
          gen_reengagement_1_sent_at: null,
          gen_reengagement_2_sent_at: null,
        },
      ],
      convs: [],
      ultimoEntranteAt: isoHaceMinutos(GEN_TOQUE_1_MIN_MINUTES),
    });

    const res = await ejecutarReengagementGeneradoresCron(NOW);

    expect(res.procesados).toBe(0);
    expect(mockEnviarWa).not.toHaveBeenCalled();
  });

  it("no envía fuera de ventana 24h", async () => {
    configurarSupabase({
      leads: [
        {
          id: "lead-3",
          whatsapp_phone: "5215553333333",
          estado: "nuevo",
          producto: "generadores",
          gen_reengagement_1_sent_at: null,
          gen_reengagement_2_sent_at: null,
        },
      ],
      convs: [
        {
          whatsapp_phone: "5215553333333",
          state: "inicio",
          producto: "generadores",
          data: { genStep: "equipos" },
        },
      ],
      ultimoEntranteAt: isoHaceMinutos(1440),
    });

    const res = await ejecutarReengagementGeneradoresCron(NOW);

    expect(res.enviados).toBe(0);
    expect(res.resultados[0]?.motivo).toBe("fuera_ventana_24h_whatsapp");
    expect(mockEnviarWa).not.toHaveBeenCalled();
  });

  it("envía toque 2 en ventana de 20h", async () => {
    configurarSupabase({
      leads: [
        {
          id: "lead-4",
          whatsapp_phone: "5215554444444",
          estado: "nuevo",
          producto: "generadores",
          gen_reengagement_1_sent_at: "2026-06-09T10:00:00.000Z",
          gen_reengagement_2_sent_at: null,
        },
      ],
      convs: [
        {
          whatsapp_phone: "5215554444444",
          state: "inicio",
          producto: "generadores",
          data: { genStep: "horario" },
        },
      ],
      ultimoEntranteAt: isoHaceMinutos(GEN_TOQUE_2_MIN_MINUTES),
    });

    const res = await ejecutarReengagementGeneradoresCron(NOW);

    expect(res.enviados).toBe(1);
    expect(res.resultados[0]?.touch).toBe(2);
    expect(mockEnviarWa.mock.calls[0][0].body).toContain("Energrum");
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  crearSupabaseEnMemoria,
  type SupabaseEnMemoria,
} from "@/lib/testing/supabaseEnMemoria";

const mocks = vi.hoisted(() => ({
  enviarWa: vi.fn(),
  guardarMensaje: vi.fn(),
  db: null as SupabaseEnMemoria | null,
}));

vi.mock("@/lib/whatsappCloud", () => ({
  enviarMensajeTextoWa: (...args: unknown[]) => mocks.enviarWa(...args),
}));

vi.mock("@/lib/messagesDb", () => ({
  guardarMensaje: (...args: unknown[]) => mocks.guardarMensaje(...args),
}));

vi.mock("@/lib/supabaseAdmin", () => ({
  getSupabaseAdmin: () => mocks.db,
}));

import { ejecutarReengagementGeneradoresCron } from "@/lib/reengagementGeneradoresCron";
import {
  GEN_TOQUE_1_MIN_MINUTES,
  GEN_TOQUE_1_WINDOW_MINUTES,
  GEN_TOQUE_2_MIN_MINUTES,
} from "@/lib/reengagementGeneradores";

const NOW = new Date("2026-06-10T15:00:00.000Z").getTime();

function isoHaceMinutos(minutos: number): string {
  return new Date(NOW - minutos * 60_000).toISOString();
}

function configurarSupabase(args: {
  leads: Record<string, unknown>[];
  convs: Record<string, unknown>[];
  ultimoEntranteAt: string | null;
}): SupabaseEnMemoria {
  const db = crearSupabaseEnMemoria({
    leads: args.leads,
    conversations: args.convs,
    messages: args.ultimoEntranteAt
      ? args.leads.map((l, i) => ({
          id: `m-${i}`,
          lead_id: l.id,
          direccion: "entrante",
          created_at: args.ultimoEntranteAt,
        }))
      : [],
  });
  mocks.db = db;
  return db;
}

function leadGen(overrides: Record<string, unknown> = {}) {
  return {
    id: "lead-1",
    whatsapp_phone: "5215551111111",
    estado: "nuevo",
    producto: "generadores",
    gen_reengagement_1_sent_at: null,
    gen_reengagement_2_sent_at: null,
    ...overrides,
  };
}

function convGen(overrides: Record<string, unknown> = {}) {
  return {
    whatsapp_phone: "5215551111111",
    state: "inicio",
    producto: "generadores",
    data: { genStep: "tipo" },
    ...overrides,
  };
}

describe("ejecutarReengagementGeneradoresCron", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.WHATSAPP_ACCESS_TOKEN = "token-test";
    process.env.WHATSAPP_PHONE_NUMBER_ID = "1177472778778882";
    mocks.enviarWa.mockResolvedValue({ ok: true, status: 200, data: {} });
    mocks.guardarMensaje.mockResolvedValue(true);
  });

  afterEach(() => {
    delete process.env.WHATSAPP_ACCESS_TOKEN;
    delete process.env.WHATSAPP_PHONE_NUMBER_ID;
    mocks.db = null;
  });

  it("envía toque 1 y marca gen_reengagement_1_sent_at", async () => {
    const db = configurarSupabase({
      leads: [leadGen()],
      convs: [convGen()],
      ultimoEntranteAt: isoHaceMinutos(GEN_TOQUE_1_MIN_MINUTES),
    });

    const res = await ejecutarReengagementGeneradoresCron(NOW);

    expect(res.enviados).toBe(1);
    expect(mocks.enviarWa).toHaveBeenCalledOnce();
    expect(mocks.enviarWa.mock.calls[0][0]).toMatchObject({
      phoneNumberId: "1177472778778882",
      to: "5215551111111",
    });
    expect(mocks.guardarMensaje).toHaveBeenCalledOnce();
    expect(db.tablas.leads[0].gen_reengagement_1_sent_at).toEqual(expect.any(String));
  });

  it("omite lead contactado (query solo trae estado=nuevo)", async () => {
    configurarSupabase({
      leads: [leadGen({ estado: "contactado" })],
      convs: [],
      ultimoEntranteAt: isoHaceMinutos(GEN_TOQUE_1_MIN_MINUTES),
    });

    const res = await ejecutarReengagementGeneradoresCron(NOW);

    expect(res.candidatos).toBe(0);
    expect(res.consultas).toBe(1);
    expect(mocks.enviarWa).not.toHaveBeenCalled();
  });

  it("no envía fuera de ventana 24h", async () => {
    configurarSupabase({
      leads: [leadGen()],
      convs: [convGen({ data: { genStep: "equipos" } })],
      ultimoEntranteAt: isoHaceMinutos(1440),
    });

    const res = await ejecutarReengagementGeneradoresCron(NOW);

    expect(res.enviados).toBe(0);
    expect(res.resultados[0]?.motivo).toBe("fuera_ventana_24h_whatsapp");
    expect(mocks.enviarWa).not.toHaveBeenCalled();
  });

  it("envía toque 2 en ventana de 20h", async () => {
    configurarSupabase({
      leads: [leadGen({ gen_reengagement_1_sent_at: "2026-06-09T10:00:00.000Z" })],
      convs: [convGen({ data: { genStep: "horario" } })],
      ultimoEntranteAt: isoHaceMinutos(GEN_TOQUE_2_MIN_MINUTES),
    });

    const res = await ejecutarReengagementGeneradoresCron(NOW);

    expect(res.enviados).toBe(1);
    expect(res.resultados[0]?.touch).toBe(2);
    expect(mocks.enviarWa.mock.calls[0][0].body).toContain("Energrum");
  });

  it("mantiene la ventana comercial del toque 1 (180 a 190 minutos)", async () => {
    for (const [min, esperado] of [
      [GEN_TOQUE_1_MIN_MINUTES - 1, 0],
      [GEN_TOQUE_1_MIN_MINUTES + GEN_TOQUE_1_WINDOW_MINUTES - 1, 1],
      [GEN_TOQUE_1_MIN_MINUTES + GEN_TOQUE_1_WINDOW_MINUTES, 0],
    ] as const) {
      configurarSupabase({
        leads: [leadGen()],
        convs: [convGen()],
        ultimoEntranteAt: isoHaceMinutos(min),
      });
      const res = await ejecutarReengagementGeneradoresCron(NOW);
      expect(res.enviados).toBe(esperado);
    }
  });

  it("conversación finalizada o sin paso de Generadores: no envía", async () => {
    configurarSupabase({
      leads: [
        leadGen(),
        leadGen({ id: "lead-2", whatsapp_phone: "5215552222222" }),
      ],
      convs: [
        convGen({ state: "finalizado" }),
        convGen({ whatsapp_phone: "5215552222222", data: {} }),
      ],
      ultimoEntranteAt: isoHaceMinutos(GEN_TOQUE_1_MIN_MINUTES),
    });

    const res = await ejecutarReengagementGeneradoresCron(NOW);

    expect(res.enviados).toBe(0);
    expect(res.motivos).toEqual({ conversacion_no_elegible: 2 });
    expect(mocks.db!.operaciones.some((o) => o.tabla === "messages")).toBe(false);
  });

  it("ambos toques ya enviados: el lead no es candidato", async () => {
    configurarSupabase({
      leads: [
        leadGen({
          gen_reengagement_1_sent_at: "2026-06-09T10:00:00.000Z",
          gen_reengagement_2_sent_at: "2026-06-10T06:00:00.000Z",
        }),
      ],
      convs: [convGen()],
      ultimoEntranteAt: isoHaceMinutos(GEN_TOQUE_2_MIN_MINUTES),
    });

    const res = await ejecutarReengagementGeneradoresCron(NOW);

    expect(res.candidatos).toBe(0);
  });

  it("varios leads: una sola consulta de mensajes", async () => {
    const db = configurarSupabase({
      leads: [
        leadGen(),
        leadGen({ id: "lead-2", whatsapp_phone: "5215552222222" }),
        leadGen({ id: "lead-3", whatsapp_phone: "5215553333333" }),
      ],
      convs: [
        convGen(),
        convGen({ whatsapp_phone: "5215552222222" }),
        convGen({ whatsapp_phone: "5215553333333" }),
      ],
      ultimoEntranteAt: isoHaceMinutos(60),
    });

    const res = await ejecutarReengagementGeneradoresCron(NOW);

    expect(res.enviados).toBe(0);
    expect(res.consultas).toBe(3);
    expect(db.operaciones.filter((o) => o.tabla === "messages")).toHaveLength(1);
  });

  it("dos ejecuciones simultáneas envían una sola vez", async () => {
    configurarSupabase({
      leads: [leadGen()],
      convs: [convGen()],
      ultimoEntranteAt: isoHaceMinutos(GEN_TOQUE_1_MIN_MINUTES + 2),
    });

    const [a, b] = await Promise.all([
      ejecutarReengagementGeneradoresCron(NOW),
      ejecutarReengagementGeneradoresCron(NOW),
    ]);

    expect(a.enviados + b.enviados).toBe(1);
    expect(mocks.enviarWa).toHaveBeenCalledOnce();
  });
});

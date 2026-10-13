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
  buscarLeadPorTelefono: vi.fn(),
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
import { RECORDATORIOS_ACTIVIDAD_DESDE_ISO } from "@/lib/reengagementEnvio";

const ACTIVACION = Date.parse(RECORDATORIOS_ACTIVIDAD_DESDE_ISO);
const NOW = ACTIVACION + 3 * 24 * 60 * 60_000;
const PHONE = "5215551111111";

function isoHaceMinutos(minutos: number, base = NOW): string {
  return new Date(base - minutos * 60_000).toISOString();
}

function despues(iso: string, segundos: number): string {
  return new Date(Date.parse(iso) + segundos * 1000).toISOString();
}

function configurar(args: {
  minutosDesdeEntrante: number;
  textoEntrante?: string;
  lead?: Record<string, unknown>;
  conv?: Record<string, unknown> | null;
  acciones?: Record<string, unknown>[];
  base?: number;
}): SupabaseEnMemoria {
  const entranteAt = isoHaceMinutos(args.minutosDesdeEntrante, args.base);
  const db = crearSupabaseEnMemoria({
    leads: [
      {
        id: "lead-1",
        whatsapp_phone: PHONE,
        estado: "contactado",
        producto: "generadores",
        gen_reengagement_1_sent_at: null,
        gen_reengagement_2_sent_at: null,
        ...args.lead,
      },
    ],
    conversations:
      args.conv === null
        ? []
        : [
            {
              whatsapp_phone: PHONE,
              lead_id: "lead-1",
              state: "inicio",
              producto: "generadores",
              data: { genStep: "tipo" },
              ...args.conv,
            },
          ],
    messages: [
      {
        id: "m-1",
        lead_id: "lead-1",
        direccion: "entrante",
        origen: "cliente",
        contenido: args.textoEntrante ?? "Para mi casa",
        created_at: entranteAt,
      },
      {
        id: "m-2",
        lead_id: "lead-1",
        direccion: "saliente",
        origen: "bot",
        contenido: "¿Qué equipos necesitas respaldar?",
        created_at: despues(entranteAt, 10),
      },
    ],
    lead_actions: args.acciones ?? [],
  });
  mocks.db = db;
  return db;
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

  it("lead contactado por el bot: envía toque 1 a las 3 horas", async () => {
    const db = configurar({ minutosDesdeEntrante: GEN_TOQUE_1_MIN_MINUTES });

    const res = await ejecutarReengagementGeneradoresCron(NOW);

    expect(res.enviados).toBe(1);
    expect(mocks.enviarWa.mock.calls[0][0]).toMatchObject({
      phoneNumberId: "1177472778778882",
      to: PHONE,
    });
    expect(db.tablas.leads[0].gen_reengagement_1_sent_at).toEqual(expect.any(String));
    expect(db.tablas.leads[0].estado).toBe("contactado");
  });

  it("lead nuevo: envía", async () => {
    configurar({ minutosDesdeEntrante: GEN_TOQUE_1_MIN_MINUTES, lead: { estado: "nuevo" } });

    const res = await ejecutarReengagementGeneradoresCron(NOW);

    expect(res.enviados).toBe(1);
  });

  it("mantiene la ventana del toque 1 (180 a 190 minutos)", async () => {
    for (const [min, esperado] of [
      [GEN_TOQUE_1_MIN_MINUTES - 1, 0],
      [GEN_TOQUE_1_MIN_MINUTES + GEN_TOQUE_1_WINDOW_MINUTES - 1, 1],
      [GEN_TOQUE_1_MIN_MINUTES + GEN_TOQUE_1_WINDOW_MINUTES, 0],
    ] as const) {
      configurar({ minutosDesdeEntrante: min });
      const res = await ejecutarReengagementGeneradoresCron(NOW);
      expect(res.enviados).toBe(esperado);
    }
  });

  it("envía toque 2 a las 20 horas si el toque 1 es de este silencio", async () => {
    configurar({
      minutosDesdeEntrante: GEN_TOQUE_2_MIN_MINUTES,
      lead: { gen_reengagement_1_sent_at: isoHaceMinutos(GEN_TOQUE_2_MIN_MINUTES - 180) },
      conv: { data: { genStep: "horario" } },
    });

    const res = await ejecutarReengagementGeneradoresCron(NOW);

    expect(res.enviados).toBe(1);
    expect(res.resultados[0]?.touch).toBe(2);
    expect(mocks.enviarWa.mock.calls[0][0].body).toContain("Energrum");
  });

  it("lead histórico con toque 1 antiguo: no usa ese toque para enviar el 2", async () => {
    configurar({
      minutosDesdeEntrante: GEN_TOQUE_2_MIN_MINUTES,
      lead: { gen_reengagement_1_sent_at: "2026-06-26T05:15:23.698Z" },
    });

    const res = await ejecutarReengagementGeneradoresCron(NOW);

    expect(res.enviados).toBe(0);
    expect(res.resultados[0].motivo).toBe("toque_1_de_otra_conversacion");
  });

  it("actividad anterior a la activación: no es candidato", async () => {
    const ahora = ACTIVACION + 60 * 60_000;
    configurar({ minutosDesdeEntrante: GEN_TOQUE_1_MIN_MINUTES, base: ahora });

    const res = await ejecutarReengagementGeneradoresCron(ahora);

    expect(res.candidatos).toBe(0);
    expect(res.consultas).toBe(1);
  });

  it("asesor que ya intervino: no envía", async () => {
    configurar({
      minutosDesdeEntrante: GEN_TOQUE_1_MIN_MINUTES,
      acciones: [{ id: "a", lead_id: "lead-1", accion: "mensaje_asesor", advisor_id: "x" }],
    });

    const res = await ejecutarReengagementGeneradoresCron(NOW);

    expect(res.resultados[0].motivo).toBe("atencion_humana");
    expect(mocks.enviarWa).not.toHaveBeenCalled();
  });

  it.each(["lo pienso y le aviso", "está muy caro", "luego te escribo"])(
    "cliente que rechaza o pausa (%s): no envía",
    async (texto) => {
      configurar({ minutosDesdeEntrante: GEN_TOQUE_1_MIN_MINUTES, textoEntrante: texto });

      const res = await ejecutarReengagementGeneradoresCron(NOW);

      expect(res.resultados[0].motivo).toBe("cliente_pauso_o_rechazo");
    },
  );

  it("conversación cambiada a Mejoravit por comando: producto no confirmado", async () => {
    configurar({ minutosDesdeEntrante: GEN_TOQUE_1_MIN_MINUTES, conv: { producto: "mejoravit" } });

    const res = await ejecutarReengagementGeneradoresCron(NOW);

    expect(res.resultados[0].motivo).toBe("producto_no_confirmado");
    expect(mocks.enviarWa).not.toHaveBeenCalled();
  });

  it("conversación finalizada o sin paso de Generadores: no envía", async () => {
    configurar({ minutosDesdeEntrante: GEN_TOQUE_1_MIN_MINUTES, conv: { state: "finalizado" } });
    const finalizada = await ejecutarReengagementGeneradoresCron(NOW);

    configurar({ minutosDesdeEntrante: GEN_TOQUE_1_MIN_MINUTES, conv: { data: {} } });
    const sinPaso = await ejecutarReengagementGeneradoresCron(NOW);

    expect(finalizada.resultados[0].motivo).toBe("conversacion_no_elegible");
    expect(sinPaso.resultados[0].motivo).toBe("conversacion_no_elegible");
    expect(mocks.enviarWa).not.toHaveBeenCalled();
  });

  it("dos ejecuciones simultáneas envían una sola vez", async () => {
    configurar({ minutosDesdeEntrante: GEN_TOQUE_1_MIN_MINUTES + 2 });

    const [a, b] = await Promise.all([
      ejecutarReengagementGeneradoresCron(NOW),
      ejecutarReengagementGeneradoresCron(NOW),
    ]);

    expect(a.enviados + b.enviados).toBe(1);
    expect(mocks.enviarWa).toHaveBeenCalledOnce();
  });

  it("rechazo 4xx de Meta: libera la reserva y reintenta dentro de la ventana", async () => {
    const db = configurar({ minutosDesdeEntrante: GEN_TOQUE_1_MIN_MINUTES });
    mocks.enviarWa.mockResolvedValueOnce({ ok: false, status: 400, data: {} });

    await ejecutarReengagementGeneradoresCron(NOW);
    expect(db.tablas.leads[0].gen_reengagement_1_sent_at).toBeNull();

    const segunda = await ejecutarReengagementGeneradoresCron(NOW + 5 * 60_000);
    expect(segunda.enviados).toBe(1);
  });
});

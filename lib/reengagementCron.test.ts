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

import {
  ejecutarReengagementCron,
  ejecutarReengagementMejoravitCron,
  metricasCronSinDatosPersonales,
} from "@/lib/reengagementCron";

const NOW = new Date("2026-06-05T12:30:00.000Z").getTime();
const LEAD_ID = "11111111-1111-4111-8111-111111111111";
const PHONE = "5218110000001";

function haceMinutos(minutos: number, base = NOW): string {
  return new Date(base - minutos * 60_000).toISOString();
}

function escenario(args: {
  minutosDesdeEntrante: number | null;
  r1?: string | null;
  r2?: string | null;
  leadProducto?: string;
  leadEstado?: string;
  leadUpdatedAt?: string;
  convState?: string;
  convProducto?: string;
}): SupabaseEnMemoria {
  return crearSupabaseEnMemoria({
    leads: [
      {
        id: LEAD_ID,
        whatsapp_phone: PHONE,
        estado: args.leadEstado ?? "nuevo",
        producto: args.leadProducto ?? "mejoravit",
        updated_at: args.leadUpdatedAt ?? haceMinutos(30),
        monto_aprobado_min: null,
        monto_aprobado_max: null,
        reengagement_1_sent_at: args.r1 ?? null,
        reengagement_2_sent_at: args.r2 ?? null,
        gen_reengagement_1_sent_at: null,
        gen_reengagement_2_sent_at: null,
      },
    ],
    conversations: [
      {
        whatsapp_phone: PHONE,
        lead_id: LEAD_ID,
        state: args.convState ?? "esperando_datos",
        producto: args.convProducto ?? "mejoravit",
        data: {},
      },
    ],
    messages:
      args.minutosDesdeEntrante == null
        ? []
        : [
            {
              id: "m-1",
              lead_id: LEAD_ID,
              direccion: "entrante",
              created_at: haceMinutos(args.minutosDesdeEntrante),
            },
          ],
  });
}

function lead(db: SupabaseEnMemoria) {
  return db.tablas.leads[0] as Record<string, unknown>;
}

describe("cron de reengagement Mejoravit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.WHATSAPP_ACCESS_TOKEN = "token-test";
    process.env.WHATSAPP_PHONE_NUMBER_ID = "phone-id-test";
    mocks.enviarWa.mockResolvedValue({ ok: true, status: 200, data: {} });
    mocks.guardarMensaje.mockResolvedValue(true);
  });

  afterEach(() => {
    delete process.env.WHATSAPP_ACCESS_TOKEN;
    delete process.env.WHATSAPP_PHONE_NUMBER_ID;
    mocks.db = null;
  });

  describe("ventanas para un cron cada 5 minutos", () => {
    it.each([5, 9, 12, 14])("envía toque 1 a los %i minutos", async (min) => {
      mocks.db = escenario({ minutosDesdeEntrante: min });

      const res = await ejecutarReengagementMejoravitCron(NOW);

      expect(res.enviados).toBe(1);
      expect(res.resultados[0]).toMatchObject({ estado: "enviado", touch: 1 });
      expect(mocks.enviarWa).toHaveBeenCalledOnce();
      expect(mocks.enviarWa.mock.calls[0][0]).toMatchObject({ to: PHONE });
      expect(mocks.enviarWa.mock.calls[0][0].body).toContain("NSS");
      expect(mocks.guardarMensaje).toHaveBeenCalledWith(
        expect.objectContaining({ leadId: LEAD_ID, direccion: "saliente", origen: "bot" }),
      );
      expect(lead(mocks.db).reengagement_1_sent_at).toEqual(expect.any(String));
    });

    it.each([4, 15, 19])("no envía toque 1 a los %i minutos (antes de tiempo o ya antiguo)", async (min) => {
      mocks.db = escenario({ minutosDesdeEntrante: min });

      const res = await ejecutarReengagementMejoravitCron(NOW);

      expect(res.enviados).toBe(0);
      expect(mocks.enviarWa).not.toHaveBeenCalled();
      expect(lead(mocks.db).reengagement_1_sent_at).toBeNull();
    });

    it.each([20, 24, 29])("envía toque 2 a los %i minutos con toque 1 previo", async (min) => {
      mocks.db = escenario({ minutosDesdeEntrante: min, r1: haceMinutos(min - 5) });

      const res = await ejecutarReengagementMejoravitCron(NOW);

      expect(res.enviados).toBe(1);
      expect(res.resultados[0]).toMatchObject({ estado: "enviado", touch: 2 });
      expect(lead(mocks.db).reengagement_2_sent_at).toEqual(expect.any(String));
    });

    it("no envía toque 2 a los 30 minutos o más", async () => {
      mocks.db = escenario({ minutosDesdeEntrante: 30, r1: haceMinutos(25) });

      const res = await ejecutarReengagementMejoravitCron(NOW);

      expect(res.enviados).toBe(0);
      expect(mocks.enviarWa).not.toHaveBeenCalled();
    });

    it("no envía toque 2 sin toque 1", async () => {
      mocks.db = escenario({ minutosDesdeEntrante: 22 });

      const res = await ejecutarReengagementMejoravitCron(NOW);

      expect(res.enviados).toBe(0);
      expect(mocks.enviarWa).not.toHaveBeenCalled();
    });

    it("no junta un toque 1 retrasado con el toque 2", async () => {
      mocks.db = escenario({ minutosDesdeEntrante: 21, r1: haceMinutos(7) });

      const res = await ejecutarReengagementMejoravitCron(NOW);

      expect(res.enviados).toBe(0);
      expect(mocks.enviarWa).not.toHaveBeenCalled();
    });

    it("ejecución retrasada: cada toque sale una sola vez a lo largo de varias corridas", async () => {
      mocks.db = escenario({ minutosDesdeEntrante: 3 });
      const corridas = [0, 7, 12, 19, 26, 33, 45].map((m) => NOW + m * 60_000);

      for (const t of corridas) {
        await ejecutarReengagementMejoravitCron(t);
      }

      expect(mocks.enviarWa).toHaveBeenCalledTimes(2);
      expect(lead(mocks.db).reengagement_1_sent_at).toEqual(expect.any(String));
      expect(lead(mocks.db).reengagement_2_sent_at).toEqual(expect.any(String));
    });
  });

  describe("duplicados e idempotencia", () => {
    it("dos ejecuciones simultáneas envían el recordatorio una sola vez", async () => {
      mocks.db = escenario({ minutosDesdeEntrante: 6 });

      const [a, b] = await Promise.all([
        ejecutarReengagementMejoravitCron(NOW),
        ejecutarReengagementMejoravitCron(NOW),
      ]);

      expect(a.enviados + b.enviados).toBe(1);
      expect(mocks.enviarWa).toHaveBeenCalledOnce();
      expect(mocks.guardarMensaje).toHaveBeenCalledOnce();
      expect([...a.resultados, ...b.resultados].map((r) => r.motivo)).toContain(
        "reservado_por_otra_ejecucion",
      );
    });

    it("un reintento de Vercel después de enviar no reenvía", async () => {
      mocks.db = escenario({ minutosDesdeEntrante: 6 });

      await ejecutarReengagementMejoravitCron(NOW);
      const reintento = await ejecutarReengagementMejoravitCron(NOW + 30_000);

      expect(reintento.enviados).toBe(0);
      expect(mocks.enviarWa).toHaveBeenCalledOnce();
    });

    it("cliente que ya respondió: no se envía", async () => {
      mocks.db = escenario({ minutosDesdeEntrante: 1 });

      const res = await ejecutarReengagementMejoravitCron(NOW);

      expect(res.enviados).toBe(0);
      expect(mocks.enviarWa).not.toHaveBeenCalled();
    });

    it("cliente que responde durante el procesamiento: se cancela y se libera la reserva", async () => {
      const db = escenario({ minutosDesdeEntrante: 6 });
      let consultasMensajes = 0;
      db.alEjecutar = (tabla, op) => {
        if (tabla === "messages" && op === "select") {
          consultasMensajes += 1;
          if (consultasMensajes === 1) {
            db.tablas.messages.push({
              id: "m-2",
              lead_id: LEAD_ID,
              direccion: "entrante",
              created_at: haceMinutos(0),
            });
          }
        }
      };
      mocks.db = db;

      const res = await ejecutarReengagementMejoravitCron(NOW);

      expect(res.enviados).toBe(0);
      expect(res.resultados[0]).toMatchObject({ estado: "omitido", motivo: "cliente_respondio" });
      expect(mocks.enviarWa).not.toHaveBeenCalled();
      expect(lead(db).reengagement_1_sent_at).toBeNull();
    });

    it("asesor que cambia el estado antes de la reserva: no se envía", async () => {
      const db = escenario({ minutosDesdeEntrante: 6 });
      db.alEjecutar = (tabla, op) => {
        if (tabla === "conversations" && op === "select") {
          lead(db).estado = "contactado";
        }
      };
      mocks.db = db;

      const res = await ejecutarReengagementMejoravitCron(NOW);

      expect(res.enviados).toBe(0);
      expect(mocks.enviarWa).not.toHaveBeenCalled();
      expect(lead(db).reengagement_1_sent_at).toBeNull();
    });
  });

  describe("fallos de WhatsApp y recuperación", () => {
    it("rechazo 4xx: libera la reserva y la siguiente corrida reintenta dentro de la ventana", async () => {
      mocks.db = escenario({ minutosDesdeEntrante: 5 });
      mocks.enviarWa.mockResolvedValueOnce({ ok: false, status: 400, data: {} });

      const primera = await ejecutarReengagementMejoravitCron(NOW);
      expect(primera.errores).toBe(1);
      expect(primera.resultados[0].motivo).toBe("whatsapp_rechazado");
      expect(lead(mocks.db).reengagement_1_sent_at).toBeNull();
      expect(mocks.guardarMensaje).not.toHaveBeenCalled();

      const segunda = await ejecutarReengagementMejoravitCron(NOW + 5 * 60_000);
      expect(segunda.enviados).toBe(1);
      expect(mocks.enviarWa).toHaveBeenCalledTimes(2);
      expect(mocks.guardarMensaje).toHaveBeenCalledOnce();
    });

    it("rechazo 4xx fuera de ventana en la siguiente corrida: no manda un recordatorio antiguo", async () => {
      mocks.db = escenario({ minutosDesdeEntrante: 12 });
      mocks.enviarWa.mockResolvedValueOnce({ ok: false, status: 429, data: {} });

      await ejecutarReengagementMejoravitCron(NOW);
      await ejecutarReengagementMejoravitCron(NOW + 5 * 60_000);

      expect(mocks.enviarWa).toHaveBeenCalledOnce();
    });

    it("error 5xx: conserva la reserva y no reenvía", async () => {
      mocks.db = escenario({ minutosDesdeEntrante: 5 });
      mocks.enviarWa.mockResolvedValueOnce({ ok: false, status: 503, data: {} });

      const primera = await ejecutarReengagementMejoravitCron(NOW);
      await ejecutarReengagementMejoravitCron(NOW + 5 * 60_000);

      expect(primera.resultados[0].motivo).toBe("envio_incierto");
      expect(lead(mocks.db).reengagement_1_sent_at).toEqual(expect.any(String));
      expect(mocks.enviarWa).toHaveBeenCalledOnce();
    });

    it("fallo de red: conserva la reserva y no reenvía", async () => {
      mocks.db = escenario({ minutosDesdeEntrante: 5 });
      mocks.enviarWa.mockRejectedValueOnce(new Error("socket hang up"));

      const primera = await ejecutarReengagementMejoravitCron(NOW);
      await ejecutarReengagementMejoravitCron(NOW + 5 * 60_000);

      expect(primera.resultados[0].motivo).toBe("envio_incierto");
      expect(mocks.enviarWa).toHaveBeenCalledOnce();
    });

    it("falla el historial después de enviar: no reenvía", async () => {
      mocks.db = escenario({ minutosDesdeEntrante: 5 });
      mocks.guardarMensaje.mockResolvedValueOnce(false);

      const primera = await ejecutarReengagementMejoravitCron(NOW);
      await ejecutarReengagementMejoravitCron(NOW + 5 * 60_000);

      expect(primera.resultados[0].motivo).toBe("historial_no_guardado");
      expect(lead(mocks.db).reengagement_1_sent_at).toEqual(expect.any(String));
      expect(mocks.enviarWa).toHaveBeenCalledOnce();
    });

    it("sin credenciales de WhatsApp no reserva el toque", async () => {
      delete process.env.WHATSAPP_ACCESS_TOKEN;
      mocks.db = escenario({ minutosDesdeEntrante: 5 });

      const res = await ejecutarReengagementMejoravitCron(NOW);

      expect(res.errores).toBe(1);
      expect(lead(mocks.db).reengagement_1_sent_at).toBeNull();
    });
  });

  describe("tipos de prospecto", () => {
    it("conversación finalizada: no se envía y no consulta mensajes", async () => {
      mocks.db = escenario({ minutosDesdeEntrante: 6, convState: "finalizado" });

      const res = await ejecutarReengagementMejoravitCron(NOW);

      expect(res.enviados).toBe(0);
      expect(mocks.db.operaciones.some((o) => o.tabla === "messages")).toBe(false);
    });

    it.each(["esperando_horario", "tramite_mejoravit", "inicio"])(
      "conversación que ya avanzó (%s): no se envía",
      async (convState) => {
        mocks.db = escenario({ minutosDesdeEntrante: 6, convState });

        const res = await ejecutarReengagementMejoravitCron(NOW);

        expect(res.enviados).toBe(0);
        expect(mocks.enviarWa).not.toHaveBeenCalled();
      },
    );

    it("Compra de Casa: el lead no es candidato", async () => {
      mocks.db = escenario({
        minutosDesdeEntrante: 6,
        leadProducto: "compra_casa",
        convProducto: "compra_casa",
      });

      const res = await ejecutarReengagementMejoravitCron(NOW);

      expect(res.candidatos).toBe(0);
      expect(res.consultas).toBe(1);
      expect(mocks.enviarWa).not.toHaveBeenCalled();
    });

    it("conversación de Compra de Casa con lead sin producto Mejoravit explícito: no se envía", async () => {
      mocks.db = escenario({
        minutosDesdeEntrante: 6,
        leadProducto: "sin_clasificar",
        convProducto: "compra_casa",
      });

      const res = await ejecutarReengagementMejoravitCron(NOW);

      expect(res.enviados).toBe(0);
      expect(res.resultados[0].motivo).toBe("estado_conversacion_no_aplica");
      expect(mocks.enviarWa).not.toHaveBeenCalled();
    });

    it("Generadores: el flujo Mejoravit no lo procesa", async () => {
      mocks.db = escenario({
        minutosDesdeEntrante: 6,
        leadProducto: "generadores",
        convProducto: "generadores",
      });

      const res = await ejecutarReengagementMejoravitCron(NOW);

      expect(res.candidatos).toBe(0);
      expect(mocks.enviarWa).not.toHaveBeenCalled();
    });

    it("lead contactado: no se envía (regla vigente)", async () => {
      mocks.db = escenario({ minutosDesdeEntrante: 6, leadEstado: "contactado" });

      const res = await ejecutarReengagementMejoravitCron(NOW);

      expect(res.candidatos).toBe(0);
      expect(mocks.enviarWa).not.toHaveBeenCalled();
    });

    it("lead actualizado hace menos de 2 minutos: se omite sin más consultas", async () => {
      mocks.db = escenario({ minutosDesdeEntrante: 6, leadUpdatedAt: haceMinutos(1) });

      const res = await ejecutarReengagementMejoravitCron(NOW);

      expect(res.enviados).toBe(0);
      expect(res.consultas).toBe(1);
    });

    it("ambos toques ya enviados: el lead no es candidato", async () => {
      mocks.db = escenario({
        minutosDesdeEntrante: 22,
        r1: haceMinutos(17),
        r2: haceMinutos(2),
      });

      const res = await ejecutarReengagementMejoravitCron(NOW);

      expect(res.candidatos).toBe(0);
    });
  });

  describe("consultas y métricas", () => {
    it("sin candidatos hace una sola consulta", async () => {
      mocks.db = crearSupabaseEnMemoria({ leads: [], conversations: [], messages: [] });

      const res = await ejecutarReengagementMejoravitCron(NOW);

      expect(res.consultas).toBe(1);
      expect(mocks.db.operaciones).toHaveLength(1);
    });

    it("un envío usa 3 consultas de selección y 3 de envío", async () => {
      mocks.db = escenario({ minutosDesdeEntrante: 6 });

      const res = await ejecutarReengagementMejoravitCron(NOW);

      expect(res.consultas).toBe(6);
    });

    it("las métricas del cron no incluyen IDs, teléfonos ni contenido", async () => {
      mocks.db = escenario({ minutosDesdeEntrante: 6 });

      const metricas = metricasCronSinDatosPersonales(await ejecutarReengagementCron(NOW));
      const json = JSON.stringify(metricas);

      expect(metricas).toMatchObject({ candidatos: 1, enviados: 1, errores: 0 });
      expect(metricas.duracion_ms).toEqual(expect.any(Number));
      expect(metricas.consultas).toBeGreaterThan(0);
      expect(json).not.toContain(LEAD_ID);
      expect(json).not.toContain(PHONE);
      expect(json).not.toContain("NSS");
    });
  });

  describe("preservación de historiales y estados", () => {
    it("solo escribe columnas de recordatorio; no toca conversaciones, mensajes ni estado", async () => {
      mocks.db = escenario({ minutosDesdeEntrante: 6 });
      const conversacionesAntes = structuredClone(mocks.db.tablas.conversations);
      const mensajesAntes = structuredClone(mocks.db.tablas.messages);

      await ejecutarReengagementCron(NOW);
      await ejecutarReengagementCron(NOW + 15 * 60_000);

      expect(mocks.enviarWa).toHaveBeenCalledTimes(2);
      expect(mocks.db.tablas.conversations).toEqual(conversacionesAntes);
      expect(mocks.db.tablas.messages).toEqual(mensajesAntes);
      expect(lead(mocks.db).estado).toBe("nuevo");
      expect(mocks.db.updates.every((u) => u.tabla === "leads")).toBe(true);
      for (const u of mocks.db.updates) {
        expect(Object.keys(u.patch)).toEqual([
          expect.stringMatching(/^reengagement_[12]_sent_at$/),
        ]);
      }
    });
  });
});

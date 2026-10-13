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

import {
  ejecutarReengagementCron,
  ejecutarReengagementMejoravitCron,
  metricasCronSinDatosPersonales,
} from "@/lib/reengagementCron";
import { RECORDATORIOS_ACTIVIDAD_DESDE_ISO } from "@/lib/reengagementEnvio";

const ACTIVACION = Date.parse(RECORDATORIOS_ACTIVIDAD_DESDE_ISO);
const NOW = ACTIVACION + 2 * 24 * 60 * 60_000;
const LEAD_ID = "11111111-1111-4111-8111-111111111111";
const PHONE = "5218110000001";

function haceMinutos(minutos: number, base = NOW): string {
  return new Date(base - minutos * 60_000).toISOString();
}

function despues(iso: string, segundos: number): string {
  return new Date(Date.parse(iso) + segundos * 1000).toISOString();
}

type Escenario = {
  minutosDesdeEntrante: number;
  textoEntrante?: string;
  botRespondio?: boolean;
  r1?: string | null;
  r2?: string | null;
  leadProducto?: string;
  leadEstado?: string;
  leadUpdatedAt?: string;
  convState?: string;
  convProducto?: string;
  convData?: Record<string, unknown>;
  acciones?: Record<string, unknown>[];
  mensajesExtra?: Record<string, unknown>[];
  base?: number;
};

function escenario(args: Escenario): SupabaseEnMemoria {
  const entranteAt = haceMinutos(args.minutosDesdeEntrante, args.base);
  const mensajes: Record<string, unknown>[] = [
    {
      id: "m-1",
      lead_id: LEAD_ID,
      direccion: "entrante",
      origen: "cliente",
      contenido: args.textoEntrante ?? "Sí",
      created_at: entranteAt,
    },
  ];
  if (args.botRespondio ?? true) {
    mensajes.push({
      id: "m-2",
      lead_id: LEAD_ID,
      direccion: "saliente",
      origen: "bot",
      contenido: "¿Estás dado de alta en el Infonavit?",
      created_at: despues(entranteAt, 10),
    });
  }
  return crearSupabaseEnMemoria({
    leads: [
      {
        id: LEAD_ID,
        whatsapp_phone: PHONE,
        estado: args.leadEstado ?? "contactado",
        producto: args.leadProducto ?? "mejoravit",
        updated_at: args.leadUpdatedAt ?? despues(entranteAt, 10),
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
        state: args.convState ?? "esperando_infonavit",
        producto: args.convProducto ?? "mejoravit",
        data: args.convData ?? {},
      },
    ],
    messages: [...mensajes, ...(args.mensajesExtra ?? [])],
    lead_actions: args.acciones ?? [],
  });
}

function lead(db: SupabaseEnMemoria) {
  return db.tablas.leads[0] as Record<string, unknown>;
}

async function correr(args: Escenario, nowMs = NOW) {
  mocks.db = escenario(args);
  return ejecutarReengagementMejoravitCron(nowMs);
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

  describe("estado del lead", () => {
    it("lead contactado solo por el bot: envía el toque 1 y conserva el estado", async () => {
      const res = await correr({ minutosDesdeEntrante: 6 });

      expect(res.enviados).toBe(1);
      expect(res.resultados[0]).toMatchObject({ estado: "enviado", touch: 1 });
      expect(mocks.enviarWa.mock.calls[0][0]).toMatchObject({ to: PHONE });
      expect(mocks.enviarWa.mock.calls[0][0].body).toContain("Infonavit");
      expect(lead(mocks.db!).reengagement_1_sent_at).toEqual(expect.any(String));
      expect(lead(mocks.db!).estado).toBe("contactado");
    });

    it("lead nuevo: envía", async () => {
      const res = await correr({ minutosDesdeEntrante: 6, leadEstado: "nuevo" });

      expect(res.enviados).toBe(1);
    });

    it("lead no_interesado: no es candidato", async () => {
      const res = await correr({ minutosDesdeEntrante: 6, leadEstado: "no_interesado" });

      expect(res.candidatos).toBe(0);
      expect(mocks.enviarWa).not.toHaveBeenCalled();
    });
  });

  describe("atención humana", () => {
    it.each([
      ["mensaje del asesor (intervención del webhook)", { accion: "mensaje_asesor", advisor_id: "a-1" }],
      ["archivo del asesor", { accion: "archivo_asesor", advisor_id: null }],
      ["estado contactado puesto a mano en el CRM", { accion: "contactado", advisor_id: "a-1" }],
    ])("%s: no envía", async (_nombre, accion) => {
      const res = await correr({
        minutosDesdeEntrante: 6,
        acciones: [{ id: "x-1", lead_id: LEAD_ID, ...accion }],
      });

      expect(res.enviados).toBe(0);
      expect(res.resultados[0].motivo).toBe("atencion_humana");
      expect(mocks.enviarWa).not.toHaveBeenCalled();
    });

    it("mensaje de asesor después del último mensaje del cliente: no envía", async () => {
      const res = await correr({
        minutosDesdeEntrante: 6,
        mensajesExtra: [
          {
            id: "m-3",
            lead_id: LEAD_ID,
            direccion: "saliente",
            origen: "asesor",
            created_at: haceMinutos(4),
          },
        ],
      });

      expect(res.enviados).toBe(0);
      expect(res.resultados[0].motivo).toBe("atencion_humana");
    });
  });

  describe("conversación pendiente", () => {
    it("el bot todavía no respondió el último mensaje: no envía", async () => {
      const res = await correr({ minutosDesdeEntrante: 6, botRespondio: false });

      expect(res.enviados).toBe(0);
      expect(res.resultados[0].motivo).toBe("pendiente_respuesta_bot");
    });

    it("el cliente ya respondió la pregunta: no envía", async () => {
      const res = await correr({
        minutosDesdeEntrante: 6,
        mensajesExtra: [
          {
            id: "m-3",
            lead_id: LEAD_ID,
            direccion: "entrante",
            origen: "cliente",
            contenido: "Sí",
            created_at: haceMinutos(1),
          },
        ],
      });

      expect(res.enviados).toBe(0);
      expect(mocks.enviarWa).not.toHaveBeenCalled();
    });

    it("el cliente responde durante el procesamiento: cancela y libera la reserva", async () => {
      const db = escenario({ minutosDesdeEntrante: 6 });
      db.alEjecutar = (tabla, op) => {
        if (tabla === "lead_actions" && op === "select") {
          db.tablas.messages.push({
            id: "m-3",
            lead_id: LEAD_ID,
            direccion: "entrante",
            origen: "cliente",
            contenido: "Sí",
            created_at: haceMinutos(0),
          });
        }
      };
      mocks.db = db;

      const res = await ejecutarReengagementMejoravitCron(NOW);

      expect(res.resultados[0].motivo).toBe("conversacion_cambio_antes_de_enviar");
      expect(mocks.enviarWa).not.toHaveBeenCalled();
      expect(lead(db).reengagement_1_sent_at).toBeNull();
    });

    it.each(["Luego te escribo", "ahorita no puedo, estoy ocupado", "no me interesa", "ya no gracias"])(
      "el cliente rechazó o pausó (%s): no envía",
      async (texto) => {
        const res = await correr({ minutosDesdeEntrante: 6, textoEntrante: texto });

        expect(res.enviados).toBe(0);
        expect(res.resultados[0].motivo).toBe("cliente_pauso_o_rechazo");
      },
    );

    it("NSS ya recibido con consulta pendiente: no vuelve a pedirlo", async () => {
      const res = await correr({
        minutosDesdeEntrante: 6,
        convState: "esperando_datos",
        convData: { nssPendiente: "12345678901" },
      });

      expect(res.enviados).toBe(0);
      expect(res.resultados[0].motivo).toBe("nss_ya_recibido");
    });

    it.each(["tramite_mejoravit", "finalizado", "esperando_horario", "inicio"])(
      "conversación en %s: no envía",
      async (convState) => {
        const res = await correr({ minutosDesdeEntrante: 6, convState });

        expect(res.enviados).toBe(0);
        expect(res.resultados[0].motivo).toBe("estado_conversacion_no_aplica");
      },
    );
  });

  describe("producto", () => {
    it("Compra de Casa con conversación cambiada a Mejoravit por comando: no envía", async () => {
      mocks.db = escenario({
        minutosDesdeEntrante: 6,
        leadProducto: "compra_casa",
        convProducto: "mejoravit",
      });

      const res = await ejecutarReengagementCron(NOW);

      expect(res.enviados).toBe(0);
      expect(mocks.enviarWa).not.toHaveBeenCalled();
    });

    it("lead Mejoravit con conversación de Compra de Casa: no envía", async () => {
      const res = await correr({
        minutosDesdeEntrante: 6,
        convProducto: "compra_casa",
        convState: "esperando_datos",
      });

      expect(res.enviados).toBe(0);
      expect(res.resultados[0].motivo).toBe("producto_no_confirmado");
    });

    it("lead Generadores con conversación Mejoravit: ningún flujo envía", async () => {
      mocks.db = escenario({
        minutosDesdeEntrante: 6,
        leadProducto: "generadores",
        convProducto: "mejoravit",
      });

      const res = await ejecutarReengagementCron(NOW);

      expect(res.enviados).toBe(0);
      expect(mocks.enviarWa).not.toHaveBeenCalled();
    });

    it("lead sin_clasificar: no se confirma el producto", async () => {
      const res = await correr({ minutosDesdeEntrante: 6, leadProducto: "sin_clasificar" });

      expect(res.enviados).toBe(0);
    });

    it("conversación inexistente: no envía", async () => {
      mocks.db = escenario({ minutosDesdeEntrante: 6 });
      mocks.db.tablas.conversations = [];

      const res = await ejecutarReengagementMejoravitCron(NOW);

      expect(res.resultados[0].motivo).toBe("conversacion_no_encontrada");
    });
  });

  describe("actividad histórica", () => {
    it("mensaje anterior a la activación: no envía aunque el silencio esté en ventana", async () => {
      const ahora = ACTIVACION + 4 * 60_000;
      const res = await correr({ minutosDesdeEntrante: 6, base: ahora }, ahora);

      expect(res.candidatos).toBe(0);
      expect(res.consultas).toBe(1);
      expect(mocks.enviarWa).not.toHaveBeenCalled();
    });

    it("toque 1 de una conversación anterior no habilita el toque 2", async () => {
      const res = await correr({ minutosDesdeEntrante: 22, r1: haceMinutos(60 * 24 * 30) });

      expect(res.enviados).toBe(0);
      expect(res.resultados[0].motivo).toBe("toque_1_de_otra_conversacion");
    });

    it("sin actividad reciente: una sola consulta y ninguna lectura de leads", async () => {
      mocks.db = escenario({ minutosDesdeEntrante: 90 });

      const res = await ejecutarReengagementMejoravitCron(NOW);

      expect(res.consultas).toBe(1);
      expect(mocks.db.operaciones.map((o) => o.tabla)).toEqual(["messages"]);
    });
  });

  describe("ventanas de un cron cada 5 minutos", () => {
    it.each([5, 9, 14])("toque 1 a los %i minutos: envía", async (min) => {
      const res = await correr({ minutosDesdeEntrante: min });
      expect(res.enviados).toBe(1);
    });

    it.each([4, 15, 19])("toque 1 a los %i minutos: no envía", async (min) => {
      const res = await correr({ minutosDesdeEntrante: min });
      expect(res.enviados).toBe(0);
    });

    it.each([20, 29])("toque 2 a los %i minutos tras el toque 1 de este silencio: envía", async (min) => {
      const res = await correr({ minutosDesdeEntrante: min, r1: haceMinutos(min - 6) });

      expect(res.enviados).toBe(1);
      expect(res.resultados[0].touch).toBe(2);
    });

    it("toque 2 a los 30 minutos: no envía", async () => {
      const res = await correr({ minutosDesdeEntrante: 30, r1: haceMinutos(24) });
      expect(res.enviados).toBe(0);
    });

    it("recorrido completo: dos toques en total, ninguno repetido", async () => {
      mocks.db = escenario({ minutosDesdeEntrante: 2 });
      for (const m of [0, 5, 10, 15, 20, 25, 30, 40]) {
        await ejecutarReengagementMejoravitCron(NOW + m * 60_000);
      }

      expect(mocks.enviarWa).toHaveBeenCalledTimes(2);
    });
  });

  describe("duplicados y fallos de Meta", () => {
    it("dos ejecuciones simultáneas envían una sola vez", async () => {
      mocks.db = escenario({ minutosDesdeEntrante: 6 });

      const [a, b] = await Promise.all([
        ejecutarReengagementMejoravitCron(NOW),
        ejecutarReengagementMejoravitCron(NOW),
      ]);

      expect(a.enviados + b.enviados).toBe(1);
      expect(mocks.enviarWa).toHaveBeenCalledOnce();
      expect([...a.resultados, ...b.resultados].map((r) => r.motivo)).toContain(
        "reservado_por_otra_ejecucion",
      );
    });

    it("la reserva con estado contactado falla si un asesor marca no_interesado antes", async () => {
      const db = escenario({ minutosDesdeEntrante: 6 });
      db.alEjecutar = (tabla, op) => {
        if (tabla === "lead_actions" && op === "select") lead(db).estado = "no_interesado";
      };
      mocks.db = db;

      const res = await ejecutarReengagementMejoravitCron(NOW);

      expect(res.resultados[0].motivo).toBe("reservado_por_otra_ejecucion");
      expect(mocks.enviarWa).not.toHaveBeenCalled();
      expect(lead(db).reengagement_1_sent_at).toBeNull();
    });

    it("rechazo 4xx: libera la reserva y reintenta una vez dentro de la ventana", async () => {
      mocks.db = escenario({ minutosDesdeEntrante: 5 });
      mocks.enviarWa.mockResolvedValueOnce({ ok: false, status: 400, data: {} });

      const primera = await ejecutarReengagementMejoravitCron(NOW);
      expect(primera.resultados[0].motivo).toBe("whatsapp_rechazado");
      expect(lead(mocks.db).reengagement_1_sent_at).toBeNull();

      const segunda = await ejecutarReengagementMejoravitCron(NOW + 5 * 60_000);
      expect(segunda.enviados).toBe(1);
      expect(mocks.guardarMensaje).toHaveBeenCalledOnce();
    });

    it("error 5xx o de red: conserva la reserva y no reenvía", async () => {
      mocks.db = escenario({ minutosDesdeEntrante: 5 });
      mocks.enviarWa.mockResolvedValueOnce({ ok: false, status: 503, data: {} });

      const primera = await ejecutarReengagementMejoravitCron(NOW);
      await ejecutarReengagementMejoravitCron(NOW + 5 * 60_000);

      expect(primera.resultados[0].motivo).toBe("envio_incierto");
      expect(mocks.enviarWa).toHaveBeenCalledOnce();

      mocks.db = escenario({ minutosDesdeEntrante: 5 });
      mocks.enviarWa.mockRejectedValueOnce(new Error("socket hang up"));
      const red = await ejecutarReengagementMejoravitCron(NOW);
      expect(red.resultados[0].motivo).toBe("envio_incierto");
      expect(lead(mocks.db).reengagement_1_sent_at).toEqual(expect.any(String));
    });

    it("falla el historial después de enviar: no reenvía", async () => {
      mocks.db = escenario({ minutosDesdeEntrante: 5 });
      mocks.guardarMensaje.mockResolvedValueOnce(false);

      const primera = await ejecutarReengagementMejoravitCron(NOW);
      await ejecutarReengagementMejoravitCron(NOW + 5 * 60_000);

      expect(primera.resultados[0].motivo).toBe("historial_no_guardado");
      expect(mocks.enviarWa).toHaveBeenCalledOnce();
    });
  });

  describe("métricas y preservación", () => {
    it("un envío usa 5 consultas de selección y 3 de envío", async () => {
      const res = await correr({ minutosDesdeEntrante: 6 });
      expect(res.consultas).toBe(8);
    });

    it("las métricas no incluyen IDs, teléfonos ni contenido", async () => {
      mocks.db = escenario({ minutosDesdeEntrante: 6 });

      const metricas = metricasCronSinDatosPersonales(await ejecutarReengagementCron(NOW));
      const json = JSON.stringify(metricas);

      expect(metricas).toMatchObject({ enviados: 1, errores: 0 });
      expect(json).not.toContain(LEAD_ID);
      expect(json).not.toContain(PHONE);
      expect(json).not.toContain("Infonavit");
    });

    it("solo escribe columnas de recordatorio; no toca conversaciones, mensajes ni estado", async () => {
      mocks.db = escenario({ minutosDesdeEntrante: 6 });
      const conversacionesAntes = structuredClone(mocks.db.tablas.conversations);
      const mensajesAntes = structuredClone(mocks.db.tablas.messages);

      await ejecutarReengagementCron(NOW);

      expect(mocks.enviarWa).toHaveBeenCalledOnce();
      expect(mocks.db.tablas.conversations).toEqual(conversacionesAntes);
      expect(mocks.db.tablas.messages).toEqual(mensajesAntes);
      expect(lead(mocks.db).estado).toBe("contactado");
      for (const u of mocks.db.updates) {
        expect(u.tabla).toBe("leads");
        expect(Object.keys(u.patch)).toEqual([
          expect.stringMatching(/^reengagement_[12]_sent_at$/),
        ]);
      }
    });
  });
});

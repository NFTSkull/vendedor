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

import { GET } from "@/app/api/cron/reengagement/route";

const LEAD_ID = "22222222-2222-4222-8222-222222222222";
const PHONE = "5218110000002";

function solicitud(headers?: Record<string, string>) {
  return new Request("http://localhost/api/cron/reengagement", { headers });
}

describe("GET /api/cron/reengagement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = "cron-test-secret";
    process.env.WHATSAPP_ACCESS_TOKEN = "token-test";
    process.env.WHATSAPP_PHONE_NUMBER_ID = "phone-id-test";
    mocks.enviarWa.mockResolvedValue({ ok: true, status: 200, data: {} });
    mocks.guardarMensaje.mockResolvedValue(true);
    mocks.db = crearSupabaseEnMemoria({ leads: [], conversations: [], messages: [] });
  });

  afterEach(() => {
    delete process.env.CRON_SECRET;
    delete process.env.WHATSAPP_ACCESS_TOKEN;
    delete process.env.WHATSAPP_PHONE_NUMBER_ID;
    vi.restoreAllMocks();
  });

  it("rechaza sin autorización y no consulta la base", async () => {
    const res = await GET(solicitud());
    expect(res.status).toBe(401);
    expect(mocks.db!.operaciones).toHaveLength(0);
  });

  it("rechaza solo con header x-vercel-cron", async () => {
    const res = await GET(solicitud({ "x-vercel-cron": "1" }));
    expect(res.status).toBe(401);
    expect(mocks.db!.operaciones).toHaveLength(0);
  });

  it("rechaza Bearer incorrecto", async () => {
    const res = await GET(solicitud({ Authorization: "Bearer otro" }));
    expect(res.status).toBe(401);
  });

  it("rechaza si CRON_SECRET no está configurado", async () => {
    delete process.env.CRON_SECRET;
    const res = await GET(solicitud({ Authorization: "Bearer cron-test-secret" }));
    expect(res.status).toBe(401);
  });

  it("acepta Bearer CRON_SECRET y sin candidatos hace 2 consultas", async () => {
    const res = await GET(solicitud({ Authorization: "Bearer cron-test-secret" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, candidatos: 0, enviados: 0, consultas: 2 });
    expect(mocks.db!.operaciones).toHaveLength(2);
  });

  it("responde y registra solo métricas, sin IDs ni teléfonos", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const now = Date.now();
    mocks.db = crearSupabaseEnMemoria({
      leads: [
        {
          id: LEAD_ID,
          whatsapp_phone: PHONE,
          estado: "nuevo",
          producto: "mejoravit",
          updated_at: new Date(now - 30 * 60_000).toISOString(),
          reengagement_1_sent_at: null,
          reengagement_2_sent_at: null,
        },
      ],
      conversations: [
        { whatsapp_phone: PHONE, state: "esperando_datos", producto: "mejoravit", data: {} },
      ],
      messages: [
        {
          id: "m-1",
          lead_id: LEAD_ID,
          direccion: "entrante",
          created_at: new Date(now - 7 * 60_000).toISOString(),
        },
      ],
    });

    const res = await GET(solicitud({ Authorization: "Bearer cron-test-secret" }));
    const texto = await res.text();

    expect(res.status).toBe(200);
    expect(JSON.parse(texto)).toMatchObject({ ok: true, enviados: 1 });
    expect(JSON.parse(texto)).not.toHaveProperty("resultados");
    expect(texto).not.toContain(LEAD_ID);
    expect(texto).not.toContain(PHONE);
    const logs = JSON.stringify(info.mock.calls);
    expect(logs).toContain("duracion_ms");
    expect(logs).not.toContain(LEAD_ID);
    expect(logs).not.toContain(PHONE);
  });
});

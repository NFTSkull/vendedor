import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const LEAD_1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const LEAD_2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ASESOR = "11111111-1111-4111-8111-111111111111";
const OTRO = "22222222-2222-4222-8222-222222222222";

const mocks = vi.hoisted(() => ({
  requireCrmAuth: vi.fn(),
  enviarMensajeTextoWa: vi.fn(),
  guardarMensaje: vi.fn(),
  listarMensajesPorLead: vi.fn(),
  maybeSingleLead: vi.fn(),
  insertLeadAction: vi.fn(),
  updateLeadEstado: vi.fn(),
  filtrosUpdate: [] as Array<[string, string, unknown]>,
  advisor: null as Record<string, unknown> | null,
}));

vi.mock("@/lib/crmAuth", () => ({
  requireCrmAuth: mocks.requireCrmAuth,
}));

vi.mock("@/lib/whatsappCloud", () => ({
  enviarMensajeTextoWa: mocks.enviarMensajeTextoWa,
  errorGraphParaLog: () => null,
}));

vi.mock("@/lib/messagesDb", () => ({
  guardarMensaje: mocks.guardarMensaje,
  listarMensajesPorLead: mocks.listarMensajesPorLead,
}));

vi.mock("@/lib/supabaseAdmin", () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => {
      if (table === "advisors") {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: mocks.advisor, error: null }) }),
          }),
        };
      }
      if (table === "leads") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: mocks.maybeSingleLead,
            }),
          }),
          update: (payload: Record<string, unknown>) => {
            const filtro = {
              eq(col: string, val: unknown) {
                mocks.filtrosUpdate.push(["eq", col, val]);
                return col === "advisor_id" ? mocks.updateLeadEstado(payload) : filtro;
              },
              is(col: string, val: unknown) {
                mocks.filtrosUpdate.push(["is", col, val]);
                return mocks.updateLeadEstado(payload);
              },
            };
            return filtro;
          },
        };
      }
      if (table === "lead_actions") {
        return {
          insert: mocks.insertLeadAction,
        };
      }
      return {};
    },
  }),
}));

import { GET, POST } from "@/app/api/crm/leads/[id]/messages/route";

function postMensaje(leadId: string, mensaje: string) {
  return POST(
    new Request(`http://localhost/api/crm/leads/${leadId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mensaje }),
    }),
    { params: Promise.resolve({ id: leadId }) },
  );
}

function getMensajes(leadId: string) {
  return GET(new Request(`http://localhost/api/crm/leads/${leadId}/messages`), {
    params: Promise.resolve({ id: leadId }),
  });
}

function leadCon(estado: string, advisorId: string | null = ASESOR, id = LEAD_1) {
  mocks.maybeSingleLead.mockResolvedValue({
    data: { id, whatsapp_phone: "5215550000000", estado, advisor_id: advisorId },
    error: null,
  });
}

describe("POST /api/crm/leads/[id]/messages", () => {
  beforeEach(() => {
    process.env.WHATSAPP_ACCESS_TOKEN = "token";
    process.env.WHATSAPP_PHONE_NUMBER_ID = "phone-id";
    process.env.WHATSAPP_GRAPH_API_VERSION = "v19.0";

    mocks.requireCrmAuth.mockResolvedValue({ sub: ASESOR });
    mocks.advisor = { id: ASESOR, email: "asesor@example.com", activo: true };
    mocks.filtrosUpdate.length = 0;
    mocks.enviarMensajeTextoWa.mockResolvedValue({ ok: true, status: 200, data: {} });
    mocks.guardarMensaje.mockResolvedValue(true);
    mocks.insertLeadAction.mockResolvedValue({ error: null });
    mocks.updateLeadEstado.mockResolvedValue({ error: null });
    mocks.listarMensajesPorLead.mockResolvedValue([{ id: "m1", contenido: "hola" }]);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("lead en nuevo + envío exitoso → contactado + limpia tiene_mensaje_nuevo + mensaje_asesor", async () => {
    leadCon("nuevo");

    const res = await postMensaje(LEAD_1, "Hola desde CRM");

    expect(res.status).toBe(200);
    expect(mocks.updateLeadEstado).toHaveBeenCalledWith({
      estado: "contactado",
      tiene_mensaje_nuevo: false,
    });
    expect(mocks.filtrosUpdate).toEqual([
      ["eq", "id", LEAD_1],
      ["eq", "advisor_id", ASESOR],
    ]);
    expect(mocks.insertLeadAction).toHaveBeenCalledTimes(2);
    expect(mocks.insertLeadAction).toHaveBeenNthCalledWith(1, {
      lead_id: LEAD_1,
      advisor_id: ASESOR,
      accion: "mensaje_asesor",
      nota: "Hola desde CRM",
    });
    expect(mocks.insertLeadAction).toHaveBeenNthCalledWith(2, {
      lead_id: LEAD_1,
      advisor_id: ASESOR,
      accion: "cambio_estado_automatico",
      nota: "Marcado como contactado (asesor respondió)",
    });
  });

  it("lead en contactado + envío exitoso → sin update de estado", async () => {
    leadCon("contactado");

    const res = await postMensaje(LEAD_1, "Seguimiento");

    expect(res.status).toBe(200);
    expect(mocks.updateLeadEstado).toHaveBeenCalledWith({ tiene_mensaje_nuevo: false });
    expect(mocks.insertLeadAction).toHaveBeenCalledTimes(1);
    expect(mocks.insertLeadAction).toHaveBeenCalledWith({
      lead_id: LEAD_1,
      advisor_id: ASESOR,
      accion: "mensaje_asesor",
      nota: "Seguimiento",
    });
  });

  it("lead en no_interesado + envío exitoso → estado no cambia", async () => {
    leadCon("no_interesado");

    const res = await postMensaje(LEAD_1, "Último intento");

    expect(res.status).toBe(200);
    expect(mocks.updateLeadEstado).toHaveBeenCalledWith({ tiene_mensaje_nuevo: false });
    expect(mocks.insertLeadAction).toHaveBeenCalledTimes(1);
    expect(mocks.insertLeadAction).toHaveBeenCalledWith(
      expect.objectContaining({ accion: "mensaje_asesor" }),
    );
  });

  it("lead en nuevo + WhatsApp falla → estado sigue nuevo", async () => {
    leadCon("nuevo");
    mocks.enviarMensajeTextoWa.mockResolvedValue({
      ok: false,
      status: 502,
      data: { error: "fail" },
    });

    const res = await postMensaje(LEAD_1, "Hola");

    expect(res.status).toBe(502);
    expect(mocks.guardarMensaje).not.toHaveBeenCalled();
    expect(mocks.updateLeadEstado).not.toHaveBeenCalled();
    expect(mocks.insertLeadAction).not.toHaveBeenCalled();
  });

  it("bloquea estados fuera de nuevo/contactado/no_interesado", async () => {
    leadCon("archivado", ASESOR, LEAD_2);

    const res = await postMensaje(LEAD_2, "Hola");
    const body = (await res.json()) as { error?: string };

    expect(res.status).toBe(400);
    expect(body.error).toContain("no permite");
    expect(mocks.enviarMensajeTextoWa).not.toHaveBeenCalled();
  });

  it("sin sesión 401 y asesor inactivo 403, sin llamar a Meta", async () => {
    leadCon("nuevo");
    mocks.requireCrmAuth.mockResolvedValueOnce(null);
    expect((await postMensaje(LEAD_1, "Hola")).status).toBe(401);

    mocks.advisor = { id: ASESOR, email: "asesor@example.com", activo: false };
    expect((await postMensaje(LEAD_1, "Hola")).status).toBe(403);
    expect(mocks.enviarMensajeTextoWa).not.toHaveBeenCalled();
  });

  it("envío de WhatsApp a un lead ajeno: 403 antes de llamar a Meta y sin escribir", async () => {
    leadCon("nuevo", OTRO);

    expect((await postMensaje(LEAD_1, "Hola")).status).toBe(403);
    expect(mocks.enviarMensajeTextoWa).not.toHaveBeenCalled();
    expect(mocks.guardarMensaje).not.toHaveBeenCalled();
    expect(mocks.insertLeadAction).not.toHaveBeenCalled();
    expect(mocks.updateLeadEstado).not.toHaveBeenCalled();
  });

  it("admin: escribe a leads sin asignar con la condición en el UPDATE; asignados se rechazan", async () => {
    mocks.requireCrmAuth.mockResolvedValue({ sub: "admin-1" });
    mocks.advisor = { id: "admin-1", email: "admin@mejoravit.com", activo: true };

    leadCon("contactado", null);
    expect((await postMensaje(LEAD_1, "Hola")).status).toBe(200);
    expect(mocks.filtrosUpdate).toContainEqual(["is", "advisor_id", null]);

    leadCon("contactado", ASESOR);
    expect((await postMensaje(LEAD_1, "Hola")).status).toBe(403);
    expect(mocks.enviarMensajeTextoWa).toHaveBeenCalledTimes(1);
  });
});

describe("GET /api/crm/leads/[id]/messages", () => {
  beforeEach(() => {
    mocks.requireCrmAuth.mockResolvedValue({ sub: ASESOR });
    mocks.advisor = { id: ASESOR, email: "asesor@example.com", activo: true };
    mocks.listarMensajesPorLead.mockResolvedValue([{ id: "m1", contenido: "hola" }]);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("lee el historial de un lead propio", async () => {
    leadCon("nuevo");
    const res = await getMensajes(LEAD_1);
    expect(res.status).toBe(200);
    expect(mocks.listarMensajesPorLead).toHaveBeenCalledWith(LEAD_1);
  });

  it("lectura de mensajes ajenos: 403 sin consultar el historial", async () => {
    leadCon("nuevo", OTRO);
    expect((await getMensajes(LEAD_1)).status).toBe(403);
    expect(mocks.listarMensajesPorLead).not.toHaveBeenCalled();
  });

  it("ID que no es UUID: 404 sin consultar el historial", async () => {
    expect((await getMensajes("lead-1")).status).toBe(404);
    expect(mocks.listarMensajesPorLead).not.toHaveBeenCalled();
  });
});

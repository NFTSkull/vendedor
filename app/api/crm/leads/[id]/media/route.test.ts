import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MAX_ARCHIVO_CHAT_BYTES } from "@/lib/crmMediaUpload";

const mocks = vi.hoisted(() => ({
  requireCrmAuth: vi.fn(),
  subirMediaWa: vi.fn(),
  enviarMediaWa: vi.fn(),
  guardarMensaje: vi.fn(),
  maybeSingleLead: vi.fn(),
  insertLeadAction: vi.fn(),
}));

vi.mock("@/lib/crmAuth", () => ({
  requireCrmAuth: mocks.requireCrmAuth,
}));

vi.mock("@/lib/whatsappCloud", () => ({
  subirMediaWa: mocks.subirMediaWa,
  enviarMediaWa: mocks.enviarMediaWa,
  resolverTipoWaMedia: (mime: string) =>
    mime === "image/jpeg" || mime === "image/png" ? "image" : "document",
  esErrorVentana24hWhatsApp: () => false,
}));

vi.mock("@/lib/messagesDb", () => ({
  guardarMensaje: mocks.guardarMensaje,
}));

vi.mock("@/lib/supabaseAdmin", () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => {
      if (table === "leads") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: mocks.maybeSingleLead,
            }),
          }),
        };
      }
      if (table === "lead_actions") {
        return { insert: mocks.insertLeadAction };
      }
      return {};
    },
  }),
}));

import { POST } from "@/app/api/crm/leads/[id]/media/route";

function requestConArchivo(args: {
  mime: string;
  size: number;
  name?: string;
}): Request {
  const bytes = new Uint8Array(args.size);
  const file = new File([bytes], args.name ?? "archivo.bin", { type: args.mime });
  const form = new FormData();
  form.append("file", file);
  return new Request("http://localhost/api/crm/leads/lead-1/media", {
    method: "POST",
    headers: { Authorization: "Bearer token" },
    body: form,
  });
}

describe("POST /api/crm/leads/[id]/media", () => {
  beforeEach(() => {
    process.env.WHATSAPP_ACCESS_TOKEN = "token";
    process.env.WHATSAPP_PHONE_NUMBER_ID = "phone-id";

    mocks.requireCrmAuth.mockResolvedValue({ sub: "advisor-1" });
    mocks.maybeSingleLead.mockResolvedValue({
      data: { id: "lead-1", whatsapp_phone: "5215550000000", estado: "nuevo" },
      error: null,
    });
    mocks.subirMediaWa.mockResolvedValue({ ok: true, mediaId: "media-1" });
    mocks.enviarMediaWa.mockResolvedValue({ ok: true, status: 200, data: {} });
    mocks.guardarMensaje.mockResolvedValue(true);
    mocks.insertLeadAction.mockResolvedValue({ error: null });
  });

  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.WHATSAPP_ACCESS_TOKEN;
    delete process.env.WHATSAPP_PHONE_NUMBER_ID;
  });

  it("rechaza tipo no permitido → 400", async () => {
    const req = requestConArchivo({
      mime: "text/plain",
      size: 100,
      name: "nota.txt",
    });

    const res = await POST(req, { params: Promise.resolve({ id: "lead-1" }) });
    const body = (await res.json()) as { error?: string };

    expect(res.status).toBe(400);
    expect(body.error).toBe("Tipo de archivo no permitido");
    expect(mocks.subirMediaWa).not.toHaveBeenCalled();
  });

  it("rechaza archivo mayor a 4 MB → 413", async () => {
    const req = requestConArchivo({
      mime: "application/pdf",
      size: MAX_ARCHIVO_CHAT_BYTES + 1,
      name: "grande.pdf",
    });

    const res = await POST(req, { params: Promise.resolve({ id: "lead-1" }) });
    const body = (await res.json()) as { error?: string };

    expect(res.status).toBe(413);
    expect(body.error).toBe("El archivo supera el límite de 4 MB");
    expect(mocks.subirMediaWa).not.toHaveBeenCalled();
  });

  it("envía PDF permitido y guarda rastro en messages", async () => {
    const req = requestConArchivo({
      mime: "application/pdf",
      size: 1024,
      name: "cotizacion.pdf",
    });

    const res = await POST(req, { params: Promise.resolve({ id: "lead-1" }) });

    expect(res.status).toBe(200);
    expect(mocks.subirMediaWa).toHaveBeenCalledOnce();
    expect(mocks.enviarMediaWa).toHaveBeenCalledOnce();
    expect(mocks.guardarMensaje).toHaveBeenCalledWith({
      leadId: "lead-1",
      direccion: "saliente",
      contenido: "📎 cotizacion.pdf",
    });
    expect(mocks.insertLeadAction).toHaveBeenCalledWith(
      expect.objectContaining({
        accion: "archivo_asesor",
        nota: "cotizacion.pdf",
      }),
    );
  });
});

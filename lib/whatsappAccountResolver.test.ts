import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const supabaseMock = vi.hoisted(() => ({
  maybeSingle: vi.fn(),
}));

vi.mock("@/lib/supabaseAdmin", () => ({
  getSupabaseAdmin: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: supabaseMock.maybeSingle,
          }),
        }),
      }),
    }),
  }),
}));

import { resolveWhatsAppAccount } from "@/lib/whatsappAccountResolver";

describe("resolveWhatsAppAccount", () => {
  const envBackup: Record<string, string | undefined> = {};

  beforeEach(() => {
    vi.resetAllMocks();
    for (const key of [
      "WHATSAPP_PHONE_NUMBER_ID",
      "WHATSAPP_ACCESS_TOKEN",
      "WHATSAPP_DEFAULT_OWNER",
      "WHATSAPP_WABA_ID",
    ]) {
      envBackup[key] = process.env[key];
    }
    process.env.WHATSAPP_PHONE_NUMBER_ID = "env-phone-id";
    process.env.WHATSAPP_ACCESS_TOKEN = "env-access-token";
    delete process.env.WHATSAPP_DEFAULT_OWNER;
    delete process.env.WHATSAPP_WABA_ID;
    supabaseMock.maybeSingle.mockResolvedValue({ data: null, error: null });
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(envBackup)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("sin phoneNumberIdFromWebhook usa fallback env", async () => {
    const account = await resolveWhatsAppAccount();
    expect(account).toMatchObject({
      owner: "bot_principal",
      mode: "cloud_only",
      phoneNumberId: "env-phone-id",
      accessToken: "env-access-token",
      source: "env",
    });
    expect(supabaseMock.maybeSingle).not.toHaveBeenCalled();
  });

  it("con phoneNumberId en DB activa usa DB", async () => {
    supabaseMock.maybeSingle.mockResolvedValue({
      data: {
        owner: "jefe_1",
        mode: "coexistence",
        phone_number_id: "db-phone-id",
        access_token: "db-token-secret",
        display_phone_number: "+5218110000000",
        verified_name: "Jefe 1",
        waba_id: "waba-123",
        business_id: "biz-456",
      },
      error: null,
    });

    const account = await resolveWhatsAppAccount("db-phone-id");
    expect(account).toMatchObject({
      owner: "jefe_1",
      mode: "coexistence",
      phoneNumberId: "db-phone-id",
      accessToken: "db-token-secret",
      displayPhoneNumber: "+5218110000000",
      verifiedName: "Jefe 1",
      wabaId: "waba-123",
      businessId: "biz-456",
      source: "db",
    });
  });

  it("con phoneNumberId ausente en DB usa fallback env", async () => {
    supabaseMock.maybeSingle.mockResolvedValue({ data: null, error: null });

    const account = await resolveWhatsAppAccount("unknown-phone-id");
    expect(account).toMatchObject({
      phoneNumberId: "env-phone-id",
      accessToken: "env-access-token",
      source: "env",
    });
  });

  it("sin env ni DB devuelve null", async () => {
    delete process.env.WHATSAPP_PHONE_NUMBER_ID;
    delete process.env.WHATSAPP_ACCESS_TOKEN;
    supabaseMock.maybeSingle.mockResolvedValue({ data: null, error: null });

    const account = await resolveWhatsAppAccount("missing-id");
    expect(account).toBeNull();
  });

  it("usa WHATSAPP_DEFAULT_OWNER cuando está definido", async () => {
    process.env.WHATSAPP_DEFAULT_OWNER = "linea_principal";
    const account = await resolveWhatsAppAccount();
    expect(account?.owner).toBe("linea_principal");
  });

  it("no consulta DB si phoneNumberIdFromWebhook está vacío", async () => {
    const account = await resolveWhatsAppAccount("   ");
    expect(supabaseMock.maybeSingle).not.toHaveBeenCalled();
    expect(account?.source).toBe("env");
  });

  it("si la fila DB no tiene access_token hace fallback env", async () => {
    supabaseMock.maybeSingle.mockResolvedValue({
      data: {
        owner: "jefe_1",
        mode: "coexistence",
        phone_number_id: "db-phone-id",
        access_token: null,
        display_phone_number: null,
        verified_name: null,
        waba_id: null,
        business_id: null,
      },
      error: null,
    });

    const account = await resolveWhatsAppAccount("db-phone-id");
    expect(account?.source).toBe("env");
    expect(account?.phoneNumberId).toBe("env-phone-id");
  });
});

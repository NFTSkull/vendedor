import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  completeEmbeddedSignupJefe1: vi.fn(),
  validateWhatsAppSetupToken: vi.fn(),
}));

vi.mock("@/lib/metaEmbeddedSignup", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/metaEmbeddedSignup")>();
  return {
    ...actual,
    completeEmbeddedSignupJefe1: mocks.completeEmbeddedSignupJefe1,
    validateWhatsAppSetupToken: mocks.validateWhatsAppSetupToken,
  };
});

import { POST } from "@/app/api/meta/embedded-signup/route";

describe("POST /api/meta/embedded-signup", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.validateWhatsAppSetupToken.mockReturnValue(true);
    mocks.completeEmbeddedSignupJefe1.mockResolvedValue({
      owner: "jefe_1",
      mode: "coexistence",
      phone_number_id: "phone-jefe-1",
      display_phone_number: "+5218110000000",
      verified_name: "Jefe 1",
      waba_id: "waba-1",
      business_id: "biz-1",
      status: "created",
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rechaza sin setup token válido", async () => {
    mocks.validateWhatsAppSetupToken.mockReturnValue(false);
    const res = await POST(
      new Request("http://localhost/api/meta/embedded-signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: "abc" }),
      }),
    );
    expect(res.status).toBe(401);
  });

  it("rechaza sin code", async () => {
    const res = await POST(
      new Request("http://localhost/api/meta/embedded-signup", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-whatsapp-setup-token": "ok",
        },
        body: JSON.stringify({}),
      }),
    );
    expect(res.status).toBe(400);
    expect(mocks.completeEmbeddedSignupJefe1).not.toHaveBeenCalled();
  });

  it("devuelve datos seguros sin access_token", async () => {
    const res = await POST(
      new Request("http://localhost/api/meta/embedded-signup", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-whatsapp-setup-token": "ok",
        },
        body: JSON.stringify({
          code: "exchange-code-123",
          sessionInfo: {
            data: { phone_number_id: "phone-jefe-1", waba_id: "waba-1" },
          },
        }),
      }),
    );

    expect(res.status).toBe(200);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json.owner).toBe("jefe_1");
    expect(json.mode).toBe("coexistence");
    expect(json.phone_number_id).toBe("phone-jefe-1");
    expect(json.source).toBe("embedded_signup_v3");
    expect(json).not.toHaveProperty("access_token");
    expect(json).not.toHaveProperty("accessToken");

    expect(mocks.completeEmbeddedSignupJefe1).toHaveBeenCalledWith({
      code: "exchange-code-123",
      sessionInfo: expect.objectContaining({ phone_number_id: "phone-jefe-1" }),
    });
  });
});

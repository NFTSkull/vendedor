import { afterEach, describe, expect, it } from "vitest";

import {
  parseEmbeddedSignupSessionInfo,
  toEmbeddedSignupPublicResponse,
  validateWhatsAppSetupToken,
} from "@/lib/metaEmbeddedSignup";

describe("validateWhatsAppSetupToken", () => {
  const backup = process.env.WHATSAPP_SETUP_TOKEN;

  afterEach(() => {
    if (backup === undefined) delete process.env.WHATSAPP_SETUP_TOKEN;
    else process.env.WHATSAPP_SETUP_TOKEN = backup;
  });

  it("acepta token coincidente", () => {
    process.env.WHATSAPP_SETUP_TOKEN = "secreto-setup";
    expect(validateWhatsAppSetupToken("secreto-setup")).toBe(true);
  });

  it("rechaza token distinto o vacío", () => {
    process.env.WHATSAPP_SETUP_TOKEN = "secreto-setup";
    expect(validateWhatsAppSetupToken("otro")).toBe(false);
    expect(validateWhatsAppSetupToken("")).toBe(false);
    expect(validateWhatsAppSetupToken(undefined)).toBe(false);
  });
});

describe("parseEmbeddedSignupSessionInfo", () => {
  it("extrae ids del evento WA_EMBEDDED_SIGNUP", () => {
    const parsed = parseEmbeddedSignupSessionInfo({
      type: "WA_EMBEDDED_SIGNUP",
      event: "FINISH",
      data: {
        phone_number_id: "12345",
        waba_id: "waba-99",
        business_id: "biz-1",
      },
    });
    expect(parsed).toEqual({
      phone_number_id: "12345",
      waba_id: "waba-99",
      business_id: "biz-1",
      display_phone_number: undefined,
      verified_name: undefined,
    });
  });

  it("devuelve undefined si no hay datos útiles", () => {
    expect(parseEmbeddedSignupSessionInfo({})).toBeUndefined();
    expect(parseEmbeddedSignupSessionInfo(null)).toBeUndefined();
  });
});

describe("toEmbeddedSignupPublicResponse", () => {
  it("no incluye access_token", () => {
    const publicRes = toEmbeddedSignupPublicResponse({
      owner: "jefe_1",
      mode: "coexistence",
      phone_number_id: "pn-1",
      display_phone_number: "+5218110000000",
      verified_name: "Jefe",
      waba_id: "waba-1",
      business_id: "biz-1",
      status: "created",
    });
    expect(publicRes.source).toBe("embedded_signup_v3");
    expect(publicRes).not.toHaveProperty("access_token");
    expect(publicRes).not.toHaveProperty("accessToken");
  });
});

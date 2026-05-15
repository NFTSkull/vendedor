import { describe, expect, it } from "vitest";

import { getMetaWebhookVerificationResponse } from "./metaWebhookVerification";

describe("getMetaWebhookVerificationResponse", () => {
  it("devuelve 200 con hub.challenge cuando el token coincide", () => {
    const qs = new URLSearchParams([
      ["hub.mode", "subscribe"],
      ["hub.verify_token", "secreto"],
      ["hub.challenge", "12345"],
    ]);
    const res = getMetaWebhookVerificationResponse(qs, "secreto");
    expect(res).not.toBeNull();
    expect(res!.status).toBe(200);
  });

  it("devuelve null si el token no coincide", () => {
    const qs = new URLSearchParams([
      ["hub.mode", "subscribe"],
      ["hub.verify_token", "otro"],
      ["hub.challenge", "x"],
    ]);
    expect(getMetaWebhookVerificationResponse(qs, "secreto")).toBeNull();
  });

  it("devuelve null si falta hub.challenge", () => {
    const qs = new URLSearchParams([
      ["hub.mode", "subscribe"],
      ["hub.verify_token", "secreto"],
    ]);
    expect(getMetaWebhookVerificationResponse(qs, "secreto")).toBeNull();
  });
});

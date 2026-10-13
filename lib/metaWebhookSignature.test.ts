import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import { firmaMetaValida } from "@/lib/metaWebhookSignature";

const SECRET = "app-secret-de-prueba";
const BODY = Buffer.from(JSON.stringify({ object: "whatsapp_business_account", entry: [] }));

function firmar(body: Buffer, secret = SECRET): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

describe("firmaMetaValida", () => {
  it("acepta la firma correcta del cuerpo crudo", () => {
    expect(firmaMetaValida(BODY, firmar(BODY), SECRET)).toBe(true);
  });

  it("acepta la firma con hex en mayúsculas", () => {
    expect(firmaMetaValida(BODY, firmar(BODY).toUpperCase().replace("SHA256=", "sha256="), SECRET)).toBe(true);
  });

  it("rechaza firma hecha con otro secreto", () => {
    expect(firmaMetaValida(BODY, firmar(BODY, "otro-secreto"), SECRET)).toBe(false);
  });

  it("rechaza si el cuerpo fue alterado", () => {
    const alterado = Buffer.from(JSON.stringify({ object: "whatsapp_business_account", entry: [1] }));
    expect(firmaMetaValida(alterado, firmar(BODY), SECRET)).toBe(false);
  });

  it("rechaza sin encabezado, con formato inválido o sin secreto configurado", () => {
    expect(firmaMetaValida(BODY, null, SECRET)).toBe(false);
    expect(firmaMetaValida(BODY, "sha1=abc", SECRET)).toBe(false);
    expect(firmaMetaValida(BODY, "sha256=zz", SECRET)).toBe(false);
    expect(firmaMetaValida(BODY, firmar(BODY), undefined)).toBe(false);
    expect(firmaMetaValida(BODY, firmar(BODY), "  ")).toBe(false);
  });
});

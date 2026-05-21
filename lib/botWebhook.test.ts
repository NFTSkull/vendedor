import { describe, expect, it } from "vitest";

import { extraerNssOnceDigitos } from "@/lib/nss";
import { extraerTextosEntrantes } from "@/lib/parseWhatsAppWebhook";

describe("extraerNssOnceDigitos", () => {
  it("acepta exactamente 11 dígitos", () => {
    expect(extraerNssOnceDigitos("12345678901")).toBe("12345678901");
  });
  it("limpia caracteres no numéricos", () => {
    expect(extraerNssOnceDigitos("123-456-789-01")).toBe("12345678901");
  });
  it("rechaza si no hay ningún bloque de 11 dígitos", () => {
    expect(extraerNssOnceDigitos("1234567890")).toBeNull();
  });

  it("rechaza cuando el texto trae más de 11 dígitos", () => {
    expect(extraerNssOnceDigitos("123456789012")).toBeNull();
    expect(extraerNssOnceDigitos("Juan Pérez 5512345678901 12345678901")).toBeNull();
  });
});

describe("extraerTextosEntrantes", () => {
  it("extrae from y texto de payloads típicos de Meta", () => {
    const body = {
      entry: [
        {
          changes: [
            {
              field: "messages",
              value: {
                messages: [
                  {
                    from: "521234567890",
                    type: "text",
                    text: { body: "Hola mundo" },
                  },
                ],
              },
            },
          ],
        },
      ],
    };
    expect(extraerTextosEntrantes(body)).toEqual([
      { from: "521234567890", body: "Hola mundo" },
    ]);
  });

  it("ignora payloads sin mensajes de texto", () => {
    expect(extraerTextosEntrantes({ entry: [{ changes: [] }] })).toEqual([]);
    expect(extraerTextosEntrantes({})).toEqual([]);
  });
});

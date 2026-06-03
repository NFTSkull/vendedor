import { describe, expect, it } from "vitest";

import { extraerNssOnceDigitos } from "@/lib/nss";
import {
  extraerTextosEntrantes,
  payloadDebeIgnorarPorEcos,
} from "@/lib/parseWhatsAppWebhook";

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
                    id: "wamid.HBgLMjE...",
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
      {
        from: "521234567890",
        body: "Hola mundo",
        wamid: "wamid.HBgLMjE...",
        phoneNumberId: null,
      },
    ]);
  });

  it("extrae metadata.phone_number_id por entry", () => {
    const body = {
      entry: [
        {
          changes: [
            {
              field: "messages",
              value: {
                metadata: { phone_number_id: "123456789012345" },
                messages: [
                  {
                    id: "wamid.abc",
                    from: "521234567890",
                    type: "text",
                    text: { body: "Hola" },
                  },
                ],
              },
            },
          ],
        },
      ],
    };
    expect(extraerTextosEntrantes(body)).toEqual([
      {
        from: "521234567890",
        body: "Hola",
        wamid: "wamid.abc",
        phoneNumberId: "123456789012345",
      },
    ]);
  });

  it("payloadDebeIgnorarPorEcos es true solo con ecos sin mensajes de texto", () => {
    const soloEco = {
      entry: [
        {
          changes: [
            {
              field: "messages",
              value: {
                metadata: { phone_number_id: "111" },
                message_echoes: [{ id: "echo-1", from: "521111", type: "text" }],
              },
            },
          ],
        },
      ],
    };
    expect(payloadDebeIgnorarPorEcos(soloEco)).toBe(true);

    const ecoYMensaje = {
      entry: [
        {
          changes: [
            {
              field: "messages",
              value: {
                metadata: { phone_number_id: "111" },
                message_echoes: [{ id: "echo-1" }],
                messages: [
                  {
                    id: "wamid.in",
                    from: "521234567890",
                    type: "text",
                    text: { body: "Hola" },
                  },
                ],
              },
            },
          ],
        },
      ],
    };
    expect(payloadDebeIgnorarPorEcos(ecoYMensaje)).toBe(false);
  });

  it("ignora payloads sin mensajes de texto", () => {
    expect(extraerTextosEntrantes({ entry: [{ changes: [] }] })).toEqual([]);
    expect(extraerTextosEntrantes({})).toEqual([]);
  });
});

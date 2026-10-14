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

  it("extrae el anuncio de Meta (referral) validado y solo con los campos de texto", () => {
    const body = {
      entry: [
        {
          changes: [
            {
              field: "messages",
              value: {
                metadata: { phone_number_id: "1177472778778882" },
                messages: [
                  {
                    id: "wamid.ref",
                    from: "521234567890",
                    type: "text",
                    text: { body: "Hola, quiero información" },
                    referral: {
                      source_url: "https://fb.me/abc",
                      source_id: "120000000",
                      source_type: "ad",
                      headline: " Crédito Mejoravit ",
                      body: "Usa tu saldo Infonavit",
                      ctwa_clid: "ARAkLk...",
                    },
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
        body: "Hola, quiero información",
        wamid: "wamid.ref",
        phoneNumberId: "1177472778778882",
        referral: {
          headline: "Crédito Mejoravit",
          body: "Usa tu saldo Infonavit",
          sourceUrl: "https://fb.me/abc",
        },
      },
    ]);
  });

  it("ignora un referral malformado o sin texto sin perder el mensaje", () => {
    const mensaje = (referral: unknown) => ({
      entry: [
        {
          changes: [
            {
              field: "messages",
              value: {
                messages: [
                  { id: "w", from: "521234567890", type: "text", text: { body: "Hola" }, referral },
                ],
              },
            },
          ],
        },
      ],
    });

    for (const referral of ["texto", { headline: 123, body: ["x"] }, { source_type: "ad" }]) {
      const [m] = extraerTextosEntrantes(mensaje(referral));
      expect(m.body).toBe("Hola");
      expect(m).not.toHaveProperty("referral");
    }
    const [conTitulo] = extraerTextosEntrantes(mensaje({ headline: "Vende tu casa", body: 5 }));
    expect(conTitulo.referral).toEqual({ headline: "Vende tu casa", body: null, sourceUrl: null });
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

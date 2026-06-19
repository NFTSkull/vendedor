import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  enviarMediaWa,
  esErrorVentana24hWhatsApp,
  resolverTipoWaMedia,
  subirMediaWa,
} from "@/lib/whatsappCloud";

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("whatsappCloud media", () => {
  describe("resolverTipoWaMedia", () => {
    it("image/jpeg y image/png → image", () => {
      expect(resolverTipoWaMedia("image/jpeg")).toBe("image");
      expect(resolverTipoWaMedia("image/png")).toBe("image");
    });

    it("pdf y office → document", () => {
      expect(resolverTipoWaMedia("application/pdf")).toBe("document");
      expect(
        resolverTipoWaMedia(
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ),
      ).toBe("document");
    });
  });

  describe("esErrorVentana24hWhatsApp", () => {
    it("detecta códigos típicos de Meta", () => {
      expect(
        esErrorVentana24hWhatsApp({ error: { code: 131047, message: "x" } }),
      ).toBe(true);
      expect(
        esErrorVentana24hWhatsApp({
          error: { message: "More than 24 hours have passed" },
        }),
      ).toBe(true);
    });

    it("rechaza otros errores", () => {
      expect(esErrorVentana24hWhatsApp({ error: { code: 100 } })).toBe(false);
    });
  });

  describe("subirMediaWa", () => {
    it("devuelve mediaId en éxito", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ id: "media-123" }),
      });

      const res = await subirMediaWa({
        phoneNumberId: "phone-1",
        accessToken: "token",
        buffer: new Uint8Array([1, 2, 3]),
        mimeType: "image/png",
        filename: "foto.png",
      });

      expect(res).toEqual({ ok: true, mediaId: "media-123" });
      expect(fetchMock).toHaveBeenCalledWith(
        "https://graph.facebook.com/v19.0/phone-1/media",
        expect.objectContaining({ method: "POST" }),
      );
    });

    it("devuelve error si falla la subida", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({ error: { message: "bad" } }),
      });

      const res = await subirMediaWa({
        phoneNumberId: "phone-1",
        accessToken: "token",
        buffer: new Uint8Array([1]),
        mimeType: "application/pdf",
        filename: "doc.pdf",
      });

      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.status).toBe(400);
      }
    });
  });

  describe("enviarMediaWa", () => {
    it("envía document con filename", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ messages: [{ id: "wamid.1" }] }),
      });

      const res = await enviarMediaWa({
        phoneNumberId: "phone-1",
        accessToken: "token",
        to: "5215550000000",
        mediaId: "media-99",
        tipo: "document",
        filename: "cotizacion.pdf",
      });

      expect(res.ok).toBe(true);
      const body = JSON.parse(
        (fetchMock.mock.calls[0][1] as RequestInit).body as string,
      ) as { type: string; document: { id: string; filename: string } };
      expect(body.type).toBe("document");
      expect(body.document).toMatchObject({
        id: "media-99",
        filename: "cotizacion.pdf",
      });
    });

    it("envía image con caption opcional", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({}),
      });

      await enviarMediaWa({
        phoneNumberId: "phone-1",
        accessToken: "token",
        to: "5215550000000",
        mediaId: "media-img",
        tipo: "image",
        caption: "Foto del sitio",
      });

      const body = JSON.parse(
        (fetchMock.mock.calls[0][1] as RequestInit).body as string,
      ) as { type: string; image: { id: string; caption: string } };
      expect(body.type).toBe("image");
      expect(body.image.caption).toBe("Foto del sitio");
    });
  });
});

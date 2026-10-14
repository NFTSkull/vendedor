import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getConversation: vi.fn(),
  reemplazarConversacion: vi.fn(),
  setConversation: vi.fn(),
  deleteConversation: vi.fn(),
  limpiarHistorialClaude: vi.fn(),
  sincronizarProductoLead: vi.fn(),
}));

vi.mock("@/lib/productoLead", () => ({
  sincronizarProductoLead: mocks.sincronizarProductoLead,
}));

vi.mock("@/lib/conversationMemory", () => ({
  getConversation: mocks.getConversation,
  reemplazarConversacion: mocks.reemplazarConversacion,
  setConversation: mocks.setConversation,
  deleteConversation: mocks.deleteConversation,
}));

vi.mock("@/lib/claudeAssistant", () => ({
  limpiarHistorialClaude: mocks.limpiarHistorialClaude,
}));

import {
  aplicarComandoProducto,
  detectarComandoProducto,
  esNumeroConComandoProducto,
} from "@/lib/comandoProducto";
import { NUMERO_COMPARTIDO_PHONE_NUMBER_ID } from "@/lib/detectarProducto";

describe("detectarComandoProducto", () => {
  it.each([
    ["activa mejoravit", "mejoravit"],
    ["Modo Mejoravit", "mejoravit"],
    ["cambia a mejoravit", "mejoravit"],
    ["¡Actívame Mejoravit!", "mejoravit"],
    ["  cambiar al modo mejoravit.  ", "mejoravit"],
    ["activa casas", "compra_casa"],
    ["MODO CASAS", "compra_casa"],
    ["cambia a casas", "compra_casa"],
    ["modo casa", "compra_casa"],
    ["activa compra de casa", "compra_casa"],
    ["pasa a casas", "compra_casa"],
  ])("%s → %s", (texto, esperado) => {
    expect(detectarComandoProducto(texto)).toBe(esperado);
  });

  it.each([
    "hola",
    "mejoravit",
    "casas",
    "activa",
    "quiero cambiar a casas más grandes",
    "¿qué es el modo mejoravit?",
    "mi casa está en Apodaca",
    "activa mejoravit por favor y dime cuánto me dan",
  ])("%s → null", (texto) => {
    expect(detectarComandoProducto(texto)).toBeNull();
  });
});

describe("esNumeroConComandoProducto", () => {
  it("solo acepta el phone_number_id del número 8114118767", () => {
    expect(esNumeroConComandoProducto(NUMERO_COMPARTIDO_PHONE_NUMBER_ID)).toBe(true);
    expect(esNumeroConComandoProducto(` ${NUMERO_COMPARTIDO_PHONE_NUMBER_ID} `)).toBe(true);
    expect(esNumeroConComandoProducto("999999999999999")).toBe(false);
    expect(esNumeroConComandoProducto(null)).toBe(false);
    expect(esNumeroConComandoProducto(undefined)).toBe(false);
  });
});

describe("aplicarComandoProducto", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.reemplazarConversacion.mockResolvedValue(undefined);
  });

  it("casas → Mejoravit: reemplaza la conversación en una sola operación y conserva lead_id", async () => {
    mocks.getConversation.mockResolvedValue({
      state: "finalizado",
      name: null,
      nss: null,
      lead_id: "lead-1",
      producto: "compra_casa",
      data: { casaStep: "imagen", municipio: "Apodaca" },
    });

    const reply = await aplicarComandoProducto("5215550000000", "mejoravit");

    expect(reply).toBe(
      "Listo, a partir de ahora estamos para ayudarte con tu crédito Mejoravit.",
    );
    expect(mocks.reemplazarConversacion).toHaveBeenCalledTimes(1);
    expect(mocks.reemplazarConversacion).toHaveBeenCalledWith("5215550000000", {
      state: "inicio",
      nss: null,
      lead_id: "lead-1",
      producto: "mejoravit",
      data: { productoForzado: "mejoravit" },
    });
    expect(mocks.deleteConversation).not.toHaveBeenCalled();
    expect(mocks.setConversation).not.toHaveBeenCalled();
    expect(mocks.limpiarHistorialClaude).toHaveBeenCalledWith("5215550000000");
    expect(mocks.sincronizarProductoLead).toHaveBeenCalledWith("lead-1", "mejoravit", "comando");
  });

  it("Mejoravit → casas: limpia el NSS y el estado del flujo anterior", async () => {
    mocks.getConversation.mockResolvedValue({
      state: "esperando_horario",
      name: null,
      nss: "12345678901",
      lead_id: "lead-2",
      producto: "mejoravit",
      data: { nss: "12345678901" },
    });

    const reply = await aplicarComandoProducto("5215550000001", "compra_casa");

    expect(reply).toBe(
      "Listo, a partir de ahora estamos para ayudarte con la venta de tu propiedad.",
    );
    expect(mocks.reemplazarConversacion).toHaveBeenCalledWith("5215550000001", {
      state: "inicio",
      nss: null,
      lead_id: "lead-2",
      producto: "compra_casa",
      data: { productoForzado: "compra_casa" },
    });
    expect(mocks.sincronizarProductoLead).toHaveBeenCalledWith("lead-2", "compra_casa", "comando");
  });

  it("sin lead_id al momento del comando: guarda el producto con lead_id null", async () => {
    mocks.getConversation.mockResolvedValue({
      state: "inicio",
      name: null,
      nss: null,
      lead_id: null,
    });

    await aplicarComandoProducto("5215550000002", "mejoravit");

    expect(mocks.reemplazarConversacion).toHaveBeenCalledWith("5215550000002", {
      state: "inicio",
      nss: null,
      lead_id: null,
      producto: "mejoravit",
      data: { productoForzado: "mejoravit" },
    });
    expect(mocks.sincronizarProductoLead).not.toHaveBeenCalled();
  });
});

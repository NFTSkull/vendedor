import { describe, expect, it } from "vitest";

import { interpretarOpcionMenu, MSG_MENU_PRODUCTO } from "@/lib/menuProducto";

describe("MSG_MENU_PRODUCTO", () => {
  it("presenta las dos opciones acordadas", () => {
    expect(MSG_MENU_PRODUCTO).toBe(
      "¿En qué te podemos ayudar?\n1) Crédito Mejoravit (Infonavit)\n2) Vender tu casa",
    );
  });
});

describe("interpretarOpcionMenu", () => {
  it.each([
    ["1", "mejoravit"],
    ["1)", "mejoravit"],
    ["uno", "mejoravit"],
    ["Opción 1", "mejoravit"],
    ["la primera", "mejoravit"],
    ["Crédito Mejoravit (Infonavit)", "mejoravit"],
    ["el del infonavit", "mejoravit"],
    ["un préstamo", "mejoravit"],
    ["2", "compra_casa"],
    [" 2. ", "compra_casa"],
    ["dos", "compra_casa"],
    ["opcion 2", "compra_casa"],
    ["la segunda", "compra_casa"],
    ["Vender tu casa", "compra_casa"],
    ["quiero vender", "compra_casa"],
    ["la venta", "compra_casa"],
  ] as const)("%j → %s", (texto, esperado) => {
    expect(interpretarOpcionMenu(texto)).toBe(esperado);
  });

  it.each([
    "",
    "hola",
    "12",
    "1 y 2",
    "¿cuánto cuesta?",
    "quiero vender mi casa con crédito infonavit",
    "mi casa",
  ])("%j → null (reenviar menú)", (texto) => {
    expect(interpretarOpcionMenu(texto)).toBeNull();
  });
});

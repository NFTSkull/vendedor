import { describe, expect, it } from "vitest";

import {
  bloqueConocimientoParaPrompt,
  CONTEXTO_PRECALIFICACION,
  DATOS_CONCASA,
  detectarConsultaConCasa,
  esConsultaBreve,
  ETAPAS_OPERATIVAS_CONCASA,
  honorariosPublicables,
  respuestaDudaPermitida,
  responderConsultaConCasa,
  SEGUIMIENTO_SIN_INTEGRACION,
  type ConsultaConCasa,
  type ContextoConsulta,
} from "@/lib/conocimientoConCasa";

const CTX: ContextoConsulta = {
  momento: "captura",
  montoEstimadoTexto: "$90,000",
  datosGeneralesPendientes: 0,
  seguimiento: SEGUIMIENTO_SIN_INTEGRACION,
};

const TODAS: ConsultaConCasa[] = [
  "mi_cuenta_infonavit",
  "honorarios",
  "es_infonavit",
  "tramite_directo",
  "aprobado",
  "deposito",
  "acuse_entregado",
  "acuse",
  "firma",
  "biometricos",
  "notificacion_inscripcion",
  "citas",
  "avance",
  "despues_documentos",
  "documentos",
  "que_sigue",
  "proceso",
  "ubicacion",
  "horario_atencion",
  "telefono_contacto",
];

const MOMENTOS: ContextoConsulta["momento"][] = ["precalificacion", "previo", "captura", "datos_generales_completos"];

function todasLasRespuestas(): Array<[ConsultaConCasa, string]> {
  return TODAS.flatMap((id) =>
    MOMENTOS.map((momento) => [id, responderConsultaConCasa(id, { ...CTX, momento })] as [ConsultaConCasa, string]),
  );
}

describe("detección de preguntas frecuentes", () => {
  it.each<[string, ConsultaConCasa]>([
    ["¿Dónde están ubicados?", "ubicacion"],
    ["¿Tienen una oficina física?", "ubicacion"],
    ["¿Me puedes mandar la ubicación?", "ubicacion"],
    ["me pasas la ubicacion", "ubicacion"],
    ["¿Cómo llego?", "ubicacion"],
    ["¿Qué sigue después de entregar mis documentos?", "despues_documentos"],
    ["¿Dónde tengo que ir a biométricos?", "biometricos"],
    ["¿Qué significa Notificación?", "notificacion_inscripcion"],
    ["¿Qué pasa en Inscripción?", "notificacion_inscripcion"],
    ["¿Qué es el acuse de mi empresa?", "acuse"],
    ["¿Qué hago cuando mi empresa me entregue el acuse?", "acuse_entregado"],
    ["¿Cuándo se agenda la firma?", "firma"],
    ["¿Cuándo se depositan los recursos?", "deposito"],
    ["¿cuándo me cae el dinero?", "deposito"],
    ["¿Cómo puedo revisar mi avance?", "avance"],
    ["¿en qué etapa va mi trámite?", "avance"],
    ["¿Cuánto cobran por acompañarme?", "honorarios"],
    ["¿tiene algún costo?", "honorarios"],
    ["¿El servicio es de Infonavit?", "es_infonavit"],
    ["¿ustedes son de Infonavit?", "es_infonavit"],
    ["¿Puedo hacer el trámite directamente?", "tramite_directo"],
    ["¿Mi crédito ya está aprobado?", "aprobado"],
    ["¿ya me aprobaron?", "aprobado"],
    ["¿Cuándo es mi cita?", "citas"],
    ["¿Qué documentos necesito?", "documentos"],
    ["¿Qué sigue?", "que_sigue"],
    ["¿Cuál es el proceso?", "proceso"],
    ["¿Qué horario tienen?", "horario_atencion"],
    ["¿Tienen un teléfono de contacto?", "telefono_contacto"],
    ["¿Cómo creo mi cuenta Infonavit?", "mi_cuenta_infonavit"],
  ])("%s → %s", (texto, esperado) => {
    expect(detectarConsultaConCasa(texto)).toBe(esperado);
    expect(esConsultaBreve(texto)).toBe(true);
  });

  it.each([
    "Notificaciones del Norte SA",
    "Firma Legal y Asociados",
    "Centro",
    "Monterrey",
    "Av. Juárez 123",
    "te mando la ubicación",
    "Oficina 3",
    "Juan Carlos",
    "sí",
    "sí, ¿dónde están ubicados?",
    "mi correo es juan@example.com, ¿dónde están?",
    "Juan Carlos, ¿y cuánto cobran ustedes?",
  ])("'%s' no se contesta como pregunta frecuente sin Claude", (texto) => {
    expect(esConsultaBreve(texto)).toBe(false);
  });

  it("sin signos de interrogación también reconoce preguntas típicas de WhatsApp", () => {
    expect(esConsultaBreve("donde estan ubicados")).toBe(true);
    expect(esConsultaBreve("cuanto cobran")).toBe(true);
  });
});

describe("respuestas verificadas", () => {
  it("ubicación: dirección, referencia y enlace de Maps, sin horarios ni teléfonos", () => {
    const r = responderConsultaConCasa("ubicacion", CTX);
    expect(r).toContain("Mariano Escobedo 574, Centro, C.P. 64000, Monterrey, Nuevo León");
    expect(r).toContain("a una cuadra del CESI y de las oficinas de Infonavit");
    expect(r).toContain(DATOS_CONCASA.mapsUrl);
    expect(r).not.toMatch(/horario|lunes|\d{1,2}\s?(am|pm|hrs)/i);
  });

  it("el enlace de Maps solo va en la respuesta de ubicación", () => {
    for (const [id, r] of todasLasRespuestas()) {
      if (id !== "ubicacion") expect(r, id).not.toContain(DATOS_CONCASA.mapsUrl);
    }
  });

  it("honorarios: trámite oficial gratuito, se puede hacer directo y sin porcentaje ni importe", () => {
    const r = responderConsultaConCasa("honorarios", CTX);
    expect(r).toContain("Los trámites ante Infonavit son gratuitos");
    expect(r).toContain("directamente con Infonavit");
    expect(r).toContain("no es un cobro de Infonavit ni un requisito para obtener tu crédito");
    expect(r).toContain("por escrito");
    expect(r).not.toMatch(/18|%|\$/);
  });

  it("el porcentaje solo es publicable con política validada y base de cálculo definida", () => {
    expect(honorariosPublicables()).toBe(false);
    expect(honorariosPublicables({ validado: true, baseDeCalculo: null })).toBe(false);
    expect(honorariosPublicables({ validado: false, baseDeCalculo: "el importe dispuesto" })).toBe(false);
    expect(honorariosPublicables({ validado: true, baseDeCalculo: "el importe dispuesto" })).toBe(true);
  });

  it("¿ya está aprobado?: distingue importe estimado, crédito aprobado e importe recibido", () => {
    const r = responderConsultaConCasa("aprobado", CTX);
    expect(r).toMatch(/^Todavía no/);
    expect(r).toContain("importe neto estimado de $90,000, sujeto a validación");
    expect(r).toContain("no es un crédito aprobado");
    expect(r).toContain("ConCasa no autoriza ni entrega los recursos");
  });

  it("depósitos, firma y citas: sin fechas ni confirmaciones", () => {
    expect(responderConsultaConCasa("deposito", CTX)).toContain("No puedo darte una fecha ni confirmar depósitos");
    expect(responderConsultaConCasa("firma", CTX)).toContain("no puedo consultar ni confirmar citas");
    expect(responderConsultaConCasa("citas", CTX)).toContain("no puedo consultar ni confirmar citas");
    expect(responderConsultaConCasa("biometricos", CTX)).toContain("La sede exacta se confirma");
  });

  it("acuse: explica qué es y qué hacer, sin pedirlo por este chat", () => {
    expect(responderConsultaConCasa("acuse", CTX)).toContain("confirmación que entrega tu empresa");
    const entregado = responderConsultaConCasa("acuse_entregado", CTX);
    expect(entregado).toContain("necesita recibirlo y validarlo para coordinar tu cita de firma");
    expect(entregado).toContain("no lo envíes por aquí");
  });

  it("servicio privado: ConCasa no es Infonavit y el trámite puede hacerse directo", () => {
    expect(responderConsultaConCasa("es_infonavit", CTX)).toMatch(/^No\. ConCasa es un servicio privado/);
    expect(responderConsultaConCasa("tramite_directo", CTX)).toMatch(/^Sí\. Puedes realizar tu trámite directamente/);
  });

  it("avance sin integración: describe solo lo que consta en este chat", () => {
    const completo = responderConsultaConCasa("avance", {
      ...CTX,
      momento: "datos_generales_completos",
      datosGeneralesPendientes: 2,
    });
    expect(completo).toContain("ya quedaron registrados tus Datos Generales, con algunos datos pendientes");
    expect(completo).toContain("Tus documentos aún no se han recibido ni revisado");
    expect(completo).toContain("no está conectado al expediente de ConCasa");
    expect(responderConsultaConCasa("avance", CTX)).toContain("vamos en la captura de tus Datos Generales");
  });

  it("avance con estado del CRM (integración futura): informa la etapa reportada", () => {
    const r = responderConsultaConCasa("avance", {
      ...CTX,
      seguimiento: { fuente: "concasa_crm", etapa: "biometricos", actualizadoAt: "2026-10-15T12:00:00.000Z" },
    });
    expect(r).toContain("Según tu expediente en ConCasa, tu trámite está en: Primera cita presencial para biométricos");
    expect(r).not.toContain("no está conectado");
  });

  it("proceso: las 9 etapas operativas con la aclaración de que el orden puede variar", () => {
    const r = responderConsultaConCasa("proceso", CTX);
    expect(ETAPAS_OPERATIVAS_CONCASA).toHaveLength(9);
    for (const etapa of ETAPAS_OPERATIVAS_CONCASA) expect(r).toContain(etapa.titulo);
    expect(r).toContain("no todos los expedientes siguen exactamente el mismo orden");
  });

  it("Mi Cuenta Infonavit: información general y nunca pide credenciales", () => {
    const r = responderConsultaConCasa("mi_cuenta_infonavit", CTX);
    expect(r).toContain("se habilita cuando tus documentos obligatorios estén completos y revisados");
    expect(r).toContain("Nunca compartas tu contraseña ni códigos SMS o de verificación");
  });

  it("horario y teléfono: no inventa datos de atención", () => {
    expect(responderConsultaConCasa("horario_atencion", CTX)).toContain("no tengo confirmado el horario");
    expect(responderConsultaConCasa("telefono_contacto", CTX)).toContain("No tengo otro teléfono confirmado");
  });

  it("ninguna respuesta de la base viola la salvaguarda ni promete resultados", () => {
    for (const [id, r] of todasLasRespuestas()) {
      expect(respuestaDudaPermitida(r), id).toBe(true);
      expect(r, id).not.toMatch(/te llamar|asesor se (pondrá|comunicará)|te contactará|garantizamos|te garantiz/i);
    }
  });
});

describe("respuestas durante la precalificación", () => {
  it("la ubicación y las etapas operativas son las mismas que en el trámite", () => {
    for (const id of ["ubicacion", "biometricos", "notificacion_inscripcion", "firma", "tramite_directo"] as const) {
      expect(responderConsultaConCasa(id, CONTEXTO_PRECALIFICACION), id).toBe(responderConsultaConCasa(id, CTX));
    }
  });

  it("no menciona importes, Datos Generales capturados ni expediente en curso", () => {
    const aprobado = responderConsultaConCasa("aprobado", CONTEXTO_PRECALIFICACION);
    expect(aprobado).toContain("Primero hacemos tu precalificación");
    expect(aprobado).not.toMatch(/\$\d/);
    expect(responderConsultaConCasa("avance", CONTEXTO_PRECALIFICACION)).toContain("precalificación inicial");
    expect(responderConsultaConCasa("que_sigue", CONTEXTO_PRECALIFICACION)).toContain(
      "Primero terminamos tu precalificación",
    );
  });

  it.each(["Ya tengo mi cuenta Infonavit", "Ya me dieron cita de biométricos", "ya estoy en notificación"])(
    "una afirmación sin signos (%s) no se trata como pregunta breve",
    (texto) => {
      expect(esConsultaBreve(texto)).toBe(false);
    },
  );
});

describe("salvaguarda para respuestas de Claude", () => {
  it.each([
    "Atendemos de lunes a viernes de 9 a 6.",
    "Abrimos a las 9 am.",
    "Llámanos al 81 1234 5678.",
    "Más información en https://concasa.mx",
    "Consulta infonavit.org.mx para más detalles.",
    "Nuestros honorarios son del 18% del crédito.",
    "Tu crédito ya está aprobado.",
    "Ya te depositaron los recursos.",
    "Tu cita está confirmada para el lunes.",
    "Ya recibimos tus documentos.",
    "Compárteme tu contraseña de Mi Cuenta Infonavit.",
    "Mándame el código que te llegó por SMS.",
  ])("descarta: %s", (texto) => {
    expect(respuestaDudaPermitida(texto)).toBe(false);
  });

  it.each([
    `Nuestra oficina está en Mariano Escobedo 574. Ubicación: ${DATOS_CONCASA.mapsUrl}`,
    "Tu crédito no está aprobado todavía; es una estimación sujeta a validación.",
    "Nunca te vamos a pedir tu contraseña ni códigos de verificación.",
    "El pago mensual se confirma durante la validación del trámite.",
    "Tu importe neto estimado es de $152,100, sujeto a validación.",
  ])("permite: %s", (texto) => {
    expect(respuestaDudaPermitida(texto)).toBe(true);
  });
});

describe("bloque para el prompt de Claude", () => {
  it("separa datos, etapas, información oficial, reglas financieras, documentos y seguimiento", () => {
    const bloque = bloqueConocimientoParaPrompt();
    for (const seccion of [
      "DATOS DE CONCASA",
      "ETAPAS OPERATIVAS DE CONCASA (internas, no son procedimientos oficiales de Infonavit)",
      "INFORMACIÓN OFICIAL DE INFONAVIT",
      "REGLAS FINANCIERAS",
      "REQUISITOS DOCUMENTALES",
      "SEGUIMIENTO",
      "MI CUENTA INFONAVIT",
    ]) {
      expect(bloque).toContain(seccion);
    }
    expect(bloque).toContain(DATOS_CONCASA.mapsUrl);
    expect(bloque).toContain("Los trámites ante Infonavit son gratuitos.");
    expect(bloque).toContain("No menciones porcentajes ni importes de honorarios");
    expect(bloque).not.toMatch(/18\s?%/);
  });
});

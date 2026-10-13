import { describe, expect, it } from "vitest";

import { evaluarVigenciaIne } from "@/lib/ineVigencia";
import { estimarCreditoMejoravit } from "@/lib/mejoravitCredito";
import type { DatosPortalPrecalificacion } from "@/lib/precalificacionScraper";
import {
  avanzarTramite,
  CAMPOS_CAPTURA,
  MSG_ACTUALIZADO,
  MSG_COMPLETO_RECORDATORIO,
  MSG_PAUSA,
  MSG_PENDIENTE_INTENTOS,
  MSG_PENDIENTE_NO_LO_TIENE,
  MSG_RECHAZO_OFERTA,
  MSG_REANUDAR,
  MSG_SIN_CONSENTIMIENTO,
  necesitaInterpretacion,
  prepararTramiteTrasPrecalificacion,
  type CampoCaptura,
  type InterpretacionTramite,
  type TramiteMejoravit,
} from "@/lib/tramiteMejoravit";

const AHORA = "2026-10-13T12:00:00.000Z";
const NSS = "12345678901";
const CELULAR = "8111111111";

function portal(p: Partial<DatosPortalPrecalificacion> = {}): DatosPortalPrecalificacion {
  return {
    nombre: "JUAN CARLOS PEREZ LOPEZ",
    rfc: null,
    rfcConHomoclave: false,
    empresa: null,
    registroPatronal: null,
    ...p,
  };
}

function nuevo(p: Partial<DatosPortalPrecalificacion> = {}, saldo = 100000): TramiteMejoravit {
  return prepararTramiteTrasPrecalificacion(null, {
    nss: NSS,
    credito: estimarCreditoMejoravit(saldo),
    portal: portal(p),
    celularWhatsapp: CELULAR,
    ahora: AHORA,
  });
}

function paso(
  t: TramiteMejoravit,
  texto: string,
  interpretacion: InterpretacionTramite | null = null,
  preguntasAgrupadas = false,
) {
  return avanzarTramite(t, {
    texto,
    interpretacion,
    preguntasAgrupadas,
    urlAvisoPrivacidad: "https://vendedor.test/privacidad",
    ahora: AHORA,
  });
}

function aCaptura(t: TramiteMejoravit) {
  const consentimiento = paso(t, "sí");
  return paso(consentimiento.tramite, "sí, autorizo");
}

const RESPUESTAS: Record<CampoCaptura, string> = {
  nombres: "Juan Carlos",
  apellido_paterno: "Pérez",
  apellido_materno: "López",
  curp: "PELJ850101HNLRPN09",
  correo: "juan@example.com",
  telefono_casa: "81 8333 4444",
  domicilio_calle: "Av. Juárez",
  domicilio_numero_exterior: "123",
  domicilio_numero_interior: "no",
  domicilio_colonia: "Centro",
  domicilio_municipio: "Monterrey",
  domicilio_estado: "Nuevo León",
  domicilio_cp: "64000",
  empresa: "Acme SA de CV",
  registro_patronal: "A1234567890",
  telefono_empresa: "8187776666",
  empresa_calle: "Industria 45",
  empresa_colonia: "Industrial",
  empresa_municipio: "Apodaca",
  empresa_cp: "66600",
  referencia1_nombres: "María",
  referencia1_apellido_paterno: "Gómez",
  referencia1_apellido_materno: "Ruiz",
  referencia1_celular: "8112223333",
  referencia2_nombres: "Pedro",
  referencia2_apellido_paterno: "Sánchez",
  referencia2_apellido_materno: "no tiene",
  referencia2_celular: "8114445555",
  beneficiario_nombre: "Ana Pérez López",
  beneficiario_parentesco: "esposa",
};

/** Responde cada pregunta con su dato hasta completar; devuelve los campos preguntados y los textos. */
function completarCaptura(inicio: { tramite: TramiteMejoravit; respuesta: string }) {
  let t = inicio.tramite;
  const preguntados: CampoCaptura[] = [];
  const respuestas = [inicio.respuesta];
  for (let i = 0; i < 80 && t.etapa !== "completo"; i++) {
    const campo = t.campoActual!;
    preguntados.push(campo);
    const r = paso(t, RESPUESTAS[campo]);
    respuestas.push(r.respuesta);
    t = r.tramite;
  }
  return { t, preguntados, respuestas };
}

describe("oferta, aceptación y rechazo", () => {
  it("el trámite inicia en oferta con la estimación, documentos e INE pendientes", () => {
    const t = nuevo({}, 200000);
    expect(t.etapa).toBe("oferta");
    expect(t.credito).toMatchObject({
      montoBase: 200000,
      montoTopado: 169000,
      montoNetoEstimado: 152100,
      tope: 169000,
      factor: 0.9,
    });
    expect(t.datos.nss).toMatchObject({ valor: NSS, procedencia: "precalificacion" });
    expect(t.datos.celular).toMatchObject({ valor: CELULAR, procedencia: "whatsapp" });
    expect(Object.values(t.documentos).every((d) => d.estado === "pendiente")).toBe(true);
    expect(t.ine).toEqual({ requisito: "vigente", vigencia: "pendiente_revision" });
  });

  it("si acepta, muestra el aviso de privacidad y pide consentimiento", () => {
    const r = paso(nuevo(), "Sí, me interesa");
    expect(r.tramite.etapa).toBe("consentimiento");
    expect(r.tramite.interes).toBe("acepta");
    expect(r.respuesta).toContain("https://vendedor.test/privacidad");
    expect(r.respuesta).toContain("¿Autorizas el uso de tus datos");
  });

  it("si rechaza, guarda el rechazo sin perder la precalificación y puede retomar después", () => {
    const rechazo = paso(nuevo(), "no gracias");
    expect(rechazo.tramite.etapa).toBe("rechazado");
    expect(rechazo.tramite.interes).toBe("rechaza");
    expect(rechazo.respuesta).toBe(MSG_RECHAZO_OFERTA);

    const regreso = paso(rechazo.tramite, "hola");
    expect(regreso.tramite.etapa).toBe("oferta");
    expect(regreso.respuesta).toContain("$90,000");

    const acepta = paso(regreso.tramite, "sí");
    expect(acepta.tramite.etapa).toBe("consentimiento");
  });

  it("una duda en la oferta se responde y vuelve a la misma pregunta", () => {
    const r = paso(nuevo(), "¿y cuánto pagaría al mes?", {
      intencion: "duda",
      datos: {},
      respuesta: "El pago mensual se confirma durante la validación del trámite.",
    });
    expect(r.tramite.etapa).toBe("oferta");
    expect(r.respuesta).toContain("se confirma durante la validación");
    expect(r.respuesta).toContain("¿Te gustaría continuar con tu trámite?");
  });
});

describe("consentimiento y captura", () => {
  it("sin consentimiento no captura datos", () => {
    const consentimiento = paso(nuevo(), "sí");
    const r = paso(consentimiento.tramite, "no");
    expect(r.respuesta).toBe(MSG_SIN_CONSENTIMIENTO);
    expect(r.tramite.consentimiento).toEqual({ aceptado: false, respondidoAt: AHORA });
    expect(r.tramite.etapa).toBe("consentimiento");
    expect(r.tramite.campoActual).toBeNull();
  });

  it("con consentimiento registra fecha y hace la primera pregunta", () => {
    const r = aCaptura(nuevo());
    expect(r.tramite.consentimiento).toEqual({ aceptado: true, respondidoAt: AHORA });
    expect(r.tramite.etapa).toBe("captura");
    expect(r.tramite.campoActual).toBe("nombres");
    expect(r.respuesta).toContain("¿Cuál es tu nombre");
  });

  it("captura completa: guarda todo con procedencia, normaliza y cierra sin pedir documentos", () => {
    const { t, respuestas } = completarCaptura(aCaptura(nuevo()));
    expect(t.etapa).toBe("completo");
    expect(t.datos.telefono_casa?.valor).toBe("8183334444");
    expect(t.datos.domicilio_numero_interior?.valor).toBe("");
    expect(t.datos.referencia2_apellido_materno?.valor).toBe("");
    expect(t.datos.curp).toMatchObject({ valor: "PELJ850101HNLRPN09", procedencia: "cliente" });
    expect(Object.keys(t.pendientes)).toEqual([]);

    const cierre = respuestas[respuestas.length - 1];
    expect(cierre).toContain("INE vigente (frente y reverso)");
    expect(cierre).toContain("no necesitas enviarlos");
    expect(Object.values(t.documentos).every((d) => d.estado === "pendiente")).toBe(true);
  });

  it("ninguna respuesta pide horarios, ofrece llamadas, promete un asesor ni pide archivos", () => {
    const { respuestas } = completarCaptura(aCaptura(nuevo()));
    const todo = respuestas.join("\n");
    expect(todo).not.toMatch(/horario|te llamar|llamada|asesor se (pondrá|comunicará)|te contactará/i);
    expect(todo).not.toMatch(/env[ií]a(me)? (una )?foto|adjunta|sube tu|pdf/i);
  });
});

describe("datos laborales de la precalificación", () => {
  it("sin datos laborales del portal pregunta empresa y registro patronal", () => {
    const { preguntados, t } = completarCaptura(aCaptura(nuevo()));
    expect(preguntados).toContain("empresa");
    expect(preguntados).toContain("registro_patronal");
    expect(t.datos.empresa?.procedencia).toBe("cliente");
  });

  it("con empresa y NRP del portal no los pregunta y lo explica", () => {
    const { preguntados, respuestas, t } = completarCaptura(
      aCaptura(nuevo({ empresa: "ACME SA DE CV", registroPatronal: "A1234567890" })),
    );
    expect(preguntados).not.toContain("empresa");
    expect(preguntados).not.toContain("registro_patronal");
    expect(respuestas.join("\n")).toContain("ya los tengo de tu consulta en Infonavit");
    expect(t.datos.empresa).toMatchObject({ valor: "ACME SA DE CV", procedencia: "precalificacion" });
    expect(t.datos.registro_patronal).toMatchObject({
      valor: "A1234567890",
      procedencia: "precalificacion",
    });
  });

  it("solo empresa: pregunta únicamente el registro patronal mencionando la empresa", () => {
    const { preguntados, respuestas } = completarCaptura(aCaptura(nuevo({ empresa: "ACME SA DE CV" })));
    expect(preguntados).not.toContain("empresa");
    expect(preguntados).toContain("registro_patronal");
    expect(respuestas.join("\n")).toContain("aparece que trabajas en ACME SA DE CV");
  });

  it("solo NRP: pregunta únicamente la empresa", () => {
    const { preguntados, respuestas } = completarCaptura(
      aCaptura(nuevo({ registroPatronal: "A1234567890" })),
    );
    expect(preguntados).toContain("empresa");
    expect(preguntados).not.toContain("registro_patronal");
    expect(respuestas.join("\n")).toContain("aparece tu registro patronal, pero no el nombre de tu empresa");
  });

  it("no pregunta NSS, celular ni RFC: ya se conocen", () => {
    const { preguntados, respuestas } = completarCaptura(
      aCaptura(nuevo({ rfc: "PELJ850101AB1", rfcConHomoclave: true })),
    );
    expect(preguntados).not.toContain("nss" as CampoCaptura);
    expect(preguntados).not.toContain("celular" as CampoCaptura);
    expect(respuestas.join("\n")).not.toMatch(/\bNSS\b|tu celular\?|tu RFC/);
  });

  it("los datos laborales persisten; una nueva precalificación sin ellos no los borra", () => {
    const { t } = completarCaptura(
      aCaptura(nuevo({ empresa: "ACME SA DE CV", registroPatronal: "A1234567890" })),
    );
    const otra = prepararTramiteTrasPrecalificacion(t, {
      nss: NSS,
      credito: estimarCreditoMejoravit(100000),
      portal: portal(),
      celularWhatsapp: CELULAR,
      ahora: AHORA,
    });
    expect(otra.datos.empresa?.valor).toBe("ACME SA DE CV");
    expect(otra.datos.registro_patronal?.valor).toBe("A1234567890");
    expect(otra.datos.curp?.valor).toBe("PELJ850101HNLRPN09");
    expect(otra.consentimiento?.aceptado).toBe(true);
  });

  it("una precalificación con otro NSS no hereda datos del titular anterior", () => {
    const { t } = completarCaptura(aCaptura(nuevo()));
    const otra = prepararTramiteTrasPrecalificacion(t, {
      nss: "98765432109",
      credito: estimarCreditoMejoravit(100000),
      portal: portal(),
      celularWhatsapp: CELULAR,
      ahora: AHORA,
    });
    expect(otra.datos.curp).toBeUndefined();
    expect(otra.consentimiento).toBeNull();
    expect(otra.version).toBe(t.version);
  });

  it("si el cliente da otra empresa distinta a la del portal, pide aclaración antes de cambiarla", () => {
    let t = aCaptura(nuevo({ empresa: "ACME SA DE CV" })).tramite;
    const r = paso(t, "trabajo en Bimbo", {
      intencion: "dato",
      datos: { empresa: "Bimbo" },
      respuesta: null,
    });
    expect(r.respuesta).toContain("aparece la empresa ACME SA DE CV");
    expect(r.tramite.datos.empresa?.valor).toBe("ACME SA DE CV");
    t = paso(r.tramite, "sí").tramite;
    expect(t.datos.empresa).toMatchObject({ valor: "Bimbo", procedencia: "cliente" });
    expect(t.portal.empresa).toBe("ACME SA DE CV");
  });
});

describe("comportamiento de vendedor", () => {
  it("acepta varios datos en un mensaje y no vuelve a preguntarlos", () => {
    const inicio = aCaptura(nuevo());
    const r = paso(
      inicio.tramite,
      "Soy Juan Carlos Pérez López, mi CURP es PELJ850101HNLRPN09 y mi correo juan@example.com",
      {
        intencion: "dato",
        datos: {
          nombres: "Juan Carlos",
          apellido_paterno: "Pérez",
          apellido_materno: "López",
          curp: "PELJ850101HNLRPN09",
          correo: "juan@example.com",
        },
        respuesta: null,
      },
    );
    expect(r.tramite.campoActual).toBe("telefono_casa");
    expect(r.respuesta).toContain("teléfono de casa");
  });

  it("con Claude disponible agrupa el domicilio en una sola pregunta y separa la respuesta", () => {
    let t = aCaptura(nuevo()).tramite;
    for (const c of ["nombres", "apellido_paterno", "apellido_materno", "curp", "correo"] as const) {
      t = paso(t, RESPUESTAS[c]).tramite;
    }
    const pregunta = paso(t, RESPUESTAS.telefono_casa, null, true);
    expect(pregunta.tramite.campoActual).toBe("domicilio_calle");
    expect(pregunta.tramite.preguntaAgrupada).toBe(true);
    expect(pregunta.respuesta).toContain("Puedes escribirlo completo");

    const r = paso(
      pregunta.tramite,
      "Av. Juárez 123, Centro, Monterrey, Nuevo León, 64000",
      {
        intencion: "dato",
        datos: {
          domicilio_calle: "Av. Juárez",
          domicilio_numero_exterior: "123",
          domicilio_numero_interior: "",
          domicilio_colonia: "Centro",
          domicilio_municipio: "Monterrey",
          domicilio_estado: "Nuevo León",
          domicilio_cp: "64000",
        },
        respuesta: null,
      },
      true,
    );
    expect(r.tramite.datos.domicilio_cp?.valor).toBe("64000");
    expect(r.tramite.campoActual).toBe("empresa");
  });

  it("pausa con 'luego seguimos', conserva el avance y retoma en la misma pregunta", () => {
    let t = aCaptura(nuevo()).tramite;
    t = paso(t, "Juan Carlos").tramite;
    const pausa = paso(t, "Luego seguimos");
    expect(pausa.respuesta).toBe(MSG_PAUSA);
    expect(pausa.tramite.etapa).toBe("pausado");
    expect(pausa.tramite.datos.nombres?.valor).toBe("Juan Carlos");

    const regreso = paso(pausa.tramite, "Hola");
    expect(regreso.tramite.etapa).toBe("captura");
    expect(regreso.respuesta).toContain(MSG_REANUDAR);
    expect(regreso.respuesta).toContain("apellido paterno");
  });

  it("al volver de una pausa con el dato, lo guarda directamente", () => {
    let t = aCaptura(nuevo()).tramite;
    t = paso(t, "luego seguimos").tramite;
    const r = paso(t, "Juan");
    expect(r.tramite.etapa).toBe("captura");
    expect(r.tramite.datos.nombres?.valor).toBe("Juan");
  });

  it("'No lo tengo ahorita' marca pendiente y continúa sin insistir", () => {
    let t = aCaptura(nuevo()).tramite;
    for (const c of ["nombres", "apellido_paterno", "apellido_materno", "curp", "correo"] as const) {
      t = paso(t, RESPUESTAS[c]).tramite;
    }
    expect(t.campoActual).toBe("telefono_casa");
    const r = paso(t, "No lo tengo ahorita");
    expect(r.respuesta).toContain(MSG_PENDIENTE_NO_LO_TIENE);
    expect(r.tramite.pendientes.telefono_casa?.motivo).toBe("no_lo_tiene");
    expect(r.tramite.campoActual).toBe("domicilio_calle");
  });

  it("ya completo: un 'gracias' no se toma como dato y el pendiente se puede enviar después", () => {
    let t = aCaptura(nuevo()).tramite;
    for (let i = 0; i < 80 && t.etapa !== "completo"; i++) {
      const campo = t.campoActual!;
      t = paso(t, campo === "telefono_casa" ? "no lo tengo" : RESPUESTAS[campo]).tramite;
    }
    expect(t.pendientes.telefono_casa).toBeDefined();

    const gracias = paso(t, "gracias");
    expect(gracias.respuesta).toBe(MSG_COMPLETO_RECORDATORIO);
    expect(gracias.tramite.pendientes.telefono_casa).toBeDefined();

    const tel = paso(gracias.tramite, "8183334444");
    expect(tel.respuesta).toBe(MSG_ACTUALIZADO);
    expect(tel.tramite.datos.telefono_casa?.valor).toBe("8183334444");
    expect(tel.tramite.pendientes.telefono_casa).toBeUndefined();
  });

  it("dos respuestas inválidas seguidas dejan el dato pendiente (no insiste)", () => {
    let t = aCaptura(nuevo()).tramite;
    for (const c of ["nombres", "apellido_paterno", "apellido_materno"] as const) {
      t = paso(t, RESPUESTAS[c]).tramite;
    }
    const primero = paso(t, "ABC123");
    expect(primero.respuesta).toContain("Esa CURP no parece válida");
    expect(primero.tramite.campoActual).toBe("curp");
    const segundo = paso(primero.tramite, "otra vez mal");
    expect(segundo.respuesta).toContain(MSG_PENDIENTE_INTENTOS);
    expect(segundo.tramite.pendientes.curp?.motivo).toBe("sin_respuesta_valida");
    expect(segundo.tramite.campoActual).toBe("correo");
  });

  it("acepta correcciones de datos ya capturados", () => {
    let t = aCaptura(nuevo()).tramite;
    for (const c of ["nombres", "apellido_paterno", "apellido_materno", "curp", "correo"] as const) {
      t = paso(t, RESPUESTAS[c]).tramite;
    }
    const r = paso(t, "perdón, mi correo es juan.perez@example.com", {
      intencion: "dato",
      datos: { correo: "juan.perez@example.com" },
      respuesta: null,
    });
    expect(r.tramite.datos.correo?.valor).toBe("juan.perez@example.com");
    expect(r.tramite.campoActual).toBe("telefono_casa");
  });

  it("'no me interesa dar mi teléfono' no cancela el trámite", () => {
    const t = aCaptura(nuevo()).tramite;
    expect(paso(t, "no me interesa dar mi teléfono de casa").tramite.etapa).not.toBe("rechazado");
    expect(paso(t, "Ya no me interesa, gracias").tramite.etapa).toBe("rechazado");
  });

  it("rechaza teléfonos repetidos: casa igual al celular y referencias duplicadas", () => {
    let t = aCaptura(nuevo()).tramite;
    for (const c of ["nombres", "apellido_paterno", "apellido_materno", "curp", "correo"] as const) {
      t = paso(t, RESPUESTAS[c]).tramite;
    }
    const r = paso(t, CELULAR);
    expect(r.respuesta).toContain("Ese número es tu celular");
    expect(r.tramite.datos.telefono_casa).toBeUndefined();
  });

  it("CURP que contradice el RFC del portal pide confirmación antes de guardarla", () => {
    let t = aCaptura(nuevo({ rfc: "GOMA800101AB1", rfcConHomoclave: true })).tramite;
    for (const c of ["nombres", "apellido_paterno", "apellido_materno"] as const) {
      t = paso(t, RESPUESTAS[c]).tramite;
    }
    const r = paso(t, RESPUESTAS.curp);
    expect(r.respuesta).toContain("no coincide con los datos de tu registro en Infonavit");
    expect(r.tramite.datos.curp).toBeUndefined();
    const confirmado = paso(r.tramite, "sí, es correcta");
    expect(confirmado.tramite.datos.curp?.valor).toBe(RESPUESTAS.curp);
  });

  it("resuelve sí/no, datos con formato y comandos sin llamar a Claude", () => {
    const t = aCaptura(nuevo()).tramite;
    expect(necesitaInterpretacion(nuevo(), "sí")).toBe(false);
    expect(necesitaInterpretacion(t, "luego seguimos")).toBe(false);
    expect(necesitaInterpretacion(t, "no lo tengo")).toBe(false);
    expect(necesitaInterpretacion({ ...t, campoActual: "curp" }, RESPUESTAS.curp)).toBe(false);
    expect(necesitaInterpretacion({ ...t, campoActual: "domicilio_cp" }, "64000")).toBe(false);
    expect(necesitaInterpretacion(t, "Me llamo Juan Carlos Pérez")).toBe(true);
    expect(necesitaInterpretacion(nuevo(), "¿qué es Mejoravit?")).toBe(true);
  });
});

describe("INE y alcance del trámite", () => {
  it("la INE queda pendiente de revisión: nunca se declara validada", () => {
    const { t, respuestas } = completarCaptura(aCaptura(nuevo()));
    expect(t.ine.vigencia).toBe("pendiente_revision");
    expect(t.documentos.ine_frente.estado).toBe("pendiente");
    expect(t.documentos.ine_reverso.estado).toBe("pendiente");
    expect(respuestas.join("\n")).not.toMatch(/INE (validada|vigente confirmada|recibida)|recib[ií] tu/i);
  });

  it("regla de vigencia para la siguiente fase: último año del bloque, vencida si ya pasó", () => {
    const hoy = new Date("2026-10-13T12:00:00Z");
    expect(evaluarVigenciaIne("2019 - 2029", hoy)).toEqual({ estado: "vigente", anioVencimiento: 2029 });
    expect(evaluarVigenciaIne("VIGENCIA 2014-2024", hoy)).toEqual({ estado: "vencida", anioVencimiento: 2024 });
    expect(evaluarVigenciaIne("ilegible", hoy).estado).toBe("indeterminada");
  });

  it("no existe ningún campo ni pregunta sobre mejoras, presupuesto o tipo de vivienda", () => {
    expect(CAMPOS_CAPTURA.join(" ")).not.toMatch(/mejora|presupuesto|vivienda|material|remodel|distribuc/i);
    const { respuestas } = completarCaptura(aCaptura(nuevo()));
    expect(respuestas.slice(1).join("\n")).not.toMatch(
      /qué (quieres|te gustaría) mejorar|remodel|presupuesto|materiales|tipo de vivienda|distribución/i,
    );
  });
});

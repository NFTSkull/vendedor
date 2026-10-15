import { normalizarTexto } from "@/lib/normalizeText";

/**
 * Base de conocimientos de ConCasa para el trámite Mejoravit. Única fuente para las
 * respuestas locales y para el prompt de Claude del trámite; no se usa en Compra de
 * Casa ni en Generadores. Módulo puro: sin Supabase, sin Claude y sin reloj.
 */

// ---------------------------------------------------------------------------
// Datos comerciales de ConCasa
// ---------------------------------------------------------------------------

export const DATOS_CONCASA = {
  nombreComercial: "ConCasa",
  oficina: {
    calle: "Mariano Escobedo 574",
    colonia: "Centro",
    cp: "64000",
    municipio: "Monterrey",
    estado: "Nuevo León",
    pais: "México",
  },
  referencia: "a una cuadra del CESI y de las oficinas de Infonavit en el centro de Monterrey",
  mapsUrl: "https://maps.app.goo.gl/dwKfVX3hWdjEEyM46",
  /** Sin confirmar: no se comparten ni se inventan. */
  horarioAtencion: null,
  telefonosAdicionales: null,
} as const;

const OFICINA = DATOS_CONCASA.oficina;
export const DIRECCION_OFICINA = `${OFICINA.calle}, ${OFICINA.colonia}, C.P. ${OFICINA.cp}, ${OFICINA.municipio}, ${OFICINA.estado}`;

// ---------------------------------------------------------------------------
// Etapas operativas de ConCasa (internas; no son procedimientos oficiales de Infonavit)
// ---------------------------------------------------------------------------

export const ETAPAS_OPERATIVAS_CONCASA = [
  { id: "precalificacion", titulo: "Precalificación inicial" },
  { id: "datos_generales", titulo: "Captura de Datos Generales" },
  {
    id: "documentos",
    titulo: "Recepción y revisión de los documentos obligatorios, incluida la INE vigente",
  },
  { id: "expediente", titulo: "Preparación y revisión del expediente" },
  {
    id: "biometricos",
    titulo: "Primera cita presencial para biométricos (la sede exacta se confirma)",
  },
  {
    id: "notificacion_inscripcion",
    titulo: "Notificación e Inscripción, según el avance y los requisitos aplicables",
  },
  { id: "acuse_empleador", titulo: "Acuse o confirmación del empleador, cuando corresponda" },
  {
    id: "cita_firma",
    titulo: "Cita de firma, una vez recibido y validado el documento laboral necesario",
  },
  {
    id: "formalizacion",
    titulo:
      "Formalización y disposición de los recursos conforme a la autorización, el calendario y las condiciones de Infonavit",
  },
] as const;

export type EtapaOperativaId = (typeof ETAPAS_OPERATIVAS_CONCASA)[number]["id"];

export const AVISO_ETAPAS =
  "Es una guía general de ConCasa: no todos los expedientes siguen exactamente el mismo orden y no hay fechas garantizadas.";

// ---------------------------------------------------------------------------
// Información oficial de Infonavit (solo hechos generales verificados)
// ---------------------------------------------------------------------------

export const INFONAVIT_OFICIAL = {
  tramitesGratuitos: "Los trámites ante Infonavit son gratuitos.",
  tramiteDirecto: "Puedes realizar tu trámite directamente con Infonavit.",
  autorizacionYRecursos:
    "La autorización del crédito y la entrega de los recursos corresponden a Infonavit, conforme a sus condiciones y calendario.",
  portal: "Mi Cuenta Infonavit es el portal oficial de Infonavit.",
} as const;

// ---------------------------------------------------------------------------
// Reglas financieras
// ---------------------------------------------------------------------------

export const REGLAS_FINANCIERAS = {
  conceptos: {
    saldoSubcuenta: "saldo de la subcuenta de vivienda del cliente; no es un monto de crédito",
    montoEstimado: "importe neto estimado de la precalificación, sujeto a validación",
    creditoAprobado: "crédito autorizado por Infonavit; solo Infonavit lo autoriza",
    importeRecibido: "recursos efectivamente dispuestos por el cliente, conforme a Infonavit",
  },
  honorarios: {
    /** Propuesta comercial informada por ConCasa; servicio privado, no de Infonavit. */
    porcentajePropuesto: 18,
    /** Sin definir: no se calcula ningún importe después de honorarios. */
    baseDeCalculo: null as string | null,
    /** Licitud, contrato, alcance y forma de cobro validados. */
    validado: false,
  },
} as const;

/** El porcentaje solo se comunica cuando la política está validada y tiene base de cálculo. */
export function honorariosPublicables(
  honorarios: { validado: boolean; baseDeCalculo: string | null } = REGLAS_FINANCIERAS.honorarios,
): boolean {
  return honorarios.validado && Boolean(honorarios.baseDeCalculo);
}

// ---------------------------------------------------------------------------
// Requisitos documentales
// ---------------------------------------------------------------------------

export const REQUISITOS_DOCUMENTALES = [
  "INE vigente (frente y reverso)",
  "Comprobante de domicilio",
  "Estado de cuenta",
] as const;

// ---------------------------------------------------------------------------
// Mi Cuenta Infonavit (estructura; la guía aún no está habilitada)
// ---------------------------------------------------------------------------

export const MI_CUENTA_INFONAVIT = {
  guiaHabilitada: false,
  requisitoParaHabilitar: "documentos obligatorios completos y revisados",
  nuncaSolicitar: ["contraseñas", "códigos SMS", "códigos de verificación", "acceso a cuentas personales"],
} as const;

// ---------------------------------------------------------------------------
// Seguimiento del expediente (preparado para la integración con ConCasa CRM)
// ---------------------------------------------------------------------------

export type SeguimientoExpediente =
  | { fuente: "sin_integracion" }
  | { fuente: "concasa_crm"; etapa: EtapaOperativaId; actualizadoAt: string };

export const SEGUIMIENTO_SIN_INTEGRACION: SeguimientoExpediente = { fuente: "sin_integracion" };

// ---------------------------------------------------------------------------
// Preguntas frecuentes
// ---------------------------------------------------------------------------

/**
 * Momento dentro de este chat (no es la etapa del expediente en ConCasa).
 * `precalificacion`: aún no hay importe estimado; `previo`: oferta o consentimiento del trámite.
 */
export type MomentoTramite = "precalificacion" | "previo" | "captura" | "datos_generales_completos";

export type ContextoConsulta = {
  momento: MomentoTramite;
  /** null mientras no exista una precalificación aprobada. */
  montoEstimadoTexto: string | null;
  datosGeneralesPendientes: number;
  seguimiento: SeguimientoExpediente;
};

export const CONTEXTO_PRECALIFICACION: ContextoConsulta = {
  momento: "precalificacion",
  montoEstimadoTexto: null,
  datosGeneralesPendientes: 0,
  seguimiento: SEGUIMIENTO_SIN_INTEGRACION,
};

export type ConsultaConCasa =
  | "mi_cuenta_infonavit"
  | "honorarios"
  | "es_infonavit"
  | "tramite_directo"
  | "aprobado"
  | "deposito"
  | "acuse_entregado"
  | "acuse"
  | "firma"
  | "biometricos"
  | "notificacion_inscripcion"
  | "citas"
  | "avance"
  | "despues_documentos"
  | "documentos"
  | "que_sigue"
  | "proceso"
  | "ubicacion"
  | "horario_atencion"
  | "telefono_contacto";

export const MSG_SIN_INFORMACION_CONFIRMADA =
  "No tengo esa información confirmada por ahora, así que prefiero no darte un dato impreciso.";

const SIN_CONEXION_CRM =
  "Este chat todavía no está conectado al expediente de ConCasa, así que no puedo consultar etapas posteriores, citas ni depósitos.";
const SIN_CITAS = "Desde este chat todavía no puedo consultar ni confirmar citas.";

function listaDocumentos(): string {
  return REQUISITOS_DOCUMENTALES.map((d) => `• ${d}`).join("\n");
}

function respuestaHonorarios(): string {
  const h = REGLAS_FINANCIERAS.honorarios;
  const costo = honorariosPublicables(h)
    ? `La propuesta de honorarios de ConCasa es de ${h.porcentajePropuesto}% sobre ${h.baseDeCalculo}; el costo completo y sus condiciones deben constarte por escrito antes de contratar.`
    : "El costo completo y sus condiciones deben constarte por escrito antes de contratar; por ahora no lo tengo confirmado para compartírtelo por aquí.";
  return (
    `${INFONAVIT_OFICIAL.tramitesGratuitos} Puedes hacerlos directamente con Infonavit.\n` +
    "ConCasa ofrece un servicio privado de acompañamiento con honorarios propios: no es un cobro de Infonavit ni un requisito para obtener tu crédito.\n" +
    costo
  );
}

function respuestaAvance(ctx: ContextoConsulta): string {
  if (ctx.seguimiento.fuente === "concasa_crm") {
    const etapaId = ctx.seguimiento.etapa;
    const etapa = ETAPAS_OPERATIVAS_CONCASA.find((e) => e.id === etapaId);
    if (etapa) {
      return `Según tu expediente en ConCasa, tu trámite está en: ${etapa.titulo}. ${AVISO_ETAPAS}`;
    }
  }
  const local =
    ctx.momento === "precalificacion"
      ? "Por ahora estamos en tu precalificación inicial por este chat."
      : ctx.momento === "previo"
      ? "Tu trámite por este chat todavía no inicia la captura de tus Datos Generales."
      : ctx.momento === "captura"
        ? "En este chat vamos en la captura de tus Datos Generales."
        : `En este chat ya quedaron registrados tus Datos Generales${ctx.datosGeneralesPendientes ? ", con algunos datos pendientes" : ""}. Tus documentos aún no se han recibido ni revisado.`;
  return `${local}\n${SIN_CONEXION_CRM}`;
}

function respuestaQueSigue(ctx: ContextoConsulta): string {
  switch (ctx.momento) {
    case "precalificacion":
      return "Primero terminamos tu precalificación. Si calificas y decides continuar, capturamos tus Datos Generales por este chat y después revisamos tus documentos.";
    case "previo":
      return "Si decides continuar, el siguiente paso es capturar tus Datos Generales por este chat. Después siguen la recepción y revisión de tus documentos.";
    case "captura":
      return "Ahora estamos capturando tus Datos Generales. Al terminar siguen la recepción y revisión de tus documentos obligatorios, incluida tu INE vigente.";
    case "datos_generales_completos":
      return `El siguiente paso es la revisión de tus documentos obligatorios:\n${listaDocumentos()}\nTe los pediré por este mismo chat.`;
  }
}

const RESPUESTAS: Record<ConsultaConCasa, (ctx: ContextoConsulta) => string> = {
  mi_cuenta_infonavit: () =>
    `La guía para crear o recuperar tu Mi Cuenta Infonavit se habilita cuando tus documentos obligatorios estén completos y revisados. ${INFONAVIT_OFICIAL.portal}\n` +
    "Nunca compartas tu contraseña ni códigos SMS o de verificación por este chat; no te los vamos a pedir.",
  honorarios: respuestaHonorarios,
  es_infonavit: () =>
    "No. ConCasa es un servicio privado de acompañamiento; no es Infonavit ni un servicio oficial de Infonavit.\n" +
    `${INFONAVIT_OFICIAL.tramitesGratuitos} ${INFONAVIT_OFICIAL.autorizacionYRecursos}`,
  tramite_directo: () =>
    `Sí. ${INFONAVIT_OFICIAL.tramiteDirecto} ${INFONAVIT_OFICIAL.tramitesGratuitos}\n` +
    "El acompañamiento de ConCasa es un servicio privado y opcional para ayudarte a integrar tu expediente y darle seguimiento.",
  aprobado: (ctx) =>
    (ctx.montoEstimadoTexto
      ? `Todavía no. Lo que tienes es una precalificación con un importe neto estimado de ${ctx.montoEstimadoTexto}, sujeto a validación; no es un crédito aprobado ni el importe final que recibirías.\n`
      : "Todavía no. Primero hacemos tu precalificación para conocer tu importe neto estimado, que siempre está sujeto a validación y no es un crédito aprobado.\n") +
    "La autorización del crédito la emite Infonavit; ConCasa no autoriza ni entrega los recursos.",
  deposito: () =>
    `La disposición de los recursos ocurre después de la firma. ${INFONAVIT_OFICIAL.autorizacionYRecursos}\n` +
    "No puedo darte una fecha ni confirmar depósitos desde este chat, y ConCasa no entrega ni autoriza los recursos del crédito.",
  acuse_entregado: () =>
    "Consérvalo: ConCasa necesita recibirlo y validarlo para coordinar tu cita de firma. Por ahora este chat todavía no recibe documentos, así que no lo envíes por aquí.",
  acuse: () =>
    "Es la confirmación que entrega tu empresa cuando tu trámite lo requiere. Una vez que se recibe y se valida ese documento laboral, se coordina tu cita de firma.",
  firma: () =>
    `La cita de firma se coordina una vez que se recibe y valida el documento laboral necesario, como el acuse de tu empresa cuando corresponde. ${SIN_CITAS}`,
  biometricos: () =>
    "La primera cita presencial es para tus biométricos y se coordina después de preparar y revisar tu expediente. " +
    `La sede exacta se confirma al agendarla; puede ser nuestra oficina de ConCasa en ${OFICINA.calle}, ${OFICINA.colonia}, ${OFICINA.municipio}.`,
  notificacion_inscripcion: () =>
    "Notificación e Inscripción son etapas que se atienden después de los biométricos, según el avance de tu expediente y los requisitos que apliquen en tu caso. " +
    "Lo que implica cada una en tu trámite se confirma cuando tu expediente llegue a esa etapa.",
  citas: () =>
    `${SIN_CITAS} Las citas presenciales (biométricos y firma) se coordinan conforme avanza tu expediente.`,
  avance: respuestaAvance,
  despues_documentos: () =>
    "Después de recibir y revisar tus documentos (incluida tu INE vigente), se prepara y revisa tu expediente y se coordina tu primera cita presencial para biométricos. " +
    "Los pasos y tiempos pueden variar en cada caso.",
  documentos: () =>
    `Los documentos obligatorios son:\n${listaDocumentos()}\nPor ahora no necesitas enviarlos; más adelante te los pediré por este mismo chat.`,
  que_sigue: respuestaQueSigue,
  proceso: () =>
    `Así es el proceso con ConCasa:\n${ETAPAS_OPERATIVAS_CONCASA.map((e, i) => `${i + 1}. ${e.titulo}`).join("\n")}\n${AVISO_ETAPAS}`,
  ubicacion: () =>
    `Nuestra oficina de ConCasa está en ${DIRECCION_OFICINA}, ${DATOS_CONCASA.referencia}.\n` +
    `Ubicación en Google Maps: ${DATOS_CONCASA.mapsUrl}`,
  horario_atencion: () =>
    "Por ahora no tengo confirmado el horario de atención de la oficina, así que prefiero no darte uno inexacto. Puedes escribirnos por este chat.",
  telefono_contacto: () =>
    "Puedes escribirnos por este mismo WhatsApp. No tengo otro teléfono confirmado para compartirte.",
};

type Detector = { id: ConsultaConCasa; coincide: (n: string, crudo: string) => boolean };

const algun = (n: string, ...patrones: RegExp[]) => patrones.some((p) => p.test(n));

/** Orden de prioridad: la primera coincidencia gana (lo específico antes que lo general). */
const DETECTORES: ReadonlyArray<Detector> = [
  {
    id: "mi_cuenta_infonavit",
    coincide: (n) =>
      algun(
        n,
        /\bmi cuenta infonavit\b/,
        /\b(cuenta|usuario) (de|en|del) infonavit\b/,
        /\b(crear|abrir|recuperar|hacer|registrar) (mi |la |una )?cuenta\b/,
        /\bcontrasena\b/,
      ),
  },
  {
    id: "honorarios",
    coincide: (n) =>
      algun(
        n,
        /\bcuanto (me )?(cobran|cobrarian|cuesta|costaria)\b/,
        /\bcuanto (se )?quedan\b/,
        /\b(honorarios|comision|comisiones)\b/,
        /\b(tiene|hay|lleva|cobran) (algun )?(costo|cobro)\b/,
        /\b(cuesta|cobran) algo\b/,
        /\b(es|seria|sale) gratis\b/,
        /\bque porcentaje\b/,
        /^(y )?(ustedes )?cobran$/,
      ),
  },
  {
    id: "es_infonavit",
    coincide: (n) =>
      algun(
        n,
        /\b(son|es|eres|trabajan|trabajas) (de|del|parte de|para) (el )?infonavit\b/,
        /\bson (el )?infonavit\b/,
        /\b(es|son) (algo |un servicio |un tramite )?oficial(es)?\b/,
      ),
  },
  {
    id: "tramite_directo",
    coincide: (n) =>
      /\b(puedo|podria|se puede|es posible)\b/.test(n) &&
      /\b(directamente|directo|por mi cuenta|yo mism[oa]|sin ustedes|sin intermediari[oa]s?)\b/.test(n),
  },
  {
    id: "aprobado",
    coincide: (n, crudo) =>
      /\b(aprobad[oa]|autorizad[oa]|aprobaron|autorizaron)\b/.test(n) &&
      (crudo.includes("?") || /\b(ya|todavia|aun|mi credito)\b/.test(n)),
  },
  {
    id: "deposito",
    coincide: (n) =>
      /\bdeposit/.test(n) ||
      (/\b(dinero|recursos|lana)\b/.test(n) &&
        /\b(cuando|cuanto tiempo|que dia|en que fecha|ya (me )?(llego|cayo|dieron))\b/.test(n)),
  },
  {
    id: "acuse_entregado",
    coincide: (n) =>
      /\bacuse\b/.test(n) &&
      /\b(que hago|cuando (me|mi|la|lo)|ya (lo )?tengo|ya me (lo )?(dieron|entregaron)|a quien|donde lo|como lo|lo (mando|envio|entrego|llevo))\b/.test(n),
  },
  { id: "acuse", coincide: (n) => /\bacuse\b/.test(n) },
  { id: "firma", coincide: (n) => /\bfirm(a|o|amos|ar)\b/.test(n) },
  { id: "biometricos", coincide: (n) => /\b(biometric\w*|huellas)\b/.test(n) },
  {
    id: "notificacion_inscripcion",
    coincide: (n) => /\b(notificacion|inscripcion)\b/.test(n),
  },
  { id: "citas", coincide: (n) => /\b(cita|citas)\b/.test(n) },
  {
    id: "avance",
    coincide: (n) =>
      algun(
        n,
        /\bavance\b/,
        /\bseguimiento\b/,
        /\b(estatus|status)\b/,
        /\bestado de mi (tramite|solicitud|expediente|credito)\b/,
        /\ben que (etapa|paso|parte) (va|voy|esta|estoy|vamos|estamos)\b/,
        /\bcomo (va|van) (mi|el) (tramite|expediente|proceso|credito|solicitud)\b/,
      ),
  },
  {
    id: "despues_documentos",
    coincide: (n) => /\bdespues de (entregar|mandar|enviar|dar|llevar) (mis |los )?documentos\b/.test(n),
  },
  {
    id: "documentos",
    coincide: (n) =>
      algun(
        n,
        /\b(que|cuales) documentos\b/,
        /\bdocumentos (necesito|ocupo|piden|requiero|son|hay que)\b/,
        /\brequisitos\b/,
      ),
  },
  {
    id: "que_sigue",
    coincide: (n) =>
      algun(n, /^(y )?(ahora )?(que sigue|que mas sigue|cual es el siguiente paso|y despues que)$/),
  },
  {
    id: "proceso",
    coincide: (n) =>
      algun(
        n,
        /\b(cual|como) es el proceso\b/,
        /\b(que|cuales) son (los pasos|las etapas)\b/,
        /\bque (pasos|etapas) (son|siguen|hay)\b/,
        /^(y )?como funciona$/,
      ),
  },
  {
    id: "ubicacion",
    coincide: (n) =>
      algun(
        n,
        /\bdonde (estan|se encuentran) ubicad[oa]s\b/,
        /\bdonde (estan|se encuentran|quedan)( ustedes)?$/,
        /\bdonde (esta|queda|estan|quedan) (la |su |sus )?oficinas?\b/,
        /\b(tienen|cuentan con|hay) (una |alguna )?oficinas?\b/,
        /\boficinas? fisicas?\b/,
        /\b(mandas|mandarias|mandame|me pasas|pasame|me compartes|compartes|enviame|me das|me envias)( la| su)? ubicacion\b/,
        /\b(puedes|podrias) (mandar|enviar|pasar|compartir)(me)?( la| su)? ubicacion\b/,
        /\bubicacion de (ustedes|la oficina|su oficina|concasa)\b/,
        /\bcual es (su|la) ubicacion\b/,
        /^(y )?(la |su )?ubicacion$/,
        /\bdireccion de (ustedes|la oficina|su oficina|concasa)\b/,
        /\bcomo (llego|llegar|los encuentro)\b/,
      ),
  },
  {
    id: "horario_atencion",
    coincide: (n) =>
      algun(
        n,
        /\b(que|cual es (el|su)) horario\b/,
        /\bhorarios? de (atencion|oficina)\b/,
        /\ba que hora (abren|cierran|atienden)\b/,
        /\b(que dias|cuando) (abren|atienden)\b/,
        /\b(abren|atienden) (los )?(sabados|domingos|fines de semana)\b/,
      ),
  },
  {
    id: "telefono_contacto",
    coincide: (n) =>
      algun(
        n,
        /\b(telefono|numero) (de contacto|de (la |su )?oficina|de ustedes|para (llamar|marcar)(les)?)\b/,
        /\b(tienen|hay) (un |algun |otro )?telefono\b/,
        /\b(les|los) puedo (llamar|marcar)\b/,
      ),
  },
];

function normalizarConsulta(texto: string): string {
  return normalizarTexto(texto)
    .replace(/[^a-z0-9ñ ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Identifica una pregunta frecuente sobre ConCasa, el proceso o el seguimiento. */
export function detectarConsultaConCasa(texto: string): ConsultaConCasa | null {
  const n = normalizarConsulta(texto);
  if (!n) return null;
  return DETECTORES.find((d) => d.coincide(n, texto))?.id ?? null;
}

const SALUDO_INICIAL =
  "((hola|buenas|buenos dias|buenas tardes|buenas noches|oye|disculpa|una pregunta|pregunta|perdon)[\\s,.!:;-]*)*";
const REGEX_INICIO_PREGUNTA = new RegExp(
  `^${SALUDO_INICIAL}(y )?(que|cual|cuales|como|donde|en donde|cuando|cuanto|cuanta|a que|en que|por que|para que|quien|puedo|puedes|podrias|me (puedes|podrias|pasas|mandas|das|compartes|envias)|mandame|pasame|enviame|tienen|hay|es|son|cobran|se puede|ustedes|mi credito)\\b`,
);
const REGEX_INICIO_CON_SIGNO = new RegExp(`^${SALUDO_INICIAL}¿`);

/** Inicio típico de pregunta ("¿…", "dónde", "cuánto", "me pasas"…), tras un saludo opcional. */
function empiezaComoPregunta(texto: string): boolean {
  return (
    REGEX_INICIO_CON_SIGNO.test(normalizarTexto(texto)) ||
    REGEX_INICIO_PREGUNTA.test(normalizarConsulta(texto))
  );
}

/** Signos de interrogación o un inicio típico de pregunta. */
export function esPregunta(texto: string): boolean {
  return /[?¿]/.test(texto) || empiezaComoPregunta(texto);
}

const MAX_LARGO_CONSULTA_BREVE = 90;

/**
 * Pregunta frecuente que empieza como pregunta, sin datos ni sí/no: se contesta sin Claude.
 * Los mensajes que mezclan datos y preguntas ("Juan, ¿cuánto cobran?") los interpreta Claude.
 */
export function esConsultaBreve(texto: string): boolean {
  const n = normalizarConsulta(texto);
  if (!n || n.length > MAX_LARGO_CONSULTA_BREVE) return false;
  if (texto.includes("@") || /\d{5,}/.test(texto.replace(/[\s-]/g, ""))) return false;
  if (/^(si|no|claro|ok|va|dale|acepto|autorizo|de acuerdo)\b/.test(n)) return false;
  return empiezaComoPregunta(texto) && detectarConsultaConCasa(texto) !== null;
}

export function responderConsultaConCasa(id: ConsultaConCasa, ctx: ContextoConsulta): string {
  return RESPUESTAS[id](ctx);
}

// ---------------------------------------------------------------------------
// Salvaguarda para respuestas libres de Claude
// ---------------------------------------------------------------------------

const URLS_PERMITIDAS: ReadonlySet<string> = new Set([DATOS_CONCASA.mapsUrl]);
const REGEX_URL = /(https?:\/\/[^\s)]+|www\.[^\s)]+|\b[a-z0-9-]+\.(com|mx|org|net|gob)(\.mx)?\b[^\s)]*)/gi;

const AFIRMACIONES_NO_CONFIRMADAS: ReadonlyArray<RegExp> = [
  /(?<!no )\b(tu|su) credito (ya )?(esta|fue|quedo) (aprobado|autorizado)\b/,
  /(?<!no )\bya (se )?(te |le )?(deposit|aprob|autoriz)\w*/,
  /(?<!no )\b(tu|su) cita (ya )?(esta|quedo|fue) (confirmada|agendada|programada)\b/,
  /\b(recibi|recibimos|ya tenemos) tus documentos\b/,
  /\btus documentos (ya )?(estan|quedaron) (completos|validados|revisados)\b/,
];

const SOLICITUD_CREDENCIALES =
  /\b(comparteme|compartenos|enviame|envianos|mandame|mandanos|pasame|pasanos|dime|escribeme|proporcioname|necesito|ocupo)\b[^.]{0,25}\b(contrasena|password|codigo(?! postal)|nip|clave de acceso)\b/;

/**
 * Descarta respuestas de Claude con datos no confirmados: enlaces o teléfonos fuera de
 * la base, horarios, porcentajes de honorarios no publicables, aprobaciones, citas o
 * depósitos afirmados, o solicitudes de credenciales.
 */
export function respuestaDudaPermitida(texto: string): boolean {
  const urls = texto.match(REGEX_URL) ?? [];
  if (urls.some((u) => !URLS_PERMITIDAS.has(u.replace(/[.,;:]+$/, "")))) return false;

  if (/\d{2,4}[\s.-]?\d{3,4}[\s.-]?\d{4}/.test(texto)) return false;
  if (/\b\d{1,2}(:\d{2})?\s?(a\.?\s?m\b|p\.?\s?m\b|hrs?\b|horas\b)/i.test(texto)) return false;

  const n = normalizarTexto(texto);
  if (/\bde lunes a\b/.test(n)) return false;
  if (!honorariosPublicables() && (/\d\s?%/.test(texto) || /\bpor ciento\b/.test(n))) return false;
  if (AFIRMACIONES_NO_CONFIRMADAS.some((r) => r.test(n))) return false;
  if (SOLICITUD_CREDENCIALES.test(n)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Bloque para el prompt del trámite Mejoravit (Claude)
// ---------------------------------------------------------------------------

function lineaHonorarios(): string {
  const h = REGLAS_FINANCIERAS.honorarios;
  return honorariosPublicables(h)
    ? `- Honorarios: propuesta privada de ConCasa de ${h.porcentajePropuesto}% sobre ${h.baseDeCalculo}. No es un cobro de Infonavit ni un requisito para el crédito; el costo completo debe constar por escrito antes de contratar.`
    : "- Honorarios: ConCasa ofrece un servicio privado de acompañamiento con honorarios cuya política aún se confirma. No menciones porcentajes ni importes de honorarios. Explica que no es un cobro de Infonavit ni un requisito para el crédito y que el costo completo debe constar por escrito antes de contratar.";
}

export function bloqueConocimientoParaPrompt(): string {
  return `=== BASE DE CONOCIMIENTO CONCASA ===
Usa solo esta información para dudas sobre ConCasa, el proceso, costos o seguimiento. Si algo no está aquí, responde: "${MSG_SIN_INFORMACION_CONFIRMADA}"

DATOS DE CONCASA
- Nombre comercial: ${DATOS_CONCASA.nombreComercial}. Servicio privado de acompañamiento; no es Infonavit.
- Oficina: ${DIRECCION_OFICINA}, ${DATOS_CONCASA.referencia}.
- Google Maps: ${DATOS_CONCASA.mapsUrl} (compártelo solo si preguntan dónde están, cómo llegar, la ubicación o si hay oficina física).
- No hay horarios, teléfonos adicionales ni condiciones de atención confirmados: no los inventes.

ETAPAS OPERATIVAS DE CONCASA (internas, no son procedimientos oficiales de Infonavit)
${ETAPAS_OPERATIVAS_CONCASA.map((e, i) => `${i + 1}. ${e.titulo}`).join("\n")}
${AVISO_ETAPAS}

INFORMACIÓN OFICIAL DE INFONAVIT
- ${INFONAVIT_OFICIAL.tramitesGratuitos}
- ${INFONAVIT_OFICIAL.tramiteDirecto}
- ${INFONAVIT_OFICIAL.autorizacionYRecursos}

REGLAS FINANCIERAS
- No confundas saldo de subcuenta, importe neto estimado, crédito aprobado e importe recibido. Como máximo, el cliente tiene el importe neto estimado de su precalificación, sujeto a validación; antes de precalificar no tiene ninguno.
- Nunca digas que el crédito está aprobado ni que ConCasa autoriza o entrega los recursos.
${lineaHonorarios()}
- No calcules importes después de honorarios.

REQUISITOS DOCUMENTALES
${REQUISITOS_DOCUMENTALES.map((d) => `- ${d}`).join("\n")}

SEGUIMIENTO
- Este chat no está conectado al expediente ni a la agenda de ConCasa: no afirmes etapas actuales, citas confirmadas, depósitos ni avisos automáticos.

MI CUENTA INFONAVIT
- La guía para crearla o recuperarla se habilita solo con los ${MI_CUENTA_INFONAVIT.requisitoParaHabilitar}. Puedes dar información general, sin cambiar la etapa ni decir que sus documentos están completos.
- Nunca pidas ${MI_CUENTA_INFONAVIT.nuncaSolicitar.join(", ")}.`;
}

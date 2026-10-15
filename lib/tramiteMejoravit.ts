import {
  detectarConsultaConCasa,
  esConsultaBreve,
  esPregunta,
  MSG_SIN_INFORMACION_CONFIRMADA,
  REQUISITOS_DOCUMENTALES,
  responderConsultaConCasa,
  SEGUIMIENTO_SIN_INTEGRACION,
  type ContextoConsulta,
} from "@/lib/conocimientoConCasa";
import {
  FACTOR_NETO_MEJORAVIT,
  TOPE_MONTO_MEJORAVIT,
  type EstimacionCreditoMejoravit,
} from "@/lib/mejoravitCredito";
import { esAfirmativo, esNegativo, normalizarTexto } from "@/lib/normalizeText";
import {
  normalizarRegistroPatronal,
  type DatosPortalPrecalificacion,
} from "@/lib/precalificacionScraper";

/**
 * Trámite Mejoravit conducido por el bot (Paso 1). Módulo puro: sin Supabase, sin Claude
 * y sin reloj propio, para que cada mensaje se pueda recalcular sobre la versión más
 * reciente del trámite si otro mensaje concurrente la cambió.
 *
 * Campos alineados al contrato "Datos Generales" de ConCasa CRM (perfil completo del
 * asesor). Estado civil, datos de la INE, CLABE, plazo y monto a solicitar no se piden:
 * los captura Mesa de Control o son internos.
 */

export const CAMPOS_CAPTURA = [
  "nombres",
  "apellido_paterno",
  "apellido_materno",
  "curp",
  "correo",
  "telefono_casa",
  "domicilio_calle",
  "domicilio_numero_exterior",
  "domicilio_numero_interior",
  "domicilio_colonia",
  "domicilio_municipio",
  "domicilio_estado",
  "domicilio_cp",
  "empresa",
  "registro_patronal",
  "telefono_empresa",
  "empresa_calle",
  "empresa_colonia",
  "empresa_municipio",
  "empresa_cp",
  "referencia1_nombres",
  "referencia1_apellido_paterno",
  "referencia1_apellido_materno",
  "referencia1_celular",
  "referencia2_nombres",
  "referencia2_apellido_paterno",
  "referencia2_apellido_materno",
  "referencia2_celular",
  "beneficiario_nombre",
  "beneficiario_parentesco",
] as const;

export type CampoCaptura = (typeof CAMPOS_CAPTURA)[number];
/** `nss`, `rfc` y `celular` se conocen por la precalificación o por WhatsApp; no se preguntan. */
export type CampoTramite = CampoCaptura | "nss" | "rfc" | "celular";

export type EtapaTramite =
  | "oferta"
  | "consentimiento"
  | "captura"
  | "pausado"
  | "completo"
  | "rechazado";

export type ProcedenciaDato = "precalificacion" | "whatsapp" | "cliente";

export type DatoCapturado = {
  valor: string;
  procedencia: ProcedenciaDato;
  actualizadoAt: string;
};

export type MotivoPendiente = "no_lo_tiene" | "sin_respuesta_valida";

export const DOCUMENTOS_TRAMITE = [
  "ine_frente",
  "ine_reverso",
  "comprobante_domicilio",
  "estado_cuenta",
] as const;
export type DocumentoTramite = (typeof DOCUMENTOS_TRAMITE)[number];

export type TramiteMejoravit = {
  esquema: 1;
  version: number;
  producto: "mejoravit";
  etapa: EtapaTramite;
  etapaAntesDePausa: EtapaTramite | null;
  interes: "pendiente" | "acepta" | "rechaza";
  consentimiento: { aceptado: boolean; respondidoAt: string } | null;
  credito: EstimacionCreditoMejoravit & {
    tope: number;
    factor: number;
    calculadoAt: string;
  };
  portal: DatosPortalPrecalificacion & { consultadoAt: string };
  datos: Partial<Record<CampoTramite, DatoCapturado>>;
  pendientes: Partial<Record<CampoCaptura, { motivo: MotivoPendiente; at: string }>>;
  intentos: Partial<Record<CampoCaptura, number>>;
  campoActual: CampoCaptura | null;
  preguntaAgrupada: boolean;
  porConfirmar: { campo: CampoCaptura; valor: string } | null;
  introducciones: GrupoCaptura[];
  /** Solo checklist: en esta fase no se piden ni se reciben archivos. */
  documentos: Record<DocumentoTramite, { estado: "pendiente" }>;
  /** La INE debe estar vigente; aún no se revisa ninguna credencial. */
  ine: { requisito: "vigente"; vigencia: "pendiente_revision" };
  creadoAt: string;
  ultimaActividadAt: string;
};

type GrupoCaptura =
  | "identidad"
  | "contacto"
  | "domicilio"
  | "laboral"
  | "referencias"
  | "beneficiario";

type TipoCampo =
  | "nombre"
  | "nombre_completo"
  | "texto"
  | "curp"
  | "correo"
  | "telefono"
  | "cp"
  | "numero"
  | "nrp"
  | "parentesco";

type DefCampo = {
  tipo: TipoCampo;
  grupo: GrupoCaptura;
  etiqueta: string;
  /** Descripción para que Claude ubique el dato en mensajes libres. */
  descripcion: string;
  pregunta: (t: TramiteMejoravit) => string;
  /** Respuesta explícita "no tengo / no tiene" se guarda como valor vacío confirmado. */
  vacioPermitido?: boolean;
};

const fija = (texto: string) => () => texto;

function nombreReferencia(t: TramiteMejoravit, n: 1 | 2): string {
  const nombre = t.datos[`referencia${n}_nombres`]?.valor;
  return nombre ? nombre : n === 1 ? "tu primera referencia" : "tu segunda referencia";
}

export const DEFINICION_CAMPOS: Record<CampoCaptura, DefCampo> = {
  nombres: {
    tipo: "nombre",
    grupo: "identidad",
    etiqueta: "nombre",
    descripcion: "nombre(s) de pila del cliente, sin apellidos",
    pregunta: fija("¿Cuál es tu nombre (o nombres), sin apellidos?"),
  },
  apellido_paterno: {
    tipo: "nombre",
    grupo: "identidad",
    etiqueta: "apellido paterno",
    descripcion: "apellido paterno del cliente",
    pregunta: fija("¿Cuál es tu apellido paterno?"),
  },
  apellido_materno: {
    tipo: "nombre",
    grupo: "identidad",
    etiqueta: "apellido materno",
    descripcion: "apellido materno del cliente (\"\" si dice que no tiene)",
    pregunta: fija('¿Y tu apellido materno? Si no tienes, respóndeme "no tengo".'),
    vacioPermitido: true,
  },
  curp: {
    tipo: "curp",
    grupo: "identidad",
    etiqueta: "CURP",
    descripcion: "CURP del cliente (18 caracteres)",
    pregunta: fija(
      "¿Me compartes tu CURP? Son 18 caracteres; la encuentras en tu INE o en tu acta de nacimiento.",
    ),
  },
  correo: {
    tipo: "correo",
    grupo: "contacto",
    etiqueta: "correo electrónico",
    descripcion: "correo electrónico del cliente",
    pregunta: fija("¿Cuál es tu correo electrónico? Es necesario para tu expediente."),
  },
  telefono_casa: {
    tipo: "telefono",
    grupo: "contacto",
    etiqueta: "teléfono de casa",
    descripcion: "teléfono de casa del cliente, 10 dígitos, distinto a su celular",
    pregunta: fija(
      "¿Me compartes un teléfono de casa? Debe ser distinto a tu celular; queda registrado como teléfono de contacto adicional en tu expediente.",
    ),
  },
  domicilio_calle: {
    tipo: "texto",
    grupo: "domicilio",
    etiqueta: "calle de tu domicilio",
    descripcion: "calle del domicilio del cliente (sin número)",
    pregunta: fija("¿En qué calle está tu domicilio?"),
  },
  domicilio_numero_exterior: {
    tipo: "numero",
    grupo: "domicilio",
    etiqueta: "número exterior",
    descripcion: "número exterior del domicilio del cliente",
    pregunta: fija("¿Cuál es el número exterior de tu domicilio?"),
  },
  domicilio_numero_interior: {
    tipo: "numero",
    grupo: "domicilio",
    etiqueta: "número interior",
    descripcion: "número interior del domicilio (\"\" si dice que no tiene)",
    pregunta: fija('¿Tu domicilio tiene número interior? Si no tiene, respóndeme "no".'),
    vacioPermitido: true,
  },
  domicilio_colonia: {
    tipo: "texto",
    grupo: "domicilio",
    etiqueta: "colonia",
    descripcion: "colonia del domicilio del cliente",
    pregunta: fija("¿En qué colonia está tu domicilio?"),
  },
  domicilio_municipio: {
    tipo: "texto",
    grupo: "domicilio",
    etiqueta: "municipio",
    descripcion: "municipio del domicilio del cliente",
    pregunta: fija("¿En qué municipio?"),
  },
  domicilio_estado: {
    tipo: "texto",
    grupo: "domicilio",
    etiqueta: "estado",
    descripcion: "estado de la República del domicilio del cliente",
    pregunta: fija("¿En qué estado?"),
  },
  domicilio_cp: {
    tipo: "cp",
    grupo: "domicilio",
    etiqueta: "código postal",
    descripcion: "código postal del domicilio del cliente (5 dígitos)",
    pregunta: fija("¿Cuál es el código postal de tu domicilio?"),
  },
  empresa: {
    tipo: "texto",
    grupo: "laboral",
    etiqueta: "empresa",
    descripcion: "nombre de la empresa donde trabaja el cliente",
    pregunta: (t) =>
      t.datos.registro_patronal?.procedencia === "precalificacion"
        ? "En tu consulta de Infonavit aparece tu registro patronal, pero no el nombre de tu empresa. ¿Cómo se llama la empresa donde trabajas?"
        : "¿Cómo se llama la empresa donde trabajas?",
  },
  registro_patronal: {
    tipo: "nrp",
    grupo: "laboral",
    etiqueta: "registro patronal",
    descripcion: "registro patronal (NRP) de la empresa, 11 caracteres",
    pregunta: (t) => {
      const base =
        "¿Me compartes el registro patronal de tu empresa? Son 11 caracteres y viene en tu recibo de nómina. Si no lo tienes a la mano, lo dejamos pendiente.";
      const empresa = t.datos.empresa;
      return empresa?.procedencia === "precalificacion"
        ? `En tu consulta de Infonavit aparece que trabajas en ${empresa.valor}. ${base}`
        : base;
    },
  },
  telefono_empresa: {
    tipo: "telefono",
    grupo: "laboral",
    etiqueta: "teléfono de tu trabajo",
    descripcion: "teléfono de la empresa donde trabaja el cliente, 10 dígitos",
    pregunta: fija("¿Cuál es el teléfono de la empresa donde trabajas?"),
  },
  empresa_calle: {
    tipo: "texto",
    grupo: "laboral",
    etiqueta: "calle de tu trabajo",
    descripcion: "calle y número del domicilio de la empresa",
    pregunta: fija("¿En qué calle y número está tu trabajo?"),
  },
  empresa_colonia: {
    tipo: "texto",
    grupo: "laboral",
    etiqueta: "colonia de tu trabajo",
    descripcion: "colonia del domicilio de la empresa",
    pregunta: fija("¿En qué colonia está tu trabajo?"),
  },
  empresa_municipio: {
    tipo: "texto",
    grupo: "laboral",
    etiqueta: "municipio de tu trabajo",
    descripcion: "municipio del domicilio de la empresa",
    pregunta: fija("¿En qué municipio está tu trabajo?"),
  },
  empresa_cp: {
    tipo: "cp",
    grupo: "laboral",
    etiqueta: "código postal de tu trabajo",
    descripcion: "código postal del domicilio de la empresa (5 dígitos)",
    pregunta: fija("¿Cuál es el código postal de tu trabajo?"),
  },
  referencia1_nombres: {
    tipo: "nombre",
    grupo: "referencias",
    etiqueta: "nombre de tu primera referencia",
    descripcion: "nombre(s) de pila de la primera referencia personal",
    pregunta: fija("¿Cuál es el nombre (o nombres) de tu primera referencia, sin apellidos?"),
  },
  referencia1_apellido_paterno: {
    tipo: "nombre",
    grupo: "referencias",
    etiqueta: "apellido paterno de tu primera referencia",
    descripcion: "apellido paterno de la primera referencia",
    pregunta: (t) => `¿Cuál es el apellido paterno de ${nombreReferencia(t, 1)}?`,
  },
  referencia1_apellido_materno: {
    tipo: "nombre",
    grupo: "referencias",
    etiqueta: "apellido materno de tu primera referencia",
    descripcion: "apellido materno de la primera referencia (\"\" si no tiene)",
    pregunta: (t) =>
      `¿Y el apellido materno de ${nombreReferencia(t, 1)}? Si no tiene, respóndeme "no tiene".`,
    vacioPermitido: true,
  },
  referencia1_celular: {
    tipo: "telefono",
    grupo: "referencias",
    etiqueta: "celular de tu primera referencia",
    descripcion: "celular de la primera referencia, 10 dígitos",
    pregunta: (t) => `¿Cuál es el celular de ${nombreReferencia(t, 1)}? (10 dígitos)`,
  },
  referencia2_nombres: {
    tipo: "nombre",
    grupo: "referencias",
    etiqueta: "nombre de tu segunda referencia",
    descripcion: "nombre(s) de pila de la segunda referencia personal",
    pregunta: fija("Ahora tu segunda referencia: ¿cuál es su nombre (o nombres), sin apellidos?"),
  },
  referencia2_apellido_paterno: {
    tipo: "nombre",
    grupo: "referencias",
    etiqueta: "apellido paterno de tu segunda referencia",
    descripcion: "apellido paterno de la segunda referencia",
    pregunta: (t) => `¿Cuál es el apellido paterno de ${nombreReferencia(t, 2)}?`,
  },
  referencia2_apellido_materno: {
    tipo: "nombre",
    grupo: "referencias",
    etiqueta: "apellido materno de tu segunda referencia",
    descripcion: "apellido materno de la segunda referencia (\"\" si no tiene)",
    pregunta: (t) =>
      `¿Y el apellido materno de ${nombreReferencia(t, 2)}? Si no tiene, respóndeme "no tiene".`,
    vacioPermitido: true,
  },
  referencia2_celular: {
    tipo: "telefono",
    grupo: "referencias",
    etiqueta: "celular de tu segunda referencia",
    descripcion: "celular de la segunda referencia, 10 dígitos",
    pregunta: (t) => `¿Cuál es el celular de ${nombreReferencia(t, 2)}? (10 dígitos)`,
  },
  beneficiario_nombre: {
    tipo: "nombre_completo",
    grupo: "beneficiario",
    etiqueta: "nombre de tu beneficiario",
    descripcion: "nombre completo del beneficiario del cliente",
    pregunta: fija("¿Cuál es el nombre completo de tu beneficiario?"),
  },
  beneficiario_parentesco: {
    tipo: "parentesco",
    grupo: "beneficiario",
    etiqueta: "parentesco de tu beneficiario",
    descripcion: "parentesco del beneficiario con el cliente (esposa, hijo, mamá…)",
    pregunta: fija("¿Qué parentesco tiene contigo? Por ejemplo: esposa, hijo o mamá."),
  },
};

/** Preguntas que aceptan varios datos a la vez; solo se usan cuando Claude puede separarlos. */
const BLOQUES: ReadonlyArray<{ id: string; campos: CampoCaptura[]; pregunta: string }> = [
  {
    id: "nombre",
    campos: ["nombres", "apellido_paterno", "apellido_materno"],
    pregunta: "Para empezar, ¿me compartes tu nombre completo, tal como aparece en tu INE?",
  },
  {
    id: "domicilio",
    campos: [
      "domicilio_calle",
      "domicilio_numero_exterior",
      "domicilio_numero_interior",
      "domicilio_colonia",
      "domicilio_municipio",
      "domicilio_estado",
      "domicilio_cp",
    ],
    pregunta:
      "¿Cuál es tu domicilio? Puedes escribirlo completo: calle, número exterior e interior (si tiene), colonia, municipio, estado y código postal.",
  },
  {
    id: "direccion_empresa",
    campos: ["empresa_calle", "empresa_colonia", "empresa_municipio", "empresa_cp"],
    pregunta:
      "¿Cuál es la dirección de tu trabajo? Calle y número, colonia, municipio y código postal.",
  },
  {
    id: "referencia1",
    campos: ["referencia1_nombres", "referencia1_apellido_paterno", "referencia1_apellido_materno"],
    pregunta: "¿Cuál es el nombre completo de tu primera referencia?",
  },
  {
    id: "referencia2",
    campos: ["referencia2_nombres", "referencia2_apellido_paterno", "referencia2_apellido_materno"],
    pregunta: "Ahora tu segunda referencia: ¿cuál es su nombre completo?",
  },
];

const BLOQUES_DE_NOMBRE = new Set(["nombre", "referencia1", "referencia2"]);

// ---------------------------------------------------------------------------
// Mensajes
// ---------------------------------------------------------------------------

export function formatoMonto(valor: number): string {
  return `$${Math.floor(valor).toLocaleString("es-MX")}`;
}

export function mensajeOferta(montoNetoEstimado: number): string {
  return (
    "🏡 ¡Buenas noticias!\n\n" +
    "De acuerdo con tu precalificación, el importe neto estimado para tu crédito Mejoravit es de:\n\n" +
    `💰 ${formatoMonto(montoNetoEstimado)}\n\n` +
    "Es una estimación sujeta a validación.\n\n" +
    "¡Podemos ayudarte a comenzar tu trámite directamente por aquí! 😊\n\n" +
    "¿Te gustaría continuar?"
  );
}

export function mensajeConsentimiento(urlAvisoPrivacidad: string): string {
  return (
    "¡Excelente! 🙌\n\n" +
    "Antes de empezar: los datos que me compartas por este medio se usarán únicamente para integrar y dar seguimiento a tu trámite de crédito Mejoravit, " +
    `conforme a nuestro aviso de privacidad: ${urlAvisoPrivacidad}\n\n` +
    "¿Autorizas el uso de tus datos para este fin?"
  );
}

export const MSG_PREGUNTA_CONTINUAR = "¿Te gustaría continuar con tu trámite?";
export const MSG_CONSENTIMIENTO_REPREGUNTA =
  "¿Autorizas el uso de tus datos para integrar tu trámite? Respóndeme sí o no.";
export const MSG_SIN_CONSENTIMIENTO =
  'Entendido. Sin tu autorización no puedo integrar tu trámite por este medio. Si cambias de opinión, escríbeme "sí, autorizo" y continuamos.';
export const MSG_INICIO_CAPTURA =
  '¡Gracias! Te haré algunas preguntas cortas, una a la vez. Si en algún momento necesitas pausar, solo dime "luego seguimos" y retomamos cuando quieras.';
export const MSG_RECHAZO_OFERTA =
  "Entendido, no hay problema. Tu precalificación queda guardada; si más adelante quieres comenzar tu trámite, escríbeme por aquí. 😊";
export const MSG_PAUSA =
  "¡Claro! Guardé tu avance. Cuando quieras continuar, escríbeme por aquí y seguimos justo donde nos quedamos. 😊";
export const MSG_REANUDAR = "¡Qué gusto leerte de nuevo! Seguimos con tu trámite.";
export const MSG_PENDIENTE_NO_LO_TIENE =
  "Sin problema, lo dejamos pendiente; me lo puedes compartir cuando lo tengas.";
export const MSG_PENDIENTE_INTENTOS = "No te preocupes, lo dejamos pendiente por ahora y seguimos.";
export const MSG_POR_PARTES = "Para no equivocarme, vamos por partes.";
export const MSG_ACTUALIZADO = "¡Gracias, ya quedó registrado! 🙌";
export const MSG_COMPLETO_RECORDATORIO =
  "Tu información ya está guardada. 😊 En el siguiente paso te pediré tus documentos por este mismo chat. Si quieres corregir algún dato, dime cuál y el dato correcto.";

export function mensajeReoferta(montoNetoEstimado: number): string {
  return (
    `¡Hola de nuevo! 😊 Tu importe neto estimado para el crédito Mejoravit es de ${formatoMonto(montoNetoEstimado)} (sujeto a validación).\n\n` +
    "¿Te gustaría comenzar tu trámite?"
  );
}

function avisoPendientes(pendientes: CampoCaptura[], verbo: "Queda" | "Sigue"): string {
  return pendientes.length === 1
    ? `${verbo} pendiente: ${listaEtiquetas(pendientes)}. Cuando lo tengas, compártemelo por aquí.`
    : `${verbo === "Queda" ? "Quedan" : "Siguen"} pendientes: ${listaEtiquetas(pendientes)}. Cuando los tengas, compártemelos por aquí.`;
}

const ACUSES = ["¡Gracias!", "Perfecto.", "Listo.", "Anotado."] as const;

function acuse(t: TramiteMejoravit): string {
  return ACUSES[Object.keys(t.datos).length % ACUSES.length];
}

export function mensajeCompleto(pendientes: CampoCaptura[]): string {
  const bloquePendientes = pendientes.length ? `${avisoPendientes(pendientes, "Queda")}\n\n` : "";
  return (
    "¡Listo! Ya tengo la información principal de tu trámite. 🙌\n\n" +
    bloquePendientes +
    "El siguiente paso será revisar tus documentos:\n" +
    REQUISITOS_DOCUMENTALES.map((d) => `• ${d}\n`).join("") +
    "\n" +
    "Por ahora no necesitas enviarlos; en el siguiente paso te los pediré por este mismo chat."
  );
}

function listaEtiquetas(campos: CampoCaptura[]): string {
  const etiquetas = campos.map((c) => DEFINICION_CAMPOS[c].etiqueta);
  if (etiquetas.length <= 1) return etiquetas.join("");
  return `${etiquetas.slice(0, -1).join(", ")} y ${etiquetas[etiquetas.length - 1]}`;
}

function introduccionGrupo(t: TramiteMejoravit, grupo: GrupoCaptura): string | null {
  switch (grupo) {
    case "domicilio":
      return "Ahora vamos con tu domicilio.";
    case "laboral": {
      const empresaPortal = t.datos.empresa?.procedencia === "precalificacion";
      const nrpPortal = t.datos.registro_patronal?.procedencia === "precalificacion";
      if (empresaPortal && nrpPortal) {
        return "Tu empresa y tu registro patronal ya los tengo de tu consulta en Infonavit, así que no necesito pedírtelos. Ahora unos datos de tu trabajo.";
      }
      return "Ahora unos datos de tu trabajo.";
    }
    case "referencias":
      return "Ahora necesito dos referencias personales: personas que te conozcan y a quienes se pueda contactar para confirmar tus datos. Compártelas solo si están de acuerdo en que usemos su nombre y teléfono para este trámite.";
    case "beneficiario":
      return "Por último, necesito los datos de tu beneficiario.";
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Normalización y validación (reglas del contrato ConCasa)
// ---------------------------------------------------------------------------

const REGEX_CURP = /^[A-Z]{4}[0-9]{6}[HM][A-Z]{5}[0-9A-Z][0-9]$/;
const REGEX_CURP_EN_TEXTO = /[A-Z]{4}[0-9]{6}[HM][A-Z]{5}[0-9A-Z][0-9]/;
const REGEX_CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const REGEX_CORREO_EN_TEXTO = /[^\s@,;:<>()]+@[^\s@,;:<>()]+\.[^\s@,;:<>().]+/;
const REGEX_LETRAS = /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ'´.\- ]+$/;

function colapsarEspacios(valor: string): string {
  return valor.replace(/\s+/g, " ").trim();
}

/** 10 dígitos nacionales; acepta prefijos 52 / 521 (como llegan de WhatsApp). */
export function normalizarTelefonoMx(valor: string): string | null {
  const digitos = String(valor || "").replace(/\D/g, "");
  if (digitos.length === 10) return digitos;
  if (digitos.length === 12 && digitos.startsWith("52")) return digitos.slice(2);
  if (digitos.length === 13 && digitos.startsWith("521")) return digitos.slice(3);
  return null;
}

type Validacion = { ok: true; valor: string } | { ok: false; motivo: string };

function validarPorTipo(campo: CampoCaptura, bruto: string): Validacion {
  const def = DEFINICION_CAMPOS[campo];
  const valor = colapsarEspacios(bruto);
  switch (def.tipo) {
    case "nombre":
    case "nombre_completo": {
      const minPalabras = def.tipo === "nombre_completo" ? 2 : 1;
      if (
        valor.length < 2 ||
        valor.length > 80 ||
        !REGEX_LETRAS.test(valor) ||
        valor.split(" ").length < minPalabras
      ) {
        return {
          ok: false,
          motivo:
            def.tipo === "nombre_completo"
              ? "Necesito el nombre completo (nombre y apellidos), solo con letras."
              : `No logré identificar el ${def.etiqueta}; escríbelo solo con letras, por favor.`,
        };
      }
      return { ok: true, valor };
    }
    case "parentesco":
      if (valor.length < 3 || valor.length > 40 || !REGEX_LETRAS.test(valor)) {
        return { ok: false, motivo: "Escríbeme el parentesco con palabras, por ejemplo: esposa, hijo o mamá." };
      }
      return { ok: true, valor };
    case "texto":
      if (valor.length < 2 || valor.length > 120 || !/[A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9]/.test(valor)) {
        return { ok: false, motivo: `No logré identificar la ${def.etiqueta}.` };
      }
      return { ok: true, valor };
    case "curp": {
      const curp = valor.toUpperCase().replace(/[\s-]/g, "");
      if (!REGEX_CURP.test(curp)) {
        return {
          ok: false,
          motivo: "Esa CURP no parece válida: debe tener 18 caracteres, por ejemplo GOMA850101HNLRRN09.",
        };
      }
      return { ok: true, valor: curp };
    }
    case "correo": {
      const correo = valor.toLowerCase().replace(/\s/g, "");
      if (!REGEX_CORREO.test(correo)) {
        return { ok: false, motivo: "Ese correo no parece válido; revisa que tenga @ y dominio, por ejemplo nombre@gmail.com." };
      }
      return { ok: true, valor: correo };
    }
    case "telefono": {
      const tel = normalizarTelefonoMx(valor);
      if (!tel) return { ok: false, motivo: "El teléfono debe tener 10 dígitos." };
      return { ok: true, valor: tel };
    }
    case "cp":
      if (!/^\d{5}$/.test(valor.replace(/\s/g, ""))) {
        return { ok: false, motivo: "El código postal debe tener 5 dígitos." };
      }
      return { ok: true, valor: valor.replace(/\s/g, "") };
    case "numero": {
      const numero = valor.toUpperCase();
      if (numero.length > 12 || !/^[A-Z0-9#/\- ]+$/.test(numero)) {
        return { ok: false, motivo: "Escríbeme solo el número, por ejemplo 123 o 12-B." };
      }
      return { ok: true, valor: numero };
    }
    case "nrp": {
      const nrp = normalizarRegistroPatronal(valor);
      if (!nrp) {
        return { ok: false, motivo: "El registro patronal tiene 11 caracteres entre letras y números." };
      }
      return { ok: true, valor: nrp };
    }
  }
}

function valorDe(t: TramiteMejoravit, campo: CampoTramite): string | null {
  return t.datos[campo]?.valor ?? null;
}

const TELEFONOS_A_COMPARAR: Partial<Record<CampoCaptura, CampoTramite[]>> = {
  telefono_casa: ["celular", "referencia1_celular", "referencia2_celular"],
  referencia1_celular: ["celular", "telefono_casa", "referencia2_celular"],
  referencia2_celular: ["celular", "telefono_casa", "referencia1_celular"],
};

function validarCruzado(t: TramiteMejoravit, campo: CampoCaptura, valor: string): string | null {
  const comparar = TELEFONOS_A_COMPARAR[campo];
  if (comparar) {
    const repetido = comparar.find((c) => valorDe(t, c) === valor);
    if (repetido === "celular") {
      return campo === "telefono_casa"
        ? "Ese número es tu celular; necesito un teléfono distinto."
        : "Ese número es tu celular; necesito el de tu referencia.";
    }
    if (repetido) return "Ese número ya lo registré para otro contacto; necesito uno distinto.";
  }
  if (campo === "referencia2_apellido_paterno") {
    const mismo = (a: string | null, b: string | null) =>
      a !== null && b !== null && normalizarTexto(a) === normalizarTexto(b);
    if (
      mismo(valorDe(t, "referencia2_nombres"), valorDe(t, "referencia1_nombres")) &&
      mismo(valor, valorDe(t, "referencia1_apellido_paterno"))
    ) {
      return "Esa persona ya es tu primera referencia; necesito una persona distinta.";
    }
  }
  return null;
}

/** CURP y RFC comparten los primeros 10 caracteres (nombre y fecha de nacimiento). */
function curpContradiceRfcPortal(t: TramiteMejoravit, curp: string): boolean {
  const rfc = t.portal.rfc;
  return Boolean(rfc && rfc.length >= 10 && rfc.slice(0, 10) !== curp.slice(0, 10));
}

// ---------------------------------------------------------------------------
// Detección local (sin Claude)
// ---------------------------------------------------------------------------

const REGEX_PAUSA =
  /\b(luego seguimos|despues seguimos|seguimos (luego|despues|manana|otro dia|mas tarde)|(manana|luego|despues|al rato) (te escribo|le seguimos|continuamos|seguimos)|otro dia|mas tarde|ahorita no puedo|ahora no puedo|estoy ocupad[oa]|te escribo (luego|despues|mas tarde|manana))\b/;
/** Mensaje completo (sin signos): "no me interesa dar mi teléfono" no es un rechazo del trámite. */
const REGEX_RECHAZO_FIRME =
  /^(ya no me interesa|no me interesa|ya no quiero|no quiero (seguir|continuar)( con el tramite)?|cancela(r)? (el|mi) tramite|no quiero nada)( gracias)?$/;
const MAX_LARGO_DETECCION_LOCAL = 40;
const REGEX_ACEPTA =
  /\b(me interesa|quiero|adelante|continuemos|continuar|sigamos|dale|de acuerdo|acepto|autorizo|perfecto|claro|por supuesto|va)\b/;
const REGEX_NO_LO_TIENE =
  /\b(no (lo |la )?(tengo|se|recuerdo|me acuerdo|traigo)|no tiene|ninguno|n\/a|(despues|luego|mas tarde) (te |se )?(lo |la )?(paso|doy|mando|envio))\b/;
const REGEX_SALUDO =
  /^(hola|holi|buenas|buen dia|buenos dias|buenas tardes|buenas noches|ya (estoy|puedo|regrese|volvi)|aqui estoy|seguimos|continuamos|listo|ya)\b/;

export type IntencionTramite =
  | "acepta"
  | "rechaza"
  | "dato"
  | "duda"
  | "pausa"
  | "no_lo_tiene"
  | "otro";

export type InterpretacionTramite = {
  intencion: IntencionTramite;
  datos: Partial<Record<CampoCaptura | "celular", string>>;
  respuesta: string | null;
};

function sinSignos(normalizado: string): string {
  return normalizado.replace(/[^a-z0-9ñ ]/g, " ").replace(/\s+/g, " ").trim();
}

function compactar(valor: string): string {
  return normalizarTexto(valor).replace(/[^a-z0-9ñ]/g, "");
}

function etapaEfectiva(t: TramiteMejoravit): EtapaTramite {
  return t.etapa === "pausado" ? (t.etapaAntesDePausa ?? "captura") : t.etapa;
}

function esSiNo(texto: string): "si" | "no" | null {
  const n = normalizarTexto(texto);
  if (!n || texto.includes("?")) return null;
  if (esNegativo(texto)) return "no";
  if (esAfirmativo(texto) || REGEX_ACEPTA.test(n)) return "si";
  return null;
}

/** El cliente dijo que seguirá después ("luego te escribo", "más tarde", "estoy ocupado"). */
export function esPausaExplicita(texto: string): boolean {
  return REGEX_PAUSA.test(normalizarTexto(texto));
}

export function detectarIntencionLocal(
  t: TramiteMejoravit,
  texto: string,
): IntencionTramite | null {
  const n = normalizarTexto(texto);
  if (!n) return null;
  if (REGEX_PAUSA.test(n)) return "pausa";
  if (REGEX_RECHAZO_FIRME.test(sinSignos(n))) return "rechaza";
  if (esConsultaBreve(texto)) return "duda";

  const etapa = etapaEfectiva(t);
  if (t.porConfirmar || etapa === "oferta" || etapa === "consentimiento" || etapa === "rechazado") {
    const sn = esSiNo(texto);
    if (sn) return sn === "si" ? "acepta" : "rechaza";
    return null;
  }
  if (
    n.length <= MAX_LARGO_DETECCION_LOCAL &&
    REGEX_NO_LO_TIENE.test(n) &&
    extraerDirecto(t.campoActual, texto) === null
  ) {
    return "no_lo_tiene";
  }
  if (n === "no" && t.campoActual && DEFINICION_CAMPOS[t.campoActual].vacioPermitido) {
    return "no_lo_tiene";
  }
  return null;
}

/** Extracción determinística del dato de la pregunta actual cuando el mensaje es solo ese dato. */
export function extraerDirecto(campo: CampoCaptura | null, texto: string): string | null {
  if (!campo) return null;
  const limpio = colapsarEspacios(texto);
  const tipo = DEFINICION_CAMPOS[campo].tipo;
  switch (tipo) {
    case "curp": {
      const m = limpio.toUpperCase().replace(/[\s-]/g, "").match(REGEX_CURP_EN_TEXTO);
      return m && limpio.length <= 45 ? m[0] : null;
    }
    case "correo": {
      const m = limpio.match(REGEX_CORREO_EN_TEXTO);
      return m && limpio.length - m[0].length <= 25 ? m[0] : null;
    }
    case "telefono":
      return /^[\d\s\-().+]+$/.test(limpio) ? normalizarTelefonoMx(limpio) : null;
    case "cp":
      return /^\d{5}$/.test(limpio) ? limpio : null;
    case "numero":
      return /^(#?\s?[A-Za-z0-9\-/]{1,10}|s\/n)$/i.test(limpio) && /\d|s\/n/i.test(limpio)
        ? limpio.toUpperCase()
        : null;
    case "nrp":
      return normalizarRegistroPatronal(limpio);
    default:
      return null;
  }
}

/** ¿Hace falta Claude para entender el mensaje? Nunca se llama más de una vez por mensaje. */
export function necesitaInterpretacion(t: TramiteMejoravit, texto: string): boolean {
  const etapa = etapaEfectiva(t);
  const local = detectarIntencionLocal(t, texto);
  if (local === "pausa" && (etapa === "captura" || etapa === "completo")) {
    return normalizarTexto(texto).length > MAX_LARGO_DETECCION_LOCAL;
  }
  if (local !== null) return false;
  if (etapa === "rechazado") return false;
  if (etapa === "oferta" || etapa === "consentimiento") return true;
  if (t.porConfirmar) return true;
  if (t.etapa === "pausado" && REGEX_SALUDO.test(normalizarTexto(texto)) && texto.length < 40) {
    return false;
  }
  if (!t.preguntaAgrupada && extraerDirecto(t.campoActual, texto) !== null) return false;
  return true;
}

/** Contexto mínimo que Claude necesita: la pregunta actual y los campos aún faltantes. */
export function contextoParaInterpretacion(t: TramiteMejoravit) {
  const etapa = etapaEfectiva(t);
  const faltantes = CAMPOS_CAPTURA.filter((c) => !t.datos[c]);
  return {
    etapa,
    preguntaActual: preguntaActualTexto(t),
    campoActual: t.campoActual,
    campos: faltantes.map((c) => ({ clave: c, descripcion: DEFINICION_CAMPOS[c].descripcion })),
    camposCapturados: CAMPOS_CAPTURA.filter((c) => t.datos[c]).map((c) => ({
      clave: c,
      descripcion: DEFINICION_CAMPOS[c].descripcion,
    })),
    montoNetoEstimado: t.credito.montoNetoEstimado,
  };
}

function preguntaActualTexto(t: TramiteMejoravit): string {
  const etapa = etapaEfectiva(t);
  if (etapa === "oferta" || etapa === "rechazado") return MSG_PREGUNTA_CONTINUAR;
  if (etapa === "consentimiento") return MSG_CONSENTIMIENTO_REPREGUNTA;
  if (!t.campoActual) return "";
  if (t.preguntaAgrupada) {
    const bloque = BLOQUES.find((b) => b.campos[0] === t.campoActual);
    if (bloque) return bloque.pregunta;
  }
  return DEFINICION_CAMPOS[t.campoActual].pregunta(t);
}

// ---------------------------------------------------------------------------
// Creación y fusión con la precalificación
// ---------------------------------------------------------------------------

function documentosPendientes(): TramiteMejoravit["documentos"] {
  return {
    ine_frente: { estado: "pendiente" },
    ine_reverso: { estado: "pendiente" },
    comprobante_domicilio: { estado: "pendiente" },
    estado_cuenta: { estado: "pendiente" },
  };
}

/**
 * Crea el trámite o lo actualiza con una nueva precalificación. Conserva lo capturado
 * (mismo NSS) y nunca sustituye un valor existente por uno vacío del portal.
 */
export function prepararTramiteTrasPrecalificacion(
  previo: TramiteMejoravit | null,
  args: {
    nss: string;
    credito: EstimacionCreditoMejoravit;
    portal: DatosPortalPrecalificacion;
    celularWhatsapp: string | null;
    ahora: string;
  },
): TramiteMejoravit {
  const mismoTitular = previo?.datos.nss?.valor === args.nss;
  const base: TramiteMejoravit =
    previo && mismoTitular
      ? structuredClone(previo)
      : {
          esquema: 1,
          version: previo?.version ?? 0,
          producto: "mejoravit",
          etapa: "oferta",
          etapaAntesDePausa: null,
          interes: "pendiente",
          consentimiento: null,
          credito: { ...args.credito, tope: TOPE_MONTO_MEJORAVIT, factor: FACTOR_NETO_MEJORAVIT, calculadoAt: args.ahora },
          portal: { ...args.portal, consultadoAt: args.ahora },
          datos: {},
          pendientes: {},
          intentos: {},
          campoActual: null,
          preguntaAgrupada: false,
          porConfirmar: null,
          introducciones: [],
          documentos: documentosPendientes(),
          ine: { requisito: "vigente", vigencia: "pendiente_revision" },
          creadoAt: args.ahora,
          ultimaActividadAt: args.ahora,
        };

  base.etapa = "oferta";
  base.etapaAntesDePausa = null;
  base.interes = "pendiente";
  base.porConfirmar = null;
  base.credito = {
    ...args.credito,
    tope: TOPE_MONTO_MEJORAVIT,
    factor: FACTOR_NETO_MEJORAVIT,
    calculadoAt: args.ahora,
  };
  base.portal = { ...args.portal, consultadoAt: args.ahora };

  const fijar = (campo: CampoTramite, valor: string | null, procedencia: ProcedenciaDato) => {
    if (!valor) return;
    const actual = base.datos[campo];
    if (actual && actual.procedencia === "cliente") return;
    base.datos[campo] = { valor, procedencia, actualizadoAt: args.ahora };
    if (campo in base.pendientes) delete base.pendientes[campo as CampoCaptura];
  };
  fijar("nss", args.nss, "precalificacion");
  fijar("rfc", args.portal.rfc, "precalificacion");
  fijar("empresa", args.portal.empresa, "precalificacion");
  fijar("registro_patronal", args.portal.registroPatronal, "precalificacion");
  if (!base.datos.celular) fijar("celular", args.celularWhatsapp, "whatsapp");

  base.ultimaActividadAt = args.ahora;
  return base;
}

// ---------------------------------------------------------------------------
// Avance del trámite
// ---------------------------------------------------------------------------

export type EntradaTramite = {
  texto: string;
  interpretacion: InterpretacionTramite | null;
  /** Preguntas de varios datos a la vez solo si Claude está disponible para separarlos. */
  preguntasAgrupadas: boolean;
  urlAvisoPrivacidad: string;
  ahora: string;
};

export type ResultadoTramite = { tramite: TramiteMejoravit; respuesta: string };

export function siguienteCampo(t: TramiteMejoravit): CampoCaptura | null {
  return CAMPOS_CAPTURA.find((c) => !t.datos[c] && !t.pendientes[c]) ?? null;
}

export function camposPendientes(t: TramiteMejoravit): CampoCaptura[] {
  return CAMPOS_CAPTURA.filter((c) => !t.datos[c]);
}

function bloqueAgrupable(t: TramiteMejoravit, campo: CampoCaptura) {
  const bloque = BLOQUES.find((b) => b.campos[0] === campo);
  if (!bloque) return null;
  return bloque.campos.every((c) => !t.datos[c] && !t.pendientes[c]) ? bloque : null;
}

/** Fija `campoActual` y devuelve el texto de la pregunta (con introducción de grupo la primera vez). */
function preguntar(t: TramiteMejoravit, campo: CampoCaptura, agrupar: boolean): string {
  const bloque = agrupar ? bloqueAgrupable(t, campo) : null;
  t.campoActual = campo;
  t.preguntaAgrupada = bloque !== null;
  const partes: string[] = [];
  const grupo = DEFINICION_CAMPOS[campo].grupo;
  if (!t.introducciones.includes(grupo)) {
    t.introducciones.push(grupo);
    const intro = introduccionGrupo(t, grupo);
    if (intro) partes.push(intro);
  }
  partes.push(bloque ? bloque.pregunta : DEFINICION_CAMPOS[campo].pregunta(t));
  return partes.join("\n\n");
}

function unir(...partes: Array<string | null | undefined>): string {
  return partes.filter((p): p is string => Boolean(p && p.trim())).join("\n\n");
}

/** Pregunta siguiente o cierre de la captura. */
function continuar(t: TramiteMejoravit, e: EntradaTramite, prefijo: string | null): string {
  const campo = siguienteCampo(t);
  if (campo) return unir(prefijo, preguntar(t, campo, e.preguntasAgrupadas));
  const pendientes = camposPendientes(t);
  t.campoActual = pendientes[0] ?? null;
  t.preguntaAgrupada = false;
  if (t.etapa === "completo") {
    return unir(prefijo, pendientes.length ? null : MSG_COMPLETO_RECORDATORIO);
  }
  t.etapa = "completo";
  return unir(prefijo, mensajeCompleto(pendientes));
}

function guardarDato(t: TramiteMejoravit, campo: CampoTramite, valor: string, ahora: string) {
  t.datos[campo] = { valor, procedencia: "cliente", actualizadoAt: ahora };
  if (campo !== "nss" && campo !== "rfc" && campo !== "celular") {
    delete t.pendientes[campo];
    delete t.intentos[campo];
  }
}

function marcarPendiente(t: TramiteMejoravit, campo: CampoCaptura, motivo: MotivoPendiente, ahora: string) {
  t.pendientes[campo] = { motivo, at: ahora };
  delete t.intentos[campo];
}

/** Separa "Nombre(s) Paterno Materno" cuando Claude no está disponible. */
function separarNombreCompleto(texto: string): [string, string, string] | null {
  const partes = colapsarEspacios(texto).split(" ");
  if (partes.length < 2 || !REGEX_LETRAS.test(texto.trim())) return null;
  if (partes.length === 2) return [partes[0], partes[1], ""];
  return [partes.slice(0, -2).join(" "), partes[partes.length - 2], partes[partes.length - 1]];
}

type ResultadoAplicacion = {
  guardados: CampoTramite[];
  error: { campo: CampoCaptura; motivo: string } | null;
  confirmacion: string | null;
};

function aplicarDatos(
  t: TramiteMejoravit,
  datos: Partial<Record<CampoCaptura | "celular", string>>,
  ahora: string,
): ResultadoAplicacion {
  const r: ResultadoAplicacion = { guardados: [], error: null, confirmacion: null };

  const celular = datos.celular !== undefined ? normalizarTelefonoMx(datos.celular) : null;
  if (celular && celular !== valorDe(t, "celular")) {
    guardarDato(t, "celular", celular, ahora);
    r.guardados.push("celular");
  }

  for (const campo of CAMPOS_CAPTURA) {
    const bruto = datos[campo];
    if (typeof bruto !== "string") continue;
    const def = DEFINICION_CAMPOS[campo];
    if (!bruto.trim()) {
      if (def.vacioPermitido && !t.datos[campo]) {
        guardarDato(t, campo, "", ahora);
        r.guardados.push(campo);
      }
      continue;
    }
    const v = validarPorTipo(campo, bruto);
    if (!v.ok) {
      r.error ??= { campo, motivo: v.motivo };
      continue;
    }
    const cruzado = validarCruzado(t, campo, v.valor);
    if (cruzado) {
      r.error ??= { campo, motivo: cruzado };
      continue;
    }
    const actual = t.datos[campo];
    if (actual?.valor === v.valor) continue;

    if (campo === "curp" && curpContradiceRfcPortal(t, v.valor)) {
      t.porConfirmar = { campo, valor: v.valor };
      r.confirmacion ??=
        `La CURP ${v.valor} no coincide con los datos de tu registro en Infonavit. ¿Es correcta? Respóndeme sí o no.`;
      continue;
    }
    if (actual?.procedencia === "precalificacion" && compactar(actual.valor) === compactar(v.valor)) {
      continue;
    }
    if (actual?.procedencia === "precalificacion") {
      t.porConfirmar = { campo, valor: v.valor };
      r.confirmacion ??=
        `En tu consulta de Infonavit aparece ${def.etiqueta === "empresa" ? "la empresa" : "el " + def.etiqueta} ${actual.valor}. ` +
        `¿Confirmas que el dato correcto es ${v.valor}? Respóndeme sí o no.`;
      continue;
    }
    guardarDato(t, campo, v.valor, ahora);
    r.guardados.push(campo);
  }
  return r;
}

function respuestaPorConfirmar(t: TramiteMejoravit, e: EntradaTramite): ResultadoTramite | null {
  const pc = t.porConfirmar;
  if (!pc) return null;
  const sn = esSiNo(e.texto);
  const reenviado = e.interpretacion?.datos[pc.campo] ?? extraerDirecto(pc.campo, e.texto);
  const mismoValor = typeof reenviado === "string" && compactar(reenviado) === compactar(pc.valor);
  if (sn === "si" || mismoValor) {
    t.porConfirmar = null;
    guardarDato(t, pc.campo, pc.valor, e.ahora);
    return { tramite: t, respuesta: continuar(t, e, "¡Gracias por confirmarlo!") };
  }
  if (sn === "no") {
    t.porConfirmar = null;
    if (t.datos[pc.campo]) {
      return { tramite: t, respuesta: continuar(t, e, "Perfecto, conservo el dato que ya tenía.") };
    }
    t.campoActual = pc.campo;
    t.preguntaAgrupada = false;
    return {
      tramite: t,
      respuesta: unir("Gracias. ¿Me lo compartes de nuevo, por favor?", DEFINICION_CAMPOS[pc.campo].pregunta(t)),
    };
  }
  t.porConfirmar = null;
  return null;
}

function procesarCaptura(
  t: TramiteMejoravit,
  e: EntradaTramite,
  local: IntencionTramite | null,
  reanudando: boolean,
): ResultadoTramite {
  const confirmado = respuestaPorConfirmar(t, e);
  if (confirmado) return confirmado;

  if (!t.campoActual && t.etapa === "captura") t.campoActual = siguienteCampo(t);
  const actual = t.campoActual;
  const interp = e.interpretacion;
  const datos: Partial<Record<CampoCaptura | "celular", string>> = { ...(interp?.datos ?? {}) };
  delete (datos as Record<string, unknown>).nss;

  const directo = extraerDirecto(actual, e.texto);
  if (actual && directo !== null && datos[actual] === undefined) datos[actual] = directo;

  const saludo = REGEX_SALUDO.test(normalizarTexto(e.texto)) && e.texto.length < 40;
  if (!interp && t.etapa === "captura" && actual && directo === null && local === null && !saludo) {
    const bloque = t.preguntaAgrupada ? BLOQUES.find((b) => b.campos[0] === actual) : null;
    if (bloque && BLOQUES_DE_NOMBRE.has(bloque.id)) {
      const separado = separarNombreCompleto(e.texto);
      if (separado) {
        bloque.campos.forEach((c, i) => {
          datos[c] = separado[i];
        });
      }
    } else if (bloque) {
      return { tramite: t, respuesta: unir(MSG_POR_PARTES, preguntar(t, actual, false)) };
    } else {
      datos[actual] = e.texto;
    }
  }

  const aplicado = aplicarDatos(t, datos, e.ahora);
  const intencion = local ?? interp?.intencion ?? (aplicado.guardados.length ? "dato" : "otro");

  if (intencion === "rechaza" && aplicado.guardados.length === 0) {
    const firme = local === "rechaza";
    if (firme || !(actual && DEFINICION_CAMPOS[actual].vacioPermitido)) {
      t.etapa = "rechazado";
      t.interes = "rechaza";
      return { tramite: t, respuesta: MSG_RECHAZO_OFERTA };
    }
  }
  if (intencion === "pausa") {
    t.etapaAntesDePausa = t.etapa === "pausado" ? t.etapaAntesDePausa : t.etapa;
    t.etapa = "pausado";
    return { tramite: t, respuesta: aplicado.guardados.length ? unir("Anotado.", MSG_PAUSA) : MSG_PAUSA };
  }
  const respuestaDuda = interp?.respuesta ?? null;

  if (aplicado.confirmacion) {
    return {
      tramite: t,
      respuesta: unir(respuestaDuda, aplicado.guardados.length ? "¡Gracias!" : null, aplicado.confirmacion),
    };
  }

  if (aplicado.guardados.length > 0) {
    if (aplicado.error) {
      t.campoActual = aplicado.error.campo;
      t.preguntaAgrupada = false;
      return {
        tramite: t,
        respuesta: unir(
          respuestaDuda,
          "¡Gracias!",
          aplicado.error.motivo,
          DEFINICION_CAMPOS[aplicado.error.campo].pregunta(t),
        ),
      };
    }
    if (t.etapa === "completo") {
      const restantes = camposPendientes(t);
      t.campoActual = restantes[0] ?? null;
      return {
        tramite: t,
        respuesta: unir(respuestaDuda, MSG_ACTUALIZADO, restantes.length ? avisoPendientes(restantes, "Sigue") : null),
      };
    }
    return { tramite: t, respuesta: continuar(t, e, unir(respuestaDuda, acuse(t))) };
  }

  if (intencion === "no_lo_tiene" && actual) {
    const def = DEFINICION_CAMPOS[actual];
    if (def.vacioPermitido && !t.preguntaAgrupada) {
      guardarDato(t, actual, "", e.ahora);
      return { tramite: t, respuesta: continuar(t, e, "Perfecto.") };
    }
    const bloque = t.preguntaAgrupada ? BLOQUES.find((b) => b.campos[0] === actual) : null;
    for (const c of bloque ? bloque.campos : [actual]) {
      if (!t.datos[c]) marcarPendiente(t, c, "no_lo_tiene", e.ahora);
    }
    if (t.etapa === "completo") {
      return { tramite: t, respuesta: "Sin problema, queda pendiente." };
    }
    return { tramite: t, respuesta: continuar(t, e, MSG_PENDIENTE_NO_LO_TIENE) };
  }

  if (t.etapa === "completo") {
    if (aplicado.error) return { tramite: t, respuesta: aplicado.error.motivo };
    return { tramite: t, respuesta: respuestaDuda ?? MSG_COMPLETO_RECORDATORIO };
  }

  if (!actual) return { tramite: t, respuesta: continuar(t, e, respuestaDuda) };

  if (saludo && !aplicado.error) {
    return {
      tramite: t,
      respuesta: unir(reanudando ? MSG_REANUDAR : null, respuestaDuda, preguntaActualTexto(t)),
    };
  }

  if (respuestaDuda && !aplicado.error) {
    return { tramite: t, respuesta: unir(respuestaDuda, preguntaActualTexto(t)) };
  }

  const campoError = aplicado.error?.campo ?? actual;
  const intentos = (t.intentos[campoError] ?? 0) + 1;
  if (intentos >= 2 && campoError === actual) {
    marcarPendiente(t, actual, "sin_respuesta_valida", e.ahora);
    return { tramite: t, respuesta: continuar(t, e, MSG_PENDIENTE_INTENTOS) };
  }
  t.intentos[campoError] = intentos;
  t.campoActual = campoError;
  t.preguntaAgrupada = false;
  return {
    tramite: t,
    respuesta: unir(
      aplicado.error?.motivo ?? "No logré identificar el dato.",
      DEFINICION_CAMPOS[campoError].pregunta(t),
    ),
  };
}

function contextoConsulta(t: TramiteMejoravit): ContextoConsulta {
  const etapa = etapaEfectiva(t);
  return {
    momento: etapa === "captura" ? "captura" : etapa === "completo" ? "datos_generales_completos" : "previo",
    montoEstimadoTexto: formatoMonto(t.credito.montoNetoEstimado),
    datosGeneralesPendientes: camposPendientes(t).length,
    seguimiento: SEGUIMIENTO_SIN_INTEGRACION,
  };
}

/**
 * Si Claude no respondió la duda (o no hizo falta llamarlo), usa la respuesta verificada
 * de la base de ConCasa. Una duda sin respuesta confirmada nunca cuenta como dato inválido.
 */
function interpretacionConConsulta(
  t: TramiteMejoravit,
  e: EntradaTramite,
  local: IntencionTramite | null,
): InterpretacionTramite | null {
  const interp = e.interpretacion;
  if (interp?.respuesta || local === "pausa" || local === "rechaza") return interp;
  const pregunta =
    local === "duda" ||
    (interp
      ? interp.intencion === "duda" || interp.intencion === "otro" || /[?¿]/.test(e.texto)
      : esPregunta(e.texto));
  const consulta = pregunta ? detectarConsultaConCasa(e.texto) : null;
  if (consulta) {
    const respuesta = responderConsultaConCasa(consulta, contextoConsulta(t));
    return interp ? { ...interp, respuesta } : { intencion: "duda", datos: {}, respuesta };
  }
  if (interp?.intencion === "duda") return { ...interp, respuesta: MSG_SIN_INFORMACION_CONFIRMADA };
  const enCaptura = ["captura", "completo"].includes(etapaEfectiva(t));
  if (!interp && local === null && enCaptura && /[?¿]/.test(e.texto) && !REGEX_SALUDO.test(normalizarTexto(e.texto))) {
    return { intencion: "duda", datos: {}, respuesta: MSG_SIN_INFORMACION_CONFIRMADA };
  }
  return interp;
}

function iniciarCaptura(t: TramiteMejoravit, e: EntradaTramite, prefijo: string | null): ResultadoTramite {
  t.etapa = "captura";
  t.interes = "acepta";
  return { tramite: t, respuesta: continuar(t, e, prefijo) };
}

/**
 * Avanza el trámite con un mensaje del cliente. Puro: recibe el trámite vigente y la
 * interpretación (si hizo falta Claude) y devuelve el nuevo trámite y la respuesta.
 */
export function avanzarTramite(previo: TramiteMejoravit, entrada: EntradaTramite): ResultadoTramite {
  const t = structuredClone(previo);
  t.ultimaActividadAt = entrada.ahora;
  const local = detectarIntencionLocal(t, entrada.texto);
  const e = { ...entrada, interpretacion: interpretacionConConsulta(t, entrada, local) };
  const intencion = local ?? e.interpretacion?.intencion ?? "otro";
  const duda = e.interpretacion?.respuesta ?? null;
  const reanudando = t.etapa === "pausado";

  if (t.etapa === "pausado") {
    t.etapa = t.etapaAntesDePausa ?? "captura";
    t.etapaAntesDePausa = null;
    if (intencion === "pausa") {
      t.etapaAntesDePausa = t.etapa;
      t.etapa = "pausado";
      return { tramite: t, respuesta: MSG_PAUSA };
    }
    if (t.etapa === "oferta" || t.etapa === "consentimiento") {
      if (intencion !== "acepta" && intencion !== "rechaza") {
        const pregunta = t.etapa === "oferta" ? MSG_PREGUNTA_CONTINUAR : MSG_CONSENTIMIENTO_REPREGUNTA;
        return { tramite: t, respuesta: unir(MSG_REANUDAR, duda, pregunta) };
      }
    }
  }

  if (intencion === "pausa" && t.etapa !== "rechazado") {
    t.etapaAntesDePausa = t.etapa;
    t.etapa = "pausado";
    return { tramite: t, respuesta: MSG_PAUSA };
  }

  switch (t.etapa) {
    case "rechazado":
      if (intencion === "acepta") {
        return t.consentimiento?.aceptado
          ? iniciarCaptura(t, e, "¡Qué gusto! Seguimos con tu trámite.")
          : aceptarOferta(t, e);
      }
      if (intencion === "duda" && duda) return { tramite: t, respuesta: duda };
      t.etapa = "oferta";
      t.interes = "pendiente";
      return { tramite: t, respuesta: mensajeReoferta(t.credito.montoNetoEstimado) };
    case "oferta":
      if (intencion === "acepta") {
        return t.consentimiento?.aceptado
          ? iniciarCaptura(t, e, "¡Excelente! 🙌")
          : aceptarOferta(t, e);
      }
      if (intencion === "rechaza") {
        t.etapa = "rechazado";
        t.interes = "rechaza";
        return { tramite: t, respuesta: MSG_RECHAZO_OFERTA };
      }
      return { tramite: t, respuesta: unir(duda, MSG_PREGUNTA_CONTINUAR) };
    case "consentimiento":
      if (intencion === "acepta") {
        t.consentimiento = { aceptado: true, respondidoAt: e.ahora };
        return iniciarCaptura(t, e, MSG_INICIO_CAPTURA);
      }
      if (intencion === "rechaza") {
        t.consentimiento = { aceptado: false, respondidoAt: e.ahora };
        return { tramite: t, respuesta: MSG_SIN_CONSENTIMIENTO };
      }
      return { tramite: t, respuesta: unir(duda, MSG_CONSENTIMIENTO_REPREGUNTA) };
    case "captura":
    case "completo":
    default:
      return procesarCaptura(t, e, local, reanudando);
  }
}

function aceptarOferta(t: TramiteMejoravit, e: EntradaTramite): ResultadoTramite {
  t.etapa = "consentimiento";
  t.interes = "acepta";
  return { tramite: t, respuesta: mensajeConsentimiento(e.urlAvisoPrivacidad) };
}

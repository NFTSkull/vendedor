const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });

const express = require("express");
const { generarRespuesta, extraerNssSiValido } = require("./generarRespuesta");

const app = express();

/**
 * @typedef {{ estado: string, nss: string | null, mensajes: Array<{ texto: string, ts: string }> }} RegistroUsuario
 * @type {Record<string, RegistroUsuario>}
 */
const usuarios = {};

/** @returns {RegistroUsuario} */
function normalizarRegistroUsuario(raw) {
  if (typeof raw === "string") {
    return { estado: raw, nss: null, mensajes: [] };
  }
  if (!raw || typeof raw !== "object") {
    return { estado: "inicio", nss: null, mensajes: [] };
  }
  const mensajesRaw = Array.isArray(raw.mensajes) ? raw.mensajes : [];
  const mensajes = mensajesRaw
    .map((m) => {
      if (typeof m === "string") return { texto: m, ts: new Date(0).toISOString() };
      if (m && typeof m === "object" && typeof m.texto === "string") {
        return {
          texto: m.texto,
          ts: typeof m.ts === "string" ? m.ts : new Date().toISOString()
        };
      }
      return null;
    })
    .filter(Boolean);
  return {
    estado: typeof raw.estado === "string" ? raw.estado : "inicio",
    nss: raw.nss == null || raw.nss === "" ? null : String(raw.nss),
    mensajes
  };
}

/** @returns {RegistroUsuario} */
function obtenerRegistroUsuario(waId) {
  const prev = usuarios[waId];
  const reg = normalizarRegistroUsuario(prev);
  usuarios[waId] = reg;
  return reg;
}

const USUARIOS_PATH = path.join(__dirname, "usuarios.json");

function cargarUsuarios() {
  try {
    if (!fs.existsSync(USUARIOS_PATH)) return;
    const raw = fs.readFileSync(USUARIOS_PATH, "utf8");
    if (!raw.trim()) return;
    const data = JSON.parse(raw);
    if (data && typeof data === "object" && !Array.isArray(data)) {
      for (const [waId, val] of Object.entries(data)) {
        usuarios[waId] = normalizarRegistroUsuario(val);
      }
    }
  } catch (err) {
    if (err && err.code === "ENOENT") return;
    console.error("Error leyendo usuarios.json:", err);
  }
}

async function guardarUsuarios() {
  try {
    await fs.promises.writeFile(USUARIOS_PATH, JSON.stringify(usuarios, null, 2), "utf8");
  } catch (err) {
    console.error("Error guardando usuarios.json:", err);
  }
}

const PRECALIFICAR_URL = process.env.PRECALIFICAR_URL || "https://mi-api.com/precalificar";

/**
 * @returns {Promise<{ ok: boolean, aprobado: boolean, monto: number | null, error?: unknown }>}
 */
async function precalificar(nss) {
  try {
    const resp = await fetch(PRECALIFICAR_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nss })
    });

    const contentType = resp.headers.get("content-type") || "";
    let data = null;
    try {
      if (contentType.includes("application/json")) data = await resp.json();
      else {
        const t = await resp.text();
        if (!t) data = null;
        else {
          try {
            data = JSON.parse(t);
          } catch {
            data = { raw: t };
          }
        }
      }
    } catch (e) {
      console.error("Precalificar: lectura de body", e);
      data = null;
    }

    if (!resp.ok) {
      console.error("Precalificar HTTP:", resp.status, data);
      return { ok: false, aprobado: false, monto: null, error: data ?? resp.statusText };
    }

    const montoRaw = data && Object.prototype.hasOwnProperty.call(data, "monto") ? data.monto : null;
    const monto = typeof montoRaw === "number" ? montoRaw : Number(montoRaw);
    if (!Number.isFinite(monto)) {
      console.error("Precalificar: monto inválido", data);
      return { ok: false, aprobado: false, monto: null, error: "monto_invalido" };
    }

    const aprobado =
      data && Object.prototype.hasOwnProperty.call(data, "aprobado") ? Boolean(data.aprobado) : true;

    return {
      ok: true,
      aprobado,
      monto
    };
  } catch (err) {
    console.error("Precalificar error:", err);
    return { ok: false, aprobado: false, monto: null, error: err };
  }
}

const LEAD_URL = process.env.LEAD_URL || "https://mi-api.com/lead";

async function enviarLeadExterno({ waId, nss, fecha, mensajes }) {
  try {
    const resp = await fetch(LEAD_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ waId, nss, fecha, mensajes })
    });

    let detalle = null;
    try {
      detalle = await resp.text();
    } catch {
      detalle = null;
    }

    if (!resp.ok) {
      console.error("Lead: error HTTP", resp.status, detalle);
      return;
    }

    console.log("Lead enviado correctamente:", waId);
  } catch (err) {
    console.error("Lead: error", err);
  }
}

const LEADS_PATH = path.join(__dirname, "leads.json");

async function guardarLeadLocal({ waId, nss, fecha, mensajes }) {
  try {
    let lista = [];
    try {
      if (fs.existsSync(LEADS_PATH)) {
        const raw = await fs.promises.readFile(LEADS_PATH, "utf8");
        if (raw.trim()) {
          const parsed = JSON.parse(raw);
          lista = Array.isArray(parsed) ? parsed : [parsed];
        }
      }
    } catch (err) {
      console.error("leads.json: contenido inválido, se reinicia la lista", err);
      lista = [];
    }

    lista.push({ waId, nss, fecha, mensajes });
    await fs.promises.writeFile(LEADS_PATH, JSON.stringify(lista, null, 2), "utf8");
    console.log("Lead guardado en leads.json:", waId);
  } catch (err) {
    console.error("Lead local: error guardando leads.json", err);
  }
}

async function leerLeadsArchivo() {
  try {
    if (!fs.existsSync(LEADS_PATH)) return [];
    const raw = await fs.promises.readFile(LEADS_PATH, "utf8");
    if (!raw.trim()) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch (err) {
    console.error("Error leyendo leads.json:", err);
    return [];
  }
}

const PORT = Number(process.env.PORT || 3000);
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "";
const WHATSAPP_ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN || "";
const WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID || "";
const GRAPH_API_VERSION = process.env.GRAPH_API_VERSION || "v22.0";

app.use(express.json({ limit: "2mb" }));

app.get("/api/leads", async (req, res) => {
  const lista = await leerLeadsArchivo();
  res.json(lista);
});

app.get("/leads", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "leads.html"));
});

app.get("/chat", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "chat.html"));
});

app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }

  return res.sendStatus(403);
});

async function sendWhatsAppText({ to, body }) {
  if (!WHATSAPP_ACCESS_TOKEN || !WHATSAPP_PHONE_NUMBER_ID) {
    console.warn(
      "No se envió respuesta: faltan WHATSAPP_ACCESS_TOKEN o WHATSAPP_PHONE_NUMBER_ID en .env"
    );
    return { ok: false, status: 0, data: null, error: "missing_env" };
  }

  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${WHATSAPP_PHONE_NUMBER_ID}/messages`;
  console.log("WhatsApp API prefetch token(10):", WHATSAPP_ACCESS_TOKEN.slice(0, 10));
  console.log("WhatsApp API prefetch phone_number_id:", WHATSAPP_PHONE_NUMBER_ID);
  console.log("WhatsApp API URL:", url);

  const payload = {
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: { body }
  };
  console.log("WhatsApp API headers:", {
    Authorization: `Bearer ${WHATSAPP_ACCESS_TOKEN.slice(0, 10)}...`,
    "Content-Type": "application/json"
  });
  console.log("WhatsApp API body:", payload);

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const status = resp.status;
  const contentType = resp.headers.get("content-type") || "";

  let data = null;
  try {
    if (contentType.includes("application/json")) data = await resp.json();
    else data = await resp.text();
  } catch (e) {
    data = { parse_error: String(e) };
  }

  console.log("WhatsApp API status:", status);
  console.log("WhatsApp API response:", data);

  return { ok: resp.ok, status, data };
}

/**
 * @param {{ waId: string, texto: string, enviarWhatsApp?: boolean }} params
 * @returns {Promise<{ respuesta: string, estado: string }>}
 */
async function procesarMensajeUsuario({ waId, texto, enviarWhatsApp = false }) {
  const reg = obtenerRegistroUsuario(waId);

  reg.mensajes.push({ texto, ts: new Date().toISOString() });

  const nssDetectado = extraerNssSiValido(texto);
  if (nssDetectado) reg.nss = nssDetectado;

  const estadoActual = reg.estado ?? "inicio";
  const { respuesta, nuevoEstado } = generarRespuesta(texto, estadoActual);

  let cuerpoRespuesta = respuesta;
  if (nssDetectado && estadoActual === "nss") {
    console.log(`Nuevo lead con NSS: ${waId} - NSS: ${nssDetectado}`);
    const fecha = new Date().toISOString();
    const mensajes = reg.mensajes.map((m) => ({ ...m }));
    const resultados = await Promise.all([
      enviarLeadExterno({ waId, nss: nssDetectado, fecha, mensajes }),
      precalificar(nssDetectado),
      guardarLeadLocal({ waId, nss: nssDetectado, fecha, mensajes })
    ]);
    const pre = resultados[1];
    if (pre.ok && pre.aprobado && pre.monto != null) {
      cuerpoRespuesta =
        "Listo ✅\n" +
        `Revisé tu información y puedes acceder a un monto aproximado de $${pre.monto}\n` +
        "¿te explico cómo puedes utilizarlo?";
    }
  }

  reg.estado = nuevoEstado;
  await guardarUsuarios();

  if (enviarWhatsApp) {
    const result = await sendWhatsAppText({ to: waId, body: cuerpoRespuesta });
    if (result.ok) console.log(`Respuesta enviada a ${waId} (estado -> ${nuevoEstado})`);
    else console.warn(`No se confirmó envío a ${waId} (estado -> ${nuevoEstado})`);
  }

  return { respuesta: cuerpoRespuesta, estado: nuevoEstado };
}

app.post("/test", async (req, res) => {
  try {
    const { waId, texto } = req.body || {};
    if (typeof waId !== "string" || !waId.trim()) {
      return res.status(400).json({ error: "waId requerido" });
    }
    if (typeof texto !== "string") {
      return res.status(400).json({ error: "texto requerido" });
    }
    const out = await procesarMensajeUsuario({
      waId: waId.trim(),
      texto,
      enviarWhatsApp: false
    });
    return res.json({ respuesta: out.respuesta, estado: out.estado });
  } catch (err) {
    console.error("POST /test:", err);
    return res.status(500).json({ error: "error_interno" });
  }
});

app.post("/webhook", async (req, res) => {
  console.log("Webhook recibido:");
  console.dir(req.body, { depth: null });

  try {
    const entry = req.body?.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    const message = value?.messages?.[0];

    const isText = message?.type === "text" && typeof message?.text?.body === "string";
    if (isText) {
      const waId = message.from;
      if (typeof waId === "string" && waId.length > 0) {
        await procesarMensajeUsuario({
          waId,
          texto: message.text.body,
          enviarWhatsApp: true
        });
      }
    }
  } catch (err) {
    console.error("Error procesando webhook:", err);
    // Igual respondemos 200 para que WhatsApp no reintente en loop
  }

  return res.sendStatus(200);
});

cargarUsuarios();

app.listen(PORT, () => {
  console.log(process.env.WHATSAPP_ACCESS_TOKEN);
  console.log(process.env.WHATSAPP_PHONE_NUMBER_ID);
  console.log(`Servidor escuchando en http://localhost:${PORT}`);
});


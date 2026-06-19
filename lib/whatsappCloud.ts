/** Envía texto por WhatsApp Cloud API (Graph). */
export async function enviarMensajeTextoWa(params: {
  phoneNumberId: string;
  accessToken: string;
  graphVersion?: string;
  to: string;
  body: string;
}): Promise<{ ok: boolean; status: number; data: unknown }> {
  const v = params.graphVersion ?? "v19.0";
  const url = `https://graph.facebook.com/${v}/${params.phoneNumberId}/messages`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: params.to,
      type: "text",
      text: { body: params.body },
    }),
  });

  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }

  return { ok: res.ok, status: res.status, data };
}

export type WaMediaTipo = "image" | "document";

const MIMES_IMAGEN_WA = new Set(["image/jpeg", "image/png"]);

export function resolverTipoWaMedia(mimeType: string): WaMediaTipo {
  return MIMES_IMAGEN_WA.has(mimeType) ? "image" : "document";
}

export type SubirMediaWaResult =
  | { ok: true; mediaId: string }
  | { ok: false; status: number; data: unknown };

/** Sube binario a Meta; devuelve media_id para enviar mensaje. */
export async function subirMediaWa(params: {
  phoneNumberId: string;
  accessToken: string;
  graphVersion?: string;
  buffer: ArrayBuffer | Uint8Array;
  mimeType: string;
  filename: string;
}): Promise<SubirMediaWaResult> {
  const v = params.graphVersion ?? "v19.0";
  const url = `https://graph.facebook.com/${v}/${params.phoneNumberId}/media`;

  const bytes =
    params.buffer instanceof Uint8Array
      ? params.buffer
      : new Uint8Array(params.buffer);

  const blobBytes = new Uint8Array(bytes);

  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("type", params.mimeType);
  form.append(
    "file",
    new Blob([blobBytes], { type: params.mimeType }),
    params.filename,
  );

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
    },
    body: form,
  });

  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }

  if (!res.ok) {
    return { ok: false, status: res.status, data };
  }

  const id =
    data &&
    typeof data === "object" &&
    typeof (data as { id?: unknown }).id === "string"
      ? (data as { id: string }).id
      : null;

  if (!id) {
    return { ok: false, status: res.status, data };
  }

  return { ok: true, mediaId: id };
}

export async function enviarMediaWa(params: {
  phoneNumberId: string;
  accessToken: string;
  graphVersion?: string;
  to: string;
  mediaId: string;
  tipo: WaMediaTipo;
  filename?: string;
  caption?: string;
}): Promise<{ ok: boolean; status: number; data: unknown }> {
  const v = params.graphVersion ?? "v19.0";
  const url = `https://graph.facebook.com/${v}/${params.phoneNumberId}/messages`;

  const caption = params.caption?.trim() || undefined;

  const payload: Record<string, unknown> = {
    messaging_product: "whatsapp",
    to: params.to,
    type: params.tipo,
  };

  if (params.tipo === "image") {
    payload.image = {
      id: params.mediaId,
      ...(caption ? { caption } : {}),
    };
  } else {
    payload.document = {
      id: params.mediaId,
      ...(params.filename ? { filename: params.filename } : {}),
      ...(caption ? { caption } : {}),
    };
  }

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }

  return { ok: res.ok, status: res.status, data };
}

/** Errores típicos de Meta fuera de la ventana de 24 h de mensaje libre. */
export function esErrorVentana24hWhatsApp(data: unknown): boolean {
  if (!data || typeof data !== "object") return false;
  const err = (data as {
    error?: { code?: number; message?: string; error_subcode?: number };
  }).error;
  if (!err) return false;

  const code = err.code;
  const sub = err.error_subcode;
  if (code === 131047 || code === 131026 || sub === 2494055) {
    return true;
  }

  const msg = (err.message ?? "").toLowerCase();
  return (
    msg.includes("24 hour") ||
    msg.includes("24 hours") ||
    msg.includes("re-engagement") ||
    msg.includes("reengagement")
  );
}

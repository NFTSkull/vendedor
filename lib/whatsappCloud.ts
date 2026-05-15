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

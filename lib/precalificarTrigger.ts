export async function dispararPrecalificacion({
  nss,
  conversationId,
  phoneNumber,
}: {
  nss: string;
  conversationId: string;
  phoneNumber: string;
}) {
  try {
    await enviarMensajeEspera(phoneNumber);
    fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/precalificar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nss, conversationId, phoneNumber }),
    }).catch((err) => console.error("Error precalificación:", err));
  } catch (error) {
    console.error("Error dispararPrecalificacion:", error);
  }
}

async function enviarMensajeEspera(phoneNumber: string) {
  await fetch(
    `https://graph.facebook.com/v19.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: phoneNumber,
        type: "text",
        text: {
          body: "⏳ Estoy consultando tu información en Infonavit...\n\nEsto tarda unos segundos, enseguida te doy el resultado. 🔍",
        },
      }),
    },
  );
}

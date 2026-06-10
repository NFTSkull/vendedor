import webpush from "web-push";

import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

type PushSubscriptionRow = {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

let vapidConfigured = false;

function ensureVapidConfig(): boolean {
  if (vapidConfigured) return true;
  const subject = process.env.VAPID_SUBJECT;
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!subject || !publicKey || !privateKey) {
    return false;
  }
  webpush.setVapidDetails(subject, publicKey, privateKey);
  vapidConfigured = true;
  return true;
}

async function enviarPushPayload(
  payload: {
    title: string;
    body: string;
    url: string;
  },
  advisorId?: string | null,
): Promise<void> {
  if (!ensureVapidConfig()) {
    return;
  }

  const supabase = getSupabaseAdmin();
  let subsQuery = supabase
    .from("crm_push_subscriptions")
    .select("id, endpoint, p256dh, auth");

  if (advisorId) {
    subsQuery = subsQuery.eq("advisor_id", advisorId);
  }

  const { data, error } = await subsQuery;

  if (error) {
    console.error("[push] Error listando subscripciones:", error);
    return;
  }

  const subscriptions = (data ?? []) as PushSubscriptionRow[];
  if (subscriptions.length === 0) return;

  const payloadJson = JSON.stringify(payload);

  for (const sub of subscriptions) {
    try {
      await webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: {
            p256dh: sub.p256dh,
            auth: sub.auth,
          },
        },
        payloadJson,
      );
    } catch (err: unknown) {
      const statusCode =
        typeof err === "object" && err !== null && "statusCode" in err
          ? Number((err as { statusCode?: number }).statusCode)
          : 0;
      if (statusCode === 404 || statusCode === 410) {
        await supabase.from("crm_push_subscriptions").delete().eq("id", sub.id);
      } else {
        console.error("[push] Error enviando notificación:", err);
      }
    }
  }
}

export async function enviarPushNuevoLead(args: {
  leadId: string;
  telefono: string;
  horario: string | null | undefined;
  advisorId?: string | null;
}): Promise<void> {
  const horario = args.horario && args.horario.trim() ? args.horario : "Sin horario";
  await enviarPushPayload(
    {
      title: "Nuevo lead Mejoravit",
      body: `Teléfono: ${args.telefono} | Horario: ${horario}`,
      url: `/crm/leads/${args.leadId}`,
    },
    args.advisorId,
  );
}

export async function enviarPushNuevoMensaje(args: {
  leadId: string;
  telefono: string;
  mensaje: string;
  advisorId?: string | null;
}): Promise<void> {
  await enviarPushPayload(
    {
      title: `Nuevo mensaje de ${args.telefono}`,
      body: args.mensaje.trim().slice(0, 60),
      url: `/crm/leads/${args.leadId}/chat`,
    },
    args.advisorId,
  );
}

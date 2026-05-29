import { z } from "zod";

import { requireCrmAuth } from "@/lib/crmAuth";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

const SubscribeSchema = z.object({
  subscription: z.object({
    endpoint: z.string().url(),
    keys: z.object({
      p256dh: z.string().min(1),
      auth: z.string().min(1),
    }),
  }),
});

export async function POST(req: Request): Promise<Response> {
  try {
    const auth = await requireCrmAuth(req);
    if (!auth) {
      return Response.json({ error: "No autorizado" }, { status: 401 });
    }

    const body = await req.json();
    const parsed = SubscribeSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json({ error: "Body inválido" }, { status: 400 });
    }

    const sub = parsed.data.subscription;
    const supabase = getSupabaseAdmin();

    const { data: existing } = await supabase
      .from("crm_push_subscriptions")
      .select("id")
      .eq("endpoint", sub.endpoint)
      .maybeSingle();

    if (existing?.id) {
      const { error: updateError } = await supabase
        .from("crm_push_subscriptions")
        .update({
          advisor_id: auth.sub,
          p256dh: sub.keys.p256dh,
          auth: sub.keys.auth,
          user_agent: req.headers.get("user-agent"),
          updated_at: new Date().toISOString(),
        })
        .eq("id", existing.id);

      if (updateError) {
        console.error("[CRM push subscribe] Error actualizando:", updateError);
        return Response.json({ error: "Error interno" }, { status: 500 });
      }
    } else {
      const { error: insertError } = await supabase.from("crm_push_subscriptions").insert({
        advisor_id: auth.sub,
        endpoint: sub.endpoint,
        p256dh: sub.keys.p256dh,
        auth: sub.keys.auth,
        user_agent: req.headers.get("user-agent"),
      });

      if (insertError) {
        console.error("[CRM push subscribe] Error insertando:", insertError);
        return Response.json({ error: "Error interno" }, { status: 500 });
      }
    }

    return Response.json({ ok: true }, { status: 200 });
  } catch (err) {
    console.error("[CRM push subscribe] Error:", err);
    return Response.json({ error: "Error interno" }, { status: 500 });
  }
}

import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export type WhatsAppAccountMode = "cloud_only" | "coexistence";

export type WhatsAppAccountSource = "db" | "env";

export type WhatsAppAccountResolved = {
  owner: string;
  mode: WhatsAppAccountMode;
  phoneNumberId: string;
  accessToken: string;
  displayPhoneNumber: string | null;
  verifiedName: string | null;
  wabaId: string | null;
  businessId: string | null;
  source: WhatsAppAccountSource;
};

type WhatsAppAccountRow = {
  owner: string;
  mode: string;
  phone_number_id: string;
  access_token: string | null;
  display_phone_number: string | null;
  verified_name: string | null;
  waba_id: string | null;
  business_id: string | null;
};

function rowToResolved(row: WhatsAppAccountRow): WhatsAppAccountResolved | null {
  const accessToken = row.access_token?.trim();
  const phoneNumberId = row.phone_number_id?.trim();
  if (!accessToken || !phoneNumberId) return null;
  if (row.mode !== "cloud_only" && row.mode !== "coexistence") return null;

  return {
    owner: row.owner,
    mode: row.mode,
    phoneNumberId,
    accessToken,
    displayPhoneNumber: row.display_phone_number ?? null,
    verifiedName: row.verified_name ?? null,
    wabaId: row.waba_id ?? null,
    businessId: row.business_id ?? null,
    source: "db",
  };
}

async function lookupActiveAccountByPhoneNumberId(
  phoneNumberId: string,
): Promise<WhatsAppAccountResolved | null> {
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("whatsapp_accounts")
      .select(
        "owner, mode, phone_number_id, access_token, display_phone_number, verified_name, waba_id, business_id",
      )
      .eq("phone_number_id", phoneNumberId)
      .eq("is_active", true)
      .maybeSingle();

    if (error || !data) return null;
    return rowToResolved(data as WhatsAppAccountRow);
  } catch {
    return null;
  }
}

function resolveFromEnv(): WhatsAppAccountResolved | null {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID?.trim();
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN?.trim();
  if (!phoneNumberId || !accessToken) return null;

  const wabaId = process.env.WHATSAPP_WABA_ID?.trim();

  return {
    owner: process.env.WHATSAPP_DEFAULT_OWNER?.trim() || "bot_principal",
    mode: "cloud_only",
    phoneNumberId,
    accessToken,
    displayPhoneNumber: null,
    verifiedName: null,
    wabaId: wabaId || null,
    businessId: null,
    source: "env",
  };
}

/**
 * Resuelve credenciales WhatsApp Cloud API por phone_number_id del webhook o fallback env.
 * Con tabla vacía y sin phoneNumberId en el evento, equivale al comportamiento actual (solo env).
 */
export async function resolveWhatsAppAccount(
  phoneNumberIdFromWebhook?: string,
): Promise<WhatsAppAccountResolved | null> {
  const phoneNumberId = phoneNumberIdFromWebhook?.trim();
  if (phoneNumberId) {
    const fromDb = await lookupActiveAccountByPhoneNumberId(phoneNumberId);
    if (fromDb) return fromDb;
  }

  return resolveFromEnv();
}

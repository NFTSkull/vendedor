import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const JEFE1_OWNER = "jefe_1" as const;

export type EmbeddedSignupSessionInfo = {
  phone_number_id?: string;
  waba_id?: string;
  business_id?: string;
  display_phone_number?: string;
  verified_name?: string;
};

export type EmbeddedSignupInput = {
  code: string;
  sessionInfo?: EmbeddedSignupSessionInfo;
};

export type EmbeddedSignupPersisted = {
  owner: typeof JEFE1_OWNER;
  mode: "coexistence";
  phone_number_id: string;
  display_phone_number: string | null;
  verified_name: string | null;
  waba_id: string | null;
  business_id: string | null;
  status: "created" | "updated";
};

export type EmbeddedSignupPublicResponse = EmbeddedSignupPersisted & {
  source: "embedded_signup_v3";
};

export function getMetaGraphApiVersion(): string {
  return (
    process.env.META_GRAPH_API_VERSION?.trim() ||
    process.env.WHATSAPP_GRAPH_API_VERSION?.trim() ||
    "v19.0"
  );
}

export function validateWhatsAppSetupToken(token: string | null | undefined): boolean {
  const expected = process.env.WHATSAPP_SETUP_TOKEN?.trim();
  const received = token?.trim();
  if (!expected || !received) return false;
  if (expected.length !== received.length) return false;
  let mismatch = 0;
  for (let i = 0; i < expected.length; i++) {
    mismatch |= expected.charCodeAt(i) ^ received.charCodeAt(i);
  }
  return mismatch === 0;
}

/** Parsea sessionInfo del listener WA_EMBEDDED_SIGNUP o body del cliente. */
export function parseEmbeddedSignupSessionInfo(
  raw: unknown,
): EmbeddedSignupSessionInfo | undefined {
  if (!raw || typeof raw !== "object") return undefined;

  const root = raw as Record<string, unknown>;
  const data =
    root.data && typeof root.data === "object"
      ? (root.data as Record<string, unknown>)
      : root;

  const pick = (obj: Record<string, unknown>, keys: string[]): string | undefined => {
    for (const key of keys) {
      const v = obj[key];
      if (typeof v === "string" && v.trim()) return v.trim();
      if (typeof v === "number" && Number.isFinite(v)) return String(v);
    }
    return undefined;
  };

  const phone_number_id = pick(data, [
    "phone_number_id",
    "phoneNumberId",
    "business_phone_number_id",
  ]);
  const waba_id = pick(data, ["waba_id", "wabaId", "whatsapp_business_account_id"]);
  const business_id = pick(data, ["business_id", "businessId"]);
  const display_phone_number = pick(data, [
    "display_phone_number",
    "displayPhoneNumber",
  ]);
  const verified_name = pick(data, ["verified_name", "verifiedName"]);

  if (
    !phone_number_id &&
    !waba_id &&
    !business_id &&
    !display_phone_number &&
    !verified_name
  ) {
    return undefined;
  }

  return {
    phone_number_id,
    waba_id,
    business_id,
    display_phone_number,
    verified_name,
  };
}

export function toEmbeddedSignupPublicResponse(
  account: EmbeddedSignupPersisted,
): EmbeddedSignupPublicResponse {
  return {
    ...account,
    source: "embedded_signup_v3",
  };
}

export async function exchangeEmbeddedSignupCode(
  code: string,
): Promise<{ accessToken: string }> {
  const appId = process.env.NEXT_PUBLIC_META_APP_ID?.trim();
  const appSecret = process.env.META_APP_SECRET?.trim();
  if (!appId || !appSecret) {
    throw new Error("META_OAUTH_NOT_CONFIGURED");
  }

  const version = getMetaGraphApiVersion();
  const params = new URLSearchParams({
    client_id: appId,
    client_secret: appSecret,
    code: code.trim(),
  });

  const redirectUri =
    process.env.META_OAUTH_REDIRECT_URI?.trim() ||
    (process.env.NEXT_PUBLIC_APP_URL
      ? `${process.env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "")}/conectar-whatsapp`
      : "");
  if (redirectUri) {
    params.set("redirect_uri", redirectUri);
  }

  const url = `https://graph.facebook.com/${version}/oauth/access_token?${params.toString()}`;
  const res = await fetch(url, { method: "GET" });
  const data = (await res.json()) as {
    access_token?: string;
    error?: { message?: string; type?: string; code?: number };
  };

  if (!res.ok || !data.access_token) {
    const detail = data.error?.message ?? `HTTP ${res.status}`;
    throw new Error(`META_TOKEN_EXCHANGE_FAILED:${detail}`);
  }

  return { accessToken: data.access_token };
}

async function fetchPhoneNumberFields(
  phoneNumberId: string,
  accessToken: string,
): Promise<{ display_phone_number?: string; verified_name?: string }> {
  const version = getMetaGraphApiVersion();
  const fields = "display_phone_number,verified_name";
  const url = `https://graph.facebook.com/${version}/${phoneNumberId}?fields=${fields}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return {};

  const data = (await res.json()) as {
    display_phone_number?: string;
    verified_name?: string;
  };
  return {
    display_phone_number: data.display_phone_number,
    verified_name: data.verified_name,
  };
}

export async function completeEmbeddedSignupJefe1(
  input: EmbeddedSignupInput,
): Promise<EmbeddedSignupPersisted> {
  const session = input.sessionInfo ?? {};
  const { accessToken } = await exchangeEmbeddedSignupCode(input.code);

  const phoneNumberId = session.phone_number_id?.trim();
  if (!phoneNumberId) {
    throw new Error("MISSING_PHONE_NUMBER_ID");
  }

  let displayPhone = session.display_phone_number ?? null;
  let verifiedName = session.verified_name ?? null;

  if (!displayPhone || !verifiedName) {
    const fields = await fetchPhoneNumberFields(phoneNumberId, accessToken);
    displayPhone = displayPhone ?? fields.display_phone_number ?? null;
    verifiedName = verifiedName ?? fields.verified_name ?? null;
  }

  const row = {
    owner: JEFE1_OWNER,
    mode: "coexistence" as const,
    business_id: session.business_id ?? null,
    waba_id: session.waba_id ?? null,
    phone_number_id: phoneNumberId,
    display_phone_number: displayPhone,
    verified_name: verifiedName,
    access_token: accessToken,
    is_active: true,
    is_default: false,
    updated_at: new Date().toISOString(),
  };

  const supabase = getSupabaseAdmin();
  const { data: existing } = await supabase
    .from("whatsapp_accounts")
    .select("id")
    .eq("phone_number_id", phoneNumberId)
    .maybeSingle();

  if (existing?.id) {
    const { error } = await supabase
      .from("whatsapp_accounts")
      .update(row)
      .eq("id", existing.id);
    if (error) throw new Error(`SUPABASE_UPDATE_FAILED:${error.message}`);
    return {
      owner: JEFE1_OWNER,
      mode: "coexistence",
      phone_number_id: phoneNumberId,
      display_phone_number: displayPhone,
      verified_name: verifiedName,
      waba_id: session.waba_id ?? null,
      business_id: session.business_id ?? null,
      status: "updated",
    };
  }

  const { error: insertError } = await supabase.from("whatsapp_accounts").insert(row);
  if (insertError) throw new Error(`SUPABASE_INSERT_FAILED:${insertError.message}`);

  return {
    owner: JEFE1_OWNER,
    mode: "coexistence",
    phone_number_id: phoneNumberId,
    display_phone_number: displayPhone,
    verified_name: verifiedName,
    waba_id: session.waba_id ?? null,
    business_id: session.business_id ?? null,
    status: "created",
  };
}

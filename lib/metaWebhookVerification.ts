/**
 * Verificación webhook Meta (WhatsApp Cloud API): GET hub.* query params.
 * @returns challange response si coincide; si no, null para responder 403.
 */
export function getMetaWebhookVerificationResponse(
  searchParams: URLSearchParams,
  expectedVerifyToken: string | undefined,
): Response | null {
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  if (
    mode !== "subscribe" ||
    expectedVerifyToken == null ||
    expectedVerifyToken === "" ||
    token !== expectedVerifyToken ||
    challenge == null
  ) {
    return null;
  }

  return new Response(challenge, {
    status: 200,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

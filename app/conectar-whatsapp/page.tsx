import ConectarWhatsAppClient from "@/app/conectar-whatsapp/ConectarWhatsAppClient";
import { validateWhatsAppSetupToken } from "@/lib/metaEmbeddedSignup";

type PageProps = {
  searchParams: Promise<{ setup_token?: string }>;
};

/**
 * Puerta server-side: el SDK y FB.login viven en ConectarWhatsAppClient (client).
 * El secret WHATSAPP_SETUP_TOKEN nunca se expone al bundle del navegador.
 */
export default async function ConectarWhatsAppPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const setupToken = sp.setup_token?.trim() ?? "";
  const authorized = validateWhatsAppSetupToken(setupToken);

  const metaAppId = process.env.NEXT_PUBLIC_META_APP_ID?.trim() ?? "";
  const configId = process.env.NEXT_PUBLIC_META_EMBEDDED_SIGNUP_CONFIG_ID?.trim() ?? "";

  return (
    <ConectarWhatsAppClient
      authorized={authorized}
      setupToken={authorized ? setupToken : ""}
      metaAppId={metaAppId}
      configId={configId}
    />
  );
}

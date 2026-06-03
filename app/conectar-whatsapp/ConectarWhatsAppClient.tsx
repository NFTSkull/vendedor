"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type FbLoginResponse = {
  authResponse?: { code?: string };
  status?: string;
};

type WaEmbeddedSignupMessage = {
  type?: string;
  event?: string;
  data?: Record<string, unknown>;
};

declare global {
  interface Window {
    FB?: {
      init: (params: {
        appId: string;
        cookie?: boolean;
        xfbml?: boolean;
        version: string;
      }) => void;
      login: (
        callback: (response: FbLoginResponse) => void,
        options: Record<string, unknown>,
      ) => void;
    };
    fbAsyncInit?: () => void;
  }
}

export const SIGNUP_CLIENT_VERSION = "sdk-fbasyncinit-1";

const FB_SDK_VERSION = "v19.0";
const FB_SDK_SCRIPT_ID = "facebook-jssdk";
const FB_SDK_SRC = "https://connect.facebook.net/en_US/sdk.js";

type Props = {
  authorized: boolean;
  setupToken: string;
  metaAppId: string;
  configId: string;
};

function boolLabel(value: boolean): string {
  return value ? "true" : "false";
}

export default function ConectarWhatsAppClient({
  authorized,
  setupToken,
  metaAppId,
  configId,
}: Props) {
  const [sdkReady, setSdkReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [lastSdkEvent, setLastSdkEvent] = useState("idle");
  const [lastError, setLastError] = useState("");
  const sessionInfoRef = useRef<Record<string, unknown> | null>(null);
  const sdkInitStartedRef = useRef(false);

  const hasMetaAppId = Boolean(metaAppId?.trim());
  const hasConfigId = Boolean(configId?.trim());
  const hasMetaConfig = hasMetaAppId && hasConfigId;

  const onMessage = useCallback((event: MessageEvent) => {
    if (event.origin !== "https://www.facebook.com") return;
    if (typeof event.data !== "string") return;

    try {
      const payload = JSON.parse(event.data) as WaEmbeddedSignupMessage;
      if (payload.type !== "WA_EMBEDDED_SIGNUP") return;
      if (payload.event === "FINISH" || payload.event === "FINISH_ONLY_WABA") {
        sessionInfoRef.current = payload.data ?? null;
        setLastSdkEvent(`WA_EMBEDDED_SIGNUP:${payload.event}`);
      }
    } catch {
      // ignorar mensajes no JSON del SDK
    }
  }, []);

  useEffect(() => {
    if (!authorized || !hasMetaAppId) return;
    if (sdkInitStartedRef.current) return;
    sdkInitStartedRef.current = true;

    const appId = metaAppId.trim();

    window.addEventListener("message", onMessage);
    setLastSdkEvent("assigning fbAsyncInit before script");

    // 1) fbAsyncInit ANTES del script (orden obligatorio de Meta)
    window.fbAsyncInit = () => {
      if (!window.FB) {
        setLastError("window.FB no disponible en fbAsyncInit");
        setLastSdkEvent("fbAsyncInit fired without window.FB");
        return;
      }

      window.FB.init({
        appId,
        cookie: true,
        xfbml: false,
        version: FB_SDK_VERSION,
      });

      setSdkReady(true);
      setLastSdkEvent("FB.init completed in fbAsyncInit");
      setLastError("");
    };

    // 2) Si el SDK ya está en la página, invocar el callback (fbAsyncInit no se re-dispara solo)
    if (document.getElementById(FB_SDK_SCRIPT_ID) && window.FB) {
      window.fbAsyncInit();
      return () => {
        window.removeEventListener("message", onMessage);
      };
    }

    // 3) Insertar script solo si no existe
    if (!document.getElementById(FB_SDK_SCRIPT_ID)) {
      const script = document.createElement("script");
      script.id = FB_SDK_SCRIPT_ID;
      script.async = true;
      script.defer = true;
      script.src = FB_SDK_SRC;
      script.onload = () => {
        setLastSdkEvent("sdk script loaded");
      };
      script.onerror = () => {
        setLastError("No se pudo cargar el script del Facebook SDK");
        setLastSdkEvent("sdk script load error");
      };
      document.body.appendChild(script);
    }

    return () => {
      window.removeEventListener("message", onMessage);
    };
  }, [authorized, hasMetaAppId, metaAppId, onMessage]);

  async function enviarOnboardingAlServidor(code: string) {
    const res = await fetch("/api/meta/embedded-signup", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-whatsapp-setup-token": setupToken,
      },
      body: JSON.stringify({
        code,
        sessionInfo: sessionInfoRef.current ?? undefined,
      }),
    });

    const data = (await res.json()) as Record<string, unknown>;
    if (!res.ok) {
      const err =
        typeof data.error === "string" ? data.error : "Error al guardar la cuenta";
      throw new Error(err);
    }

    const phoneId =
      typeof data.phone_number_id === "string" ? data.phone_number_id : "";
    const status = typeof data.status === "string" ? data.status : "ok";
    setSuccessMsg(
      `Cuenta conectada (${status}). phone_number_id: ${phoneId || "—"}. ` +
        "El bot multi-número se activará en una fase posterior.",
    );
  }

  function handleConectar() {
    if (!sdkReady || typeof window === "undefined" || !window.FB) {
      setErrorMsg("El SDK de Facebook aún no está listo. Espera a que termine de cargar.");
      setLastSdkEvent("handleConectar blocked: sdk not ready");
      return;
    }

    if (!hasConfigId) {
      setErrorMsg("Falta NEXT_PUBLIC_META_EMBEDDED_SIGNUP_CONFIG_ID en el entorno del servidor.");
      return;
    }

    setErrorMsg("");
    setSuccessMsg("");
    setLoading(true);
    setLastSdkEvent("calling FB.login after fbAsyncInit");
    sessionInfoRef.current = null;

    window.FB.login(
      (response) => {
        void (async () => {
          try {
            const code = response.authResponse?.code;
            if (!code) {
              const msg =
                "No se recibió código de Meta. Completa el flujo en WhatsApp Business App.";
              setLastError(msg);
              setErrorMsg(msg);
              return;
            }
            setLastSdkEvent("FB.login returned code");
            await enviarOnboardingAlServidor(code);
          } catch (err) {
            const msg =
              err instanceof Error ? err.message : "No se pudo completar la conexión.";
            setLastError(msg);
            setErrorMsg(msg);
          } finally {
            setLoading(false);
          }
        })();
      },
      {
        config_id: configId,
        response_type: "code",
        override_default_response_type: true,
        extras: {
          setup: {},
          featureType: "whatsapp_business_app_onboarding",
          sessionInfoVersion: "3",
        },
      },
    );
  }

  function buttonLabel(): string {
    if (loading) return "Conectando...";
    if (!sdkReady) return "Cargando SDK...";
    return "Conectar WhatsApp Business App";
  }

  function DiagnosticPanel() {
    const hasWindowFB = Boolean(typeof window !== "undefined" && window.FB);
    const hasSdkScriptTag = Boolean(
      typeof document !== "undefined" && document.getElementById(FB_SDK_SCRIPT_ID),
    );

    return (
      <details className="mt-6 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs">
        <summary className="cursor-pointer font-medium text-slate-700">
          Diagnóstico SDK (solo esta página)
        </summary>
        <dl className="mt-3 space-y-1 font-mono text-slate-600">
          <div>
            <dt className="inline text-slate-500">version: </dt>
            <dd className="inline">{SIGNUP_CLIENT_VERSION}</dd>
          </div>
          <div>
            <dt className="inline text-slate-500">sdkReady: </dt>
            <dd className="inline">{boolLabel(sdkReady)}</dd>
          </div>
          <div>
            <dt className="inline text-slate-500">hasWindowFB: </dt>
            <dd className="inline">{boolLabel(hasWindowFB)}</dd>
          </div>
          <div>
            <dt className="inline text-slate-500">facebook-jssdk tag: </dt>
            <dd className="inline">{boolLabel(hasSdkScriptTag)}</dd>
          </div>
          <div>
            <dt className="inline text-slate-500">buttonEnabled: </dt>
            <dd className="inline">{boolLabel(sdkReady && !loading && hasMetaConfig)}</dd>
          </div>
          <div>
            <dt className="inline text-slate-500">lastSdkEvent: </dt>
            <dd className="inline break-all">{lastSdkEvent}</dd>
          </div>
          <div>
            <dt className="inline text-slate-500">lastError: </dt>
            <dd className="inline break-all text-red-700">{lastError || "—"}</dd>
          </div>
        </dl>
      </details>
    );
  }

  if (!authorized) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6 bg-slate-50">
        <section className="max-w-md w-full rounded-2xl border border-slate-200 bg-white p-8 shadow-sm text-center">
          <h1 className="text-xl font-semibold text-slate-900">Acceso no autorizado</h1>
          <p className="mt-3 text-sm text-slate-600">
            Usa el enlace con <code className="text-xs bg-slate-100 px-1 rounded">setup_token</code>{" "}
            válido.
          </p>
          <DiagnosticPanel />
        </section>
      </main>
    );
  }

  if (!hasMetaAppId || !hasConfigId) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6 bg-slate-50">
        <section className="max-w-md w-full rounded-2xl border border-amber-200 bg-white p-8 shadow-sm">
          <h1 className="text-xl font-semibold text-slate-900">Configuración incompleta</h1>
          <p className="mt-3 text-sm text-slate-600">
            {!hasMetaAppId ? (
              <>
                Falta <code>NEXT_PUBLIC_META_APP_ID</code> en Vercel o <code>.env.local</code>.
              </>
            ) : null}
            {!hasMetaAppId && !hasConfigId ? <br /> : null}
            {!hasConfigId ? (
              <>
                Falta <code>NEXT_PUBLIC_META_EMBEDDED_SIGNUP_CONFIG_ID</code> en Vercel o{" "}
                <code>.env.local</code>.
              </>
            ) : null}
          </p>
          <DiagnosticPanel />
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-6 bg-slate-50">
      <section className="max-w-lg w-full rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-2xl font-semibold text-slate-900">Conectar WhatsApp — Jefe 1</h1>
        <p className="mt-1 text-xs text-slate-400 font-mono">build {SIGNUP_CLIENT_VERSION}</p>
        <p className="mt-2 text-sm text-slate-600">
          Modo <strong>WhatsApp Business App</strong> (coexistence). Activa el número en la app del
          celular antes de continuar. Escanea el QR cuando Meta lo solicite.
        </p>

        <ol className="mt-4 text-sm text-slate-600 list-decimal list-inside space-y-1">
          <li>Número activo en WhatsApp Business App</li>
          <li>Clic en conectar y completar Embedded Signup</li>
          <li>Guardado seguro en servidor (sin exponer token al navegador)</li>
        </ol>

        {sdkReady ? (
          <p className="mt-4 text-sm text-emerald-700" role="status">
            SDK listo
          </p>
        ) : (
          <p className="mt-4 text-sm text-slate-500" role="status">
            Cargando SDK...
          </p>
        )}

        <button
          type="button"
          onClick={handleConectar}
          disabled={!sdkReady || loading}
          className="mt-6 w-full rounded-xl bg-[#1877F2] px-4 py-3 text-white font-medium hover:bg-[#166FE5] disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {buttonLabel()}
        </button>

        {errorMsg ? (
          <p className="mt-4 text-sm text-red-600" role="alert">
            {errorMsg}
          </p>
        ) : null}
        {successMsg ? (
          <p className="mt-4 text-sm text-emerald-700" role="status">
            {successMsg}
          </p>
        ) : null}

        <DiagnosticPanel />
      </section>
    </main>
  );
}

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

const FB_SDK_VERSION = "v19.0";
const FB_SDK_SCRIPT_ID = "facebook-jssdk";
const FB_SDK_SRC = "https://connect.facebook.net/en_US/sdk.js";
const SDK_INIT_TIMEOUT_MS = 15000;

let sdkLoadPromise: Promise<void> | null = null;
let sdkLoadAppId: string | null = null;
let fbSdkInitCompletedGlobal = false;

function devLog(message: string): void {
  if (process.env.NODE_ENV === "development") {
    console.log(message);
  }
}

function runFbInit(appId: string): void {
  if (!window.FB) {
    throw new Error("window.FB no disponible");
  }
  window.FB.init({
    appId,
    cookie: true,
    xfbml: false,
    version: FB_SDK_VERSION,
  });
}

/**
 * Carga el script del SDK una sola vez y resuelve solo después de FB.init exitoso.
 */
function loadFacebookSdkOnce(appId: string): Promise<void> {
  const trimmedAppId = appId?.trim();
  if (!trimmedAppId) {
    return Promise.reject(new Error("Falta NEXT_PUBLIC_META_APP_ID"));
  }

  if (fbSdkInitCompletedGlobal && window.FB) {
    return Promise.resolve();
  }

  if (sdkLoadPromise && sdkLoadAppId === trimmedAppId) {
    return sdkLoadPromise;
  }

  sdkLoadAppId = trimmedAppId;

  sdkLoadPromise = new Promise<void>((resolve, reject) => {
    let settled = false;
    let pollTimer: ReturnType<typeof setInterval> | null = null;

    const cleanup = () => {
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    };

    const finishResolve = () => {
      if (settled) return;
      settled = true;
      cleanup();
      clearTimeout(timeoutTimer);
      fbSdkInitCompletedGlobal = true;
      devLog("Facebook SDK initialized");
      resolve();
    };

    const finishReject = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      clearTimeout(timeoutTimer);
      sdkLoadPromise = null;
      fbSdkInitCompletedGlobal = false;
      reject(error);
    };

    const attemptInit = (): boolean => {
      if (!window.FB) return false;
      try {
        runFbInit(trimmedAppId);
        finishResolve();
        return true;
      } catch {
        finishReject(new Error("No se pudo inicializar Facebook SDK"));
        return true;
      }
    };

    const pollUntilFbReady = () => {
      if (attemptInit()) return;
      pollTimer = setInterval(() => {
        attemptInit();
      }, 50);
    };

    const timeoutTimer = setTimeout(() => {
      finishReject(
        new Error("Facebook SDK no terminó de inicializarse (tiempo de espera agotado)"),
      );
    }, SDK_INIT_TIMEOUT_MS);

    window.fbAsyncInit = () => {
      devLog("Facebook SDK fbAsyncInit fired");
      if (!attemptInit()) {
        pollUntilFbReady();
      }
    };

    const existingScript = document.getElementById(FB_SDK_SCRIPT_ID);

    if (existingScript) {
      if (window.FB) {
        attemptInit();
      } else {
        pollUntilFbReady();
      }
    } else {
      const script = document.createElement("script");
      script.id = FB_SDK_SCRIPT_ID;
      script.async = true;
      script.defer = true;
      script.src = FB_SDK_SRC;
      script.onload = () => {
        devLog("Facebook SDK script loaded");
        if (!settled) {
          pollUntilFbReady();
        }
      };
      script.onerror = () => {
        finishReject(new Error("No se pudo cargar Facebook SDK"));
      };
      document.body.appendChild(script);
    }
  });

  return sdkLoadPromise;
}

type Props = {
  authorized: boolean;
  setupToken: string;
  metaAppId: string;
  configId: string;
};

export default function ConectarWhatsAppClient({
  authorized,
  setupToken,
  metaAppId,
  configId,
}: Props) {
  const [sdkLoaded, setSdkLoaded] = useState(false);
  const [sdkInitialized, setSdkInitialized] = useState(false);
  const [sdkError, setSdkError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const sessionInfoRef = useRef<Record<string, unknown> | null>(null);
  const fbInitCompletedRef = useRef(false);

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
      }
    } catch {
      // ignorar mensajes no JSON del SDK
    }
  }, []);

  const markSdkReady = useCallback(() => {
    fbInitCompletedRef.current = true;
    setSdkLoaded(true);
    setSdkInitialized(true);
    setSdkError("");
  }, []);

  const markSdkFailed = useCallback((message: string) => {
    fbInitCompletedRef.current = false;
    setSdkInitialized(false);
    setSdkError(message);
  }, []);

  useEffect(() => {
    if (!authorized || !hasMetaConfig) return;

    let cancelled = false;

    window.addEventListener("message", onMessage);

    void loadFacebookSdkOnce(metaAppId)
      .then(() => {
        if (cancelled) return;
        markSdkReady();
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message =
          err instanceof Error ? err.message : "No se pudo inicializar Facebook SDK";
        markSdkFailed(message);
      });

    return () => {
      cancelled = true;
      window.removeEventListener("message", onMessage);
    };
  }, [authorized, hasMetaConfig, metaAppId, onMessage, markSdkReady, markSdkFailed]);

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

  async function handleConnect() {
    setErrorMsg("");
    setSuccessMsg("");

    if (!hasMetaAppId) {
      setErrorMsg("Falta NEXT_PUBLIC_META_APP_ID en el entorno del servidor.");
      return;
    }
    if (!hasConfigId) {
      setErrorMsg("Falta NEXT_PUBLIC_META_EMBEDDED_SIGNUP_CONFIG_ID en el entorno del servidor.");
      return;
    }

    setIsSubmitting(true);

    try {
      await loadFacebookSdkOnce(metaAppId);
      fbInitCompletedRef.current = fbSdkInitCompletedGlobal;

      if (!window.FB || !fbInitCompletedRef.current) {
        setErrorMsg("Facebook SDK no terminó de inicializarse.");
        setIsSubmitting(false);
        return;
      }

      if (!fbSdkInitCompletedGlobal) {
        try {
          runFbInit(metaAppId);
          fbSdkInitCompletedGlobal = true;
          fbInitCompletedRef.current = true;
        } catch {
          setErrorMsg("Facebook SDK no terminó de inicializarse.");
          setIsSubmitting(false);
          return;
        }
      }

      devLog("Calling FB.login");
      sessionInfoRef.current = null;

      window.FB.login(
        (response) => {
          void (async () => {
            try {
              const code = response.authResponse?.code;
              if (!code) {
                setErrorMsg(
                  "No se recibió código de Meta. Completa el flujo en WhatsApp Business App.",
                );
                return;
              }
              await enviarOnboardingAlServidor(code);
            } catch (err) {
              setErrorMsg(
                err instanceof Error ? err.message : "No se pudo completar la conexión.",
              );
            } finally {
              setIsSubmitting(false);
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
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Facebook SDK no terminó de inicializarse.";
      setErrorMsg(message);
      markSdkFailed(message);
      setIsSubmitting(false);
    }
  }

  const canUseFbLogin =
    hasMetaConfig &&
    sdkInitialized &&
    fbInitCompletedRef.current &&
    fbSdkInitCompletedGlobal &&
    Boolean(window.FB) &&
    !sdkError;

  const buttonDisabled = !canUseFbLogin || isSubmitting;

  function buttonLabel(): string {
    if (isSubmitting) return "Conectando...";
    if (sdkError) return "SDK no disponible";
    if (!sdkInitialized || !fbInitCompletedRef.current) return "Cargando Facebook SDK...";
    return "Conectar WhatsApp Business App";
  }

  function sdkStatusMessage(): string | null {
    if (sdkError) return sdkError;
    if (sdkInitialized && fbInitCompletedRef.current && window.FB) return "SDK listo";
    if (sdkLoaded || hasMetaConfig) return "Cargando Facebook SDK...";
    return null;
  }

  if (!authorized) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6 bg-slate-50">
        <section className="max-w-md w-full rounded-2xl border border-slate-200 bg-white p-8 shadow-sm text-center">
          <h1 className="text-xl font-semibold text-slate-900">Acceso no autorizado</h1>
          <p className="mt-3 text-sm text-slate-600">
            Usa el enlace con <code className="text-xs bg-slate-100 px-1 rounded">setup_token</code>{" "}
            válido. Ejemplo:{" "}
            <code className="text-xs bg-slate-100 px-1 rounded break-all">
              /conectar-whatsapp?setup_token=...
            </code>
          </p>
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
        </section>
      </main>
    );
  }

  const statusLine = sdkStatusMessage();

  return (
    <main className="min-h-screen flex items-center justify-center p-6 bg-slate-50">
      <section className="max-w-lg w-full rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-2xl font-semibold text-slate-900">Conectar WhatsApp — Jefe 1</h1>
        <p className="mt-2 text-sm text-slate-600">
          Modo <strong>WhatsApp Business App</strong> (coexistence). Activa el número en la app del
          celular antes de continuar. Escanea el QR cuando Meta lo solicite.
        </p>

        <ol className="mt-4 text-sm text-slate-600 list-decimal list-inside space-y-1">
          <li>Número activo en WhatsApp Business App</li>
          <li>Clic en conectar y completar Embedded Signup</li>
          <li>Guardado seguro en servidor (sin exponer token al navegador)</li>
        </ol>

        {statusLine ? (
          <p
            className={`mt-4 text-sm ${
              sdkError ? "text-red-600" : sdkInitialized ? "text-emerald-700" : "text-slate-500"
            }`}
            role="status"
          >
            {statusLine}
          </p>
        ) : null}

        <button
          type="button"
          onClick={() => void handleConnect()}
          disabled={buttonDisabled}
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
      </section>
    </main>
  );
}

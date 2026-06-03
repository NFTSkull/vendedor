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

type SdkDiagHandlers = {
  onEvent: (event: string) => void;
  onError: (error: string) => void;
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

export const SIGNUP_CLIENT_VERSION = "sdk-debug-e0a6d6b-2";

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
function loadFacebookSdkOnce(appId: string, diag?: SdkDiagHandlers): Promise<void> {
  const trimmedAppId = appId?.trim();
  if (!trimmedAppId) {
    const msg = "Falta NEXT_PUBLIC_META_APP_ID";
    diag?.onError(msg);
    return Promise.reject(new Error(msg));
  }

  if (fbSdkInitCompletedGlobal && window.FB) {
    diag?.onEvent("FB.init completed (cached)");
    return Promise.resolve();
  }

  if (sdkLoadPromise && sdkLoadAppId === trimmedAppId) {
    return sdkLoadPromise;
  }

  sdkLoadAppId = trimmedAppId;
  diag?.onEvent("loadFacebookSdkOnce started");

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
      diag?.onEvent("FB.init completed");
      resolve();
    };

    const finishReject = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      clearTimeout(timeoutTimer);
      sdkLoadPromise = null;
      fbSdkInitCompletedGlobal = false;
      diag?.onError(error.message);
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
      diag?.onEvent("polling for window.FB");
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
      diag?.onEvent("fbAsyncInit fired");
      if (!attemptInit()) {
        pollUntilFbReady();
      }
    };

    const existingScript = document.getElementById(FB_SDK_SCRIPT_ID);

    if (existingScript) {
      diag?.onEvent("sdk script tag already present");
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
        diag?.onEvent("sdk script loaded");
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

function boolLabel(value: boolean): string {
  return value ? "true" : "false";
}

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
  const [lastSdkEvent, setLastSdkEvent] = useState("idle");
  const [lastError, setLastError] = useState("");
  const [fbInitCompletedDisplay, setFbInitCompletedDisplay] = useState(false);
  const [hasWindowFB, setHasWindowFB] = useState(false);
  const [hasSdkScriptTag, setHasSdkScriptTag] = useState(false);
  const sessionInfoRef = useRef<Record<string, unknown> | null>(null);
  const fbInitCompletedRef = useRef(false);

  const hasMetaAppId = Boolean(metaAppId?.trim());
  const hasConfigId = Boolean(configId?.trim());
  const hasMetaConfig = hasMetaAppId && hasConfigId;

  const syncFbInitCompleted = useCallback((value: boolean) => {
    fbInitCompletedRef.current = value;
    setFbInitCompletedDisplay(value);
  }, []);

  const sdkDiagHandlers = useCallback(
    (): SdkDiagHandlers => ({
      onEvent: (event) => setLastSdkEvent(event),
      onError: (error) => setLastError(error),
    }),
    [],
  );

  const refreshDomDiagnostics = useCallback(() => {
    setHasWindowFB(Boolean(typeof window !== "undefined" && window.FB));
    setHasSdkScriptTag(
      Boolean(typeof document !== "undefined" && document.getElementById(FB_SDK_SCRIPT_ID)),
    );
  }, []);

  useEffect(() => {
    refreshDomDiagnostics();
    const timer = setInterval(refreshDomDiagnostics, 400);
    return () => clearInterval(timer);
  }, [refreshDomDiagnostics, sdkInitialized, lastSdkEvent]);

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

  const markSdkReady = useCallback(() => {
    syncFbInitCompleted(true);
    setSdkLoaded(true);
    setSdkInitialized(true);
    setSdkError("");
    setLastError("");
    setLastSdkEvent("FB.init completed");
    refreshDomDiagnostics();
  }, [syncFbInitCompleted, refreshDomDiagnostics]);

  const markSdkFailed = useCallback(
    (message: string) => {
      syncFbInitCompleted(false);
      setSdkInitialized(false);
      setSdkError(message);
      setLastError(message);
      refreshDomDiagnostics();
    },
    [syncFbInitCompleted, refreshDomDiagnostics],
  );

  useEffect(() => {
    if (!authorized || !hasMetaConfig) return;

    let cancelled = false;

    window.addEventListener("message", onMessage);
    setLastSdkEvent("mount: starting SDK preload");

    void loadFacebookSdkOnce(metaAppId, sdkDiagHandlers())
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
  }, [
    authorized,
    hasMetaConfig,
    metaAppId,
    onMessage,
    markSdkReady,
    markSdkFailed,
    sdkDiagHandlers,
  ]);

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

  function buildLoginReadiness() {
    refreshDomDiagnostics();
    return {
      hasMetaAppId,
      hasConfigId,
      hasWindowFB: Boolean(window.FB),
      sdkInitialized,
      fbInitCompletedRef: fbInitCompletedRef.current,
      fbSdkInitCompletedGlobal,
      hasSdkScriptTag: Boolean(document.getElementById(FB_SDK_SCRIPT_ID)),
    };
  }

  async function handleConnect() {
    setErrorMsg("");
    setSuccessMsg("");

    if (!hasMetaAppId) {
      const msg = "Falta NEXT_PUBLIC_META_APP_ID en el entorno del servidor.";
      setLastError(msg);
      setErrorMsg(msg);
      return;
    }
    if (!hasConfigId) {
      const msg = "Falta NEXT_PUBLIC_META_EMBEDDED_SIGNUP_CONFIG_ID en el entorno del servidor.";
      setLastError(msg);
      setErrorMsg(msg);
      return;
    }

    setIsSubmitting(true);
    setLastSdkEvent("handleConnect: awaiting SDK");

    try {
      await loadFacebookSdkOnce(metaAppId, sdkDiagHandlers());
      syncFbInitCompleted(fbSdkInitCompletedGlobal);
      refreshDomDiagnostics();

      const readiness = buildLoginReadiness();

      if (!readiness.hasWindowFB) {
        const msg = "Facebook SDK no terminó de inicializarse (window.FB ausente).";
        setLastError(msg);
        setErrorMsg(msg);
        setIsSubmitting(false);
        return;
      }

      if (!readiness.sdkInitialized || !readiness.fbInitCompletedRef) {
        const msg = "Facebook SDK no terminó de inicializarse (estado local incompleto).";
        setLastError(msg);
        setErrorMsg(msg);
        setIsSubmitting(false);
        return;
      }

      if (!readiness.fbSdkInitCompletedGlobal) {
        try {
          runFbInit(metaAppId);
          fbSdkInitCompletedGlobal = true;
          syncFbInitCompleted(true);
          setLastSdkEvent("FB.init completed");
        } catch {
          const msg = "Facebook SDK no terminó de inicializarse (FB.init falló).";
          setLastError(msg);
          setErrorMsg(msg);
          setIsSubmitting(false);
          return;
        }
      }

      const preLogin = buildLoginReadiness();
      const readyForLogin =
        preLogin.hasMetaAppId &&
        preLogin.hasConfigId &&
        preLogin.hasWindowFB &&
        preLogin.sdkInitialized &&
        preLogin.fbInitCompletedRef &&
        preLogin.fbSdkInitCompletedGlobal;

      if (!readyForLogin) {
        const msg =
          "Bloqueado: no se llama FB.login porque faltan banderas de inicialización. " +
          `sdkInitialized=${boolLabel(preLogin.sdkInitialized)}, ` +
          `fbInitCompletedRef=${boolLabel(preLogin.fbInitCompletedRef)}, ` +
          `fbSdkInitCompletedGlobal=${boolLabel(preLogin.fbSdkInitCompletedGlobal)}, ` +
          `hasWindowFB=${boolLabel(preLogin.hasWindowFB)}`;
        setLastError(msg);
        setErrorMsg("Facebook SDK no terminó de inicializarse.");
        setIsSubmitting(false);
        return;
      }

      setLastSdkEvent("calling FB.login after init");
      setLastError("");
      devLog("Calling FB.login");
      sessionInfoRef.current = null;

      window.FB!.login(
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
              setIsSubmitting(false);
              refreshDomDiagnostics();
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
    fbInitCompletedDisplay &&
    fbSdkInitCompletedGlobal &&
    hasWindowFB &&
    !sdkError;

  const buttonEnabled = canUseFbLogin && !isSubmitting;
  const buttonDisabled = !buttonEnabled;

  function buttonLabel(): string {
    if (isSubmitting) return "Conectando...";
    if (sdkError) return "SDK no disponible";
    if (!sdkInitialized || !fbInitCompletedDisplay) return "Cargando Facebook SDK...";
    return "Conectar WhatsApp Business App";
  }

  function sdkStatusMessage(): string | null {
    if (sdkError) return sdkError;
    if (sdkInitialized && fbInitCompletedDisplay && hasWindowFB) return "SDK listo";
    if (sdkLoaded || hasMetaConfig) return "Cargando Facebook SDK...";
    return null;
  }

  function DiagnosticPanel() {
    const readiness = {
      hasMetaAppId,
      hasConfigId,
      hasWindowFB,
      sdkInitialized,
      fbInitCompletedRef: fbInitCompletedDisplay,
      fbSdkInitCompletedGlobal,
      hasSdkScriptTag,
      buttonEnabled,
      lastSdkEvent,
      lastError: lastError || sdkError || errorMsg || "—",
    };

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
            <dt className="inline text-slate-500">hasMetaAppId: </dt>
            <dd className="inline">{boolLabel(readiness.hasMetaAppId)}</dd>
          </div>
          <div>
            <dt className="inline text-slate-500">hasConfigId: </dt>
            <dd className="inline">{boolLabel(readiness.hasConfigId)}</dd>
          </div>
          <div>
            <dt className="inline text-slate-500">hasWindowFB: </dt>
            <dd className="inline">{boolLabel(readiness.hasWindowFB)}</dd>
          </div>
          <div>
            <dt className="inline text-slate-500">sdkInitialized: </dt>
            <dd className="inline">{boolLabel(readiness.sdkInitialized)}</dd>
          </div>
          <div>
            <dt className="inline text-slate-500">fbInitCompletedRef: </dt>
            <dd className="inline">{boolLabel(readiness.fbInitCompletedRef)}</dd>
          </div>
          <div>
            <dt className="inline text-slate-500">fbSdkInitCompletedGlobal: </dt>
            <dd className="inline">{boolLabel(readiness.fbSdkInitCompletedGlobal)}</dd>
          </div>
          <div>
            <dt className="inline text-slate-500">facebook-jssdk tag: </dt>
            <dd className="inline">{boolLabel(readiness.hasSdkScriptTag)}</dd>
          </div>
          <div>
            <dt className="inline text-slate-500">buttonEnabled: </dt>
            <dd className="inline">{boolLabel(readiness.buttonEnabled)}</dd>
          </div>
          <div>
            <dt className="inline text-slate-500">lastSdkEvent: </dt>
            <dd className="inline break-all">{readiness.lastSdkEvent}</dd>
          </div>
          <div>
            <dt className="inline text-slate-500">lastError: </dt>
            <dd className="inline break-all text-red-700">{readiness.lastError}</dd>
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

  const statusLine = sdkStatusMessage();

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

        <DiagnosticPanel />
      </section>
    </main>
  );
}

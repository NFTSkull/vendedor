# DEVLOG

## 2026-10-13 (costos: cron de recordatorios)

- **Medición previa (solo conteos, `lxqvslupzxnkdzbhojad`):**
  - 8 leads en `nuevo`, todos de Generadores; 0 leads de Mejoravit.
  - Cada minuto el cron hacía 5 consultas: leads para Mejoravit, leads y conversaciones de Generadores, y 2 consultas de mensajes de leads que ya tenían ambos toques.
  - Con el código nuevo y los datos actuales son 3 consultas cada 5 minutos.
- **Ventanas:** de 10 minutos para un cron de 5. Cubren una ejecución retrasada u omitida; pasado el límite, el toque se pierde en lugar de llegar fuera de contexto. La separación mínima de 10 minutos evita que un toque 1 tardío y el toque 2 lleguen juntos.
- **Reserva:** se reutilizan las columnas `*_sent_at`, que nunca se reinician, así que no hizo falta migración. Dos ejecuciones simultáneas o un reintento de Vercel no obtienen la misma reserva. La liberación exige que la marca coincida, para no borrar la de otra ejecución.
- **Política de fallos:** se prefiere perder un recordatorio a duplicarlo. Solo un 4xx de Meta confirma que el mensaje no salió.
- **Generadores:** solo cambió cómo se consulta. La regla de elegibilidad es la misma función (`conversacionElegibleGeneradores`, `resolverToquePendienteGeneradores`).
- **Hallazgo sin cambiar:** desde `ce79dc2` (2026-06-25) el webhook marca el lead como `contactado` después de cada respuesta exitosa del bot. Los dos flujos exigen `estado = 'nuevo'`, así que en la práctica casi no hay candidatos: el último recordatorio de Generadores fue el 2026-06-26 y nunca se ha enviado uno de Mejoravit. Se mantuvo la regla para no empezar a escribir a clientes activos sin decisión comercial.
- **Pruebas:** `lib/testing/supabaseEnMemoria.ts` aplica filtros y UPDATE condicionados en memoria; con él se prueban la concurrencia, los reintentos y la respuesta del cliente durante el proceso sin red ni mensajes reales.

## 2026-10-13 (seguridad: expedientes del CRM y permisos Supabase)

- **`lib/crmAcceso.ts`:**
  - `autorizarAsesorCrm` relee el asesor y exige `activo = true`, porque el JWT dura 7 días.
  - `leadEnAlcance` y `conAlcance` reproducen la regla de la bandeja (`admin@mejoravit.com` con `advisor_id` nulo; los demás con `advisor_id = sub`).
  - `autorizarLeadCrm` valida el UUID, carga el lead con `advisor_id` y lo descarta de la respuesta.
  - Decisión: lead ajeno → 403, lead inexistente → 404, igual que `/api/precalificar`.
- **Orden:** la autorización va antes de parsear el cuerpo. En `media`, también antes de leer el `formData`, para no procesar archivos de solicitudes no autorizadas.
- **Concurrencia:** en `PATCH`, si el UPDATE condicionado no devuelve fila, se responde 403 y no se registra la acción. El envío a Meta no puede condicionarse en la base; se autoriza justo antes. La ventana restante es la latencia entre leer el lead y enviar.
- **Respuestas:** `COLUMNAS_LEAD_DETALLE` y `leadDetalleParaCrm` (`lib/crmLeadDetalle.ts`) contienen lo que lee `app/crm/leads/[id]/page.tsx`. Se eliminó `sinTramiteMejoravit`, sustituida por columnas explícitas.
- **No se tocó `app/api/crm/leads/broadcast/route.ts`:** ya filtra por alcance con columnas explícitas y tiene un cambio pendiente en otra copia del repositorio.
- **Auditoría de privilegios:**
  - Las 7 tablas públicas tenían RLS sin políticas, pero conservaban los grants por defecto a `anon`/`authenticated`, incluido TRUNCATE (que no pasa por RLS).
  - No hay usuarios de Auth, Edge Functions, buckets, vistas ni políticas.
  - En 24 h, todo el tráfico legítimo usó la llave `sb_secret_` (`service_role`, `rolbypassrls`). Las únicas solicitudes con la llave publicable fueron pruebas de seguridad.
  - Las dos funciones de `public` son de trigger y no se modificaron.
- **Pendiente:** los privilegios por defecto del esquema `public` siguen otorgando todo a `anon`/`authenticated` en tablas futuras. Cada tabla nueva debe activar RLS y revocar esos permisos en su migración.

## 2026-10-13 (seguridad: /api/precalificar y conversations)

- **Alcance en `/api/precalificar`:** se reutiliza la regla de la bandeja (`admin@mejoravit.com` opera leads con `advisor_id` nulo y cada asesor los suyos). Decisión: no basta un JWT válido; se relee el asesor y se exige `activo = true`, para que una baja surta efecto antes de que expire el token de 7 días.
- **Decisión: el detalle del lead envía `leadId`, no NSS ni teléfono,** para que el cliente no pueda elegir sobre qué datos operar.
- **Captura manual:** se rechaza si el NSS ya pertenece a un lead fuera del alcance, para no consultar ni sobrescribir clientes de otro asesor. Un lead nuevo de un asesor queda asignado a él; antes quedaba sin asignar y solo lo veía el admin.
- **Límites y duplicados con `lead_actions`** (sin tabla nueva): 10 solicitudes por asesor en 10 minutos; la última acción del lead debe ser `precalificacion_completada` o tener más de 200 s (el scraper tiene timeout de 180 s).
  - Riesgo aceptado: dos solicitudes simultáneas de la misma persona pueden pasar ambas la verificación; el botón ya se deshabilita mientras consulta.
  - Si no se puede registrar en `lead_actions`, la ruta falla cerrada (500).
- **Logs:** solo `lead_id`, `advisor_id`, tipo o código de error; nunca NSS, teléfono ni respuesta del scraper.
- **Auditoría de `conversations`:**
  - Código: solo `lib/conversationMemory.ts`, `lib/reengagementCron.ts` y `lib/reengagementGeneradoresCron.ts`, todos con `getSupabaseAdmin()` (service role). No hay cliente anon ni de navegador.
  - Base: no hay vistas, funciones, triggers, realtime ni pg_cron que dependan de la tabla.
  - Logs de la API (24 h): 1,260 accesos a `conversations`, todos con llave `sb_secret_` desde Vercel. `service_role` tiene `rolbypassrls = true`.
- **Migración `conversations_rls`:** `enable row level security` y `revoke all ... from anon, authenticated`, sin políticas.
  - Antes: un HEAD anónimo con la llave publicable devolvía las 564 filas en el conteo.
  - Después: lectura, insert, update y delete anónimos responden 42501/401. El tráfico del cron con service role sigue en 200.
- **Pendiente:** las demás tablas tienen RLS sin políticas, pero conservan los grants por defecto de Supabase para `anon`/`authenticated` (incluido TRUNCATE, que no pasa por RLS ni se expone por la API REST).

## 2026-10-13 (Paso 1: asesor inteligente Mejoravit)

- **Fuentes revisadas** (sin modificarlas): `mejoravit-scraper` (respuesta real de `POST /precalificar`) y `crmconcasa` (contrato Datos Generales, validadores, triggers de Mesa, cálculo de cobro).
- **`lib/mejoravitCredito.ts`:** `floor(min(base, 169000) × 0.90)`.
  - Decisión: el CRM usa factor **0.89** (`clienteDatosCobro.ts`); aquí se aplica el 0.90 confirmado por negocio. Hay que alinearlos antes de integrar.
  - Base: `datos.saldoSubcuenta`, la misma que ya usaba el bot.
- **`lib/precalificacionScraper.ts`:**
  - `empresa` y `registroPatronal` solo llegan con `califica: true` y pueden ser null.
  - Se descartan etiquetas del portal ("N.R.P.:") y NRP que no tengan 11 caracteres alfanuméricos.
- **`lib/tramiteMejoravit.ts`:** módulo puro (sin E/S) con etapas `oferta` → `consentimiento` → `captura` → `completo`, más `pausado` y `rechazado`.
  - Cada dato guarda valor, procedencia (`precalificacion` | `whatsapp` | `cliente`) y fecha; también lleva pendientes con motivo, intentos y pregunta actual.
  - Decisión: puro para poder recalcular el mensaje sobre la versión más reciente cuando hay mensajes concurrentes.
- **Persistencia:** `leads.tramite_mejoravit jsonb` (`supabase/sql/leads_tramite_mejoravit.sql`).
  - Decisión: en `leads` y no en `conversations.data`, porque "reiniciar" reemplaza `data` y el trámite debe sobrevivir a reinicios y a otras instancias de Vercel.
  - Concurrencia optimista en `lib/tramiteMejoravitRepo.ts`: UPDATE condicionado a `tramite_mejoravit->>version` (o `is null` en la primera escritura). Si hay conflicto, se relee y se recalcula (máximo 3 intentos).
  - Cada mensaje del trámite hace 3 llamadas a Supabase: leer la conversación, leer el lead y un UPDATE.
- **Claude:** `interpretarMensajeTramite` es un prompt nuevo; no se tocaron los existentes.
  - Devuelve intención, datos (solo claves permitidas; `nss` y campos internos se descartan) y respuesta a dudas.
  - Máximo una llamada por mensaje.
  - Sin Claude: sí/no, pausa, "no lo tengo", CURP, correo, teléfonos, CP, números y NRP con formato.
  - Las preguntas agrupadas (nombre completo, domicilio completo) solo se usan si Claude está disponible. Si falla, se pregunta por partes.
- **Router (`lib/botSteps.ts`):** `tramite_mejoravit` va después de "reiniciar" y antes del opt-out global.
  - Decisión: dentro del trámite un rechazo no marca `no_interesado` ni manda "no te molestaremos más". Queda `etapa: rechazado` y el cliente puede retomar.
  - El rechazo firme solo se detecta con el mensaje completo, para que "no me interesa dar mi teléfono" no cancele el trámite.
- **`lib/botStepsCore.ts`:**
  - Al aprobar, un solo UPDATE guarda los montos originales, las columnas de precalificación y el trámite.
  - Si el trámite no se puede guardar (por ejemplo, sin la migración), se guardan las columnas de precalificación y el siguiente mensaje reconstruye el trámite desde `precalificacion_resultado`.
  - Reutiliza la precalificación aprobada del mismo NSS (`resultado.nss`) por 7 días.
  - `data.consultaIniciadaAt` evita una segunda consulta durante 200 s (el timeout del scraper es de 180 s). Se libera al fallar.
- **Campos según el contrato del CRM (perfil completo del asesor):**
  - Validaciones: CURP con regex del CRM, correo, teléfonos de 10 dígitos y distintos entre sí, CP de 5 dígitos, 2 referencias sin repetir.
  - No se preguntan:
    - RFC: opcional en el CRM y viene del portal.
    - Estado civil, género y datos de la INE: los captura Mesa.
    - CLABE: solo Equipo Silvia.
    - Plazo y monto a solicitar: internos.
  - El domicilio se captura estructurado; el CRM lo guarda como texto libre (`direccion_opcional`).
- **Logs:** el trámite solo registra `lead_id`, etapa, campo actual (nombre del campo, no el valor) y si se usó Claude.

### Cierre del Paso 1 (preparación de producción)

- **Supabase:** el proyecto de Vendedor IA es `lxqvslupzxnkdzbhojad` ("mejoravit-crm"). Se confirmó cruzando un `lead_id` de los logs de producción. La migración no se aplica a ConCasa CRM ni a Precalix.
- **RLS:** `leads` tiene RLS activo sin políticas para `anon`/`authenticated`; la app solo usa la service role. El trámite se lee desde el servidor y las rutas del CRM exigen JWT de asesor.
  - Decisión: aun así, las rutas del CRM quitan `tramite_mejoravit` de sus respuestas (`sinTramiteMejoravit`). El detalle `GET /api/crm/leads/[id]` no filtra por asesor y el CRM todavía no usa el trámite.
- **Hallazgos previos, sin corregir aquí (fuera del Paso 1):**
  - `conversations` tiene RLS desactivado y grants para `anon`; guarda el NSS en `nss` y `data`.
  - `POST /api/precalificar` no exige autenticación: cualquiera puede lanzar una consulta real, recibir nombre, RFC y empresa de un NSS, sobrescribir el lead de un teléfono y enviar WhatsApp. Las pantallas del CRM la llaman sin token.
- **Migración de `esperando_horario`:** el núcleo (`migrarDesdeEsperandoHorario`) sustituye el cierre "finalizar".
  - Decisión: el saldo anterior solo se reutiliza si `leads.nss` coincide con el NSS de la conversación.
  - Decisión: el mensaje actual (normalmente un horario) no se interpreta; se responde con la oferta.
  - El enrutador ya no pasa `esperando_horario` por Claude. Se eliminaron `guardarLead`, `mensajeMontoAutorizado` y el parámetro `trasMonto`, que solo servían al cierre anterior.
  - Las conversaciones en `finalizado` siguen respondiendo como antes.
- **Webhook:** los errores de Graph solo registran `{ code, type }`, porque el mensaje puede incluir el número destino.
- **Pendiente para integrar con ConCasa:**
  - El CRM no expone una API para crear o actualizar expedientes desde un sistema externo; las RPC exigen el JWT de un asesor.
  - Alinear el factor 0.89/0.90.
  - El teléfono de casa es obligatorio en el primer envío a Mesa.

## 2026-10-13 (precalificación Vercel → Railway)

- Causa: `SCRAPER_SERVICE_URL` (Vercel, sensible, sin cambios desde 2026-05-22) apuntaba a un dominio `*.up.railway.app` de un servicio que ya no existe; Railway respondía 404 con `x-railway-fallback: true` y la solicitud nunca llegaba a `mejoravit-scraper` (proyecto creado el 2026-08-27, único dominio `-fa7a`). `SCRAPER_SECRET` sí coincide con Railway. No existe `SCRAPER_URL`, así que el bot usa `SCRAPER_SERVICE_URL`.
- Verificación sin exponer valores: build de Preview desechable que solo imprimió comparaciones (host == `-fa7a`, DNS, `GET /health`, sha256 del secreto contra el de Railway); el deploy falló a propósito y se eliminó.
- `lib/botStepsCore.ts`: `tipoErrorScraper` clasifica el error (sin datos personales) y se registra junto al `lead_id`. Antes el `catch` lo descartaba y respondía igual que ante una respuesta vacía.
- Decisión: al recibir el NSS se guarda en `conversations.data.nssPendiente` antes de consultar. Si la consulta falla, el estado sigue en `esperando_datos` y el siguiente mensaje reintenta con ese NSS. `lib/botSteps.ts` no pasa por Claude en ese caso, porque su "fuera de tema"/"inválido" volvería a pedir el NSS.

## 2026-10-13 (comando de producto Mejoravit ↔ Compra de Casa)

- `lib/comandoProducto.ts`: `detectarComandoProducto` (mensaje completo normalizado, sin acentos ni signos), `esNumeroConComandoProducto` (`COMPRA_CASA_PHONE_NUMBER_ID`) y `aplicarComandoProducto`.
- Decisión: el comando queda abierto a cualquier remitente en 8114118767, sin lista de autorizados. Un cliente que escriba el comando exacto cambia solo su propia conversación; `leads.producto` no se toca.
- `app/api/webhook/route.ts`: el comando se evalúa justo antes de `procesarYEvolucionar`, solo con el `phone_number_id` del payload de Meta (sin fallback al de entorno). Envío, historial en `messages` y flip a `contactado` siguen el camino normal. La verificación de intervención del asesor corre antes, así que el comando la respeta.
- `lib/metaWebhookSignature.ts` + webhook: `POST` lee el cuerpo crudo y valida `X-Hub-Signature-256` (HMAC-SHA256 con `META_APP_SECRET`, comparación en tiempo constante) antes de parsear; si falta o no coincide → 401. `GET` (verify token) sin cambios.
- `lib/botStepsCore.ts`: `reiniciarFlujoCore` con producto guardado en la conversación lo conserva en un solo `reemplazarConversacion` (estado `esperando_labor_vigente`, NSS y `data` limpios salvo `productoForzado`). `lead_id`: el de la conversación, si no el lead existente por teléfono, y solo si no hay ninguno `ensureLeadProvisional` (sin duplicados). Antes, `deleteConversation` + `ensureLeadProvisional` re-detectaba el producto por número y en 8114118767 mandaba a Compra de Casa toda conversación Mejoravit reiniciada.
- `lib/conversationMemory.ts`: `reemplazarConversacion` — un solo upsert que reemplaza `state`, `nss`, `lead_id`, `producto` y `data`. Decisión: no usar `deleteConversation` + `setConversation` para no pasar por un estado sin fila ni heredar llaves viejas de `data` (`setConversation` hace merge).
- `lib/detectarProducto.ts`: `productoForzadoDe(data)` valida `data.productoForzado` (`mejoravit` | `compra_casa`).
- `lib/leadProvisional.ts`: con `productoForzado` y sin `lead_id`, liga o crea el lead sin sobrescribir `conversations.producto`. `leads.producto` del lead nuevo sigue tomando el producto del número (decisión: el comando no toca `leads`).
- Historial de Claude: `limpiarHistorialClaude` vacía el historial de esa conversación en la instancia que procesa el comando. Hoy ningún paso de Mejoravit lo lee (`ResultadoPaso` siempre `exacto`, así que `naturalizarMensajeBot` no se invoca) y Compra de Casa no lo lee. El `Map` es por instancia serverless: si en el futuro se activa la naturalización, conviene persistir el reset en la conversación.

## 2026-06-10 (asignación leads G-/B-)

- `supabase/sql/leads_advisor_id.sql`: `leads.advisor_id` → `advisors(id)` (ejecutar en Supabase SQL Editor).
- Asesores en producción: Guillermo `2d46ad6c-dc1a-4089-81ec-47eb0be7472e`, Bernardo `cf72eace-68a2-457b-b0cc-f30c51bca7aa` (override con `ADVISOR_ID_*` en env).
- `lib/detectarProducto.ts`: `detectarPrefijoAsesor`; webhook en `inicio` limpia prefijo y pasa `advisorId` a `ensureLeadProvisional`.
- `app/api/crm/leads/route.ts`: `.or('advisor_id.is.null,advisor_id.eq.{sub}')`.
- `lib/pushNotifications.ts`: filtra `crm_push_subscriptions` por `advisor_id` del lead cuando existe.

## 2026-06-05 (flujo NSS→horario y captura con NSS existente)

- Orden corregido: `esperando_credito_activo` (No) → `esperando_datos` → monto → `esperando_horario` → `finalizado`.
- `resolverNssGuardado`: `conversations.nss`, `data.nss` o query `leads.nss`; en horario con NSS → scraper + cierre sin re-pedir NSS.
- `claudeAssistant`: `INSTRUCCIONES_CLAUDE_ESPERANDO_HORARIO`; `botSteps.ts` fallback `fuera_tema` → horario si texto ≥3 en `esperando_horario`.
- `reengagement.ts`: `MSG_CONTACTO_HORARIO` unificado en toques de `esperando_horario`.

## 2026-06-05 (opt-out pre-Claude y medios no texto)

- `lib/botSteps.ts`: `esOptOut` + `manejarOptOut` antes de Claude; `manejarOptOut` exportado desde `botStepsCore`.
- `app/api/webhook/route.ts`: mensajes entrantes no-texto (imagen/audio/video/etc.) reciben `MSG_SOLO_TEXTO` y se guarda saliente en `messages`.

## 2026-06-05 (opt-out, no califica y cierre con horario)

- `lib/botStepsCore.ts`: `esOptOut()` antes del switch (excepto `inicio`) → `no_interesado` + `finalizado`; scraper `no califica` usa `rechazar()` (`descalificado`); `mensajeFinalizadoPost(horario)` con 8140100246; estado `finalizado` sin Claude vía `botSteps.ts` (retorno directo).

## 2026-06-05 (re-engagement automático)

- `supabase/sql/leads_reengagement.sql`: columnas `reengagement_1_sent_at` y `reengagement_2_sent_at` en `leads`.
- `vercel.json`: cron `* * * * *` → `/api/cron/reengagement`.
- `lib/reengagement.ts` + `app/api/cron/reengagement/route.ts`: leads `estado=nuevo`, ventanas 5–6 min (toque 1) y 20–21 min (toque 2) desde último mensaje entrante; mensajes por `conversations.state`; guarda saliente en `messages`; auth `x-vercel-cron` o `Bearer CRON_SECRET`; omite si `leads.updated_at` < 2 min.

## 2026-06-05 (backfill montos precalificación)

- `scripts/backfill-montos.ts`: backfill manual para leads con `nss` y `saldo_subcuenta` null; consulta/actualiza vía PostgREST (`fetch`) para evitar dependencia de WebSocket en Node 20; POST a scraper con `{ nss, workerIndex }` igual que `botStepsCore`; en éxito persiste montos; si no califica intenta `estado_precalificacion=no_califica` (solo log si la columna no existe). Delay 20s entre NSS.
- `app/api/admin/backfill-montos/route.ts`: mismo flujo expuesto en Vercel con `Authorization: Bearer {CRM_JWT_SECRET}`; `maxDuration=300`; respuesta JSON con resultado por NSS.

## 2026-05-29 (bot monto exacto)

- `lib/botStepsCore.ts`: mensaje post-NSS usa `montoCredito` del scraper (`Tu monto autorizado es: $X`); sin rango 80%–85%. Persistencia en lead: `monto_credito`, `monto_aprobado_min/max` = mismo valor.

## 2026-05-29 (webhook multi-número Fase D)

- `lib/parseWhatsAppWebhook.ts`: `phoneNumberId` desde `metadata.phone_number_id`; `payloadDebeIgnorarPorEcos` para ecos sin mensajes entrantes.
- `app/api/webhook/route.ts`: solo si `WHATSAPP_MULTI_NUMBER_ENABLED=true` — resolver por `phone_number_id`, ecos ignorados, try/catch con fallback env. Con flag `false`/ausente: comportamiento idéntico al anterior.
- **Sin cambios** en `botSteps.ts`, `botStepsCore.ts`, `metaWebhookVerification.ts`, ni env vars existentes.

## 2026-05-29 (fix FB.init antes de FB.login)

- `ConectarWhatsAppClient.tsx`: orden Meta estricto — `fbAsyncInit` → `FB.init` → `setSdkReady(true)` → luego script al DOM. Botón `disabled={!sdkReady || loading}`; guard en `handleConectar`. Eliminados polling, `setTimeout` y `ensureFacebookLoginReady`. Versión diagnóstico `sdk-fbasyncinit-1`.
- `page.tsx` sin cambios (solo props server-side).

## 2026-05-29 (Embedded Signup Jefe 1)

- `app/conectar-whatsapp/page.tsx` + `ConectarWhatsAppClient.tsx`: FB SDK, `FB.login` con `featureType: whatsapp_business_app_onboarding`, listener `WA_EMBEDDED_SIGNUP`, POST al backend con `setup_token` en header.
- `app/api/meta/embedded-signup/route.ts` + `lib/metaEmbeddedSignup.ts`: intercambio OAuth Graph, persistencia `whatsapp_accounts` (`jefe_1`, `coexistence`), respuesta pública sin `access_token`.
- Seguridad: `WHATSAPP_SETUP_TOKEN` en query (gate UI) y header `x-whatsapp-setup-token` (API).
- **Sin cambios** en webhook, `botSteps`, env `WHATSAPP_PHONE_NUMBER_ID` / `WHATSAPP_ACCESS_TOKEN` de producción.

## 2026-05-29 (multi-número, solo preparación)

- `supabase/sql/whatsapp_accounts.sql`: tabla `whatsapp_accounts` (owner, mode, phone_number_id único, token, default activo único). Ejecutar manualmente en Supabase; seed opcional comentado.
- `lib/whatsappAccountResolver.ts`: `resolveWhatsAppAccount(phoneNumberId?)` — busca fila activa por `phone_number_id` o fallback idéntico a env actual (`bot_principal`, `cloud_only`). No usado aún por webhook.
- `.env.example`: documentadas `WHATSAPP_MULTI_NUMBER_ENABLED`, `WHATSAPP_DEFAULT_OWNER` y variables Meta Embedded Signup (fase QR posterior).
- **Explícito:** esta fase NO conecta Jefe 1, NO toca `app/api/webhook/route.ts`, NO activa multi-número en producción.

## 2026-05-29

- `lib/botStepsCore.ts`: nuevo `MSG_REINTENTO_PRECIFICACION` para fallos técnicos o respuestas incompletas del scraper; pide reingresar NSS sin tono de error. Rechazo explícito (`califica: false`) y flujo exitoso sin cambios.

## 2026-05-28

- `lib/botStepsCore.ts`: se eliminó del `MSG_FINAL` el bloque «También puedes comunicarte directamente a este número: 8140100246»; el cierre queda únicamente con el aviso de contacto por asesor.
- `app/manifest.json`: configuración base PWA para CRM (`start_url`, `display`, `theme_color` y `background_color`).
- `public/sw.js`: Service Worker para `push` y `notificationclick` con navegación a la URL del payload.
- `app/api/crm/push/subscribe/route.ts`: endpoint protegido para registrar/actualizar suscripciones push en `crm_push_subscriptions`.
- `app/crm/leads/page.tsx`: botón `Activar notificaciones` con solicitud de permiso, registro de SW y alta de suscripción mediante `/api/crm/push/subscribe`.
- `lib/pushNotifications.ts`: envío de web push con `web-push` a suscripciones activas y limpieza automática de endpoints expirados (404/410).
- `app/api/webhook/route.ts`: al crear lead nuevo se dispara push `Nuevo lead Mejoravit` con deep-link a `/crm/leads/{id}`.
- Requisito de esquema Supabase: tabla `crm_push_subscriptions` (endpoint, p256dh, auth, advisor_id, timestamps).
- `lib/leadProvisional.ts`: corrección de compatibilidad con esquema `leads` (`nss`/`horario` NOT NULL) usando strings vacíos en el insert provisional.
- `lib/botStepsCore.ts`: fallback de seguridad al cerrar horario; si la conversación llega sin `lead_id`, se hace `insert` del lead y se enlaza en `conversations` antes de finalizar.
- `lib/leadProvisional.ts`: creación de lead provisional al primer contacto (`whatsapp_phone`, `estado: nuevo`) y actualización incremental del mismo registro durante el flujo.
- `lib/conversationMemory.ts`: se agregó `lead_id` a `ConversationValue` y al upsert de `conversations` para enlazar mensajes con el lead desde el inicio.
- `lib/botStepsCore.ts`: `inicio` y reinicio llaman `ensureLeadProvisional`; al validar NSS se actualiza el lead; al cerrar horario se hace `update` (ya no `insert` final).
- `app/api/webhook/route.ts`: resolución de lead priorizando `conversations.lead_id` tras `ensureLeadProvisional`, antes de guardar entrantes/salientes.
- Requisito de esquema Supabase: columna `lead_id` (uuid, nullable) en tabla `conversations`.
- `app/crm/leads/[id]/useLeadChat.ts`: hook compartido para chat CRM (`fetchMensajes`, envío `POST /messages`, polling cada 10s, autoscroll y etiquetado de origen `Cliente/Bot/Asesor`) para evitar duplicación entre vistas.
- `app/crm/leads/[id]/chat/page.tsx`: nueva vista de chat a pantalla completa estilo WhatsApp con header fijo verde (`#075E54`), avatar por inicial del teléfono, datos de lead, separadores por día y composer fijo inferior.
- `app/crm/leads/page.tsx`: en listado de leads se agregaron dos acciones separadas (`Ver` para detalle y `Chat` para pantalla completa de conversación) en desktop y móvil.
- `app/crm/leads/[id]/page.tsx`: refactor para consumir `useLeadChat` y mantener misma lógica de chat existente en la vista de detalle.
- `app/crm/leads/[id]/page.tsx`: rediseño visual del chat para aproximar WhatsApp Web (fondo `#ECE5DD`, burbujas blancas/verde `#DCF8C6` con cola, metadatos en esquina inferior derecha y barra inferior de envío fija).
- `app/crm/leads/[id]/page.tsx`: se agregó etiquetado visual de origen por mensaje (`Cliente`, `Bot`, `Asesor`) sin modificar contrato de API; para salientes se conserva detección local de mensajes enviados desde la sesión del asesor.
- `app/api/webhook/route.ts`: se quitó la dependencia de `leadEnModoChat` para persistir entrantes; ahora se guarda el mensaje entrante siempre que exista lead y se hace flush post-procesamiento para cubrir creación tardía del lead en el mismo evento.
- `app/api/webhook/route.ts`: se añadió cola de mensajes salientes exitosos del webhook (mensaje de espera + reply del bot) para persistirlos en `messages` con `direccion: "saliente"` sin alterar el orden de envío por WhatsApp.
- `app/crm/leads/[id]/page.tsx`: `chatHabilitado` incluye estado `nuevo` además de `contactado` y `no_interesado`.
- `app/api/crm/leads/[id]/messages/route.ts`: se agregó guardia de estado permitido para envío de asesor (`nuevo`, `contactado`, `no_interesado`) con respuesta `400` para estados no contemplados.
- Tests nuevos:
  - `app/api/webhook/route.test.ts` valida guardado entrante en `nuevo`, persistencia post-creación de lead y guardado de salientes automáticos.
  - `app/api/crm/leads/[id]/messages/route.test.ts` valida envío permitido en `nuevo` y rechazo de estados fuera de contrato.

## 2026-05-20

- `app/api/precalificar/route.ts` + `lib/precalificarTrigger.ts`: precalificación vía scraper tras captura de NSS; webhook dispara el job en segundo plano. Leads por `whatsapp_phone` (insert si aún no existe fila).
- `buildMensajeAprobado` ahora calcula el rango con fórmula comercial desde `saldoSubcuenta` (`0.90 * 0.80` a `0.90 * 0.85`), redondea hacia abajo y comunica solo el rango final al lead.
- CRM `/crm/leads/[id]`: se agregó módulo de precalificación manual con botón, loading "Consultando Infonavit...", badge de resultado y campos de resumen (titular, rango aprobado, capacidad de compra, pago mensual, motivo de rechazo).
- `POST /api/precalificar` acepta `source: "crm"` para persistir resultado sin enviar WhatsApp cuando el disparo viene del panel CRM.
- `/crm/leads`: botón `Precalificar` en cabecera abre modal con captura de NSS; ejecuta `/api/precalificar` con `source: "crm"` y muestra badge/resultado en el mismo modal. `phoneNumber` es opcional en CRM (se usa `crm-{nss}` si no se indica teléfono).
- `app/api/precalificar/route.ts`: fetch al scraper migrado de `AbortSignal.timeout(90000)` a `AbortController` de 180000ms para soportar consultas largas (proxy/CAPTCHA) sin `The operation was aborted due to timeout`.
- `app/crm/leads/page.tsx`: en el modal, durante `precalificando`, se añade texto de espera explícito («Consultando Infonavit... esto puede tardar hasta 2 minutos»).
- `lib/botStepsCore.ts`: el estado `esperando_datos` ahora consulta `SCRAPER_URL` en línea con `AbortController` de 180000ms, calcula rango desde `montoCredito` y solo avanza a `esperando_horario` en éxito.
- `app/api/webhook/route.ts`: al detectar NSS válido en `esperando_datos` se envía mensaje previo de espera al usuario y se eliminó el disparo asíncrono `dispararPrecalificacion` para evitar doble consulta/respuesta.
- `lib/botStepsMemory.test.ts`: se mockea fetch de scraper y se actualizan aserciones para validar rango dinámico en respuesta del paso NSS.
- `lib/parseWhatsAppWebhook.ts`: `extraerTextosEntrantes` ahora extrae también `wamid` (id del mensaje entrante) para permitir deduplicación en webhook.
- `app/api/webhook/route.ts`: se cambió a ACK inmediato (`200`) con procesamiento asíncrono y se agregó deduplicación en memoria por `wamid` y teléfono para ignorar reintentos duplicados de Meta.
- `app/api/webhook/route.ts`: se revierte `queueMicrotask` para volver a procesamiento síncrono con `await` dentro de `POST /api/webhook`; se mantiene únicamente la deduplicación por `wamid`.
- `lib/botStepsCore.ts`: en éxito de scraper por bot se toma `saldoSubcuenta` como base y se cachean por teléfono `saldo_subcuenta` (raw), `monto_base`, `monto_aprobado_min` y `monto_aprobado_max`; al guardar lead tras capturar horario se insertan esos campos junto con `nss/horario`.
- `app/crm/leads/page.tsx`: el listado (tabla y cards) muestra por lead `Saldo subcuenta`, `Después de descuento (×0.9)` y `Rango aprobado`.
- `lib/botStepsMemory.test.ts`: mock de `leads.insert` captura payload y valida persistencia de los cuatro campos nuevos en flujo exitoso.
- `lib/botStepsCore.ts` / `conversationMemory.ts` / `botSteps.ts`: eliminado estado `esperando_centro_trabajo`; en `esperando_credito_activo` la respuesta negativa avanza directo a `esperando_datos` con `MSG_SOLICITUD_DATOS`.
- Estado `finalizado` con manejo post-flujo vía `__POST_FLUJO__` y llamada directa a Anthropic; se eliminó reinicio automático al recibir mensajes tras completar registro.
- Claude ahora interpreta respuestas naturales con prompt más estricto y ejemplos explícitos; `procesarYEvolucionar` unificado para usar una sola vía de interpretación y responder fuera de tema sin reglas heurísticas de longitud.
- Estado del bot persistido en Supabase (`conversations`): lectura con `maybeSingle` sin insert por defecto, escritura con `upsert` y caché `Map` por request; corrige pérdida de estado entre instancias Vercel.
- Copy del paso crédito Infonavit: `MSG_CREDITO_ACTIVO` actualizado a «Actualmente estás pagando un crédito Infonavit».
- Ajuste de interpretación Si/No: `esAfirmativo` ahora contempla `efectivamente` y `así es`; en `procesarYEvolucionar` se registra diagnóstico de estado/interpretación/entrada y se trata `ambiguo` sin forzar entrada para que el core normalice texto.
- Validación de NSS endurecida: se acepta únicamente cuando el mensaje contiene exactamente 11 dígitos en total; agregado test para rechazar entradas de 12+ dígitos.
- Guardia de arranque en `procesarYEvolucionar`: si estado es `inicio`, no se invoca Claude y se devuelve bienvenida exacta; si es `finalizado`, se limpia historial Claude y se reinicia con bienvenida exacta.
- Mensajes del flujo marcados `exacto: true` (sin `naturalizarMensajeBot`); Claude solo en `fuera_tema` con tono profesional y pregunta literal al final.
- Mensajes sí/no del flujo sin bloque «Responde: Sí/No»; regla anti-emojis en `SYSTEM_PROMPT` de Claude.
- Bloque 4 Chat CRM: `lib/messagesDb.ts`, endpoints de mensajes, UI de chat en detalle de lead (habilitado en `contactado` y `no_interesado`), webhook persiste entrantes en esos estados y deja de auto-responder solo en `contactado`.
- Bloque 3 UI CRM implementado con Tailwind CSS y App Router: login de asesores, listado de leads con contador de nuevos y vista detalle con actualización de estado + nota.
- Se usa token JWT del CRM en `localStorage` y `Authorization: Bearer` para consumir `/api/crm/*`; incluye estados de carga/error y layout responsive móvil/escritorio.

## 2026-05-19

- Bloque 2: `getSupabaseAdmin`, `guardarLead` en `esperando_horario`, API CRM con login JWT y listado/detalle/actualización de leads. RLS desactivado; acceso vía `service_role` en servidor.

## 2026-05-18

- Integración Claude: `procesarYEvolucionar` es async; sin `ANTHROPIC_API_KEY` el bot usa solo reglas (`normalizeText`, `nss`). Con API key, Claude interpreta antes del paso y naturaliza salidas no exactas. Historial por teléfono en memoria (`Map` en `claudeAssistant.ts`).
- Flujo conversacional en `lib/botSteps.ts` reemplaza embudo nombre→NSS→confirmación por precalificación Mejoravit (sí/no con `normalizeText`), datos combinados, monto placeholder sin cálculo, y cierre con horario. Estados en `conversationMemory`; webhook `/api/webhook` intacto.
- Tras capturar datos se envía monto y, en el siguiente mensaje del usuario, la pregunta de interés (limitación de un reply por evento Meta).
- Ajuste de copy y validación: en `esperando_datos` ya no se solicita nombre; se acepta únicamente NSS/IMSS de 11 dígitos y se conserva la traza de logs con `name: null`.

## 2026-05-15

- Estado de conversación persistente sólo dentro del proceso Node mediante `conversationMemory` (`Map`): adecuado para pruebas; en serverless el estado puede perderse al escalar o al reinicio.
- Se retiró Supabase del código y dependencias; leads confirmados se registran vía `console.log` hasta definir BD.
- Previo Next + Express coexistencia y luego Supabase fueron pasos intermedios; el repo queda sólo Next con memoria RAM.

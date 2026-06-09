# Changelog

## [Sin versión semver] — 2026-06-05 (continuación IV)

### Cambio actual

- **Bot — flujo NSS → horario:** tras crédito activo se pide NSS primero; el horario se captura después del monto; en `esperando_horario` con NSS existente (conversación o `leads`) se precalifica y finaliza sin volver a pedir NSS.
- **Bot — Claude en horario:** instrucciones para redirigir preguntas fuera de guión al contacto; fallback si `fuera_tema` con texto ≥3 chars en `esperando_horario`.
- **Re-engagement horario:** mensajes sin detalles del producto, solo agendar contacto.

## [Sin versión semver] — 2026-06-05 (continuación III)

### Cambio actual

- **Bot — opt-out antes de Claude:** `esOptOut` se evalúa en `botSteps.ts` antes de `interpretarRespuestaUsuario`, evitando que Claude bloquee el cierre por `fuera_tema`.
- **Webhook — medios no texto:** imagen, audio o video reciben respuesta fija y se persiste el mensaje saliente en `messages`.

## [Sin versión semver] — 2026-06-05 (continuación II)

### Cambio actual

- **Bot — cierre y opt-out:** detección de desinterés (`no_interesado`), scraper no califica cierra como `descalificado`, mensaje final con horario y teléfono 8140100246 sin Claude en `finalizado`.

## [Sin versión semver] — 2026-06-05 (continuación)

### Cambio actual

- **Re-engagement automático (Vercel Cron):** `vercel.json` ejecuta `GET /api/cron/reengagement` cada minuto; toques a 5 y 20 min sin respuesta del usuario en leads `nuevo`, mensajes según `conversations.state`, columnas `reengagement_1_sent_at` / `reengagement_2_sent_at` en `leads`.

## [Sin versión semver] — 2026-06-05

### Cambio actual

- **Backfill montos precalificación:** `scripts/backfill-montos.ts` (local) y `POST /api/admin/backfill-montos` (temporal, auth con `CRM_JWT_SECRET`) consultan leads con NSS y sin `saldo_subcuenta`, llaman al scraper como el bot y actualizan montos o marcan `no_califica`; ejecutan un NSS cada 20s.

## [Sin versión semver] — 2026-05-29 (continuación)

### Cambio actual

- **Bot — monto exacto tras precalificación:** tras validar NSS, el mensaje muestra el `montoCredito` del scraper (sin “aproximadamente” ni rango min–max). El lead guarda `monto_credito` y min/max iguales a ese valor.

## [Sin versión semver] — 2026-05-29 (continuación)

### Cambio actual

- **Webhook multi-número (Fase D, opt-in):** con `WHATSAPP_MULTI_NUMBER_ENABLED=true`, el webhook resuelve credenciales por `metadata.phone_number_id` vía `resolveWhatsAppAccount` y responde desde el mismo número; ecos (`message_echoes` / `smb_message_echoes`) se ignoran. Default `false` = sin cambio de runtime. Fallback siempre a `WHATSAPP_PHONE_NUMBER_ID` / `WHATSAPP_ACCESS_TOKEN`.

## [Sin versión semver] — 2026-05-29

### Cambio actual

- **Fix timing Facebook SDK (conectar-whatsapp):** `ConectarWhatsAppClient` asigna `window.fbAsyncInit` antes de insertar `sdk.js`; `sdkReady` solo pasa a `true` tras `FB.init()` en ese callback. El botón queda `disabled` hasta entonces y `handleConectar` no llama `FB.login` sin guard. Sin `setTimeout` ni polling. Build `sdk-fbasyncinit-1`.

## [Sin versión semver] — 2026-05-28

### Cambio actual

- **Embedded Signup v3 (Jefe 1):** página `/conectar-whatsapp` (Facebook SDK + `whatsapp_business_app_onboarding`), endpoint `POST /api/meta/embedded-signup` (intercambio de code, upsert en `whatsapp_accounts` con `owner: jefe_1`, `mode: coexistence`). Protección con `WHATSAPP_SETUP_TOKEN`. Webhook y bot sin cambios.
- **Preparación multi-número WhatsApp (sin cambio de runtime):** SQL `supabase/sql/whatsapp_accounts.sql`, resolver `lib/whatsappAccountResolver.ts` con fallback a `WHATSAPP_*` env, y tests. No modifica webhook ni flujo del bot; Jefe 1 / Embedded Signup / coexistence quedan para fases posteriores.
- **Copy al fallar precalificación en bot:** si la consulta al scraper no completa la validación, el bot pide reingresar el NSS en lugar de mostrar un mensaje de error técnico; el flujo exitoso y el rechazo por no calificar no cambian.
- **Copy de cierre del bot:** `MSG_FINAL` ya no incluye la invitación a llamar al 8140100246; el flujo termina solo con que un asesor contactará en el horario indicado.
- **Web Push en CRM:** agregado `app/manifest.json` para PWA y `public/sw.js` para recibir push/click a rutas del CRM.
- **Suscripción de asesores a notificaciones:** nuevo endpoint `POST /api/crm/push/subscribe` (auth + Zod) y botón `Activar notificaciones` en `/crm/leads` para pedir permiso, registrar Service Worker y guardar suscripción.
- **Notificación al crear lead nuevo:** en `POST /api/webhook`, cuando se detecta creación de lead `nuevo`, se envía push con título **Nuevo lead Mejoravit**, cuerpo con teléfono/horario y click a `/crm/leads/{id}`.
- **Fix urgente lead provisional:** `ensureLeadProvisional` ahora inserta `nss: ""` y `horario: ""` (en lugar de `null`) para cumplir restricciones `NOT NULL` de la tabla `leads`.
- **Respaldo en cierre de flujo:** al capturar horario, si la conversación no tiene `lead_id`, `botStepsCore` realiza `insert` de fallback del lead y luego enlaza `lead_id` en `conversations`.
- **Lead provisional desde el primer mensaje:** al iniciar el flujo (`inicio`) se crea o reutiliza un lead en estado `nuevo` con `nss`/`horario` iniciales, se guarda su `lead_id` en `conversations` y se actualiza el mismo lead al capturar NSS y horario (sin insert tardío al final).
- **Webhook enlazado por `lead_id` de conversación:** `POST /api/webhook` ahora llama `ensureLeadProvisional` antes de persistir mensajes y resuelve el lead con `conversations.lead_id` para asociar historial desde el primer “Hola”.
- **CRM listado con acceso directo a chat:** en `app/crm/leads/page.tsx` se reemplazó la acción única `Ver` por dos botones (`Ver` y `Chat`) tanto en tabla de escritorio como en tarjetas móviles.
- **Nueva vista full-screen de chat:** se creó `app/crm/leads/[id]/chat/page.tsx` con layout tipo WhatsApp (header verde fijo, área de mensajes `#ECE5DD`, separadores por fecha, autoscroll y barra inferior fija con input + botón circular `➤`).
- **Lógica de chat compartida:** se extrajo la lógica de fetch/envío/polling/autoscroll a `app/crm/leads/[id]/useLeadChat.ts` y se reutiliza en detalle de lead y en la nueva pantalla completa.
- **UI de chat tipo WhatsApp en CRM:** en `/crm/leads/[id]` se rediseñó el chat con fondo `#ECE5DD`, burbujas entrantes blancas/salientes verdes (`#DCF8C6`) con cola lateral, timestamp y origen dentro de cada burbuja (`Cliente`, `Bot`, `Asesor`), manteniendo polling de 10s y lógica existente.
- **Composer estilo WhatsApp Web:** barra inferior visual fija con input redondeado (`Escribe un mensaje...`) y botón circular de envío con ícono de avión.
- **Persistencia completa de chat en webhook:** `POST /api/webhook` ahora guarda mensajes entrantes siempre que exista el lead (sin depender de `leadEnModoChat`) y reintenta guardarlos al final del procesamiento para cubrir el caso donde el lead se crea dentro del mismo flujo.
- **Historial de salientes automáticos del bot:** los mensajes enviados automáticamente por WhatsApp desde webhook (incluido el mensaje de espera y la respuesta principal) ahora también se persisten en `messages` con `direccion: "saliente"` tras envío exitoso.
- **Chat CRM habilitado en estado `nuevo`:** en `/crm/leads/[id]` el asesor ya puede enviar desde `nuevo`, `contactado` y `no_interesado`; `POST /api/crm/leads/[id]/messages` valida explícitamente esos tres estados permitidos.
- **Cobertura de pruebas:** se agregaron tests para webhook (`app/api/webhook/route.test.ts`) y para el endpoint CRM de mensajes (`app/api/crm/leads/[id]/messages/route.test.ts`) cubriendo persistencia entrante/saliente y permiso en estado `nuevo`.

## [Sin versión semver] — 2026-05-20

### Cambio actual

- **Precalificación Infonavit:** endpoint `POST /api/precalificar`, disparo desde webhook al confirmar NSS, mensaje de espera y notificación por WhatsApp con resultado del scraper.
- **Mensaje de aprobado:** el rango mostrado al lead ahora se calcula con base en `saldo_subcuenta` (90% prestable, luego 80%-85%), mostrando solo el monto final estimado sin exponer montos crudos del portal.
- **CRM detalle lead:** botón `Precalificar` / `Re-precalificar` en `/crm/leads/[id]` con estado de carga, resultado visual (aprobado/rechazado), motivo y fecha de consulta. Desde CRM se llama `/api/precalificar` con `source: "crm"` para omitir envío de WhatsApp.
- **Acceso rápido en listado CRM:** botón `Precalificar` junto a `Cerrar sesión` en `/crm/leads` abre modal para capturar NSS (y teléfono opcional), consultar Infonavit y mostrar resultado sin depender de leads existentes.
- **Timeout CRM → scraper:** `POST /api/precalificar` ahora espera hasta 180s al scraper usando `AbortController` para evitar abortos prematuros cuando hay reintentos de proxy/CAPTCHA.
- **UX modal de precalificación:** en `/crm/leads` durante la consulta se muestra el aviso «Consultando Infonavit... esto puede tardar hasta 2 minutos» para evitar cierres prematuros del modal.
- **WhatsApp NSS en línea:** al capturar NSS válido en el bot se consulta el scraper en el mismo flujo (timeout 180s) y se responde con rango estimado dinámico antes de pedir horario.
- **Espera visible en WhatsApp:** el webhook envía «Un momento, estoy consultando tu información en Infonavit... ⏳» antes de procesar la consulta de NSS para evitar abandono por silencio.
- **Webhook robusto ante reintentos de Meta:** `POST /api/webhook` ahora responde `200` inmediatamente y procesa en segundo plano para reducir duplicados por timeout de entrega.
- **Deduplicación por WAMID:** los mensajes entrantes incluyen `wamid` y se ignoran reintentos con el mismo ID por conversación para evitar doble consulta al scraper.
- **Webhook en modo síncrono (await):** se revierte el procesamiento en background con `queueMicrotask` y se vuelve a procesar el mensaje dentro del `POST`; se conserva la deduplicación por `wamid`.
- **Persistencia de montos de precalificación en leads:** al cerrar horario desde bot se guardan `saldo_subcuenta`, `monto_base` (`*0.9`), `monto_aprobado_min` y `monto_aprobado_max` calculados desde `saldoSubcuenta`; listado CRM ahora muestra esos tres valores por lead.
- **Flujo WhatsApp sin paso de centro de trabajo:** se eliminó el estado `esperando_centro_trabajo`; tras responder que no tiene crédito Infonavit activo, el bot pasa directo a solicitar NSS.
- **Mensaje de cierre del bot:** `MSG_FINAL` muestra solo el teléfono 8140100246 (se quitó 8114118767).
- **CRM detalle lead:** si el lead tiene `saldo_subcuenta`, la sección Precalificación Infonavit muestra el desglose de montos en lugar del mensaje vacío.

- **Post-flujo:** cuando el estado es `finalizado`, ya no se reinicia el embudo; Claude responde mensajes posteriores (gracias, dudas, despedida) sin reiniciar la conversación.

- **Claude interpretación natural:** `SYSTEM_PROMPT` y prompt de interpretación reforzados para respuestas humanas naturales; `botSteps` simplificado para una sola ruta de interpretación y manejo de fuera de tema.

- **Persistencia del flujo en serverless:** estado conversacional migrado de `Map` en memoria a Supabase (`conversations` + caché local por request); `getConversation` / `setConversation` / `deleteConversation`.

- **Copy crédito Infonavit:** pregunta del paso 3 cambiada a «Actualmente estás pagando un crédito Infonavit».

- **Si/No y estados:** se robusteció `esAfirmativo` para variantes como `efectivamente` y `así es`; en el flujo se añadió diagnóstico temporal y manejo explícito de interpretaciones `ambiguo` de Claude para que el core resuelva con `normalizeText`.

- **Validación estricta NSS:** en captura de NSS solo se acepta entrada con exactamente 11 dígitos totales; si llegan más o menos, se mantiene reintento con mensaje de validación.

- **Inicio robusto del flujo:** para contactos nuevos (`inicio`) el primer mensaje siempre dispara `MSG_BIENVENIDA` sin intervención de Claude; en `finalizado` se limpia historial de Claude, se reinicia flujo y se retorna bienvenida exacta.

- **Flujo del bot:** mensajes del embudo se envían exactos (sin naturalización Claude); Claude solo para fuera de tema, tono profesional y retomo con texto literal de la pregunta.

- **Copy del bot:** se quitaron las líneas «Responde: Sí / No» de las preguntas de precalificación; Claude instruido para no usar emojis ni símbolos especiales.

- **Bloque 4 Chat CRM:** tabla `messages`, API `GET/POST /api/crm/leads/[id]/messages`, historial en detalle de lead con poll 10s, envío por WhatsApp Cloud API; webhook guarda entrantes y silencia el bot cuando el lead está `contactado`; chat habilitado en UI para `contactado` y `no_interesado`.

- **Bloque 3 CRM visual:** panel web para asesores con Tailwind (`/crm/login`, `/crm/leads`, `/crm/leads/[id]`), autenticación por token en `localStorage`, listado responsive (tabla/card), badges de estado y acciones para marcar leads como `contactado` o `no_interesado`.

## [Sin versión semver] — 2026-05-19

### Cambio actual

- **Bloque 2 CRM:** Supabase (`leads`, `advisors`, `lead_actions`), persistencia al cerrar horario, endpoints `/api/crm/login`, `/api/crm/leads`, `/api/crm/leads/[id]` con JWT (`CRM_JWT_SECRET`).

## [Sin versión semver] — 2026-05-18

### Cambio actual (histórico)

- **Claude (Anthropic) opcional:** capa en `lib/claudeAssistant.ts` para interpretar respuestas ambiguas o fuera de tema y naturalizar mensajes de transición; la máquina de estados vive en `lib/botStepsCore.ts`. Variable `ANTHROPIC_API_KEY`. Rechazos y cierre final siguen con texto exacto; logs `[lead confirmado]` / `[lead horario]` intactos.

- **Flujo WhatsApp (textos y pasos):** precalificación (labor NL, Infonavit, crédito activo, centro de trabajo), datos solo NSS (11 dígitos), monto simbólico `__________`, interés, horario de contacto y cierre con teléfonos 8114118767 / 8140100246. Sin cambios en webhook Meta ni variables de entorno.

## [Sin versión semver] — 2026-05-15

### Cambio actual (histórico)

- **Estado conversacional sólo en memoria:** `lib/conversationMemory.ts` (`Map` global por proceso). Confirmación sí → `console.log` con `{ phone, name, nss }` y mensaje fin al usuario.
- **Eliminación de Supabase:** dependencia `@supabase/supabase-js`, `lib/supabaseAdmin.ts` y variables `SUPABASE_*` retiradas.
- Script `npm run next:build` → alias de `next build`.

### Previo — migración sólo Next (Supabase desde entonces revertido aquí)

- Webhook WhatsApp en `/api/webhook` con flujo nombre → NSS → confirmación.

### Previo más antiguo

- Migración inicial **solo Next.js** (sin Express); pruebas Vitest para GET Meta (`hub.*`).

### Eliminado (época Express)

- Servidor Express (`index.js`), `generarRespuesta.js`, vistas estáticas y JSON locales de leads/usuarios.

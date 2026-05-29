# Changelog

## [Sin versión semver] — 2026-05-28

### Cambio actual

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

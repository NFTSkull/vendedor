# DEVLOG

## 2026-05-28

- `lib/leadProvisional.ts`: creación de lead provisional al primer contacto (`whatsapp_phone`, `estado: nuevo`, `nss/horario: null`) y actualización incremental del mismo registro durante el flujo.
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

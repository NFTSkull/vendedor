# DEVLOG

## 2026-05-20

- `app/api/precalificar/route.ts` + `lib/precalificarTrigger.ts`: precalificación vía scraper tras captura de NSS; webhook dispara el job en segundo plano.
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

# Changelog

## [Sin versión semver] — 2026-10-14 (número compartido: clasificación, asesor por defecto y pestaña Compra de Casa)

### Cambio actual

- **Clasificación del número 8114118767 (`phone_number_id` 1177472778778882)** (`lib/detectarProducto.ts`). Ya no manda todo a Compra de Casa. Cascada:
  1. Texto del anuncio de Meta (`messages[].referral`: `headline`, `body`, `source_url`), validado con Zod en `lib/parseWhatsAppWebhook.ts`.
  2. Palabras clave estrictas del primer mensaje:
     - Mejoravit: "mejoravit", "nss", "crédito (de/del) infonavit", "préstamo".
     - Compra de Casa: "vender", "vendo mi casa/propiedad/depa", "venta de mi casa/propiedad/depa".
     - Generadores: "generador(es)", "vacante(s)".
     - "Infonavit" suelto no cuenta.
  3. Si no hay coincidencia o hay más de un producto, el lead queda `sin_clasificar`.
- **Menú para `sin_clasificar`** (`lib/menuProducto.ts`): el bot responde "¿En qué te podemos ayudar? 1) Crédito Mejoravit (Infonavit) 2) Vender tu casa".
  - Se acepta "1"/"2", "uno"/"dos", "opción 1", "la segunda" o el texto de la opción.
  - Al elegir, se fija el producto en la conversación y en el lead, y arranca el flujo correspondiente.
  - Una respuesta no reconocida reenvía el menú.
- **`leads.producto` sincronizado** (`lib/productoLead.ts`) cuando cambia el producto de la conversación:
  - por el comando "activa mejoravit/casas";
  - por el menú;
  - al ligar un lead existente con un primer mensaje clasificado.
- **Asesor por defecto** (`lib/asignacionAsesor.ts`):
  - Leads nuevos o recién clasificados como Mejoravit o Compra de Casa reciben `DEFAULT_ADVISOR_MEJORAVIT` / `DEFAULT_ADVISOR_COMPRA_CASA` (Guillermo si no están configuradas).
  - Solo se asigna si `advisor_id` es nulo.
  - El prefijo G-/B- tiene prioridad.
  - Generadores, Paneles y `sin_clasificar` no se asignan.
- **Historial:** `lead_actions` registra `cambio_producto_automatico` y `asesor_asignado_automatico`, con `advisor_id` nulo y el detalle en `nota`.
- **CRM:**
  - Pestaña "Compra de Casa" (🔑) en Leads y Agenda.
  - Ícono 🔑 en el detalle del lead.
  - El botón regresar del detalle vuelve a Compra de Casa en lugar de Generadores.
- **Agenda:** un lead de Compra de Casa `contactado` sin `fecha_contacto` aparece en "Sin agendar" en vez de desaparecer.
- **Constantes:** `MEJORAVIT_PHONE_NUMBER_ID` y `COMPRA_CASA_PHONE_NUMBER_ID` se reemplazan por `NUMERO_COMPARTIDO_PHONE_NUMBER_ID`.

## [Sin versión semver] — 2026-10-13 (recordatorios para leads contactados por el bot)

### Cambio actual

- **Estados:** Mejoravit y Generadores aceptan leads `nuevo` y `contactado`. La reserva atómica también acepta los dos estados; si el lead pasa a `no_interesado` antes de reservar, no se envía.
- **Solo actividad nueva:** únicamente cuenta el último mensaje del cliente posterior a `2026-10-13T22:50:00Z` (`RECORDATORIOS_ACTIVIDAD_DESDE_ISO`). No hay backfill ni se reactivan conversaciones históricas.
- **Toque 2:** exige que el toque 1 se haya enviado después del último mensaje del cliente. Un toque 1 antiguo ya no habilita el toque 2.
- **No se envía si:**
  - un asesor intervino (`mensaje_asesor`/`archivo_asesor`, la misma definición del webhook) o registró cualquier acción en el CRM, como un cambio manual de estado;
  - después del último mensaje del cliente hay mensajes que no son del bot, el cliente volvió a escribir o el bot aún no respondió;
  - el último mensaje del cliente es un rechazo, opt-out o pausa ("luego te escribo", "lo pienso"), según los detectores existentes del bot;
  - el producto del lead y el de la conversación no coinciden, la conversación es de otro lead o no existe;
  - en Mejoravit, la conversación está en `tramite_mejoravit`, `esperando_horario` o `finalizado`, o ya se recibió el NSS (para no volver a pedirlo).
- **Producto:** Mejoravit exige `producto = mejoravit` en el lead y en la conversación (`sin_clasificar` ya no recibe recordatorios). No se modifica ningún `producto`.
- **Consultas:** cada flujo empieza por los mensajes entrantes recientes (30 min en Mejoravit, 20 h 10 min en Generadores). Solo los leads cuyo silencio cae en una ventana de toque llevan a leer leads, conversaciones, mensajes posteriores y acciones de asesor. Sin actividad: 2 consultas por ejecución (antes 3).
- **Tiempos sin cambio:** Mejoravit de 5 a 15 min y de 20 a 30 min; Generadores 3 h y 20 h, con la ventana de 24 h de WhatsApp.

## [Sin versión semver] — 2026-10-13 (costos: cron de recordatorios)

### Cambio actual

- **Frecuencia:** `vercel.json` pasa de `* * * * *` (1,440 ejecuciones al día) a `*/5 * * * *` (288).
- **Ventanas de Mejoravit adaptadas al cron de 5 minutos (`lib/reengagement.ts`):**
  - Toque 1: de 5 a menos de 15 minutos sin respuesta (antes de 5 a 6).
  - Toque 2: de 20 a menos de 30 minutos (antes de 20 a 21), con el toque 1 enviado al menos 10 minutos antes.
  - Después de esos límites no se manda nada, para no enviar recordatorios antiguos.
- **Generadores:** mismas reglas comerciales (toque 1 entre 180 y 190 min, toque 2 entre 1,200 y 1,210 min, ventana de 24 h, `genStep`).
- **Consultas:**
  - Mejoravit solo lee leads `nuevo` de producto Mejoravit (o `sin_clasificar`) con algún toque pendiente, y solo conversaciones `producto = mejoravit` en estados con recordatorio. Antes leía todos los leads `nuevo` y hacía 1–2 consultas por lead.
  - Generadores excluye en SQL a los leads con ambos toques enviados.
  - En los dos flujos, el último mensaje entrante de todos los candidatos sale en una sola consulta acotada por tiempo.
- **Sin duplicados (`lib/reengagementEnvio.ts`):**
  - Antes de enviar, cada toque se reserva con un UPDATE condicionado (`*_sent_at IS NULL` y `estado = 'nuevo'`). Solo una ejecución lo obtiene.
  - Después se comprueba que el cliente no haya escrito; si escribió, se libera la reserva y no se envía.
  - Rechazo 4xx de WhatsApp: se libera la reserva para reintentar dentro de la ventana. 5xx, fallo de red o historial no guardado: la reserva se conserva y no se reenvía.
- **Seguridad del cron:** se elimina la autorización solo con `x-vercel-cron: 1`; ahora exige `Authorization: Bearer CRON_SECRET`, el mecanismo oficial de Vercel.
- **Métricas:** la ruta responde y registra solo conteos (duración, candidatos, enviados, omitidos, errores, consultas y motivos). Ya no devuelve IDs de lead.

## [Sin versión semver] — 2026-10-13 (seguridad: expedientes del CRM y permisos Supabase)

### Cambio actual

- **Autorización por expediente (`lib/crmAcceso.ts`):** `GET`/`PATCH /api/crm/leads/[id]`, `GET`/`POST /api/crm/leads/[id]/messages` y `POST /api/crm/leads/[id]/media` comprueban sesión, asesor activo y que el lead esté en su alcance antes de leer mensajes, procesar archivos, escribir o llamar a Meta.
  - Regla de la bandeja: el admin opera leads sin asignar y cada asesor solo los suyos.
  - Respuestas: 401 sin sesión o con token inválido; 403 si el asesor está inactivo o el lead es ajeno; 404 si el ID no es UUID o no existe.
  - El teléfono destino de WhatsApp siempre sale de la base.
- **Condición de propiedad en escrituras:** el UPDATE de `PATCH` y los UPDATE del lead al responder por chat incluyen el alcance del asesor. Si el lead se reasigna entre la verificación y la escritura, no se modifica y `PATCH` responde 403.
- **Bandeja y agenda:** también exigen asesor activo y usan el mismo filtro de alcance (`conAlcance`).
- **Respuestas mínimas:**
  - Detalle y `PATCH` devuelven solo las columnas que usa la pantalla. No incluyen `tramite_mejoravit`, `advisor_id` ni campos internos. De `precalificacion_resultado` solo salen `califica`, `mensaje` y `datos.saldoSubcuenta` (sin RFC, empresa ni registro patronal).
  - La bandeja ya no devuelve NSS, precalificación ni trámite.
- **Logs:** los errores de la Graph API en mensajes y archivos del CRM solo registran código y tipo.
- **`/api/precalificar`:** usa la misma autorización compartida, sin cambio de comportamiento.
- **Supabase (`supabase/sql/revocar_privilegios_publicos.sql`, aplicado en `lxqvslupzxnkdzbhojad`):** se retiran todos los permisos de `anon`/`authenticated`, incluido TRUNCATE, en `leads`, `messages`, `advisors`, `lead_actions`, `whatsapp_accounts` y `crm_push_subscriptions`. RLS, políticas, datos, índices, funciones y `service_role` sin cambios.

## [Sin versión semver] — 2026-10-13 (seguridad: /api/precalificar y conversations)

### Cambio actual

- **`POST /api/precalificar`:**
  - Exige sesión del CRM (401 sin token o con token inválido).
  - El asesor debe existir y estar activo (403).
  - Solo opera leads dentro de su alcance, igual que la bandeja: el admin los leads sin asignar y cada asesor los suyos (403 si no).
  - `source` ya no existe; cualquier campo extra se rechaza con 400.
- **Cuerpo de la precalificación:**
  - Detalle del lead: solo envía `{ leadId }`; el NSS sale de la base.
  - Captura manual: `{ nss, phoneNumber? }` con NSS de 11 dígitos y teléfono de 10 a 13. Se rechaza un NSS o teléfono de un lead fuera del alcance (403) y un teléfono cuyo lead ya tiene otro NSS (409). Un lead nuevo creado por un asesor queda asignado a él.
- **Límites:** 10 precalificaciones por asesor cada 10 minutos (429) y una sola consulta en curso por lead (409). Cada solicitud y resultado queda en `lead_actions` (`precalificacion_solicitada` / `precalificacion_completada`).
- **Respuesta:** solo califica, nombre, NSS consultado, motivo y montos que muestra la pantalla; ya no incluye RFC, empresa ni registro patronal. Los errores del scraper responden 502 genérico.
- **Ya no envía WhatsApp desde esta ruta.** Solo lo hacía con `source=bot`, que ningún llamador usaba. Se eliminó `lib/precalificarTrigger.ts`, que no se usaba y llamaba a la ruta sin autenticación.
- **CRM:** la bandeja y el detalle del lead envían su token y regresan al login si la sesión expiró.
- **Supabase (`supabase/sql/conversations_rls.sql`, aplicado en `lxqvslupzxnkdzbhojad`):** RLS activo en `conversations` y sin permisos para `anon`/`authenticated`. No modifica filas.

## [Sin versión semver] — 2026-10-13 (Paso 1: asesor inteligente Mejoravit)

### Cambio actual

- **Requisito previo de despliegue:** ejecutar `supabase/sql/leads_tramite_mejoravit.sql` (columna `leads.tramite_mejoravit jsonb`, aditiva).
- **Crédito estimado:** importe neto estimado = `floor(min(saldoSubcuenta, 169000) × 0.90)` (máximo $152,100), presentado como estimación sujeta a validación. El saldo y la respuesta original del scraper se guardan sin cambios.
- **Después de una precalificación aprobada:** ya no se pide horario ni se dice que un asesor contactará. El bot muestra el importe neto estimado y ofrece continuar el trámite por el chat. Si el cliente acepta: aviso de privacidad, consentimiento y captura de datos, una pregunta a la vez.
- **Datos capturados (contrato Datos Generales de ConCasa):**
  - Identidad: nombres y apellidos por separado y CURP.
  - Contacto: correo y teléfono de casa distinto al celular.
  - Domicilio: calle, número exterior e interior, colonia, municipio, estado y CP.
  - Laboral: empresa, registro patronal, teléfono y dirección del trabajo.
  - Referencias: dos, con nombres, apellidos y celular, sin repetir personas ni teléfonos.
  - Beneficiario: nombre completo y parentesco.
- **Datos que no se preguntan:** NSS (de la precalificación) y celular (de WhatsApp). Empresa y registro patronal tampoco se preguntan cuando los devuelve la precalificación.
- **Sin preguntas de vivienda o mejora:** el bot no pregunta mejoras, presupuesto, materiales ni tipo de vivienda.
- **Vendedor:**
  - Acepta varios datos en un mensaje y correcciones.
  - "Luego seguimos" pausa y guarda el avance; al volver, retoma en la misma pregunta.
  - "No lo tengo ahorita" deja el dato pendiente y continúa; después de dos respuestas inválidas, el dato queda pendiente sin insistir.
  - Pide aclaración si la CURP no coincide con el RFC de Infonavit o si la empresa difiere de la del portal.
  - Rechazar el trámite no marca el lead como `no_interesado` ni borra el avance.
- **Documentos e INE:** checklist pendiente (INE frente y reverso, comprobante de domicilio, estado de cuenta). No se piden ni se reciben archivos; la INE queda "vigente requerida, pendiente de revisión". `lib/ineVigencia.ts` deja lista la regla para la siguiente fase.
- **Precalificación:**
  - Se reutiliza la aprobada del mismo NSS (7 días) en lugar de volver a consultar Railway.
  - No se lanza una segunda consulta mientras otra sigue en curso.
  - Se guardan `precalificacion_resultado`, `precalificacion_status`, `precalificado_at` y `nombre_infonavit`, igual que hace la ruta del CRM.
- **Logs:** se quitaron NSS, teléfono y texto del cliente de los logs del flujo Mejoravit y del alta de lead provisional.
- **Conversaciones antiguas en `esperando_horario`:** con el siguiente mensaje pasan al trámite y ya no cierran con "un asesor te contactará".
  - Si el lead ya tiene saldo guardado para el mismo NSS, se ofrece el trámite sin volver a consultar el portal; ese saldo no se guarda como `precalificacion_resultado`.
  - Si el saldo es de otro NSS o no hay saldo, se consulta una vez (estas conversaciones nunca se habían precalificado).
  - Sin NSS, se pide el NSS como antes. No se borra nada de `conversations.data` (el horario anterior se conserva).
  - Ya no reciben el toque de re-engagement que pedía horario de contacto.
- **CRM:** `GET /api/crm/leads` y `GET /api/crm/leads/[id]` no devuelven `tramite_mejoravit` (CURP, domicilio, referencias), porque el CRM todavía no lo muestra.
- **Reconstrucción del trámite:** solo con una precalificación aprobada cuyo NSS coincide con el que el cliente escribió en el chat.
- **Logs del webhook:** se quitó el payload completo de Meta, el remitente y el destino; los errores de la Graph API solo registran código y tipo. Compra de Casa y Generadores ya no registran el teléfono al fallar el UPDATE del lead.
- **Sin cambios:** Compra de Casa, Generadores, Paneles, comando de producto, reiniciar, scraper, reintentos de NSS, intervención del asesor.

## [Sin versión semver] — 2026-10-13 (precalificación Vercel → Railway)

### Cambio actual

- **Configuración:** `SCRAPER_SERVICE_URL` en Vercel apuntaba a un dominio de Railway que ya no existe (404 "Application not found"); ahora apunta a `https://mejoravit-scraper-production-fa7a.up.railway.app`. Afecta al bot y a `/api/precalificar` del CRM.
- **Falla del scraper en el bot (Mejoravit):** ya no vuelve a pedir el NSS. Conserva el NSS capturado y el estado, responde que hubo un problema temporal y el siguiente mensaje reintenta la consulta con el NSS guardado (si el cliente manda otro NSS, se usa el nuevo).
- **Logs:** `[scraper] Precalificación fallida` con el tipo de error (`scraper_http_<status>`, `scraper_http_404_railway_app_no_encontrada`, `timeout`, `red_<código>`, `respuesta_no_json`, `respuesta_inesperada`, `no_configurado`) y `lead_id`; sin NSS, teléfono, secretos ni cuerpo de la respuesta.

## [Sin versión semver] — 2026-10-13

### Cambio actual

- **Comando de producto de prueba (número 8114118767):** "activa / modo / cambia a mejoravit" y "activa / modo / cambia a casas" (o "compra de casa") cambian la conversación entre Mejoravit y Compra de Casa sin redeploy. Abierto a cualquier remitente que escriba a ese número, sin lista de autorizados. Solo aplica si el `phone_number_id` recibido de Meta es el de ese número y el texto completo es el comando.
- **Reset limpio:** el comando reemplaza `state`, `nss`, `producto` y `data` de la conversación en un solo upsert, conserva `lead_id`, limpia el historial de Claude y responde una confirmación corta. El siguiente mensaje entra al primer paso del flujo elegido.
- **Reiniciar conserva el producto:** "reiniciar" en Mejoravit conserva el producto guardado y el `lead_id` (antes volvía a detectar el producto por número y en 8114118767 pasaba a Compra de Casa). Limpia estado, NSS y datos del flujo; no duplica leads.
- **Webhook firmado:** `POST /api/webhook` valida `X-Hub-Signature-256` con `META_APP_SECRET`; solicitudes sin firma válida reciben 401.
- **Sin cambios** para otros números, mensajes normales, `leads.producto`, system prompts ni intervención de asesores (si un asesor ya intervino, el comando no responde).

## [Sin versión semver] — 2026-06-10

### Cambio actual

- **Asignación de leads por prefijo:** primer mensaje en estado `inicio` con `G-` o `B-` asigna `advisor_id` (Guillermo/Bernardo); el prefijo se elimina antes del bot.
- **CRM:** listado filtra leads por asesor (`advisor_id` del JWT o `null` para todos).
- **Push:** notificaciones de nuevo lead/mensaje solo al asesor asignado, o a todos si no hay asignación.
- **SQL:** `supabase/sql/leads_advisor_id.sql` — columna `advisor_id` en `leads`.

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

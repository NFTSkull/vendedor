# DEVLOG

## 2026-05-15 — WhatsApp webhook en Next.js

- El proyecto arrancaba solo con Express (`index.js`); se incorporó Next 15 manteniendo los scripts Express para no romper el flujo existente (`dev`/`start` siguen en Express).
- Meta exige responder el `hub.challenge` como cuerpo `text/plain` en GET; POST solo registra el JSON por ahora hasta definir procesamiento según `/docs/API_CONTRATOS` cuando existan contratos formales (`/docs` aún vacío en este repo).
- ESLint ignora JS legacy de Express (`index.js`, `generarRespuesta.js`) para no forzar migrate a ES modules antes de tiempo.

## 2026-05-15 — Nuevo flujo de preguntas comerciales

- Se reemplazó el flujo de conversación por una secuencia de elegibilidad más estricta:
  `relacion_laboral` -> `alta_infonavit` -> `credito_activo` -> `centro_trabajo_nl` -> `nss` -> `contacto`.
- Decisión funcional: si el prospecto responde "no" en requisitos indispensables o "sí" a crédito INFONAVIT activo, el flujo termina en `fin` con mensaje de descarte.
- Se alineó `index.js` para que, al precalificar NSS exitosamente, el texto devuelto pida día/horario de contacto en lugar de pasar a explicación comercial.

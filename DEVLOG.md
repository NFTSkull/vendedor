# DEVLOG

## 2026-05-15 — WhatsApp webhook en Next.js

- El proyecto arrancaba solo con Express (`index.js`); se incorporó Next 15 manteniendo los scripts Express para no romper el flujo existente (`dev`/`start` siguen en Express).
- Meta exige responder el `hub.challenge` como cuerpo `text/plain` en GET; POST solo registra el JSON por ahora hasta definir procesamiento según `/docs/API_CONTRATOS` cuando existan contratos formales (`/docs` aún vacío en este repo).
- ESLint ignora JS legacy de Express (`index.js`, `generarRespuesta.js`) para no forzar migrate a ES modules antes de tiempo.

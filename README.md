## WhatsApp Webhook (Express)

### Requisitos
- Node.js 18+ (recomendado)

### Instalación
```bash
npm install
```

### Variables de entorno
```bash
cp .env.example .env
```
Edita `.env` y define:
- `VERIFY_TOKEN`
- `WHATSAPP_ACCESS_TOKEN`
- `WHATSAPP_PHONE_NUMBER_ID`

### Correr el servidor
```bash
npm start
```

Opcional (modo watch):
```bash
npm run dev
```

### Verificación (GET /webhook)
Meta llamará algo como:
`/webhook?hub.mode=subscribe&hub.verify_token=TU_TOKEN&hub.challenge=123`


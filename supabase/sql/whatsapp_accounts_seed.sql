-- Seed del número actual (bot principal) — ejecutar manualmente en Supabase
-- Reemplaza los placeholders con los valores de Vercel (WHATSAPP_PHONE_NUMBER_ID / WHATSAPP_ACCESS_TOKEN)

INSERT INTO whatsapp_accounts (
  owner,
  mode,
  phone_number_id,
  display_phone_number,
  access_token,
  is_active,
  is_default
) VALUES (
  'bot_principal',
  'cloud_only',
  '<WHATSAPP_PHONE_NUMBER_ID>',
  NULL,
  '<WHATSAPP_ACCESS_TOKEN>',
  true,
  true
)
ON CONFLICT (phone_number_id) DO UPDATE SET
  owner = EXCLUDED.owner,
  mode = EXCLUDED.mode,
  access_token = EXCLUDED.access_token,
  is_active = EXCLUDED.is_active,
  is_default = EXCLUDED.is_default,
  updated_at = now();

-- Segundo número (Jefe 1) — ejecutar cuando Embedded Signup haya terminado
-- INSERT INTO whatsapp_accounts (
--   owner,
--   mode,
--   phone_number_id,
--   display_phone_number,
--   access_token,
--   is_active,
--   is_default
-- ) VALUES (
--   'jefe_1',
--   'coexistence',
--   '<JEFE_1_PHONE_NUMBER_ID>',
--   '<JEFE_1_DISPLAY_PHONE>',
--   '<JEFE_1_ACCESS_TOKEN>',
--   true,
--   false
-- );

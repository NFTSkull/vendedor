-- Compra de Casa: agrega 'compra_casa' al CHECK constraint de producto en leads
-- Ejecutar manualmente en el SQL Editor de Supabase, ANTES de probar el código.

ALTER TABLE leads
  DROP CONSTRAINT IF EXISTS leads_producto_check;

ALTER TABLE leads
  ADD CONSTRAINT leads_producto_check
  CHECK (producto IN ('mejoravit', 'paneles', 'generadores', 'compra_casa', 'sin_clasificar'));

-- ---------------------------------------------------------------------------
-- Alta del número dedicado de WhatsApp para Compra de Casa
-- Reemplaza los valores entre <> con los datos reales de Meta antes de ejecutar.
-- ---------------------------------------------------------------------------
INSERT INTO whatsapp_accounts (
  owner,
  mode,
  phone_number_id,
  display_phone_number,
  access_token,
  is_active,
  is_default
) VALUES (
  'compra_casa',
  'cloud_only',
  '<PHONE_NUMBER_ID_COMPRA_CASA>',
  '<NUMERO_VISIBLE>',
  '<ACCESS_TOKEN_COMPRA_CASA>',
  true,
  false
);

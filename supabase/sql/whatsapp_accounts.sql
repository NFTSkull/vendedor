-- whatsapp_accounts: persistencia multi-número (Cloud API / coexistence)
-- Ejecutar manualmente en el SQL Editor de Supabase. No hay runner de migraciones en el repo.

-- ---------------------------------------------------------------------------
-- Tabla
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS whatsapp_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner text NOT NULL,
  mode text NOT NULL,
  business_id text,
  waba_id text,
  phone_number_id text NOT NULL,
  display_phone_number text,
  verified_name text,
  access_token text,
  is_active boolean NOT NULL DEFAULT true,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT whatsapp_accounts_mode_check
    CHECK (mode IN ('cloud_only', 'coexistence')),
  CONSTRAINT whatsapp_accounts_phone_number_id_key
    UNIQUE (phone_number_id)
);

-- Solo una cuenta puede ser default activa a la vez
CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_accounts_one_default_active
  ON whatsapp_accounts (is_default)
  WHERE is_default = true AND is_active = true;

CREATE INDEX IF NOT EXISTS whatsapp_accounts_owner_idx
  ON whatsapp_accounts (owner);

CREATE INDEX IF NOT EXISTS whatsapp_accounts_active_idx
  ON whatsapp_accounts (is_active)
  WHERE is_active = true;

-- ---------------------------------------------------------------------------
-- updated_at automático
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION whatsapp_accounts_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS whatsapp_accounts_updated_at ON whatsapp_accounts;

CREATE TRIGGER whatsapp_accounts_updated_at
  BEFORE UPDATE ON whatsapp_accounts
  FOR EACH ROW
  EXECUTE FUNCTION whatsapp_accounts_set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS (opcional): la app usa service_role; si habilitas RLS, bloquea anon/authenticated
-- ---------------------------------------------------------------------------
-- ALTER TABLE whatsapp_accounts ENABLE ROW LEVEL SECURITY;
-- (Sin políticas para anon: solo service_role desde el servidor Next.js)

-- ---------------------------------------------------------------------------
-- Seed opcional (descomenta y reemplaza valores tras copiar desde Vercel)
-- Mantiene el número actual como default sin obligar a usar la tabla en runtime.
-- ---------------------------------------------------------------------------
-- INSERT INTO whatsapp_accounts (
--   owner,
--   mode,
--   waba_id,
--   phone_number_id,
--   display_phone_number,
--   access_token,
--   is_active,
--   is_default
-- ) VALUES (
--   'bot_principal',
--   'cloud_only',
--   NULL,
--   '<WHATSAPP_PHONE_NUMBER_ID>',
--   NULL,
--   '<WHATSAPP_ACCESS_TOKEN>',
--   true,
--   true
-- );

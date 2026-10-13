-- Vendedor IA (proyecto lxqvslupzxnkdzbhojad). La app solo accede con service_role,
-- que ignora RLS; anon y authenticated no deben leer ni escribir conversaciones (NSS, estado del bot).
-- No modifica filas.
alter table public.conversations enable row level security;

revoke all on table public.conversations from anon, authenticated;

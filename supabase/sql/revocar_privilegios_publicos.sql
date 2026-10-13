-- Vendedor IA (proyecto lxqvslupzxnkdzbhojad). La app solo accede con service_role.
-- Estas tablas ya tienen RLS sin políticas; se retiran los grants por defecto de Supabase a
-- anon/authenticated (incluido TRUNCATE, que no pasa por RLS). No modifica RLS, políticas,
-- datos, índices ni funciones, ni los permisos de service_role.
revoke all on table
  public.leads,
  public.messages,
  public.advisors,
  public.lead_actions,
  public.whatsapp_accounts,
  public.crm_push_subscriptions
from anon, authenticated;

-- Permite que o painel autenticado leia os indicadores das automações.
-- As policies existentes continuam restringindo as linhas exclusivamente a admins.
grant select on table public.newsletter_inscritos to authenticated;
grant select on table public.carrinhos_abandonados to authenticated;


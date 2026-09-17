alter table public.pedidos
  add column if not exists concluido_em timestamptz,
  add column if not exists email_avaliacao_enviado_em timestamptz,
  add column if not exists email_avaliacao_resend_id text,
  add column if not exists email_avaliacao_erro text,
  add column if not exists email_recompra_enviado_em timestamptz,
  add column if not exists email_recompra_resend_id text,
  add column if not exists email_recompra_erro text;

update public.pedidos
set concluido_em = coalesce(atualizado_em, created_at, now()),
    email_avaliacao_enviado_em = coalesce(email_avaliacao_enviado_em, now()),
    email_recompra_enviado_em = coalesce(email_recompra_enviado_em, now())
where status = 'Concluído' and concluido_em is null;

create index if not exists pedidos_avaliacao_pendente_idx
  on public.pedidos (concluido_em)
  where status = 'Concluído' and cliente_email is not null and email_avaliacao_enviado_em is null;

create index if not exists pedidos_recompra_pendente_idx
  on public.pedidos (concluido_em)
  where status = 'Concluído' and cliente_email is not null and email_recompra_enviado_em is null;

insert into public.automacao_segredos (nome)
values ('ciclo_cliente_cron')
on conflict (nome) do nothing;

do $$
declare
  job record;
begin
  for job in select jobid from cron.job where jobname = 'tio-nan-ciclo-cliente'
  loop
    perform cron.unschedule(job.jobid);
  end loop;
end $$;

select cron.schedule(
  'tio-nan-ciclo-cliente',
  '17 * * * *',
  $cron$
    select net.http_post(
      url := 'https://eegqobqhrfdkmjyjnqvp.supabase.co/functions/v1/ciclo-cliente',
      headers := jsonb_build_object('Content-Type', 'application/json'),
      body := jsonb_build_object(
        'action', 'processar',
        'cron_token', (select valor::text from public.automacao_segredos where nome = 'ciclo_cliente_cron')
      )
    );
  $cron$
);

alter table public.produtos
  add column if not exists lancado boolean not null default false;

update public.produtos
set lancado = true
where coalesce(estoque, 0) > 0;

create or replace function public.marcar_produto_como_lancado()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if coalesce(new.estoque, 0) > 0 then
    new.lancado := true;
  end if;
  return new;
end;
$$;

drop trigger if exists produtos_marcar_lancado on public.produtos;
create trigger produtos_marcar_lancado
before insert or update of estoque on public.produtos
for each row execute function public.marcar_produto_como_lancado();

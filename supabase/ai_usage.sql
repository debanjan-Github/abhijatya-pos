-- Run once in Supabase Dashboard → SQL Editor, after schema.sql.
-- This is a shared monthly budget for the price-tag reader.

create table if not exists public.ai_tag_usage_monthly (
  month_start date primary key,
  token_budget integer not null default 10000 check (token_budget >= 0),
  tokens_used integer not null default 0 check (tokens_used >= 0),
  updated_at timestamptz not null default now()
);

alter table public.ai_tag_usage_monthly enable row level security;

-- Called only by the server-side Edge Function. The upsert is atomic, so staff
-- scanning tags at the same time cannot overwrite one another's usage.
create or replace function public.record_ai_tag_usage(p_tokens_used integer)
returns table (tokens_used integer, token_budget integer, tokens_remaining integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_month date := date_trunc('month', timezone('Asia/Kolkata', now()))::date;
begin
  if p_tokens_used < 0 then
    raise exception 'Token usage cannot be negative';
  end if;

  insert into public.ai_tag_usage_monthly (month_start, tokens_used)
  values (current_month, p_tokens_used)
  on conflict (month_start) do update
    set tokens_used = public.ai_tag_usage_monthly.tokens_used + excluded.tokens_used,
        updated_at = now();

  return query
    select usage.tokens_used,
           usage.token_budget,
           greatest(usage.token_budget - usage.tokens_used, 0)
    from public.ai_tag_usage_monthly usage
    where usage.month_start = current_month;
end;
$$;

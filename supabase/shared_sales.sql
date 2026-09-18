-- Run once in Supabase Dashboard → SQL Editor, after shared_inventory.sql.
-- This makes a completed bill, stock reduction, and inventory movements one transaction.

alter table public.sales add column if not exists payment_method text not null default 'CASH';
alter table public.sales add column if not exists customer_phone text;
alter table public.sales add column if not exists discount_paise bigint not null default 0 check (discount_paise >= 0);
alter table public.sale_items add column if not exists sku_snapshot text not null default '';
alter table public.sale_items add column if not exists discount_paise bigint not null default 0 check (discount_paise >= 0);

-- A customer is identified by their mobile number. Bills retain their own
-- phone snapshot; this profile holds optional details shared across bills.
create table if not exists public.customers (
  phone text primary key check (phone ~ '^[+]91[6-9][0-9]{9}$'),
  name text,
  is_apt boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.customers enable row level security;

-- Bring customers from existing saved bills into the directory.
insert into public.customers (phone)
select distinct customer_phone
from public.sales
where customer_phone is not null
on conflict (phone) do nothing;

create table if not exists public.invoice_counters (
  invoice_date date primary key,
  last_number integer not null default 0 check (last_number >= 0)
);

alter table public.invoice_counters enable row level security;

-- One durable, boutique-wide bill sequence. It does not restart each day.
create table if not exists public.bill_serial_counter (
  counter_name text primary key,
  last_number bigint not null default 0 check (last_number >= 0)
);

insert into public.bill_serial_counter (counter_name, last_number)
values ('ABBILL', 0)
on conflict (counter_name) do nothing;

-- Replace the previous two-argument version so all future clients use the
-- customer-phone-aware function below.
drop function if exists public.complete_sale(jsonb, text);
drop function if exists public.complete_sale(jsonb, text, text);
drop function if exists public.complete_sale(jsonb, text, text, bigint);

create or replace function public.complete_sale(p_items jsonb, p_payment_method text, p_customer_phone text default null, p_discount_paise bigint default 0, p_customer_name text default null)
returns table (sale_id uuid, invoice_number text, grand_total_paise bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  sale_row public.sales;
  line record;
  product_row public.products;
  bill_sequence bigint;
  total bigint := 0;
begin
  if auth.uid() is null then raise exception 'Staff sign-in required'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'At least one sale item is required'; end if;
  if p_payment_method not in ('CASH', 'UPI', 'CARD', 'OTHER') then raise exception 'Invalid payment method'; end if;
  if p_customer_phone is not null and p_customer_phone !~ '^[+]91[6-9][0-9]{9}$' then raise exception 'Customer mobile must be a valid Indian number'; end if;
  if p_discount_paise is null or p_discount_paise < 0 then raise exception 'Invalid bill discount'; end if;

  update public.bill_serial_counter
  set last_number = last_number + 1
  where counter_name = 'ABBILL'
  returning last_number into bill_sequence;

  if not found then raise exception 'Bill number generator is not configured'; end if;

  insert into public.sales (invoice_number, subtotal_paise, grand_total_paise, discount_paise, payment_method, customer_phone)
  values (format('ABBILL%s', lpad(bill_sequence::text, 8, '0')), 0, 0, 0, p_payment_method, p_customer_phone)
  returning * into sale_row;

  if p_customer_phone is not null then
    insert into public.customers (phone, name)
    values (p_customer_phone, nullif(trim(coalesce(p_customer_name, '')), ''))
    on conflict (phone) do update
    set name = coalesce(nullif(trim(coalesce(p_customer_name, '')), ''), customers.name),
        updated_at = now();
  end if;

  for line in select * from jsonb_to_recordset(p_items) as item(product_id uuid, quantity integer, item_discount_paise bigint) loop
    if line.product_id is null or line.quantity is null or line.quantity <= 0 then raise exception 'Invalid sale item'; end if;
    select * into product_row from public.products where id = line.product_id and archived_at is null for update;
    if not found then raise exception 'Product is no longer available'; end if;
    if product_row.stock_quantity < line.quantity then raise exception 'Insufficient stock for %', product_row.name; end if;

    line.item_discount_paise := least(greatest(coalesce(line.item_discount_paise, 0), 0), product_row.selling_price_paise * line.quantity);
    insert into public.sale_items (sale_id, product_id, product_name_snapshot, sku_snapshot, barcode_snapshot, quantity, unit_price_paise, line_total_paise, discount_paise)
    values (sale_row.id, product_row.id, product_row.name, product_row.sku, product_row.barcode, line.quantity, product_row.selling_price_paise, product_row.selling_price_paise * line.quantity - line.item_discount_paise, line.item_discount_paise);

    update public.products set stock_quantity = stock_quantity - line.quantity, updated_at = now() where id = product_row.id;
    insert into public.inventory_movements (product_id, type, quantity, previous_stock, new_stock, reference_id, notes)
    values (product_row.id, 'SALE', -line.quantity, product_row.stock_quantity, product_row.stock_quantity - line.quantity, sale_row.id, sale_row.invoice_number);
    total := total + product_row.selling_price_paise * line.quantity - line.item_discount_paise;
  end loop;

  if p_discount_paise > total then raise exception 'Bill discount cannot exceed the discounted subtotal'; end if;
  update public.sales set subtotal_paise = total, discount_paise = p_discount_paise, grand_total_paise = total - p_discount_paise where id = sale_row.id;
  return query select sale_row.id, sale_row.invoice_number, total - p_discount_paise;
end;
$$;

revoke all on function public.complete_sale(jsonb, text, text, bigint, text) from public;
grant execute on function public.complete_sale(jsonb, text, text, bigint, text) to authenticated;

-- Lets staff correct an optional WhatsApp number after a bill is completed.
-- It deliberately changes no sale totals, items, stock, or invoice number.
create or replace function public.update_sale_customer_phone(
  p_sale_id uuid,
  p_customer_phone text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Staff sign-in required'; end if;
  if p_customer_phone is not null and p_customer_phone !~ '^[+]91[6-9][0-9]{9}$' then
    raise exception 'Customer mobile must be a valid Indian number';
  end if;

  update public.sales
  set customer_phone = p_customer_phone
  where id = p_sale_id;

  if not found then raise exception 'Saved bill not found'; end if;
  if p_customer_phone is not null then
    insert into public.customers (phone)
    values (p_customer_phone)
    on conflict (phone) do nothing;
  end if;
end;
$$;

revoke all on function public.update_sale_customer_phone(uuid, text) from public;
grant execute on function public.update_sale_customer_phone(uuid, text) to authenticated;

-- Corrects a completed bill without creating a new bill number. The PIN is
-- verified inside the database as well as in the app UI so a direct API call
-- cannot bypass this staff safeguard.
drop function if exists public.update_completed_sale(uuid, jsonb, text, text, bigint, text);
create or replace function public.update_completed_sale(
  p_sale_id uuid,
  p_items jsonb,
  p_payment_method text,
  p_customer_phone text default null,
  p_discount_paise bigint default 0,
  p_pin text default null,
  p_customer_name text default null
)
returns table (grand_total_paise bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  sale_row public.sales;
  old_line record;
  line record;
  product_row public.products;
  old_prices jsonb := '{}'::jsonb;
  line_price bigint;
  line_discount bigint;
  total bigint := 0;
begin
  if auth.uid() is null then raise exception 'Staff sign-in required'; end if;
  if p_pin is distinct from '1234' then raise exception 'Incorrect bill-edit PIN'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'A bill must contain at least one item';
  end if;
  if p_payment_method not in ('CASH', 'UPI', 'CARD', 'OTHER') then
    raise exception 'Invalid payment method';
  end if;
  if p_customer_phone is not null and p_customer_phone !~ '^[+]91[6-9][0-9]{9}$' then
    raise exception 'Customer mobile must be a valid Indian number';
  end if;
  if p_discount_paise is null or p_discount_paise < 0 then
    raise exception 'Invalid bill discount';
  end if;
  if exists (
    select product_id
    from jsonb_to_recordset(p_items) as item(product_id uuid, quantity integer, item_discount_paise bigint)
    group by product_id
    having count(*) > 1
  ) then
    raise exception 'Each saree can appear only once on a bill';
  end if;

  select * into sale_row from public.sales where id = p_sale_id for update;
  if not found then raise exception 'Saved bill not found'; end if;

  -- Keep original prices for sarees that remain on the bill. Newly added
  -- sarees use their current saved selling price.
  select coalesce(
    jsonb_object_agg(product_id::text, jsonb_build_object('unit_price_paise', unit_price_paise)),
    '{}'::jsonb
  ) into old_prices
  from public.sale_items
  where sale_id = sale_row.id;

  -- Return the original bill's stock before applying the corrected bill.
  for old_line in
    select * from public.sale_items where sale_id = sale_row.id order by product_id for update
  loop
    select * into product_row from public.products where id = old_line.product_id for update;
    if not found then raise exception 'A billed product no longer exists'; end if;

    update public.products
    set stock_quantity = stock_quantity + old_line.quantity, updated_at = now()
    where id = product_row.id;
    insert into public.inventory_movements (product_id, type, quantity, previous_stock, new_stock, reference_id, notes)
    values (
      product_row.id,
      'RETURN',
      old_line.quantity,
      product_row.stock_quantity,
      product_row.stock_quantity + old_line.quantity,
      sale_row.id,
      format('Bill correction: restoring original %s', sale_row.invoice_number)
    );
  end loop;

  delete from public.sale_items where sale_id = sale_row.id;

  for line in
    select * from jsonb_to_recordset(p_items) as item(product_id uuid, quantity integer, item_discount_paise bigint)
  loop
    if line.product_id is null or line.quantity is null or line.quantity <= 0 then
      raise exception 'Invalid sale item';
    end if;
    select * into product_row from public.products where id = line.product_id for update;
    if not found then raise exception 'Product is no longer available'; end if;
    if product_row.archived_at is not null and not (old_prices ? product_row.id::text) then
      raise exception 'Archived product cannot be added to a bill';
    end if;
    if product_row.stock_quantity < line.quantity then
      raise exception 'Insufficient stock for %', product_row.name;
    end if;

    line_price := coalesce((old_prices -> product_row.id::text ->> 'unit_price_paise')::bigint, product_row.selling_price_paise);
    line_discount := least(greatest(coalesce(line.item_discount_paise, 0), 0), line_price * line.quantity);

    insert into public.sale_items (sale_id, product_id, product_name_snapshot, sku_snapshot, barcode_snapshot, quantity, unit_price_paise, line_total_paise, discount_paise)
    values (
      sale_row.id,
      product_row.id,
      product_row.name,
      product_row.sku,
      product_row.barcode,
      line.quantity,
      line_price,
      line_price * line.quantity - line_discount,
      line_discount
    );

    update public.products
    set stock_quantity = stock_quantity - line.quantity, updated_at = now()
    where id = product_row.id;
    insert into public.inventory_movements (product_id, type, quantity, previous_stock, new_stock, reference_id, notes)
    values (
      product_row.id,
      'SALE',
      -line.quantity,
      product_row.stock_quantity,
      product_row.stock_quantity - line.quantity,
      sale_row.id,
      format('Bill correction: updated %s', sale_row.invoice_number)
    );
    total := total + line_price * line.quantity - line_discount;
  end loop;

  if p_discount_paise > total then
    raise exception 'Bill discount cannot exceed the discounted subtotal';
  end if;

  update public.sales
  set subtotal_paise = total,
      discount_paise = p_discount_paise,
      grand_total_paise = total - p_discount_paise,
      payment_method = p_payment_method,
      customer_phone = p_customer_phone
  where id = sale_row.id;

  if p_customer_phone is not null then
    insert into public.customers (phone, name)
    values (p_customer_phone, nullif(trim(coalesce(p_customer_name, '')), ''))
    on conflict (phone) do update
    set name = coalesce(nullif(trim(coalesce(p_customer_name, '')), ''), customers.name),
        updated_at = now();
  end if;

  return query select total - p_discount_paise;
end;
$$;

revoke all on function public.update_completed_sale(uuid, jsonb, text, text, bigint, text, text) from public;
grant execute on function public.update_completed_sale(uuid, jsonb, text, text, bigint, text, text) to authenticated;

create or replace function public.list_customer_profiles()
returns table (phone text, name text, is_apt boolean)
language sql
security definer
set search_path = public
as $$
  select c.phone, c.name, c.is_apt
  from public.customers c
  where auth.uid() is not null
  order by c.updated_at desc;
$$;

create or replace function public.update_customer_profile(
  p_phone text,
  p_name text default null,
  p_is_apt boolean default false
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Staff sign-in required'; end if;
  if p_phone !~ '^[+]91[6-9][0-9]{9}$' then
    raise exception 'Customer mobile must be a valid Indian number';
  end if;
  insert into public.customers (phone, name, is_apt)
  values (p_phone, nullif(trim(coalesce(p_name, '')), ''), p_is_apt)
  on conflict (phone) do update
  set name = nullif(trim(coalesce(p_name, '')), ''),
      is_apt = p_is_apt,
      updated_at = now();
end;
$$;

revoke all on function public.list_customer_profiles() from public;
revoke all on function public.update_customer_profile(text, text, boolean) from public;
grant execute on function public.list_customer_profiles() to authenticated;
grant execute on function public.update_customer_profile(text, text, boolean) to authenticated;

-- Testing helper: restores every active, unique saree to one item in stock.
-- Each changed row receives an inventory movement so the audit trail remains accurate.
create or replace function public.restore_all_product_stock()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  product_row public.products;
  restored_count integer := 0;
begin
  if auth.uid() is null then raise exception 'Staff sign-in required'; end if;

  for product_row in
    select * from public.products where archived_at is null order by id for update
  loop
    if product_row.stock_quantity <> 1 then
      update public.products
      set stock_quantity = 1, updated_at = now()
      where id = product_row.id;
      insert into public.inventory_movements (product_id, type, quantity, previous_stock, new_stock, notes)
      values (product_row.id, 'ADJUSTMENT', 1 - product_row.stock_quantity, product_row.stock_quantity, 1, 'Test inventory restore: set stock to 1');
      restored_count := restored_count + 1;
    end if;
  end loop;
  return restored_count;
end;
$$;

revoke all on function public.restore_all_product_stock() from public;
grant execute on function public.restore_all_product_stock() to authenticated;

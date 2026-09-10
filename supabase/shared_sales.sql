-- Run once in Supabase Dashboard → SQL Editor, after shared_inventory.sql.
-- This makes a completed bill, stock reduction, and inventory movements one transaction.

alter table public.sales add column if not exists payment_method text not null default 'CASH';
alter table public.sales add column if not exists customer_phone text;
alter table public.sale_items add column if not exists sku_snapshot text not null default '';

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

create or replace function public.complete_sale(p_items jsonb, p_payment_method text, p_customer_phone text default null)
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

  update public.bill_serial_counter
  set last_number = last_number + 1
  where counter_name = 'ABBILL'
  returning last_number into bill_sequence;

  if not found then raise exception 'Bill number generator is not configured'; end if;

  insert into public.sales (invoice_number, subtotal_paise, grand_total_paise, payment_method, customer_phone)
  values (format('ABBILL%s', lpad(bill_sequence::text, 8, '0')), 0, 0, p_payment_method, p_customer_phone)
  returning * into sale_row;

  for line in select * from jsonb_to_recordset(p_items) as item(product_id uuid, quantity integer) loop
    if line.product_id is null or line.quantity is null or line.quantity <= 0 then raise exception 'Invalid sale item'; end if;
    select * into product_row from public.products where id = line.product_id and archived_at is null for update;
    if not found then raise exception 'Product is no longer available'; end if;
    if product_row.stock_quantity < line.quantity then raise exception 'Insufficient stock for %', product_row.name; end if;

    insert into public.sale_items (sale_id, product_id, product_name_snapshot, sku_snapshot, barcode_snapshot, quantity, unit_price_paise, line_total_paise)
    values (sale_row.id, product_row.id, product_row.name, product_row.sku, product_row.barcode, line.quantity, product_row.selling_price_paise, product_row.selling_price_paise * line.quantity);

    update public.products set stock_quantity = stock_quantity - line.quantity, updated_at = now() where id = product_row.id;
    insert into public.inventory_movements (product_id, type, quantity, previous_stock, new_stock, reference_id, notes)
    values (product_row.id, 'SALE', -line.quantity, product_row.stock_quantity, product_row.stock_quantity - line.quantity, sale_row.id, sale_row.invoice_number);
    total := total + product_row.selling_price_paise * line.quantity;
  end loop;

  update public.sales set subtotal_paise = total, grand_total_paise = total where id = sale_row.id;
  return query select sale_row.id, sale_row.invoice_number, total;
end;
$$;

revoke all on function public.complete_sale(jsonb, text, text) from public;
grant execute on function public.complete_sale(jsonb, text, text) to authenticated;

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
end;
$$;

revoke all on function public.update_sale_customer_phone(uuid, text) from public;
grant execute on function public.update_sale_customer_phone(uuid, text) to authenticated;

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

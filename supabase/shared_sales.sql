-- Run once in Supabase Dashboard → SQL Editor, after shared_inventory.sql.
-- This makes a completed bill, stock reduction, and inventory movements one transaction.

alter table public.sales add column if not exists payment_method text not null default 'CASH';
alter table public.sale_items add column if not exists sku_snapshot text not null default '';

create table if not exists public.invoice_counters (
  invoice_date date primary key,
  last_number integer not null default 0 check (last_number >= 0)
);

alter table public.invoice_counters enable row level security;

create or replace function public.complete_sale(p_items jsonb, p_payment_method text)
returns table (sale_id uuid, invoice_number text, grand_total_paise bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  sale_row public.sales;
  line record;
  product_row public.products;
  invoice_day date := timezone('Asia/Kolkata', now())::date;
  invoice_sequence integer;
  total bigint := 0;
begin
  if auth.uid() is null then raise exception 'Staff sign-in required'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'At least one sale item is required'; end if;
  if p_payment_method not in ('CASH', 'UPI', 'CARD', 'OTHER') then raise exception 'Invalid payment method'; end if;

  insert into public.invoice_counters (invoice_date, last_number) values (invoice_day, 1)
  on conflict (invoice_date) do update set last_number = public.invoice_counters.last_number + 1
  returning last_number into invoice_sequence;

  insert into public.sales (invoice_number, subtotal_paise, grand_total_paise, payment_method)
  values (format('ABH-%s-%s', to_char(invoice_day, 'YYYYMMDD'), lpad(invoice_sequence::text, 4, '0')), 0, 0, p_payment_method)
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

revoke all on function public.complete_sale(jsonb, text) from public;
grant execute on function public.complete_sale(jsonb, text) to authenticated;

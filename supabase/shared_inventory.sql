-- Run once in Supabase Dashboard → SQL Editor, after schema.sql and staff_access.sql.
-- Product creation and stock adjustments are atomic, so all staff see consistent stock.

create or replace function public.create_product_with_opening_stock(
  p_name text,
  p_sku text,
  p_barcode text,
  p_zoner text,
  p_material text,
  p_selling_price_paise bigint,
  p_stock_quantity integer,
  p_image_path text,
  p_price_tag_image_path text
)
returns public.products
language plpgsql
security definer
set search_path = public
as $$
declare
  product_row public.products;
begin
  if auth.uid() is null then raise exception 'Staff sign-in required'; end if;

  insert into public.products (name, sku, barcode, zoner, material, selling_price_paise, stock_quantity, image_path, price_tag_image_path)
  values (trim(p_name), trim(p_sku), trim(p_barcode), nullif(trim(p_zoner), ''), nullif(trim(p_material), ''), p_selling_price_paise, p_stock_quantity, p_image_path, p_price_tag_image_path)
  returning * into product_row;

  if product_row.stock_quantity > 0 then
    insert into public.inventory_movements (product_id, type, quantity, previous_stock, new_stock, notes)
    values (product_row.id, 'OPENING_STOCK', product_row.stock_quantity, 0, product_row.stock_quantity, 'Initial product stock');
  end if;

  return product_row;
end;
$$;

create or replace function public.adjust_product_stock(
  p_product_id uuid,
  p_new_stock integer,
  p_type text,
  p_notes text default null
)
returns public.products
language plpgsql
security definer
set search_path = public
as $$
declare
  previous_product public.products;
  updated_product public.products;
begin
  if auth.uid() is null then raise exception 'Staff sign-in required'; end if;
  if p_new_stock < 0 then raise exception 'Stock cannot be negative'; end if;
  if p_type not in ('PURCHASE', 'RETURN', 'ADJUSTMENT', 'DAMAGE', 'OPENING_STOCK') then raise exception 'Invalid inventory movement type'; end if;

  select * into previous_product from public.products where id = p_product_id for update;
  if not found then raise exception 'Product not found'; end if;

  update public.products set stock_quantity = p_new_stock, updated_at = now() where id = p_product_id returning * into updated_product;
  insert into public.inventory_movements (product_id, type, quantity, previous_stock, new_stock, notes)
  values (p_product_id, p_type, p_new_stock - previous_product.stock_quantity, previous_product.stock_quantity, p_new_stock, p_notes);
  return updated_product;
end;
$$;

revoke all on function public.create_product_with_opening_stock(text, text, text, text, text, bigint, integer, text, text) from public;
revoke all on function public.adjust_product_stock(uuid, integer, text, text) from public;
grant execute on function public.create_product_with_opening_stock(text, text, text, text, text, bigint, integer, text, text) to authenticated;
grant execute on function public.adjust_product_stock(uuid, integer, text, text) to authenticated;

-- Allows staff to permanently discard a test product only after it has been
-- archived and only when it was never included on a completed bill.
-- Bill history is deliberately never deleted or altered.
create or replace function public.permanently_delete_archived_product(p_product_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  product_row public.products;
begin
  if auth.uid() is null then raise exception 'Staff sign-in required'; end if;

  select * into product_row from public.products where id = p_product_id for update;
  if not found then raise exception 'Product not found'; end if;
  if product_row.archived_at is null then raise exception 'Archive the product before permanently deleting it'; end if;
  if exists (select 1 from public.sale_items where product_id = p_product_id) then
    raise exception 'This product is on a completed bill and cannot be permanently deleted. Keep it archived.';
  end if;

  delete from public.inventory_movements where product_id = p_product_id;
  delete from public.products where id = p_product_id;
end;
$$;

revoke all on function public.permanently_delete_archived_product(uuid) from public;
grant execute on function public.permanently_delete_archived_product(uuid) to authenticated;

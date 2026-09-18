-- DESTRUCTIVE TEST RESET — run manually in Supabase Dashboard → SQL Editor.
-- This permanently removes every completed bill and its line items.
-- Products, product photos, staff accounts, and the product catalogue are kept.
-- Active sarees are reset to stock 1 because each is unique for testing.

begin;

-- Remove only inventory movements created by completed sales before deleting
-- their parent sale rows. Other product/inventory history is kept.
delete from public.inventory_movements
where type = 'SALE'
   or reference_id in (select id from public.sales);

delete from public.sale_items;
delete from public.sales;

-- A fresh test run begins with the first Abhijatya bill number again.
update public.bill_serial_counter
set last_number = 0
where counter_name = 'ABBILL';

-- invoice_counters belongs to the former daily sequence and is kept only for
-- compatibility. Clear it as part of the bill-data reset.
delete from public.invoice_counters;

-- Unique sarees: restore each non-archived product for a fresh billing test.
update public.products
set stock_quantity = 1,
    updated_at = now()
where archived_at is null;

commit;

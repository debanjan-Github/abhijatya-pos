-- Run after schema.sql in Supabase Dashboard → SQL Editor.
-- All signed-in boutique staff have shared access until roles are introduced.

create policy "Authenticated staff can read products"
on public.products for select to authenticated using (true);
create policy "Authenticated staff can add products"
on public.products for insert to authenticated with check (true);
create policy "Authenticated staff can edit products"
on public.products for update to authenticated using (true) with check (true);

create policy "Authenticated staff can read inventory movements"
on public.inventory_movements for select to authenticated using (true);
create policy "Authenticated staff can add inventory movements"
on public.inventory_movements for insert to authenticated with check (true);

create policy "Authenticated staff can read sales"
on public.sales for select to authenticated using (true);
create policy "Authenticated staff can add sales"
on public.sales for insert to authenticated with check (true);
create policy "Authenticated staff can read sale items"
on public.sale_items for select to authenticated using (true);
create policy "Authenticated staff can add sale items"
on public.sale_items for insert to authenticated with check (true);

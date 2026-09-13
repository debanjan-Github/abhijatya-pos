-- Run this once in Supabase Dashboard → SQL Editor → New query.
-- This schema is deliberately simple and ready for staff authentication later.

create extension if not exists pgcrypto;

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  sku text not null unique,
  barcode text not null unique,
  zoner text,
  material text,
  selling_price_paise bigint not null check (selling_price_paise >= 0),
  stock_quantity integer not null default 0 check (stock_quantity >= 0),
  image_path text,
  price_tag_image_path text,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id),
  type text not null check (type in ('PURCHASE', 'SALE', 'RETURN', 'ADJUSTMENT', 'DAMAGE', 'OPENING_STOCK')),
  quantity integer not null,
  previous_stock integer not null check (previous_stock >= 0),
  new_stock integer not null check (new_stock >= 0),
  reference_id uuid,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.sales (
  id uuid primary key default gen_random_uuid(),
  invoice_number text not null unique,
  subtotal_paise bigint not null check (subtotal_paise >= 0),
  grand_total_paise bigint not null check (grand_total_paise >= 0),
  discount_paise bigint not null default 0 check (discount_paise >= 0),
  customer_phone text,
  created_at timestamptz not null default now()
);

create table if not exists public.sale_items (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales(id),
  product_id uuid not null references public.products(id),
  product_name_snapshot text not null,
  barcode_snapshot text not null,
  quantity integer not null check (quantity > 0),
  unit_price_paise bigint not null check (unit_price_paise >= 0),
  line_total_paise bigint not null check (line_total_paise >= 0),
  discount_paise bigint not null default 0 check (discount_paise >= 0)
);

create table if not exists public.bill_serial_counter (
  counter_name text primary key,
  last_number bigint not null default 0 check (last_number >= 0)
);

alter table public.products enable row level security;
alter table public.inventory_movements enable row level security;
alter table public.sales enable row level security;
alter table public.sale_items enable row level security;

-- No public access is granted. The application will add staff sign-in before using this live database.
-- This protects the boutique's data from anyone who merely discovers its web address.

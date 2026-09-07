# Abhijatya POS architecture

## Chosen stack

- **React + TypeScript + Vite**: a fast, mobile-first web application that runs well on an iPhone in Safari and can be installed as a PWA later.
- **Supabase (PostgreSQL + Auth)**: the intended production backend. It provides relational data, row-level security, transactions through database functions, and a future web dashboard without a backend rewrite.
- **Local repository for Milestone 1**: browser `localStorage` makes the first product workflow usable before Supabase credentials exist. Its interface is deliberately isolated so a Supabase repository can replace it without changing screens.

**ASSUMPTION:** “React JS” means a React web application, rather than React Native. The data/domain layer remains framework-independent so a future Expo iPhone app can reuse the backend and business rules.

## App architecture

`src/domain` holds business types and pure rules, `src/services` holds repositories and future hardware adapters, and `src/features` contains UI workflows. Screens should never directly depend on a database vendor.

Money is stored as integer paise, never floating-point rupees. Products are archived instead of deleted. Barcode and SKU uniqueness is enforced in the repository now and will be database constraints in Supabase.

## Barcode scanning

Milestone 2 will use the iPhone camera through a supported browser scanning library, with Code 128, EAN-13, UPC-A and QR detection. Barcode lookup is exact. Existing internal codes such as `ABH000001` are accepted; they are inventory identifiers, **not GS1/GTIN claims**.

## Printer integration

`PrinterService` is defined behind an adapter boundary (`connect`, `disconnect`, `getStatus`, `printLabel`, `printReceipt`, `testPrint`). No printer connection is faked.

**NEEDS VERIFICATION:** PSF-58D’s iOS Bluetooth protocol/SDK, whether it uses BLE or Apple External Accessory/MFi, and whether label mode accepts ESC/POS. Before direct integration, obtain the manufacturer iOS SDK/protocol documentation, pairing requirements, and label command format. Until then, label/receipt PDF or image export is the reliable fallback.

## Offline approach

Milestone 1 stores products and movements locally. Milestone 8 will add a local cache plus an outbox for queued sales. Until then, local data is device/browser-specific and is not a substitute for cloud backup.

## Major production tables

- `businesses`, `users`, `settings`, `categories`
- `products` (UUID, unique `sku`, unique `barcode`, prices in paise, stock, archive timestamp)
- `customers`
- `sales`, `sale_items` (immutable product/price snapshots), `payments`
- `inventory_movements` (every stock change with old/new quantities and reference)

Sales will be completed by one PostgreSQL transaction/function: sale, items, stock reduction and movements commit together or all roll back. PostgreSQL constraints prevent duplicate barcodes/SKUs and negative stock unless explicitly enabled.

## Milestone 1 scope

Navigation, dashboard shell, products list/search, add/edit/archive product, inventory adjustment, validation, and movement history. Billing, camera scanning, cloud sync, GST calculation, invoices and printer support are intentionally deferred.

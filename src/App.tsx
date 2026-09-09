import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import type { Product, ProductInput } from './domain/types'
import { formatInr, parseRupees } from './domain/productRules'
import { sharedProductRepository } from './services/sharedProductRepository'
import { importLocalProducts } from './services/importLocalProducts'
import { completeSharedSale, type PaymentMethod } from './services/sharedSalesRepository'
import { readPriceTag } from './services/priceTagReader'
import { readPriceTagWithVision } from './services/visionTagReader'
import { supabase } from './services/supabaseClient'
import { SearchableMultiSelect } from './components/SearchableMultiSelect'
import { ImagePreviewModal } from './components/ImagePreviewModal'
import { LiveBarcodeScannerModal } from './components/LiveBarcodeScannerModal'

type Page = 'Dashboard' | 'Products' | 'Inventory' | 'Sales' | 'Customers' | 'Reports' | 'Settings'
const pages: Page[] = ['Dashboard', 'Products', 'Inventory', 'Sales', 'Customers', 'Reports', 'Settings']
const blank = (): ProductInput => ({ name: '', sku: '', barcode: '', zoner: '', material: '', sellingPricePaise: 0, stockQuantity: 1 })
const ZONERS = [
  'Wedding', 'Bridal', 'Party', 'Festive', 'Puja', 'Haldi', 'Mehendi', 'Sangeet', 'Reception', 'Engagement', 'Office',
  'School & Teachers', 'College', 'Daily Wear', 'Casual', 'Traditional', 'Temple', 'Family Function', 'Housewarming',
  'Anniversary', 'Birthday', 'Farewell', 'Corporate Event', 'Gift', 'Premium Gift', "Mother's Day", 'Durga Puja',
  'Diwali', 'Onam', 'Poila Boishakh', 'Summer', 'Winter', 'Travel', 'Elegant Evening', 'Special Occasion',
] as const
const MATERIALS = [
  'Art Silk', 'Assam Silk', 'Bangalore Silk', 'Banarasi Silk', 'Bishnupuri Silk', 'Bhagalpuri Silk', 'Chanderi',
  'Chanderi Cotton', 'Chanderi Silk', 'Chiffon', 'Chiniya Silk', 'Cotton', 'Cotton Linen', 'Cotton Silk', 'Crepe',
  'Crepe Silk', 'Dupion Silk', 'Eri Silk', 'Gajji Silk', 'Garad Silk', 'Georgette', 'Ghicha Silk', 'Habutai Silk',
  'Handloom Cotton', 'Jute', 'Jute Silk', 'Kanjivaram Silk', 'Katan Silk', 'Khadi', 'Khadi Cotton', 'Khadi Silk',
  'Khaddi Cotton', 'Khaddi Georgette', 'Khaddi Silk', 'Kora', 'Kora Cotton', 'Kora Organza', 'Kora Silk',
  'Kota Cotton', 'Kota Doria', 'Kota Silk', 'Linen', 'Linen Cotton', 'Linen Silk', 'Maheshwari',
  'Maheshwari Cotton', 'Maheshwari Silk Cotton', 'Mango Silk', 'Matka Silk', 'Mercerised Cotton', 'Modal',
  'Modal Silk', 'Muga Silk', 'Mul Cotton', 'Mulberry Silk', 'Murshidabad Silk', 'Mysore Silk', 'Narayanpet Cotton',
  'Narayanpet Silk', 'Organza', 'Organza Silk', 'Paithani Silk', 'Poly Silk', 'Pure Silk', 'Raw Silk', 'Resham',
  'Satin', 'Satin Silk', 'Semi Silk', 'Silk', 'Silk Cotton', 'Soft Silk', 'Tant Cotton', 'Tissue', 'Tissue Silk',
  'Tussar', 'Tussar Ghicha', 'Tussar Silk', 'Uppada Silk', 'Viscose', 'Viscose Silk',
] as const

export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(() => Boolean(supabase))
  useEffect(() => {
    if (!supabase) return
    void supabase.auth.getSession().then(({ data }) => { setSession(data.session); setLoading(false) })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => { setSession(nextSession); setLoading(false) })
    return () => subscription.unsubscribe()
  }, [])
  if (loading) return <main className="app-shell"><section className="card"><h2>Opening Abhijatya…</h2></section></main>
  if (!supabase) return <main className="app-shell"><section className="card error"><h2>Supabase is not configured</h2><p>Add the Project URL and publishable key to `.env.local`.</p></section></main>
  if (!session) return <StaffSignIn />
  return <PosApp email={session.user.email ?? 'Staff member'} onSignOut={() => { void supabase?.auth.signOut() }} />
}

function PosApp({ email, onSignOut }: { email: string; onSignOut: () => void }) {
  const [page, setPage] = useState<Page>('Dashboard')
  const [products, setProducts] = useState<Product[]>([])
  const [syncError, setSyncError] = useState('')
  const [editing, setEditing] = useState<Product | undefined>()
  const refreshInProgress = useRef(false)
  const refresh = useCallback(async () => {
    if (refreshInProgress.current) return
    refreshInProgress.current = true
    try {
      setProducts(await sharedProductRepository.list(true))
      setSyncError('')
    } catch (reason) {
      setSyncError(reason instanceof Error ? `Could not refresh shared data: ${reason.message}` : 'Could not refresh shared data.')
    } finally { refreshInProgress.current = false }
  }, [])
  useEffect(() => {
    const initialRefresh = window.setTimeout(() => { void refresh() }, 0)
    const interval = window.setInterval(() => { void refresh() }, 5000)
    return () => { window.clearTimeout(initialRefresh); window.clearInterval(interval) }
  }, [refresh])
  const activeProducts = useMemo(() => products.filter((product) => !product.archivedAt), [products])
  return <main className="app-shell">
    <header><div><p className="eyebrow">BOUTIQUE POS</p><h1>ABHIJATYA</h1></div><div className="staff-actions"><small>{email}</small><button className="secondary" onClick={onSignOut}>Sign out</button><button className="scan" onClick={() => { setPage('Sales'); setEditing(undefined) }}>New bill</button></div></header>
    <nav>{pages.map((item) => <button key={item} className={page === item ? 'active' : ''} onClick={() => { setPage(item); setEditing(undefined) }}>{item}</button>)}</nav>
    {syncError && <p className="error">{syncError}</p>}
    {page === 'Dashboard' && <Dashboard products={activeProducts} onProducts={() => setPage('Products')} />}
    {page === 'Products' && <Products products={products} editing={editing} onEdit={setEditing} onSave={refresh} onCancel={() => setEditing(undefined)} />}
    {page === 'Inventory' && <Inventory products={activeProducts} onChanged={refresh} />}
    {page === 'Sales' && <Billing products={activeProducts} onCompleted={refresh} />}
    {['Customers', 'Reports', 'Settings'].includes(page) && <section className="card"><h2>{page}</h2><p>This section is planned for a later milestone. Product data is ready for it.</p></section>}
  </main>
}

function StaffSignIn() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); if (!supabase) return
    setSubmitting(true); setMessage('')
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    setSubmitting(false); setMessage(error ? 'Could not sign in. Check your email and password.' : '')
  }
  return <main className="app-shell auth-shell"><section className="card"><p className="eyebrow">STAFF ACCESS</p><h1>ABHIJATYA</h1><h2>Sign in to the boutique POS</h2><p>Use the staff email and password provided by the business owner.</p><form onSubmit={submit}><label>Email<input type="email" required autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label><label>Password<input type="password" required autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>{message && <p className="error">{message}</p>}<button disabled={submitting}>{submitting ? 'Signing in…' : 'Sign in'}</button></form></section></main>
}

function Dashboard({ products, onProducts }: { products: Product[]; onProducts: () => void }) {
  return <><section className="hero"><div><p className="eyebrow">PRODUCT CATALOGUE</p><h2>Add sarees from your existing price tags.</h2><p>Upload a tag photo and we will read its barcode, price, and visible name for you to check.</p><button onClick={onProducts}>Add a product</button></div></section><section className="metrics"><Metric label="Today’s sales" value="₹0" /><Metric label="Bills today" value="0" /><Metric label="Products" value={String(products.length)} /><Metric label="Items in stock" value={String(products.reduce((total, p) => total + p.stockQuantity, 0))} /></section></>
}
function Metric({ label, value }: { label: string; value: string }) { return <article className="metric"><span>{label}</span><strong>{value}</strong></article> }

function Products({ products, editing, onEdit, onSave, onCancel }: { products: Product[]; editing?: Product; onEdit: (p: Product | undefined) => void; onSave: () => Promise<void>; onCancel: () => void }) {
  const [query, setQuery] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const [error, setError] = useState('')
  const [importing, setImporting] = useState(false)
  const archivedProducts = products.filter((product) => Boolean(product.archivedAt))
  const activeProducts = products.filter((product) => !product.archivedAt)
  const filtered = useMemo(() => activeProducts.filter((p) => [p.name, p.sku, p.barcode, p.zoner, p.material].some((value) => value?.toLowerCase().includes(query.toLowerCase()))), [activeProducts, query])
  const restore = async (id: string) => {
    try { await sharedProductRepository.restore(id); await onSave() } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not restore product.') }
  }
  const importLocal = async () => {
    if (!confirm('Import products saved only in this browser into the shared Supabase catalogue? Existing cloud products with the same barcode or SKU will be skipped.')) return
    setImporting(true); setError('')
    try {
      const imported = await importLocalProducts()
      await onSave()
      setError(imported ? `${imported} local product(s) imported into the shared catalogue.` : 'No local products needed importing.')
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not import local products.') } finally { setImporting(false) }
  }
  const openProduct = async (product: Product) => {
    if (!product.id) { onEdit(product); return }
    setError('')
    try { onEdit(await sharedProductRepository.get(product.id)) } catch (reason) { setError(reason instanceof Error ? `Could not open product: ${reason.message}` : 'Could not open product.') }
  }
  if (editing !== undefined) return <ProductForm product={editing} onSaved={async () => { await onSave(); onCancel() }} onCancel={onCancel} />
  return <section className="card product-list"><div className="toolbar"><div><h2>Products</h2><p>{activeProducts.length} active products · shared refresh every 5 seconds</p></div><div className="product-actions"><button className="secondary" onClick={() => void importLocal()} disabled={importing}>{importing ? 'Importing…' : 'Import local products'}</button><button onClick={() => onEdit({ ...blank(), id: '', createdAt: '', updatedAt: '' })}>+ Add product</button></div></div>{error && <p className={error.includes('imported') || error.startsWith('No local') ? 'notice' : 'error'}>{error}</p>}<input aria-label="Search products" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name, zoner, material or barcode" />{filtered.length === 0 ? <p className="empty">No products yet. Upload your first price tag to begin.</p> : <div className="table">{filtered.map((p) => <button className="product-row" key={p.id} onClick={() => void openProduct(p)}><span><strong>{p.name}</strong><small>{p.zoner || 'No zoner'} · {p.material || 'No material'} · {p.barcode}</small></span><span>{formatInr(p.sellingPricePaise)}<small>Stock: {p.stockQuantity}</small></span></button>)}</div>}<button className="secondary archived-toggle" onClick={() => setShowArchived((show) => !show)}>{showArchived ? 'Hide archived products' : `Archived products (${archivedProducts.length})`}</button>{showArchived && <div className="archived-list">{archivedProducts.length === 0 ? <p className="empty">No archived products.</p> : archivedProducts.map((product) => <div className="product-row" key={product.id}><span><strong>{product.name}</strong><small>{product.barcode}</small></span><button onClick={() => void restore(product.id)}>Restore product</button></div>)}</div>}</section>
}

function ProductForm({ product, onSaved, onCancel }: { product: Product; onSaved: () => Promise<void>; onCancel: () => void }) {
  const isNew = !product.id
  const [form, setForm] = useState<ProductInput>(isNew ? blank() : product)
  const [error, setError] = useState('')
  const [reading, setReading] = useState(false)
  const [notice, setNotice] = useState('')
  const [previewImage, setPreviewImage] = useState<string>()
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const photoInputRef = useRef<HTMLInputElement>(null)
  const change = <K extends keyof ProductInput>(key: K, value: ProductInput[K]) => setForm((current) => ({ ...current, [key]: value }))
  const upload = async (file?: File) => {
    if (!file) return
    if (!file.type.startsWith('image/')) { setError('Please upload an image file.'); return }
    setError(''); setNotice('Reading the price tag…'); setReading(true)
    const imageDataUrl = await asDataUrl(file).catch((reason: unknown) => { setError(reason instanceof Error ? reason.message : 'Photo could not be loaded.'); return undefined })
    if (!imageDataUrl) { setReading(false); return }
    setForm((current) => ({ ...current, priceTagImageDataUrl: imageDataUrl }))
    try {
      const result = await readPriceTagWithVision(imageDataUrl)
      setForm((current) => { const barcode = result.barcode ?? current.barcode; return { ...current, barcode, sku: barcode || current.sku, name: result.name ?? current.name, sellingPricePaise: result.pricePaise ?? current.sellingPricePaise } })
      const usageWarning = result.aiUsage && result.aiUsage.tokensRemaining <= 100
        ? ` Warning: only ${result.aiUsage.tokensRemaining} AI tokens remain in this month's shared budget.`
        : ''
      setNotice(result.barcode || result.pricePaise || result.name ? `Details filled from the tag. Please check them before saving.${usageWarning}` : 'No clear details found. Please enter them manually.')
    } catch (reason) {
      try {
        const fallback = await readPriceTag(file)
        setForm((current) => {
          const barcode = fallback.barcode ?? current.barcode
          return {
            ...current,
            barcode,
            sku: barcode || current.sku,
            name: fallback.name ?? current.name,
            sellingPricePaise: fallback.pricePaise ?? current.sellingPricePaise,
          }
        })
        setNotice(
          fallback.barcode || fallback.pricePaise || fallback.name
            ? 'OCR fallback was used because online AI was unavailable. It filled what it could; please carefully check every value before saving.'
            : 'OCR fallback was used because online AI was unavailable, but it could not read the tag. Please enter the details manually.',
        )
      } catch {
        setNotice(`AI tag reader could not complete: ${reason instanceof Error ? reason.message : 'unknown error'}`)
      }
    } finally { setReading(false) }
  }
  const uploadSareePhoto = async (file?: File) => {
    if (!file) return
    if (!file.type.startsWith('image/')) { setError('Please upload an image file.'); return }
    try { change('imageDataUrl', await asDataUrl(file)); setError('') } catch (reason) { setError(reason instanceof Error ? reason.message : 'Photo could not be loaded.') }
  }
  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    try {
      setError('')
      if (isNew) await sharedProductRepository.create(form)
      else await sharedProductRepository.update(product.id, form)
      await onSaved()
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not save product.') }
  }
  const archive = async () => {
    if (!confirm(`Archive ${product.name}? It will be hidden from active products.`)) return
    try { await sharedProductRepository.archive(product.id); await onSaved() } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not archive product.') }
  }
  return <section className="card"><div className="toolbar"><div><h2>{isNew ? 'Add product' : 'Edit product'}</h2><p>Photograph the existing price tag, then confirm the details.</p></div><button className="secondary" type="button" onClick={onCancel}>Cancel</button></div><form onSubmit={(event) => void submit(event)}>{error && <p className="error">{error}</p>}<div className="tag-upload"><strong>Price-tag photo</strong><input ref={cameraInputRef} className="visually-hidden" type="file" accept="image/*" capture="environment" onChange={(event) => void upload(event.target.files?.[0])} /><input ref={photoInputRef} className="visually-hidden" type="file" accept="image/*" onChange={(event) => void upload(event.target.files?.[0])} /><button type="button" onClick={() => cameraInputRef.current?.click()} disabled={reading}>{reading ? 'Reading price tag…' : 'Take price-tag photo'}</button><button className="secondary" type="button" onClick={() => photoInputRef.current?.click()} disabled={reading}>Choose tag photo</button><span>Used to fill barcode, name, and price.</span>{form.priceTagImageDataUrl && <button className="tag-preview-button" type="button" onClick={() => setPreviewImage(form.priceTagImageDataUrl)} aria-label="View price-tag photo full size"><img className="tag-preview" src={form.priceTagImageDataUrl} alt="Uploaded price tag" /></button>}</div>{notice && <p className="notice">{notice}</p>}<SareePhotoField value={form.imageDataUrl} onChange={(file) => void uploadSareePhoto(file)} /><div className="form-grid">{textField('name', 'Name', true, form, change)}{textField('zoner', 'Zoner', false, form, change)}{textField('material', 'Material', false, form, change)}{textField('barcode', 'Barcode', true, form, (key, value) => { change(key, value); change('sku', value) })}<label>Price *<input required inputMode="decimal" value={String(form.sellingPricePaise / 100)} onChange={(event) => change('sellingPricePaise', parseRupees(event.target.value) ?? 0)} /></label></div><button type="submit">{isNew ? 'Save product' : 'Save changes'}</button></form>{!isNew && <button className="danger" onClick={() => void archive()}>Archive product</button>}<ImagePreviewModal imageUrl={previewImage} alt="Price-tag photo" onClose={() => setPreviewImage(undefined)} /></section>
}

function textField<K extends 'name' | 'zoner' | 'material' | 'barcode'>(key: K, label: string, required: boolean, form: ProductInput, change: (key: K, value: string) => void) {
  if (key === 'zoner') {
    const selected = form.zoner?.split(',').map((zoner) => zoner.trim()).filter(Boolean) ?? []
    return <SearchableMultiSelect label={label} options={ZONERS} selected={selected} onChange={(zoners) => change(key, zoners.join(', '))} />
  }
  if (key === 'material') {
    const selected = form.material?.split(',').map((material) => material.trim()).filter(Boolean) ?? []
    return <SearchableMultiSelect label={label} options={MATERIALS} selected={selected} onChange={(materials) => change(key, materials.join(', '))} />
  }
  return <label>{label}{required && ' *'}<input required={required} value={String(form[key] ?? '')} onChange={(event) => change(key, event.target.value)} /></label>
}
function asDataUrl(file: File): Promise<string> { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error('Photo could not be loaded.')); reader.readAsDataURL(file) }) }

function SareePhotoField({ value, onChange }: { value?: string; onChange: (file?: File) => void }) {
  const inputRef = useRef<HTMLInputElement>(null)
  return <div className="tag-upload saree-photo"><strong>Saree photo</strong><input ref={inputRef} className="visually-hidden" type="file" accept="image/*" onChange={(event) => onChange(event.target.files?.[0])} /><button className="secondary" type="button" onClick={() => inputRef.current?.click()}>{value ? 'Replace saree photo' : 'Upload saree photo'}</button><span>This photo is shown with the product in your catalogue.</span>{value && <img className="tag-preview" src={value} alt="Saree product" />}</div>
}

interface CartItem { product: Product; quantity: number }

function Billing({ products, onCompleted }: { products: Product[]; onCompleted: () => Promise<void> }) {
  const [cart, setCart] = useState<CartItem[]>([])
  const [message, setMessage] = useState('')
  const [reading, setReading] = useState(false)
  const [scannerOpen, setScannerOpen] = useState(false)
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('CASH')
  const [completing, setCompleting] = useState(false)
  const [lastCompletedSale, setLastCompletedSale] = useState<{ invoiceNumber: string; cart: CartItem[]; total: number }>()
  const inputRef = useRef<HTMLInputElement>(null)
  const total = cart.reduce((sum, item) => sum + item.product.sellingPricePaise * item.quantity, 0)
  const addProduct = (product: Product) => setCart((items) => {
    const item = items.find((entry) => entry.product.id === product.id)
    if (item && item.quantity >= product.stockQuantity) { setMessage(`Only ${product.stockQuantity} in stock for ${product.name}.`); return items }
    setMessage('')
    return item ? items.map((entry) => entry.product.id === product.id ? { ...entry, quantity: entry.quantity + 1 } : entry) : [...items, { product, quantity: 1 }]
  })
  const addBarcodeToCart = useCallback((barcode: string) => {
    const product = products.find((item) => item.barcode.trim().toUpperCase() === barcode.trim().toUpperCase())
    if (!product) { setMessage(`No saved product matches barcode ${barcode}.`); return }
    if (product.stockQuantity < 1) { setMessage(`${product.name} is out of stock.`); return }
    addProduct(product)
    setMessage(`${product.name} added to the bill.`)
  }, [products])
  const readTag = async (file?: File) => {
    if (!file) return
    setReading(true); setMessage('Reading price tag…')
    try {
      const tag = await readPriceTag(file)
      if (!tag.barcode) setMessage('No barcode was found. Please take a clearer photo of the tag.')
      else addBarcodeToCart(tag.barcode)
    } catch { setMessage('The tag could not be read. Please take a clear, straight photo.') } finally { setReading(false) }
  }
  const changeQuantity = (productId: string, quantity: number) => setCart((items) => quantity < 1 ? items.filter((item) => item.product.id !== productId) : items.map((item) => item.product.id === productId ? { ...item, quantity: Math.min(quantity, item.product.stockQuantity) } : item))
  const completeSale = async () => {
    if (!cart.length || completing) return
    setCompleting(true); setMessage('Completing shared sale…')
    try {
      const sale = await completeSharedSale(cart.map((item) => ({ productId: item.product.id, quantity: item.quantity })), paymentMethod)
      setLastCompletedSale({ invoiceNumber: sale.invoiceNumber, cart, total })
      setCart([])
      setMessage(`Sale ${sale.invoiceNumber} completed. Inventory is updated for all staff.`)
      await onCompleted()
    } catch (reason) { setMessage(reason instanceof Error ? reason.message : 'Sale could not be completed.') } finally { setCompleting(false) }
  }
  return <><section className="billing-layout"><div className="card"><div className="toolbar"><div><p className="eyebrow">FAST BILLING</p><h2>New sale</h2><p>Scan the product barcode to add it instantly. Price-tag photo remains a fallback.</p></div><div className="billing-actions"><button className="scan" onClick={() => setScannerOpen(true)}>Scan barcode</button><button className="secondary" onClick={() => inputRef.current?.click()} disabled={reading}>{reading ? 'Reading tag…' : 'Use tag photo'}</button></div></div><input ref={inputRef} className="visually-hidden" type="file" accept="image/*" capture="environment" onChange={(event) => void readTag(event.target.files?.[0])} />{message && <p className="notice">{message}</p>}<div className="cart-list">{cart.length === 0 ? <p className="empty">Your bill is empty. Scan a barcode to add a saree.</p> : cart.map(({ product, quantity }) => <div className="cart-row" key={product.id}>{product.imageDataUrl && <img className="thumb" src={product.imageDataUrl} alt="" />}<span><strong>{product.name}</strong><small>{product.barcode} · {formatInr(product.sellingPricePaise)}</small></span><div className="quantity"><button onClick={() => changeQuantity(product.id, quantity - 1)} aria-label="Remove one">−</button><strong>{quantity}</strong><button onClick={() => changeQuantity(product.id, quantity + 1)} disabled={quantity >= product.stockQuantity} aria-label="Add one">+</button></div><strong>{formatInr(product.sellingPricePaise * quantity)}</strong></div>)}</div></div><aside className="card bill-summary"><p className="eyebrow">BILL SUMMARY</p><h2>ABHIJATYA</h2><div><span>Items</span><strong>{cart.reduce((sum, item) => sum + item.quantity, 0)}</strong></div><label>Payment method<select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value as PaymentMethod)}><option value="CASH">Cash</option><option value="UPI">UPI</option><option value="CARD">Card</option><option value="OTHER">Other</option></select></label><div className="grand-total"><span>Total amount</span><strong>{formatInr(total)}</strong></div><button disabled={!cart.length || completing} onClick={() => void completeSale()}>{completing ? 'Completing sale…' : 'Complete sale'}</button>{lastCompletedSale && <button className="secondary" onClick={() => printReceipt(lastCompletedSale.cart, lastCompletedSale.total, lastCompletedSale.invoiceNumber)}>Print last bill</button>}<p className="printer-note"><strong>PSF-58D status: pending verification.</strong> This creates a 58 mm print-ready receipt using the browser’s print sheet. Direct Bluetooth printing is disabled until Shreyans confirms the iOS SDK/protocol.</p></aside></section>{scannerOpen && <LiveBarcodeScannerModal onDetected={addBarcodeToCart} onClose={() => setScannerOpen(false)} />}</>
}

function printReceipt(cart: CartItem[], total: number, invoiceNumber?: string) {
  const printableInvoiceNumber = invoiceNumber ?? `ABH-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${Date.now().toString().slice(-5)}`
  const receipt = window.open('', '_blank', 'width=360,height=700')
  if (!receipt) return
  const rows = cart.map(({ product, quantity }) => `<tr><td>${escapeHtml(product.name)}<br><small>${escapeHtml(product.barcode)} × ${quantity}</small></td><td>₹${((product.sellingPricePaise * quantity) / 100).toLocaleString('en-IN')}</td></tr>`).join('')
  receipt.document.write(`<!doctype html><title>${printableInvoiceNumber}</title><style>@page{size:58mm auto;margin:3mm}body{font-family:monospace;width:52mm;font-size:11px}h1{text-align:center;font-size:17px;margin:0}p{text-align:center;margin:4px 0}table{width:100%;border-collapse:collapse}td{padding:5px 0;border-bottom:1px dashed #555}td:last-child{text-align:right}.total{font-size:15px;font-weight:bold;text-align:right;margin-top:10px}small{font-size:9px}</style><h1>ABHIJATYA</h1><p>Invoice: ${printableInvoiceNumber}<br>${new Date().toLocaleString('en-IN')}</p><table>${rows}</table><p class="total">Total: ${formatInr(total)}</p><p>Thank you for shopping with us.</p><script>window.onload=()=>window.print()</script>`)
  receipt.document.close()
}
function escapeHtml(value: string) { return value.replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character] ?? character) }

function Inventory({ products, onChanged }: { products: Product[]; onChanged: () => Promise<void> }) {
  const [selected, setSelected] = useState<Product | undefined>(); const [stock, setStock] = useState(''); const [message, setMessage] = useState('')
  const saveAdjustment = async () => {
    try { await sharedProductRepository.adjustStock(selected!.id, Number(stock), 'ADJUSTMENT', 'Manual stock adjustment'); await onChanged(); setSelected(undefined) } catch (reason) { setMessage(reason instanceof Error ? reason.message : 'Unable to adjust stock.') }
  }
  if (selected) return <section className="card"><h2>Adjust stock · {selected.name}</h2><p>Current stock: <strong>{selected.stockQuantity}</strong>. Every adjustment creates a movement record.</p><label>New stock quantity<input type="number" min="0" value={stock} onChange={(event) => setStock(event.target.value)} /></label><button onClick={() => void saveAdjustment()}>Save adjustment</button><button className="secondary" onClick={() => setSelected(undefined)}>Cancel</button><p>{message}</p></section>
  return <section className="card"><h2>Inventory</h2><p>New products start with one item in stock. Select one to adjust it.</p><div className="table">{products.map((p) => <button className="product-row" onClick={() => { setSelected(p); setStock(String(p.stockQuantity)) }} key={p.id}><span><strong>{p.name}</strong><small>{p.barcode}</small></span><span>{p.stockQuantity}<small>In stock</small></span></button>)}</div></section>
}

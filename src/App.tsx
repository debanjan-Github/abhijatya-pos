import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { Capacitor, registerPlugin } from '@capacitor/core'
import type { Product, ProductInput } from './domain/types'
import { barcodeValidationError, formatInr, parseRupees } from './domain/productRules'
import { sharedProductRepository } from './services/sharedProductRepository'
import { importLocalProducts } from './services/importLocalProducts'
import { completeSharedSale, listSharedSales, updateSharedSaleCustomerPhone, type PaymentMethod, type SavedSale } from './services/sharedSalesRepository'
import { readPriceTag } from './services/priceTagReader'
import { readPriceTagWithVision } from './services/visionTagReader'
import { supabase } from './services/supabaseClient'
import { SearchableMultiSelect } from './components/SearchableMultiSelect'
import { ImagePreviewModal } from './components/ImagePreviewModal'
import { LiveBarcodeScannerModal, type ScannerFeedback } from './components/LiveBarcodeScannerModal'
import boutiqueLogo from '../LOGO My.png'

type Page = 'Dashboard' | 'Products' | 'Sales' | 'Inventory' | 'Customers' | 'Reports' | 'Settings'
const pages: Page[] = ['Dashboard', 'Products', 'Sales', 'Inventory', 'Customers', 'Reports', 'Settings']
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

interface NativeProductActionsPlugin {
  showActions(options: { productName: string }): Promise<{ action?: 'edit' | 'delete' | 'cancel' }>
  confirmDelete(options: { productName: string; permanent: boolean }): Promise<{ confirmed?: boolean }>
}

interface NativeBillSharePlugin {
  sharePdf(options: {
    invoiceNumber: string
    dateText: string
    items: Array<{ name: string; barcode: string; quantity: number; lineTotal: string }>
    totalText: string
    paymentMethod: string
    customerPhone?: string
    logoDataUrl?: string
  }): Promise<{ shared?: boolean }>
}

const NativeProductActions = registerPlugin<NativeProductActionsPlugin>('NativeProductActions')
const NativeBillShare = registerPlugin<NativeBillSharePlugin>('NativeBillShare')

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
    <header><div className="brand-identity"><img className="boutique-logo" src={boutiqueLogo} alt="Abhijatya Boutique" /><div><p className="eyebrow">BOUTIQUE POS</p><h1>ABHIJATYA</h1></div></div><div className="staff-actions"><small>{email}</small><button className="secondary" onClick={onSignOut}>Sign out</button><button className="scan" onClick={() => { setPage('Sales'); setEditing(undefined) }}>New bill</button></div></header>
    <nav>{pages.map((item) => <button key={item} className={page === item ? 'active' : ''} onClick={() => { setPage(item); setEditing(undefined) }}>{item}</button>)}</nav>
    {syncError && <p className="error">{syncError}</p>}
    {page === 'Dashboard' && <Dashboard products={activeProducts} onProducts={() => setPage('Products')} />}
    {page === 'Products' && <Products products={products} editing={editing} onEdit={setEditing} onSave={refresh} onCancel={() => setEditing(undefined)} />}
    {page === 'Sales' && <Billing products={activeProducts} onCompleted={refresh} />}
    {page === 'Inventory' && <Inventory products={activeProducts} onChanged={refresh} />}
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
  const [filtersExpanded, setFiltersExpanded] = useState(false)
  const [draftZoners, setDraftZoners] = useState<string[]>([])
  const [draftMaterials, setDraftMaterials] = useState<string[]>([])
  const [selectedZoners, setSelectedZoners] = useState<string[]>([])
  const [selectedMaterials, setSelectedMaterials] = useState<string[]>([])
  const [page, setPage] = useState(1)
  const [showArchived, setShowArchived] = useState(false)
  const [error, setError] = useState('')
  const [importing, setImporting] = useState(false)
  const [actionProduct, setActionProduct] = useState<Product>()
  const [deleteProduct, setDeleteProduct] = useState<Product>()
  const [deleting, setDeleting] = useState(false)
  const [permanentDeleteProduct, setPermanentDeleteProduct] = useState<Product>()
  const [permanentlyDeleting, setPermanentlyDeleting] = useState(false)
  const archivedProducts = products.filter((product) => Boolean(product.archivedAt))
  const activeProducts = products.filter((product) => !product.archivedAt)
  const selectedFilterCount = selectedZoners.length + selectedMaterials.length
  const zonerOptions = useMemo(() => [...new Set([...ZONERS, ...activeProducts.flatMap((product) => product.zoner?.split(',').map((value) => value.trim()).filter(Boolean) ?? [])])].sort(), [activeProducts])
  const materialOptions = useMemo(() => [...new Set([...MATERIALS, ...activeProducts.flatMap((product) => product.material?.split(',').map((value) => value.trim()).filter(Boolean) ?? [])])].sort(), [activeProducts])
  const filtered = useMemo(() => {
    const textQuery = query.trim().toLowerCase()
    const includesAnyTag = (value: string | undefined, selected: string[]) => {
      if (!selected.length) return true
      const productTags = value?.split(',').map((tag) => tag.trim().toLowerCase()).filter(Boolean) ?? []
      return selected.some((tag) => productTags.includes(tag.toLowerCase()))
    }
    return activeProducts.filter((product) => {
      const matchesSearch = !textQuery || [product.name, product.sku, product.barcode, product.zoner, product.material]
        .some((value) => value?.toLowerCase().includes(textQuery))
      return matchesSearch && includesAnyTag(product.zoner, selectedZoners) && includesAnyTag(product.material, selectedMaterials)
    })
  }, [activeProducts, query, selectedMaterials, selectedZoners])
  const pageCount = Math.max(1, Math.ceil(filtered.length / 10))
  const currentPage = Math.min(page, pageCount)
  const paginatedProducts = filtered.slice((currentPage - 1) * 10, currentPage * 10)
  const applyFilters = () => {
    setSelectedZoners(draftZoners)
    setSelectedMaterials(draftMaterials)
    setPage(1)
  }
  const clearFilters = () => {
    setDraftZoners([])
    setDraftMaterials([])
    setSelectedZoners([])
    setSelectedMaterials([])
    setPage(1)
  }
  const restore = async (id: string) => {
    try { await sharedProductRepository.restore(id); await onSave() } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not restore product.') }
  }
  const archiveProduct = async () => {
    if (!deleteProduct) return
    setDeleting(true); setError('')
    try {
      await sharedProductRepository.archive(deleteProduct.id)
      await onSave()
      setDeleteProduct(undefined)
      setActionProduct(undefined)
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not delete product.') } finally { setDeleting(false) }
  }
  const permanentlyDelete = async () => {
    if (!permanentDeleteProduct) return
    setPermanentlyDeleting(true); setError('')
    try {
      await sharedProductRepository.permanentlyDeleteArchived(permanentDeleteProduct.id)
      await onSave()
      setPermanentDeleteProduct(undefined)
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not permanently delete product.') } finally { setPermanentlyDeleting(false) }
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
  return <section className="card product-list"><div className="toolbar"><div><h2>Products</h2><p>{activeProducts.length} active products · shared refresh every 5 seconds</p></div><div className="product-actions"><button className="secondary" onClick={() => void importLocal()} disabled={importing}>{importing ? 'Importing…' : 'Import local products'}</button><button onClick={() => onEdit({ ...blank(), id: '', createdAt: '', updatedAt: '' })}>+ Add product</button></div></div>{error && <p className={error.includes('imported') || error.startsWith('No local') ? 'notice' : 'error'}>{error}</p>}<button className="secondary filters-toggle" type="button" aria-expanded={filtersExpanded} onClick={() => setFiltersExpanded((expanded) => !expanded)}>Filters{selectedFilterCount ? ` (${selectedFilterCount} applied)` : ''}<span aria-hidden="true"> {filtersExpanded ? '⌃' : '⌄'}</span></button>{filtersExpanded && <section className="filters-panel" aria-label="Product filters"><div className="filter-grid"><SearchableMultiSelect label="Zoner" options={zonerOptions} selected={draftZoners} onChange={setDraftZoners} allowCustom={false} /><SearchableMultiSelect label="Material" options={materialOptions} selected={draftMaterials} onChange={setDraftMaterials} allowCustom={false} /></div><p className="filter-help">Within each filter, any selected value can match. Zoner and Material filters work together.</p><div className="filter-actions"><button className="secondary" type="button" onClick={clearFilters} disabled={!draftZoners.length && !draftMaterials.length && !selectedFilterCount}>Clear filters</button><button type="button" onClick={applyFilters}>Apply filters</button></div></section>}<input aria-label="Search products" value={query} onChange={(e) => { setQuery(e.target.value); setPage(1) }} placeholder="Search name, zoner, material or barcode" />{filtered.length === 0 ? <p className="empty">No products match this search and filter combination.</p> : <><p className="results-summary">Showing {(currentPage - 1) * 10 + 1}–{Math.min(currentPage * 10, filtered.length)} of {filtered.length} matching products</p><div className="table">{paginatedProducts.map((p) => <ProductListRow product={p} key={p.id} onOpen={() => void openProduct(p)} onHold={() => setActionProduct(p)} />)}</div>{pageCount > 1 && <nav className="pagination" aria-label="Products pagination"><button className="secondary" type="button" onClick={() => setPage(currentPage - 1)} disabled={currentPage === 1}>Previous</button><span>Page {currentPage} of {pageCount}</span><button className="secondary" type="button" onClick={() => setPage(currentPage + 1)} disabled={currentPage === pageCount}>Next</button></nav>}</>}<button className="secondary archived-toggle" onClick={() => setShowArchived((show) => !show)}>{showArchived ? 'Hide archived products' : `Archived products (${archivedProducts.length})`}</button>{showArchived && <div className="archived-list">{archivedProducts.length === 0 ? <p className="empty">No archived products.</p> : archivedProducts.map((product) => <div className="product-row archived-product-row" key={product.id}><span><strong>{product.name}</strong><small>{product.barcode}</small></span><div className="archived-product-actions"><button onClick={() => void restore(product.id)}>Restore product</button><button className="danger" onClick={() => setPermanentDeleteProduct(product)}>Delete permanently</button></div></div>)}</div>}{actionProduct && <ProductActionMenu product={actionProduct} onEdit={() => { setActionProduct(undefined); void openProduct(actionProduct) }} onDelete={() => setDeleteProduct(actionProduct)} onClose={() => setActionProduct(undefined)} />}{deleteProduct && <DeleteProductDialog product={deleteProduct} deleting={deleting} onCancel={() => setDeleteProduct(undefined)} onConfirm={() => void archiveProduct()} />}{permanentDeleteProduct && <PermanentDeleteProductDialog product={permanentDeleteProduct} deleting={permanentlyDeleting} onCancel={() => setPermanentDeleteProduct(undefined)} onConfirm={() => void permanentlyDelete()} />}</section>
}

function ProductListRow({ product, onOpen, onHold }: { product: Product; onOpen: () => void; onHold: () => void }) {
  const holdTimer = useRef<number | undefined>(undefined)
  const held = useRef(false)
  const clearHold = () => { if (holdTimer.current) window.clearTimeout(holdTimer.current); holdTimer.current = undefined }
  const startHold = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    held.current = false
    holdTimer.current = window.setTimeout(() => { held.current = true; onHold() }, 650)
  }
  return <button className="product-row" onPointerDown={startHold} onPointerUp={clearHold} onPointerCancel={clearHold} onPointerLeave={clearHold} onContextMenu={(event) => { event.preventDefault(); clearHold(); onHold() }} onClick={() => { if (held.current) { held.current = false; return }; onOpen() }}><span><strong>{product.name}</strong><small>{product.zoner || 'No zoner'} · {product.material || 'No material'} · {product.barcode}</small></span><span>{formatInr(product.sellingPricePaise)}<small>Stock: {product.stockQuantity}</small></span></button>
}

function ProductActionMenu({ product, onEdit, onDelete, onClose }: { product: Product; onEdit: () => void; onDelete: () => void; onClose: () => void }) {
  const [useWebFallback, setUseWebFallback] = useState(false)
  const requestedNativeAction = useRef(false)
  useEffect(() => {
    if (!Capacitor.isNativePlatform() || requestedNativeAction.current) return
    requestedNativeAction.current = true
    let active = true
    void NativeProductActions.showActions({ productName: product.name }).then(({ action }) => {
      if (!active) return
      if (action === 'edit') onEdit()
      else if (action === 'delete') onDelete()
      else onClose()
    }).catch(() => { if (active) setUseWebFallback(true) })
    return () => { active = false }
  }, [onClose, onDelete, onEdit, product.name])
  if (Capacitor.isNativePlatform() && !useWebFallback) return null
  return <div className="dialog-backdrop" role="presentation" onMouseDown={onClose}><section className="action-menu" role="dialog" aria-label={`Actions for ${product.name}`} onMouseDown={(event) => event.stopPropagation()}><p className="eyebrow">PRODUCT ACTIONS</p><h2>{product.name}</h2><button className="secondary" onClick={onEdit}>Edit product</button><button className="danger" onClick={onDelete}>Delete product</button><button className="secondary" onClick={onClose}>Cancel</button></section></div>
}

function DeleteProductDialog({ product, deleting, onCancel, onConfirm }: { product: Product; deleting: boolean; onCancel: () => void; onConfirm: () => void }) {
  const [useWebFallback, setUseWebFallback] = useState(false)
  const requestedNativeConfirmation = useRef(false)
  useEffect(() => {
    if (!Capacitor.isNativePlatform() || requestedNativeConfirmation.current) return
    requestedNativeConfirmation.current = true
    let active = true
    void NativeProductActions.confirmDelete({ productName: product.name, permanent: false }).then(({ confirmed }) => {
      if (!active) return
      if (confirmed) onConfirm()
      else onCancel()
    }).catch(() => { if (active) setUseWebFallback(true) })
    return () => { active = false }
  }, [onCancel, onConfirm, product.name])
  if (Capacitor.isNativePlatform() && !useWebFallback) return null
  return <div className="dialog-backdrop" role="presentation"><section className="action-menu" role="alertdialog" aria-modal="true" aria-labelledby="delete-product-title"><p className="eyebrow">CONFIRM DELETE</p><h2 id="delete-product-title">Delete {product.name}?</h2><p>This removes it from active products and inventory. Past bills are kept safely.</p><div className="dialog-actions"><button className="secondary" onClick={onCancel} disabled={deleting}>Cancel</button><button className="danger" onClick={onConfirm} disabled={deleting}>{deleting ? 'Deleting…' : 'Sure, delete'}</button></div></section></div>
}

function PermanentDeleteProductDialog({ product, deleting, onCancel, onConfirm }: { product: Product; deleting: boolean; onCancel: () => void; onConfirm: () => void }) {
  const [useWebFallback, setUseWebFallback] = useState(false)
  const requestedNativeConfirmation = useRef(false)
  useEffect(() => {
    if (!Capacitor.isNativePlatform() || requestedNativeConfirmation.current) return
    requestedNativeConfirmation.current = true
    let active = true
    void NativeProductActions.confirmDelete({ productName: product.name, permanent: true }).then(({ confirmed }) => {
      if (!active) return
      if (confirmed) onConfirm()
      else onCancel()
    }).catch(() => { if (active) setUseWebFallback(true) })
    return () => { active = false }
  }, [onCancel, onConfirm, product.name])
  if (Capacitor.isNativePlatform() && !useWebFallback) return null
  return <div className="dialog-backdrop" role="presentation"><section className="action-menu" role="alertdialog" aria-modal="true" aria-labelledby="permanent-delete-product-title"><p className="eyebrow">PERMANENT DELETE</p><h2 id="permanent-delete-product-title">Permanently delete {product.name}?</h2><p>This cannot be undone. It is available only for archived products that have never been included on a completed bill.</p><div className="dialog-actions"><button className="secondary" onClick={onCancel} disabled={deleting}>Cancel</button><button className="danger" onClick={onConfirm} disabled={deleting}>{deleting ? 'Deleting…' : 'Sure, permanently delete'}</button></div></section></div>
}

function ProductForm({ product, onSaved, onCancel }: { product: Product; onSaved: () => Promise<void>; onCancel: () => void }) {
  const isNew = !product.id
  const [form, setForm] = useState<ProductInput>(isNew ? blank() : product)
  const [error, setError] = useState('')
  const [reading, setReading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState('')
  const [previewImage, setPreviewImage] = useState<string>()
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const photoInputRef = useRef<HTMLInputElement>(null)
  const change = <K extends keyof ProductInput>(key: K, value: ProductInput[K]) => setForm((current) => ({ ...current, [key]: value }))
  const barcodeError = barcodeValidationError(form.barcode)
  const upload = async (file?: File) => {
    if (!file) return
    if (!file.type.startsWith('image/')) { setError('Please upload an image file.'); return }
    setError(''); setNotice('Reading the price tag…'); setReading(true)
    const imageDataUrl = await asOptimisedDataUrl(file, 1600, 0.82).catch((reason: unknown) => { setError(reason instanceof Error ? reason.message : 'Photo could not be loaded.'); return undefined })
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
    try { change('imageDataUrl', await asOptimisedDataUrl(file, 1400, 0.76)); setError('') } catch (reason) { setError(reason instanceof Error ? reason.message : 'Photo could not be loaded.') }
  }
  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (saving) return
    setSaving(true)
    try {
      setError('')
      if (isNew) await sharedProductRepository.create(form)
      else await sharedProductRepository.update(product.id, form)
      await onSaved()
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not save product.') } finally { setSaving(false) }
  }
  const archive = async () => {
    if (!confirm(`Archive ${product.name}? It will be hidden from active products.`)) return
    try { await sharedProductRepository.archive(product.id); await onSaved() } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not archive product.') }
  }
  return <section className="card"><div className="toolbar"><div><h2>{isNew ? 'Add product' : 'Edit product'}</h2><p>Photograph the existing price tag, then confirm the details.</p></div><button className="secondary" type="button" onClick={onCancel} disabled={saving}>Cancel</button></div><form onSubmit={(event) => void submit(event)} aria-busy={saving}>{error && <p className="error">{error}</p>}{saving && <p className="notice" role="status">Saving product… Please keep this page open.</p>}<div className="tag-upload"><strong>Price-tag photo</strong><input ref={cameraInputRef} className="visually-hidden" type="file" accept="image/*" capture="environment" onChange={(event) => void upload(event.target.files?.[0])} /><input ref={photoInputRef} className="visually-hidden" type="file" accept="image/*" onChange={(event) => void upload(event.target.files?.[0])} /><button type="button" onClick={() => cameraInputRef.current?.click()} disabled={reading || saving}>{reading ? 'Reading price tag…' : 'Take price-tag photo'}</button><button className="secondary" type="button" onClick={() => photoInputRef.current?.click()} disabled={reading || saving}>Choose tag photo</button><span>Used to fill barcode, name, and price.</span>{form.priceTagImageDataUrl && <button className="tag-preview-button" type="button" onClick={() => setPreviewImage(form.priceTagImageDataUrl)} aria-label="View price-tag photo full size"><img className="tag-preview" src={form.priceTagImageDataUrl} alt="Uploaded price tag" /></button>}</div>{notice && <p className="notice">{notice}</p>}<SareePhotoField value={form.imageDataUrl} onChange={(file) => void uploadSareePhoto(file)} onRemove={() => change('imageDataUrl', undefined)} /><div className="form-grid">{textField('name', 'Name', true, form, change)}{textField('zoner', 'Zoner', false, form, change)}{textField('material', 'Material', false, form, change)}<BarcodeField value={form.barcode} error={barcodeError} onChange={(barcode) => { change('barcode', barcode); change('sku', barcode) }} /><label>Price *<input required inputMode="decimal" value={String(form.sellingPricePaise / 100)} onChange={(event) => change('sellingPricePaise', parseRupees(event.target.value) ?? 0)} /></label></div><button type="submit" disabled={saving || Boolean(barcodeError)}>{saving ? 'Saving product…' : isNew ? 'Save product' : 'Save changes'}</button></form>{!isNew && <button className="danger" onClick={() => void archive()} disabled={saving}>Archive product</button>}<ImagePreviewModal imageUrl={previewImage} alt="Price-tag photo" onClose={() => setPreviewImage(undefined)} /></section>
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

function BarcodeField({ value, error, onChange }: { value: string; error?: string; onChange: (value: string) => void }) {
  return <label>Barcode *<input required value={value} inputMode="text" autoCapitalize="characters" autoCorrect="off" pattern="AB[0-9]{5}" aria-invalid={Boolean(error)} aria-describedby={error ? 'barcode-format-error' : undefined} onChange={(event) => onChange(event.target.value.toUpperCase())} />{error && <small className="field-error" id="barcode-format-error" role="alert">{error}</small>}</label>
}
function asOptimisedDataUrl(file: File, maxDimension: number, quality: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    const objectUrl = URL.createObjectURL(file)
    image.onload = () => {
      URL.revokeObjectURL(objectUrl)
      const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight))
      const width = Math.max(1, Math.round(image.naturalWidth * scale))
      const height = Math.max(1, Math.round(image.naturalHeight * scale))
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const context = canvas.getContext('2d')
      if (!context) { reject(new Error('Photo compression is unavailable in this browser.')); return }
      context.drawImage(image, 0, 0, width, height)
      // JPEG keeps camera photos small enough for reliable Supabase saves while
      // retaining enough sharpness for price-tag reading.
      resolve(canvas.toDataURL('image/jpeg', quality))
    }
    image.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error('Photo could not be loaded. Please use a JPEG or PNG photo.')) }
    image.src = objectUrl
  })
}

function SareePhotoField({ value, onChange, onRemove }: { value?: string; onChange: (file?: File) => void; onRemove: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const choosePhoto = () => { if (inputRef.current) { inputRef.current.value = ''; inputRef.current.click() } }
  return <div className="tag-upload saree-photo"><strong>Saree photo</strong><input ref={inputRef} className="visually-hidden" type="file" accept="image/*" onChange={(event) => onChange(event.target.files?.[0])} /><button className="secondary" type="button" onClick={choosePhoto}>{value ? 'Replace saree photo' : 'Upload saree photo'}</button>{value && <button className="danger photo-remove" type="button" onClick={onRemove}>Remove photo</button>}<span>This photo is shown with the product in your catalogue.</span>{value && <img className="tag-preview" src={value} alt="Saree product" />}</div>
}

interface CartItem { product: Product; quantity: number }
interface ReceiptItem { name: string; barcode: string; quantity: number; unitPricePaise: number; lineTotalPaise: number }
interface BillDetails { invoiceNumber: string; items: ReceiptItem[]; totalPaise: number; paymentMethod: PaymentMethod; customerPhone?: string; completedAt: Date }

const receiptItemsFromCart = (cart: CartItem[]): ReceiptItem[] => cart.map(({ product, quantity }) => ({
  name: product.name,
  barcode: product.barcode,
  quantity,
  unitPricePaise: product.sellingPricePaise,
  lineTotalPaise: product.sellingPricePaise * quantity,
}))
const billDetailsFromSavedSale = (sale: SavedSale): BillDetails => ({
  invoiceNumber: sale.invoiceNumber,
  items: sale.items,
  totalPaise: sale.totalPaise,
  paymentMethod: sale.paymentMethod,
  customerPhone: sale.customerPhone,
  completedAt: new Date(sale.createdAt),
})

function normaliseIndianMobile(value: string): string | undefined {
  const digits = value.replace(/\D/g, '')
  const localNumber = digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits
  return /^[6-9]\d{9}$/.test(localNumber) ? `+91${localNumber}` : undefined
}

function Billing({ products, onCompleted }: { products: Product[]; onCompleted: () => Promise<void> }) {
  const [cart, setCart] = useState<CartItem[]>([])
  const [message, setMessage] = useState('')
  const [reading, setReading] = useState(false)
  const [scannerOpen, setScannerOpen] = useState(false)
  const [manualBarcode, setManualBarcode] = useState('')
  const [cartPreviewImage, setCartPreviewImage] = useState<string>()
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('CASH')
  const [customerMobile, setCustomerMobile] = useState('')
  const [completing, setCompleting] = useState(false)
  const [lastCompletedSale, setLastCompletedSale] = useState<BillDetails>()
  const [savedBills, setSavedBills] = useState<SavedSale[]>([])
  const [billsError, setBillsError] = useState('')
  const [editingBill, setEditingBill] = useState<SavedSale>()
  const [editedCustomerMobile, setEditedCustomerMobile] = useState('')
  const [savingCustomerPhone, setSavingCustomerPhone] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const recentlyAddedBarcodeRef = useRef(new Map<string, number>())
  const cartRef = useRef<CartItem[]>([])
  const total = cart.reduce((sum, item) => sum + item.product.sellingPricePaise * item.quantity, 0)
  const customerPhone = normaliseIndianMobile(customerMobile)
  const customerPhoneError = customerMobile.trim() && !customerPhone ? 'Enter a valid 10-digit Indian mobile number.' : undefined
  const editedCustomerPhone = normaliseIndianMobile(editedCustomerMobile)
  const editedCustomerPhoneError = editedCustomerMobile.trim() && !editedCustomerPhone ? 'Enter a valid 10-digit Indian mobile number.' : undefined
  const refreshBills = useCallback(async () => {
    try { setSavedBills(await listSharedSales()); setBillsError('') } catch (reason) { setBillsError(reason instanceof Error ? `Could not load saved bills: ${reason.message}` : 'Could not load saved bills.') }
  }, [])
  useEffect(() => {
    const initialRefresh = window.setTimeout(() => { void refreshBills() }, 0)
    return () => window.clearTimeout(initialRefresh)
  }, [refreshBills])
  useEffect(() => { cartRef.current = cart }, [cart])
  const enrichCartProduct = useCallback(async (productId: string) => {
    try {
      // The five-second shared list intentionally excludes images. Fetching the
      // tag photo after the cart row is visible keeps barcode billing responsive.
      const detailedProduct = await sharedProductRepository.getForSale(productId)
      setCart((items) => {
        const nextItems = items.map((item) => item.product.id === productId ? { ...item, product: detailedProduct } : item)
        cartRef.current = nextItems
        return nextItems
      })
    } catch {
      // The sale can still proceed: the barcode, name, price, and stock were
      // already loaded in the shared catalogue. The photo is identification help.
    }
  }, [])
  const addBarcodeToCart = useCallback((barcode: string): ScannerFeedback => {
    const cleanBarcode = barcode.trim()
    if (!cleanBarcode) return { message: 'No barcode was detected. Try again.', tone: 'error' }
    const now = Date.now()
    const canonicalBarcode = cleanBarcode.toUpperCase()
    if ((recentlyAddedBarcodeRef.current.get(canonicalBarcode) ?? 0) > now - 1200) return { message: `${canonicalBarcode} was just scanned. Scan the next saree.`, tone: 'duplicate' }
    recentlyAddedBarcodeRef.current.set(canonicalBarcode, now)
    const product = products.find((item) => item.barcode.trim().toUpperCase() === cleanBarcode.toUpperCase())
    if (!product) { const message = `No saved product matches barcode ${cleanBarcode}.`; setMessage(message); return { message, tone: 'error' } }
    if (product.stockQuantity < 1) { const message = `${product.name} is out of stock.`; setMessage(message); return { message, tone: 'error' } }
    if (cartRef.current.some((item) => item.product.id === product.id)) {
      const message = `${product.name} is already in this bill. Scan the next saree.`
      setMessage(message)
      return { message, tone: 'duplicate' }
    }
    const nextCart = [...cartRef.current, { product, quantity: 1 }]
    cartRef.current = nextCart
    setCart(nextCart)
    setManualBarcode('')
    const message = `${product.name} added to the bill.`
    setMessage(message)
    void enrichCartProduct(product.id)
    return { message, tone: 'added' }
  }, [enrichCartProduct, products])
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
    if (customerPhoneError) { setMessage(customerPhoneError); return }
    setCompleting(true); setMessage('Completing shared sale…')
    try {
      const completedAt = new Date()
      const sale = await completeSharedSale(cart.map((item) => ({ productId: item.product.id, quantity: item.quantity })), paymentMethod, customerPhone)
      setLastCompletedSale({ invoiceNumber: sale.invoiceNumber, items: receiptItemsFromCart(cart), totalPaise: total, paymentMethod, customerPhone, completedAt })
      setCart([])
      setCustomerMobile('')
      setMessage(`Sale ${sale.invoiceNumber} completed. Inventory is updated for all staff.`)
      await onCompleted()
      await refreshBills()
    } catch (reason) { setMessage(reason instanceof Error ? reason.message : 'Sale could not be completed.') } finally { setCompleting(false) }
  }
  const openCustomerPhoneEditor = (sale: SavedSale) => {
    setEditingBill(sale)
    setEditedCustomerMobile(sale.customerPhone ?? '')
  }
  const saveCustomerPhone = async () => {
    if (!editingBill || savingCustomerPhone || editedCustomerPhoneError) return
    setSavingCustomerPhone(true)
    try {
      await updateSharedSaleCustomerPhone(editingBill.id, editedCustomerPhone)
      if (lastCompletedSale?.invoiceNumber === editingBill.invoiceNumber) {
        setLastCompletedSale({ ...lastCompletedSale, customerPhone: editedCustomerPhone })
      }
      setMessage(`Customer number updated for ${editingBill.invoiceNumber}.`)
      setEditingBill(undefined)
      await refreshBills()
    } catch (reason) {
      setBillsError(reason instanceof Error ? `Could not update customer number: ${reason.message}` : 'Could not update customer number.')
    } finally { setSavingCustomerPhone(false) }
  }
  const requestReceiptPrint = (bill: BillDetails) => {
    const error = printReceipt(bill)
    setMessage(error ?? `Print receipt opened for ${bill.invoiceNumber}. Select 58 mm paper where your printer supports it.`)
  }
  return <>
    <section className="billing-layout">
      <div className="card">
        <div className="toolbar"><div><p className="eyebrow">FAST BILLING</p><h2>New sale</h2><p>Scan each product continuously. Tag photos load in the background after the item is added.</p></div><div className="billing-actions"><button className="scan" onClick={() => setScannerOpen(true)}>Scan barcode</button><button className="secondary" onClick={() => inputRef.current?.click()} disabled={reading}>{reading ? 'Reading tag…' : 'Use tag photo'}</button></div></div>
        <form className="manual-barcode" onSubmit={(event) => { event.preventDefault(); addBarcodeToCart(manualBarcode) }}><label>Enter barcode manually<input value={manualBarcode} onChange={(event) => setManualBarcode(event.target.value)} placeholder="Example: AB00023" autoCapitalize="characters" autoCorrect="off" /></label><button className="scan" type="submit" disabled={!manualBarcode.trim()}>Add item</button></form>
        <input ref={inputRef} className="visually-hidden" type="file" accept="image/*" capture="environment" onChange={(event) => void readTag(event.target.files?.[0])} />
        {message && <p className="notice">{message}</p>}
        <div className="cart-list">{cart.length === 0 ? <p className="empty">Your bill is empty. Scan or enter a barcode to add a saree.</p> : cart.map(({ product, quantity }) => <div className="cart-row" key={product.id}>{product.priceTagImageDataUrl && <button className="tag-preview-button cart-tag-preview" type="button" onClick={() => setCartPreviewImage(product.priceTagImageDataUrl)} aria-label={`View price tag for ${product.name}`}><img className="thumb" src={product.priceTagImageDataUrl} alt="Price tag" /></button>}<span><strong>{product.name}</strong><small>{product.barcode} · {formatInr(product.sellingPricePaise)}</small></span><div className="quantity"><button onClick={() => changeQuantity(product.id, quantity - 1)} aria-label="Remove one">−</button><strong>{quantity}</strong><button onClick={() => changeQuantity(product.id, quantity + 1)} disabled={quantity >= product.stockQuantity} aria-label="Add one">+</button></div><strong>{formatInr(product.sellingPricePaise * quantity)}</strong></div>)}</div>
      </div>
      <aside className="card bill-summary">
        <p className="eyebrow">BILL SUMMARY</p><h2>ABHIJATYA</h2><div><span>Items</span><strong>{cart.reduce((sum, item) => sum + item.quantity, 0)}</strong></div>
        <label>Customer mobile <small>(optional — for WhatsApp bill)</small><input type="tel" inputMode="tel" autoComplete="tel" value={customerMobile} onChange={(event) => setCustomerMobile(event.target.value)} placeholder="98765 43210" /></label>
        {customerPhoneError && <p className="field-error" role="alert">{customerPhoneError}</p>}
        <label>Payment method<select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value as PaymentMethod)}><option value="CASH">Cash</option><option value="UPI">UPI</option><option value="CARD">Card</option><option value="OTHER">Other</option></select></label>
        <div className="grand-total"><span>Total amount</span><strong>{formatInr(total)}</strong></div>
        <button disabled={!cart.length || completing || Boolean(customerPhoneError)} onClick={() => void completeSale()}>{completing ? 'Completing sale…' : 'Complete sale'}</button>
        {lastCompletedSale && <><button className="secondary" onClick={() => requestReceiptPrint(lastCompletedSale)}>Print last bill</button>{lastCompletedSale.customerPhone && <><button className="scan" onClick={() => sendTextBillToCustomer(lastCompletedSale)}>Send bill to customer</button><button className="secondary" onClick={() => void sendBillOnWhatsApp(lastCompletedSale)}>Share PDF</button></>}</>}
        {lastCompletedSale?.customerPhone && <p className="whatsapp-note">Send bill opens the saved customer number directly. Share PDF lets you choose WhatsApp Business and its customer chat.</p>}
      </aside>
    </section>
    <section className="card saved-bills"><div className="toolbar"><div><p className="eyebrow">BILL HISTORY</p><h2>Saved bills</h2><p>Every completed sale is stored here with its permanent bill number.</p></div><button className="secondary" onClick={() => void refreshBills()}>Refresh bills</button></div>{billsError && <p className="error">{billsError}</p>}{savedBills.length === 0 ? <p className="empty">No completed bills yet.</p> : <div className="table">{savedBills.map((sale) => { const bill = billDetailsFromSavedSale(sale); return <article className="saved-bill-row" key={sale.id}><div><strong>{sale.invoiceNumber}</strong><small>{bill.completedAt.toLocaleString('en-IN')} · {sale.items.reduce((sum, item) => sum + item.quantity, 0)} item(s) · {sale.paymentMethod}</small><small>Customer: {sale.customerPhone ?? 'No mobile number'}</small></div><div className="saved-bill-actions"><strong>{formatInr(sale.totalPaise)}</strong><button className="secondary" onClick={() => openCustomerPhoneEditor(sale)}>Edit customer</button><button className="secondary" onClick={() => requestReceiptPrint(bill)}>Print</button>{sale.customerPhone && <><button className="scan" onClick={() => sendTextBillToCustomer(bill)}>Send to customer</button><button className="secondary" onClick={() => void sendBillOnWhatsApp(bill)}>Share PDF</button></>}</div></article> })}</div>}</section>
    {scannerOpen && <LiveBarcodeScannerModal onDetected={addBarcodeToCart} onClose={() => setScannerOpen(false)} />}
    <ImagePreviewModal imageUrl={cartPreviewImage} alt="Price-tag photo" onClose={() => setCartPreviewImage(undefined)} />
    {editingBill && <div className="dialog-backdrop" role="presentation"><section className="action-menu customer-phone-dialog" role="dialog" aria-modal="true" aria-labelledby="edit-customer-phone-title"><p className="eyebrow">SAVED BILL</p><h2 id="edit-customer-phone-title">Edit customer number</h2><p>{editingBill.invoiceNumber}. Leave this empty to remove the number.</p><label>Customer mobile<input type="tel" inputMode="tel" autoComplete="tel" value={editedCustomerMobile} onChange={(event) => setEditedCustomerMobile(event.target.value)} placeholder="98765 43210" autoFocus /></label>{editedCustomerPhoneError && <p className="field-error" role="alert">{editedCustomerPhoneError}</p>}<div className="dialog-actions"><button className="secondary" onClick={() => setEditingBill(undefined)} disabled={savingCustomerPhone}>Cancel</button><button onClick={() => void saveCustomerPhone()} disabled={savingCustomerPhone || Boolean(editedCustomerPhoneError)}>{savingCustomerPhone ? 'Saving…' : 'Save number'}</button></div></section></div>}
  </>

  async function sendBillOnWhatsApp(sale: BillDetails) {
    try {
      const status = await shareWhatsAppBill(sale)
      if (status) setMessage(status)
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : 'Could not prepare the PDF bill.')
    }
  }

  function sendTextBillToCustomer(sale: BillDetails) {
    try {
      const status = sendWhatsAppTextBill(sale)
      if (status) setMessage(status)
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : 'Could not open WhatsApp for this customer.')
    }
  }
}

async function shareWhatsAppBill(sale: BillDetails): Promise<string | undefined> {
  if (!sale.customerPhone) return
  const paymentMethod = sale.paymentMethod === 'CASH' ? 'Cash' : sale.paymentMethod === 'UPI' ? 'UPI' : sale.paymentMethod === 'CARD' ? 'Card' : 'Other'
  if (Capacitor.isNativePlatform()) {
    const logoDataUrl = await loadLogoDataUrl()
    const result = await NativeBillShare.sharePdf({
      invoiceNumber: sale.invoiceNumber,
      dateText: sale.completedAt.toLocaleString('en-IN'),
      items: sale.items.map((item) => ({ name: item.name, barcode: item.barcode, quantity: item.quantity, lineTotal: formatInr(item.lineTotalPaise) })),
      totalText: formatInr(sale.totalPaise),
      paymentMethod,
      customerPhone: sale.customerPhone,
      logoDataUrl,
    })
    return result.shared ? 'PDF bill shared.' : 'PDF bill share was cancelled.'
  }
  return 'PDF sharing is available in the installed iPhone app. Use Send to customer for the direct WhatsApp bill.'
}

function sendWhatsAppTextBill(sale: BillDetails): string | undefined {
  if (!sale.customerPhone) return 'Add a customer mobile number before sending the bill.'
  const itemLines = sale.items.map((item) => `• ${item.name} × ${item.quantity} — ${formatInr(item.lineTotalPaise)}`)
  const paymentMethod = sale.paymentMethod === 'CASH' ? 'Cash' : sale.paymentMethod === 'UPI' ? 'UPI' : sale.paymentMethod === 'CARD' ? 'Card' : 'Other'
  const message = [
    '*ABHIJATYA BOUTIQUE*',
    `Bill: ${sale.invoiceNumber}`,
    `Date: ${sale.completedAt.toLocaleString('en-IN')}`,
    '',
    ...itemLines,
    '',
    `*Total: ${formatInr(sale.totalPaise)}*`,
    `Payment: ${paymentMethod}`,
    '',
    'Thank you for shopping with us.',
  ].join('\n')
  const phone = sale.customerPhone.replace(/\D/g, '')
  const url = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`
  const popup = window.open(url, '_blank', 'noopener,noreferrer')
  if (!popup) window.location.assign(url)
  return `WhatsApp opened for ${sale.customerPhone}. Review the bill, then tap Send.`
}

async function loadLogoDataUrl(): Promise<string | undefined> {
  try {
    const response = await fetch(boutiqueLogo)
    if (!response.ok) return undefined
    const blob = await response.blob()
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Logo could not be loaded.'))
      reader.onerror = () => reject(new Error('Logo could not be loaded.'))
      reader.readAsDataURL(blob)
    })
  } catch { return undefined }
}

function printReceipt(sale: BillDetails): string | undefined {
  if (Capacitor.isNativePlatform()) return 'Direct Bluetooth printing is not configured for the PSF-58D yet. Open this bill in the browser to use the 58 mm print receipt.'
  const receipt = window.open('', '_blank', 'width=360,height=700')
  if (!receipt) return 'The receipt window was blocked. Allow pop-ups for this site, then try Print again.'
  const rows = sale.items.map((item) => `<tr><td>${escapeHtml(item.name)}<br><small>${escapeHtml(item.barcode)} × ${item.quantity}</small></td><td>₹${(item.lineTotalPaise / 100).toLocaleString('en-IN')}</td></tr>`).join('')
  const paymentMethod = sale.paymentMethod === 'CASH' ? 'Cash' : sale.paymentMethod === 'UPI' ? 'UPI' : sale.paymentMethod === 'CARD' ? 'Card' : 'Other'
  const logoUrl = new URL(boutiqueLogo, window.location.href).href
  receipt.document.write(`<!doctype html><title>${sale.invoiceNumber}</title><style>@page{size:58mm auto;margin:3mm}body{font-family:monospace;width:52mm;font-size:16px;padding-bottom:40px;box-sizing:border-box}h1{text-align:center;font-size:17px;margin:0}.logo{display:block;width:44mm;height:44mm;object-fit:contain;margin:0 auto 2mm}p{text-align:center;margin:4px 0}table{width:100%;border-collapse:collapse}td{padding:5px 0;border-bottom:1px dashed #555}td:last-child{text-align:right}.total{font-size:15px;font-weight:bold;text-align:right;margin-top:10px}small{font-size:9px}</style><img id="boutique-logo" class="logo" src="${escapeHtml(logoUrl)}" alt="Abhijatya Boutique"><h1>ABHIJATYA</h1><p>Bill: ${escapeHtml(sale.invoiceNumber)}<br>${sale.completedAt.toLocaleString('en-IN')}</p><table>${rows}</table><p class="total">Total: ${formatInr(sale.totalPaise)}</p><p>Payment: ${paymentMethod}</p><p>Thank you for shopping with us.</p><script>const printReceipt=()=>setTimeout(()=>{window.focus();window.print()},80);const logo=document.getElementById('boutique-logo');if(logo.complete)printReceipt();else{logo.addEventListener('load',printReceipt,{once:true});logo.addEventListener('error',printReceipt,{once:true})}</script>`)
  receipt.document.close()
  return undefined
}
function escapeHtml(value: string) { return value.replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character] ?? character) }

function Inventory({ products, onChanged }: { products: Product[]; onChanged: () => Promise<void> }) {
  const [selected, setSelected] = useState<Product | undefined>(); const [stock, setStock] = useState(''); const [message, setMessage] = useState(''); const [restoring, setRestoring] = useState(false)
  const saveAdjustment = async () => {
    try { await sharedProductRepository.adjustStock(selected!.id, Number(stock), 'ADJUSTMENT', 'Manual stock adjustment'); await onChanged(); setSelected(undefined) } catch (reason) { setMessage(reason instanceof Error ? reason.message : 'Unable to adjust stock.') }
  }
  if (selected) return <section className="card"><h2>Adjust stock · {selected.name}</h2><p>Current stock: <strong>{selected.stockQuantity}</strong>. Every adjustment creates a movement record.</p><label>New stock quantity<input type="number" min="0" value={stock} onChange={(event) => setStock(event.target.value)} /></label><button onClick={() => void saveAdjustment()}>Save adjustment</button><button className="secondary" onClick={() => setSelected(undefined)}>Cancel</button><p>{message}</p></section>
  const restoreAll = async () => {
    if (!confirm('Restore every active saree to stock 1? This is intended for testing and records an adjustment for each changed product.')) return
    setRestoring(true); setMessage('Restoring inventory…')
    try {
      const restored = await sharedProductRepository.restoreAllStockToOne()
      await onChanged()
      setMessage(restored ? `${restored} product(s) restored to stock 1.` : 'All active products were already at stock 1.')
    } catch (reason) { setMessage(reason instanceof Error ? reason.message : 'Unable to restore inventory.') } finally { setRestoring(false) }
  }
  return <section className="card"><div className="toolbar"><div><h2>Inventory</h2><p>Each saree is unique. Select one to adjust it, or restore all active sarees to stock 1 for testing.</p></div><button className="secondary" onClick={() => void restoreAll()} disabled={restoring}>{restoring ? 'Restoring…' : 'Restore inventory to 1'}</button></div>{message && <p className={message.includes('Unable') || message.includes('error') ? 'error' : 'notice'}>{message}</p>}<div className="table">{products.map((p) => <button className="product-row" onClick={() => { setSelected(p); setStock(String(p.stockQuantity)) }} key={p.id}><span><strong>{p.name}</strong><small>{p.barcode}</small></span><span>{p.stockQuantity}<small>In stock</small></span></button>)}</div></section>
}

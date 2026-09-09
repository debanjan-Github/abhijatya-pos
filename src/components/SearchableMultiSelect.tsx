import { useEffect, useId, useMemo, useRef, useState } from 'react'

interface SearchableMultiSelectProps {
  label: string
  options: readonly string[]
  selected: readonly string[]
  onChange: (selected: string[]) => void
  placeholder?: string
  allowCustom?: boolean
}

export function SearchableMultiSelect({
  label,
  options,
  selected,
  onChange,
  placeholder = 'Choose one or more',
  allowCustom = true,
}: SearchableMultiSelectProps) {
  const menuId = useId()
  const containerRef = useRef<HTMLDivElement>(null)
  const [isOpen, setIsOpen] = useState(false)
  const [query, setQuery] = useState('')
  const visibleOptions = useMemo(
    () => options.filter((option) => option.toLowerCase().includes(query.trim().toLowerCase())),
    [options, query],
  )

  const toggle = (option: string) => {
    onChange(selected.includes(option) ? selected.filter((item) => item !== option) : [...selected, option])
  }
  const customValue = query.trim()
  const canAddCustom = allowCustom && customValue.length > 0
    && !options.some((option) => option.toLowerCase() === customValue.toLowerCase())
    && !selected.some((option) => option.toLowerCase() === customValue.toLowerCase())
  const addCustom = () => {
    if (!canAddCustom) return
    onChange([...selected, customValue])
    setQuery('')
  }

  useEffect(() => {
    const closeWhenOutside = (event: PointerEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) setIsOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false)
    }
    document.addEventListener('pointerdown', closeWhenOutside)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeWhenOutside)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [])

  return <div className="searchable-multi-select" ref={containerRef}>
    <span className="field-label">{label}</span>
    <button className="secondary multi-select-trigger" type="button" aria-expanded={isOpen} aria-controls={menuId} onClick={() => setIsOpen((open) => !open)}>
      {selected.length ? `${selected.length} selected` : placeholder}<span aria-hidden="true">⌄</span>
    </button>
    {selected.length > 0 && <div className="selected-options">
      {selected.map((option) => <button key={option} className="selected-option" type="button" onClick={() => toggle(option)}>{option}<span aria-hidden="true">×</span></button>)}
    </div>}
    {isOpen && <div className="multi-select-menu" id={menuId}>
      <input autoFocus aria-label={`Search ${label}`} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Search ${label.toLowerCase()}`} />
      {canAddCustom && <button className="secondary add-custom-option" type="button" onClick={addCustom}>Add “{customValue}”</button>}
      <div className="multi-select-options">
        {visibleOptions.length === 0 ? <p className="empty">No matching options.</p> : visibleOptions.map((option) => <label className="multi-select-option" key={option}>
          <input type="checkbox" checked={selected.includes(option)} onChange={() => toggle(option)} />
          <span>{option}</span>
        </label>)}
      </div>
    </div>}
  </div>
}

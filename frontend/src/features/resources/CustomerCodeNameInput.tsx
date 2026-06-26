/**
 * Customer picker as two linked inputs in a 1:3 flex row: a narrow CODE
 * box and a wide NAME box. Type a code and the name resolves; type/pick a
 * name and the code resolves. Both stay in sync with the selected
 * customer_code (the component's value).
 *
 * Autocomplete uses native <datalist>, so there's no custom dropdown to get
 * clipped by a modal's overflow — it just works in real time everywhere
 * (create modals + the admin page).
 *
 * Data comes from the shared /api/customers cache (CUSTOMER_PICKER_QUERY_KEY).
 */
import { useId, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { listResource } from '@/api/resources'
import { CUSTOMER_PICKER_QUERY_KEY, type CustomerRow } from './CustomerPicker'

interface CustomerCodeNameInputProps {
  value: number | null
  onChange: (v: number | null) => void
  disabled?: boolean
  /** Error border (used by the create form on a missing value). */
  invalid?: boolean
  className?: string
}

export function CustomerCodeNameInput({
  value,
  onChange,
  disabled,
  invalid,
  className,
}: CustomerCodeNameInputProps) {
  const q = useQuery({
    queryKey: CUSTOMER_PICKER_QUERY_KEY,
    queryFn: () =>
      listResource<CustomerRow>('customers', {
        page: 1,
        page_size: 5000,
        sort_by: 'customer_name',
        sort_dir: 'asc',
      }),
    staleTime: 60_000,
  })
  const rows = q.data?.rows ?? []
  const byCode = useMemo(() => {
    const m = new Map<number, CustomerRow>()
    for (const r of rows) m.set(r.customer_code, r)
    return m
  }, [rows])

  const selected = value != null ? byCode.get(value) ?? null : null

  // Local edit drafts. null = "mirror the selected customer". While the
  // agent is typing we show the draft; on blur (or once it resolves) we
  // snap back to the canonical code/name of the selected customer.
  const [codeDraft, setCodeDraft] = useState<string | null>(null)
  const [nameDraft, setNameDraft] = useState<string | null>(null)

  const id = useId()
  const codeListId = `cc-code-${id}`
  const nameListId = `cc-name-${id}`

  const codeValue = codeDraft ?? (value != null ? String(value) : '')
  const nameValue = nameDraft ?? (selected?.customer_name ?? '')

  function onCodeChange(text: string) {
    setCodeDraft(text)
    setNameDraft(null)
    const trimmed = text.trim()
    if (trimmed === '') {
      onChange(null)
      return
    }
    const n = Number(trimmed)
    onChange(Number.isInteger(n) && byCode.has(n) ? n : null)
  }

  function onNameChange(text: string) {
    setNameDraft(text)
    setCodeDraft(null)
    const trimmed = text.trim().toLowerCase()
    if (trimmed === '') {
      onChange(null)
      return
    }
    // Exact (case-insensitive) name match — what a datalist pick produces.
    // Names aren't guaranteed unique; the code box disambiguates.
    const match = rows.find(
      (r) => (r.customer_name ?? '').toLowerCase() === trimmed,
    )
    onChange(match ? match.customer_code : null)
  }

  function clearDrafts() {
    setCodeDraft(null)
    setNameDraft(null)
  }

  const inputCls = clsx('input', invalid && 'input-error')
  const isDisabled = disabled || q.isLoading

  return (
    <div className={clsx('flex gap-2', className)}>
      <input
        type="text"
        inputMode="numeric"
        className={clsx(inputCls, 'flex-1 min-w-0')}
        placeholder="Code"
        list={codeListId}
        value={codeValue}
        disabled={isDisabled}
        onChange={(e) => onCodeChange(e.target.value)}
        onBlur={clearDrafts}
        aria-label="Customer code"
      />
      <input
        type="text"
        className={clsx(inputCls, 'flex-[3] min-w-0')}
        placeholder={q.isLoading ? 'Loading customers…' : 'Customer name'}
        list={nameListId}
        value={nameValue}
        disabled={isDisabled}
        onChange={(e) => onNameChange(e.target.value)}
        onBlur={clearDrafts}
        aria-label="Customer name"
      />
      <datalist id={codeListId}>
        {rows.map((r) => (
          <option key={r.customer_code} value={String(r.customer_code)}>
            {r.customer_name ?? '(unnamed)'}
          </option>
        ))}
      </datalist>
      <datalist id={nameListId}>
        {rows.map((r) => (
          <option key={r.customer_code} value={r.customer_name ?? ''}>
            code {r.customer_code}
          </option>
        ))}
      </datalist>
    </div>
  )
}

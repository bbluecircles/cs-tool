/**
 * Shared read-only value formatting.
 *
 * Used by ResourceTable's non-editable cells and by the CSV/XLSX export
 * builder, so what an agent sees on screen is what lands in the file.
 * The only difference is the empty placeholder: the table shows an em
 * dash to keep columns visually anchored, exports leave the cell blank
 * (a literal "—" in a spreadsheet is worse than nothing).
 */
export function formatReadonly(
  kind: string,
  value: unknown,
  emptyPlaceholder = '—',
): string {
  if (value === null || value === undefined || value === '') {
    return emptyPlaceholder
  }
  if (kind === 'datetime') return String(value).replace('T', ' ').slice(0, 16)
  if (kind === 'flag') return value === 1 || value === '1' ? 'Yes' : 'No'
  return String(value)
}

/**
 * Edit API client.
 *
 * Two calls per row edit: preview (dry-run, returns impact counts) and
 * apply (commits the change). The frontend renders the confirmation modal
 * off the preview response so CS agents see the exact impact before
 * hitting Confirm.
 */
import { api } from './client'

export type EditScope = 'user' | 'customer' | 'dataset'

export interface EditableColumnDescriptor {
  name: string
  scope: EditScope
  kind: 'int' | 'str' | 'bigint'
  nullable: boolean
  max_length: number | null
  min_value: number | null
  max_value: number | null
  allowed_values: unknown[] | null
}

export function listEditableColumns(): Promise<EditableColumnDescriptor[]> {
  return api.get<EditableColumnDescriptor[]>('/api/edit/columns')
}

export interface ChangeImpact {
  column: string
  scope: EditScope
  old_value: unknown
  new_value: unknown
  affected_row_count: number
}

export interface PreviewResponse {
  impacts: ChangeImpact[]
}

export interface ApplyResponse {
  impacts: ChangeImpact[]
  refresh_ok: boolean
  grants_ok: boolean
  refresh_error: string | null
  grants_error: string | null
}

export interface EditPayload {
  changes: Record<string, unknown>
}

export function previewChanges(
  userId: string,
  databaseName: string,
  customerCode: number,
  changes: Record<string, unknown>,
): Promise<PreviewResponse> {
  return api.post<PreviewResponse>(
    `/api/users/${encodeURIComponent(userId)}/${encodeURIComponent(
      databaseName,
    )}/preview?customer_code=${customerCode}`,
    { changes },
  )
}

export function applyChanges(
  userId: string,
  databaseName: string,
  customerCode: number,
  changes: Record<string, unknown>,
): Promise<ApplyResponse> {
  return api.patch<ApplyResponse>(
    `/api/users/${encodeURIComponent(userId)}/${encodeURIComponent(
      databaseName,
    )}?customer_code=${customerCode}`,
    { changes },
  )
}

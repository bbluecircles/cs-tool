/**
 * A minimal global signal for "there are unsaved edits somewhere."
 *
 * ResourcePage updates this whenever its dirty count changes; the topbar
 * reads it on logout click to decide whether to confirm. Keeps the
 * topbar from having to know anything about the users feature.
 *
 * Implementation: a module-level boolean plus a CustomEvent so anyone
 * who wants live updates can subscribe. Small, honest, no context needed.
 */

const EVENT = 'cs-tool:unsaved-change'

let _hasUnsaved = false

export function setHasUnsaved(v: boolean) {
  if (_hasUnsaved === v) return
  _hasUnsaved = v
  window.dispatchEvent(new CustomEvent(EVENT, { detail: v }))
}

export function hasUnsaved(): boolean {
  return _hasUnsaved
}

export function subscribeUnsaved(cb: (v: boolean) => void): () => void {
  const handler = (e: Event) => {
    cb((e as CustomEvent<boolean>).detail)
  }
  window.addEventListener(EVENT, handler)
  return () => window.removeEventListener(EVENT, handler)
}

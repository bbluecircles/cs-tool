import type { ReactNode } from 'react'
import { useEffect } from 'react'

interface ModalShellProps {
  onClose: () => void
  children: ReactNode
  /** Max-width Tailwind class, e.g. 'max-w-md', 'max-w-xl'. */
  width?: string
  /** If true, Escape and backdrop click are ignored. */
  locked?: boolean
}

export function ModalShell({
  onClose,
  children,
  width = 'max-w-xl',
  locked,
}: ModalShellProps) {
  useEffect(() => {
    if (locked) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, locked])

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-30 flex items-center justify-center bg-gray-900/40 p-4"
      onClick={locked ? undefined : onClose}
    >
      <div
        className={`card w-full ${width} p-6 shadow-modal max-h-[90vh] overflow-auto`}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  )
}

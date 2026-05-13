/**
 * Tab bar across the top of the resources view. URL-driven — the active
 * tab is the `slug` param on /resources/:slug.
 *
 * Clicking a tab is just a navigate() to the new slug. The ResourcePage
 * itself is keyed by slug so state (filters, dirty rows) resets cleanly
 * when switching tabs.
 */
import { NavLink, Navigate, useParams } from 'react-router-dom'
import clsx from 'clsx'

import { ALL_CONFIGS, configBySlug } from './resourceConfigs'
import { ResourcePage } from './ResourcePage'

export function ResourceTabs() {
  const { slug } = useParams<{ slug: string }>()
  const active = slug ? configBySlug(slug) : undefined

  if (!active) {
    // Default to the first tab.
    const first = ALL_CONFIGS[0]
    if (!first) return null // impossible in practice — ALL_CONFIGS is non-empty
    return <Navigate to={`/resources/${first.slug}`} replace />
  }

  return (
    <div className="space-y-4">
      <div className="border-b border-border flex gap-1 -mt-1">
        {ALL_CONFIGS.map((c) => (
          <NavLink
            key={c.slug}
            to={`/resources/${c.slug}`}
            className={({ isActive }) =>
              clsx(
                'px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
                isActive
                  ? 'border-secondary-500 text-secondary-700'
                  : 'border-transparent text-gray-500 hover:text-gray-800 hover:border-gray-300',
              )
            }
          >
            {c.shortLabel}
          </NavLink>
        ))}
      </div>

      {/* Keyed by slug so each tab gets a fresh ResourcePage instance. */}
      <ResourcePage key={active.slug} config={active} />
    </div>
  )
}

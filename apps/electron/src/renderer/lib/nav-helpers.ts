/**
 * Navigation helpers
 *
 * Small pure helpers over `NavigationState`. Keep these stateless and free of
 * React/Jotai imports — they're consumed both inside hooks (PanelStackContainer)
 * and in synchronous callbacks (CompactBackButton).
 */

import type { NavigationState } from '../../shared/types'
import { routes, type Route } from '../../shared/routes'

/**
 * Returns true when the focused panel's nav state is in "detail" mode —
 * i.e. the user has drilled past the navigator into a specific item.
 *
 * Used by compact-mode logic to flip the layout from navigator-only to
 * content-only with a back-button overlay.
 *
 * Per-navigator semantics:
 * - sessions: a session is selected
 * - settings: a subpage is selected (bare `settings` route → false)
 * - sources / skills / automations: a detail item is selected
 */
export function isDetailNavState(navState: NavigationState | null): boolean {
  if (!navState) return false
  switch (navState.navigator) {
    case 'sessions':
      return navState.details !== null
    case 'settings':
      return navState.subpage !== null
    case 'sources':
    case 'skills':
    case 'automations':
      return navState.details !== null
  }
}

export function getSourceRouteForNavigation(navState: NavigationState | null, sourceSlug?: string): Route {
  if (navState?.navigator === 'sources' && navState.filter) {
    if (navState.filter.kind === 'knowledgeBase') {
      return routes.view.sourcesKnowledgeBase(sourceSlug)
    }

    switch (navState.filter.sourceType) {
      case 'api':
        return routes.view.sourcesApi(sourceSlug)
      case 'mcp':
        return routes.view.sourcesMcp(sourceSlug)
      case 'local':
        return routes.view.sourcesLocal(sourceSlug)
    }
  }

  return routes.view.sources(sourceSlug ? { sourceSlug } : undefined)
}

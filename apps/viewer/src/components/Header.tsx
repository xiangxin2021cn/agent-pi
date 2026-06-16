/**
 * Header - App header with branding and controls
 */

import { Sun, Moon, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import agentPiLogo from '../assets/agent-pi-logo.jpeg'

/**
 * AgentPiLogo - The Agent π logo.
 */
function AgentPiLogo({ className }: { className?: string }) {
  return (
    <img
      src={agentPiLogo}
      alt="Agent π"
      className={className}
      draggable={false}
    />
  )
}

interface HeaderProps {
  hasSession: boolean
  sessionTitle?: string
  isDark: boolean
  onToggleTheme: () => void
  onClear: () => void
}

export function Header({ hasSession, sessionTitle, isDark, onToggleTheme, onClear }: HeaderProps) {
  const { t } = useTranslation()
  return (
    <header className="shrink-0 grid grid-cols-[auto_1fr_auto] items-center px-4 py-3">
      {/* Logo - links to project home */}
      <a
        href="https://github.com/xiangxin2021cn/agent-pi"
        className="hover:opacity-80 transition-opacity"
        title="Agent π"
      >
        <AgentPiLogo className="w-6 h-6 rounded-[6px] object-cover" />
      </a>

      {/* Session title - centered */}
      <div className="flex justify-center">
        {sessionTitle && (
          <span className="text-sm font-semibold text-foreground truncate max-w-md">
            {sessionTitle}
          </span>
        )}
      </div>

      <div className="flex items-center gap-2">
        {/* Clear button (when session is loaded) */}
        {hasSession && (
          <button
            onClick={onClear}
            className="p-1.5 rounded-md bg-background shadow-minimal text-foreground/40 hover:text-foreground/70 transition-colors"
            title={t('viewer.clearSession')}
          >
            <X className="w-4 h-4" />
          </button>
        )}

        {/* Theme toggle */}
        <button
          onClick={onToggleTheme}
          className="p-1.5 rounded-md bg-background shadow-minimal text-foreground/40 hover:text-foreground/70 transition-colors"
          title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </button>
      </div>
    </header>
  )
}

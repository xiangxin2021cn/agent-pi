import agentPiLogo from "@/assets/agent-pi-logo.jpeg"

interface CraftAgentsSymbolProps {
  className?: string
}

/**
 * Agent π app symbol.
 *
 * The export name is kept for compatibility with existing call sites.
 */
export function CraftAgentsSymbol({ className }: CraftAgentsSymbolProps) {
  return (
    <img
      src={agentPiLogo}
      alt="Agent π"
      className={className}
      draggable={false}
    />
  )
}

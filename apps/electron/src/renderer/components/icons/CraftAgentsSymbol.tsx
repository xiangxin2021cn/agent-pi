import agentPiSymbol from "@/assets/agent-pi-symbol.png"

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
      src={agentPiSymbol}
      alt="Agent π"
      className={className}
      draggable={false}
    />
  )
}

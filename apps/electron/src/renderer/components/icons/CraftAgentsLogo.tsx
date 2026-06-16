import agentPiLogo from "@/assets/agent-pi-logo.jpeg"

interface CraftAgentsLogoProps {
  className?: string
}

/**
 * Agent π logo.
 *
 * The export name is kept for compatibility with existing playground entries.
 */
export function CraftAgentsLogo({ className }: CraftAgentsLogoProps) {
  return (
    <img
      src={agentPiLogo}
      alt="Agent π"
      className={className}
      draggable={false}
    />
  )
}

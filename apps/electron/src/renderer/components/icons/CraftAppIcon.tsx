import agentPiLogo from "@/assets/agent-pi-logo.jpeg"

interface CraftAppIconProps {
  className?: string
  size?: number
}

/**
 * CraftAppIcon - Displays the Agent π app logo.
 */
export function CraftAppIcon({ className, size = 64 }: CraftAppIconProps) {
  return (
    <img
      src={agentPiLogo}
      alt="Agent π"
      width={size}
      height={size}
      className={className}
    />
  )
}

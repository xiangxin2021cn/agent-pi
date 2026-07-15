import * as React from 'react'
import { BusinessProjectListPanel } from './BusinessProjectListPanel'

interface DeliveryWorkspaceListPanelProps {
  workspaceRootPath?: string
  selectedProjectId?: string | null
  selectedSessionId?: string | null
  onProjectClick: (projectId: string) => void
  onSessionClick: (projectId: string, sessionId: string) => void
}

export function DeliveryWorkspaceListPanel(props: DeliveryWorkspaceListPanelProps) {
  return <BusinessProjectListPanel moduleId="delivery" {...props} />
}

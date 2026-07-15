import * as React from 'react'
import { BusinessProjectListPanel } from './BusinessProjectListPanel'

interface InvestmentWorkspaceListPanelProps {
  workspaceRootPath?: string
  selectedProjectId?: string | null
  selectedSessionId?: string | null
  onProjectClick: (projectId: string) => void
  onSessionClick: (projectId: string, sessionId: string) => void
}

export function InvestmentWorkspaceListPanel(props: InvestmentWorkspaceListPanelProps) {
  return <BusinessProjectListPanel moduleId="investment" {...props} />
}

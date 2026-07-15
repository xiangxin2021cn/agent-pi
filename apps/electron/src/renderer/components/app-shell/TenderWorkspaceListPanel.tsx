import * as React from 'react'
import { BusinessProjectListPanel } from './BusinessProjectListPanel'

interface TenderWorkspaceListPanelProps {
  workspaceRootPath?: string
  selectedProjectId?: string | null
  selectedSessionId?: string | null
  onProjectClick: (projectId: string) => void
  onSessionClick: (projectId: string, sessionId: string) => void
}

export function TenderWorkspaceListPanel(props: TenderWorkspaceListPanelProps) {
  return <BusinessProjectListPanel moduleId="tender" {...props} />
}

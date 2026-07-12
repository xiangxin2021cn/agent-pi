import * as React from 'react';
import { useEffect, useState } from 'react';
import { AlertTriangle, Landmark } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { InvestmentWorkspaceSummaryDto } from '@craft-agent/shared/protocol';

export function InvestmentWorkspaceListPanel({ workingDirectory, selectedProjectId, onProjectClick }: { workingDirectory?: string; selectedProjectId?: string | null; onProjectClick: (projectId: string) => void }) {
  const [projects, setProjects] = useState<InvestmentWorkspaceSummaryDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (!workingDirectory) { setProjects([]); return; }
    setError(null);
    void window.electronAPI.listInvestmentWorkspaces({ workingDirectory })
      .then((value) => { if (!cancelled) setProjects(value); })
      .catch((cause) => { if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause)); });
    return () => { cancelled = true; };
  }, [workingDirectory]);
  if (!workingDirectory) return <div className="p-4 text-sm text-muted-foreground">Select a conversation with a working directory.</div>;
  if (error) return <div className="flex gap-2 p-4 text-sm text-destructive"><AlertTriangle className="mt-0.5 size-4 shrink-0" />{error}</div>;
  if (projects.length === 0) return <div className="p-4 text-sm text-muted-foreground">No investment workspaces in this working directory.</div>;
  return <div className="space-y-1 p-2">{projects.map((project) => <button key={project.projectId} type="button" onClick={() => onProjectClick(project.projectId)} className={cn('flex w-full items-start gap-2 rounded px-2.5 py-2 text-left hover:bg-muted/60', selectedProjectId === project.projectId && 'bg-muted')}><Landmark className="mt-0.5 size-4 shrink-0 text-muted-foreground" /><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{project.title}</span><span className="block truncate text-xs text-muted-foreground">{project.stage} · rev {project.revision} · {project.readiness.replace('_', ' ')}</span></span></button>)}</div>;
}

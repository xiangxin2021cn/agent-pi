import * as React from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, FileJson, FolderOpen, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAppShellContext } from '@/context/AppShellContext';
import { cn } from '@/lib/utils';
import type { TenderWorkspaceBundleDto } from '@craft-agent/shared/protocol';
import { buildTenderWorkspaceViewModel, type TenderWorkspaceTabId } from './tender-workspace-view-model';

interface TenderWorkspacePageProps {
  workingDirectory: string;
  projectId: string;
}

export default function TenderWorkspacePage({ workingDirectory, projectId }: TenderWorkspacePageProps) {
  const { onOpenFile } = useAppShellContext();
  const [bundle, setBundle] = useState<TenderWorkspaceBundleDto | null>(null);
  const [activeTab, setActiveTab] = useState<TenderWorkspaceTabId>('sources');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setBundle(await window.electronAPI.getTenderWorkspace({ workingDirectory, projectId }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, [workingDirectory, projectId]);

  useEffect(() => { void load(); }, [load]);
  const view = useMemo(() => bundle ? buildTenderWorkspaceViewModel(bundle) : null, [bundle]);

  if (loading && !view) {
    return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Loading tender workspace...</div>;
  }
  if (error || !view) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-destructive">
        <AlertTriangle className="size-5" />
        <span>{error ?? 'Tender workspace is unavailable.'}</span>
        <Button variant="outline" size="sm" onClick={() => void load()}>Retry</Button>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <header className="flex items-center gap-3 border-b px-5 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-base font-semibold">{view.title}</h1>
            <ReadinessBadge readiness={view.readiness} stale={false} />
          </div>
          <p className="truncate text-xs text-muted-foreground">
            {view.projectId} · revision {view.revision} · {view.issueCount} issues
          </p>
        </div>
        <Button variant="ghost" size="icon" title="Open workspace model" onClick={() => onOpenFile(view.paths.modelPath)}>
          <FileJson className="size-4" />
        </Button>
        <Button variant="ghost" size="icon" title="Show project folder" onClick={() => void window.electronAPI.showInFolder(view.paths.projectDirectory)}>
          <FolderOpen className="size-4" />
        </Button>
        <Button variant="ghost" size="icon" title="Refresh" disabled={loading} onClick={() => void load()}>
          <RefreshCw className={cn('size-4', loading && 'animate-spin')} />
        </Button>
      </header>

      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as TenderWorkspaceTabId)} className="flex min-h-0 flex-1 flex-col">
        <div className="overflow-x-auto border-b px-4">
          <TabsList className="h-11 w-max justify-start bg-transparent p-0">
            {view.tabs.map((tab) => (
              <TabsTrigger key={tab.id} value={tab.id} className="h-11 rounded-none border-b-2 border-transparent px-3 data-[state=active]:border-primary data-[state=active]:bg-transparent">
                <span>{tab.label}</span>
                <span className="ml-1.5 text-xs text-muted-foreground">{tab.count}</span>
                {tab.stale && <AlertTriangle className="ml-1 size-3 text-amber-600" />}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        {view.tabs.map((tab) => (
          <TabsContent key={tab.id} value={tab.id} className="m-0 min-h-0 flex-1 overflow-auto p-4">
            <div className="mb-3 flex items-center gap-2 text-xs text-muted-foreground">
              <ReadinessBadge readiness={tab.readiness} stale={tab.stale} />
              <span>{tab.issueCount} issues</span>
            </div>
            <div className="overflow-hidden rounded-md border">
              <div className="grid grid-cols-[minmax(180px,1fr)_minmax(160px,0.7fr)_110px] border-b bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground">
                <span>Record</span><span>Context</span><span>Status</span>
              </div>
              {tab.rows.length === 0 ? (
                <div className="px-3 py-8 text-center text-sm text-muted-foreground">No records</div>
              ) : tab.rows.map((row) => (
                <div key={row.id} className="grid grid-cols-[minmax(180px,1fr)_minmax(160px,0.7fr)_110px] items-center border-b px-3 py-2.5 text-sm last:border-b-0">
                  <span className="truncate font-medium" title={row.title}>{row.title}</span>
                  <span className="truncate text-muted-foreground" title={row.subtitle}>{row.subtitle || '—'}</span>
                  <span className="truncate text-xs text-muted-foreground">{row.status || '—'}</span>
                </div>
              ))}
            </div>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}

function ReadinessBadge({ readiness, stale }: { readiness: string; stale: boolean }) {
  const ready = readiness === 'ready' && !stale;
  return (
    <span className={cn(
      'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium',
      ready ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' : 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
    )}>
      {ready ? <CheckCircle2 className="size-3" /> : <AlertTriangle className="size-3" />}
      {stale ? 'stale' : readiness.replace('_', ' ')}
    </span>
  );
}

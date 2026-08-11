# Tender Single Parent Session + Mutable stageId Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make each tender Business Project use one continuous parent conversation across all stages (mutable `businessContext.stageId`), while keeping child sessions for heavy parallel work (document PDF parse batches, BOQ chapter pricing).

**Architecture:** Project orchestration stores a single `parentSessionId`. Entering a stage never calls `openNewChat` when a project parent already exists — it updates `stageId`, rebinds the stage task-board to that parent, injects a stage handoff prompt into the same chat, and continues dispatch. Child spawns remain stage-scoped workers under the same parent. Capability write whitelist continues to gate packs by current `stageId`. Legacy projects that already have one parent per stage are migrated by electing one canonical parent and pointing all stage boards at it.

**Tech Stack:** TypeScript, Bun test, existing Electron RPC (`runTenderStage`, session metadata APIs), React Overview, file-backed orchestration under `.agent-pi/business/tender/<projectId>/`.

## Global Constraints

- **Keep child sessions** for document-analysis batches and BOQ pricing batches (proven necessary; main model skips steps under context pressure without them).
- Child agents still **must not** `spawn_session`.
- Parent session `workingDirectory` remains `project.rootPath` for the whole project life.
- Stage completion still gated by artifacts/packs (MD review, resource schedule, 4-A/B/C), not by “which chat exists”.
- `assertCapabilityWriteAllowed(stageId, capability)` remains hard on parent + children (children inherit `businessContext`).
- Default concurrency unchanged: doc analysis `2`, BOQ `1`, planning `1`; hard cap `3`.
- Commits only when the user asks.
- Respond to the user in 中文 for progress summaries.

## Locked product model

```
Project 573
├── Parent session (ONE, continuous memory)     ← 指挥台 / 项目记忆
│     businessContext.stageId  ← mutates: setup → analysis → pricing → planning
├── Child sessions (many, short-lived workers) ← PDF 解析页 / BOQ 章节
│     inherit businessContext; own Outputs/<childId>
└── Project SoR (shared folder)
      .agent-pi/business/tender/573/
        packs/, orchestration/, stage-state.json, project-orchestration.json
      Agent Pi Outputs/573/…   (project-level human artifacts; optional follow-up)
```

**Not in scope for this plan (follow-up):** moving Project Memory Lite off `sessions/{sessionId}` to pure project brain; rewriting child Outputs layout. Continuity is achieved first by **not creating new parents**.

## File Structure

| Path | Responsibility |
| --- | --- |
| `packages/server-core/src/tender-project-orchestration.ts` | Project-level `parentSessionId` + helpers: resolve/bind/elect |
| `packages/server-core/src/tender-project-orchestration.test.ts` | Persistence + election tests |
| `packages/server-core/src/tender-stage-run.ts` | On start/advance: prefer project parent; persist bind; expose `projectParentSessionId` |
| `packages/server-core/src/tender-stage-executor.ts` | Allow rebinding `parentSessionId` across stage boards to same parent |
| `packages/shared/src/sessions/storage.ts` | Allow `businessContext` in `updateSessionMetadata` |
| `packages/shared/src/protocol/dto.ts` | DTO: `projectParentSessionId`, optional `advanceStage` fields |
| `packages/server-core/src/handlers/rpc/sessions.ts` (or tender RPC) | RPC to update session `businessContext.stageId` + refresh agent tool context |
| `packages/shared/src/agent/pi-agent.ts` | Already refreshes `ctx.businessContext` per tool call — verify after metadata update |
| `apps/electron/src/renderer/pages/business-tender-stage.ts` | `resolveProjectParentSessionId`, `enterStageInProjectParent` helpers |
| `apps/electron/src/renderer/components/app-shell/BusinessProjectOverview.tsx` | Stop per-stage `openNewChat`;「进入阶段 / 下一阶段」reuse parent |
| `apps/electron/src/renderer/components/app-shell/BusinessProjectListPanel.tsx` / `BusinessProjectDialog.tsx` | Creating project opens **one** parent at `project-setup` only |
| `packages/session-tools-core/src/tender/capability-stage-guard.ts` | No logic change expected; document that stageId is mutable |
| `docs/superpowers/specs/2026-08-11-tender-single-parent-session.md` | Short locked decisions (optional if plan alone is enough) |
| `apps/electron/resources/release-notes/next.md` | User-facing bullet |

---

### Task 1: Project orchestration pointer (SoR for parent session)

**Files:**
- Create: `packages/server-core/src/tender-project-orchestration.ts`
- Create: `packages/server-core/src/tender-project-orchestration.test.ts`

**Interfaces:**

```ts
export interface TenderProjectOrchestration {
  schemaVersion: 1;
  projectId: string;
  parentSessionId?: string;
  updatedAt: string;
  /** Session ids that were demoted during migration (optional). */
  legacyParentSessionIds?: string[];
}

export function orchestrationPointerPath(projectDirectory: string): string;
export function readProjectOrchestration(projectDirectory: string, projectId: string): TenderProjectOrchestration;
export function writeProjectOrchestration(projectDirectory: string, value: TenderProjectOrchestration): void;
export function bindProjectParentSession(
  projectDirectory: string,
  projectId: string,
  parentSessionId: string,
): TenderProjectOrchestration;

/** Prefer existing pointer; else elect from stage task-boards / stage-state. */
export function resolveOrElectProjectParent(options: {
  projectDirectory: string;
  projectId: string;
  candidateSessionIds: string[]; // from boards + stage-state parentSessionIds
}): { parentSessionId?: string; elected: boolean; legacyParentSessionIds: string[] };
```

Election rule (deterministic):

1. If pointer exists and non-empty → use it.
2. Else collect unique `parentSessionId` from all `orchestration/task-boards/*.json` and any stage-state batchProgress fields.
3. Prefer the id that appears on the **latest running/complete** stage in order: `planning-and-submission` → `boq-five-step-pricing` → `tender-document-analysis` → `project-setup`.
4. Tie-break: lexicographically smallest id.
5. Write pointer; put other candidates into `legacyParentSessionIds`.

- [ ] **Step 1: Failing tests** for bind + elect with two legacy parents

```ts
test('elects analysis parent when no pointer', () => {
  // write task-boards for setup (none) + analysis (parent-a) + pricing (parent-b)
  const result = resolveOrElectProjectParent({ projectDirectory, projectId: '573', candidateSessionIds: ['parent-b', 'parent-a'] });
  // with stage boards: pricing board present → prefer parent-b if pricing is later stage
});
```

- [ ] **Step 2: Implement file + helpers**

- [ ] **Step 3: `bun test src/tender-project-orchestration.test.ts` PASS**

- [ ] **Step 4: Commit** (if requested)

---

### Task 2: Persist / mutate session `businessContext.stageId`

**Files:**
- Modify: `packages/shared/src/sessions/storage.ts` — add `businessContext` to `updateSessionMetadata` Pick + assignment
- Modify: `packages/shared/src/sessions/__tests__/business-context.test.ts` — update stageId round-trip
- Modify: `packages/server-core/src/handlers/rpc/sessions.ts` (or add tender-specific RPC in existing tender stage handler) — expose update path used by renderer
- Modify: `packages/shared/src/protocol/dto.ts` — request type if new IPC field needed

**Interfaces:**

```ts
// storage.ts — extend updates pick:
| 'businessContext'

export async function setSessionBusinessStage(
  workspaceRootPath: string,
  sessionId: string,
  stageId: string,
): Promise<SessionBusinessContext>
// loads session, requires businessContext.module === 'tender',
// sets businessContext = { ...prev, stageId: canonicalStageId(stageId) }, saves
```

IPC options (pick one, prefer minimal):

- **A (preferred):** extend `runTenderStage` request with `bindParentSessionId` + when action is `start|advance|resume` and stage changes, server calls `setSessionBusinessStage` if `parentSessionId` provided and session belongs to project.
- **B:** new RPC `sessions.updateBusinessContext`.

Also ensure managed session in `SessionManager` reloads `businessContext` after metadata save (or Overview sends a follow-up so next tool call sees new stage — `pi-agent` already assigns `ctx.businessContext = this.config.session?.businessContext` each tool call; **must refresh `managed.businessContext` / agent config** when metadata changes).

- [ ] **Step 1: Unit test** `updateSessionMetadata` persists new stageId

- [ ] **Step 2: Implement storage + SessionManager refresh hook**

- [ ] **Step 3: Wire through `runTenderStage` start/advance** so server is source of truth for stage mutation when binding parent

- [ ] **Step 4: Tests PASS**

---

### Task 3: Stage runner binds project parent (not per-stage parent)

**Files:**
- Modify: `packages/server-core/src/tender-stage-run.ts`
- Modify: `packages/server-core/src/tender-stage-executor.ts`
- Modify: `packages/shared/src/protocol/dto.ts` — `TenderStageRunResultDto.projectParentSessionId?: string`
- Modify: `packages/server-core/src/tender-stage-run.test.ts`

**Behavior changes:**

1. On `start|advance|resume` with `parentSessionId`:
   - `bindProjectParentSession(...)` if pointer empty or equals this id
   - If pointer exists and differs → **reject** with missing item `project-parent:mismatch:<expected>` unless `forceRebindParent: true` (migration only)
2. On `start` without `parentSessionId`:
   - If project pointer exists → use it as effective parent (do not require client to rediscover)
3. Every stage task-board writes the **same** `parentSessionId` from project pointer
4. Result always includes `projectParentSessionId` + per-stage `batchProgress.parentSessionId` (same value when bound)

`updateTenderStageTaskBoard`: when previous board had a different parent but project pointer is set, **rebind** board.parentSessionId to project parent (do not spawn under orphan parents).

- [ ] **Step 1: Failing test** — start analysis then start pricing with same parentSessionId → both boards share id; pointer file exists

- [ ] **Step 2: Implement**

- [ ] **Step 3: PASS**

---

### Task 4: Overview UI — never openNewChat per stage after project parent exists

**Files:**
- Modify: `apps/electron/src/renderer/pages/business-tender-stage.ts`
- Modify: `apps/electron/src/renderer/pages/business-tender-stage.test.ts`
- Modify: `apps/electron/src/renderer/components/app-shell/BusinessProjectOverview.tsx`
- Modify: `apps/electron/src/renderer/components/app-shell/BusinessProjectListPanel.tsx`
- Modify: `apps/electron/src/renderer/components/app-shell/BusinessProjectDialog.tsx`

**Helpers:**

```ts
export function resolveProjectParentSessionId(
  stageRuns: Record<string, TenderStageRunResultDto | undefined>,
): string | undefined {
  for (const run of Object.values(stageRuns)) {
    if (run?.projectParentSessionId) return run.projectParentSessionId
    // fallback: any stage batchProgress.parentSessionId
  }
  return undefined
}

export async function enterTenderStageInProjectParent(
  run: RunTenderStage,
  target: { workspaceRootPath: string; projectId: string; stageId: string },
  parentSessionId: string,
): Promise<{ ok: boolean; result: TenderStageRunResultDto }> {
  // start+advance with parentSessionId; server mutates stageId on that session
  ...
}
```

**Overview `handleStartStage` algorithm:**

```
if stage === project-setup → complete setup (existing)
else:
  parentId = resolveProjectParentSessionId(stageRuns)
            ?? resolveStageParentSessionId(stageRuns[stage.id])
  if parentId:
    openLinkedSession(parentId)
    enterTenderStageInProjectParent(..., parentId)
    // optionally sendComposerMessage with stage draft once (see Task 5)
    return
  // only first-ever parent for this project:
  openNewChat({ name: `${project.name}`, stageId: stage.id, ... })
  bind via startAndAdvance
```

Button copy:

- 「进入阶段」→ 「打开项目主会话」 when parent exists
- Add 「进入下一阶段」 on complete stage → calls enter for `workflow.stages[i+1]` **without** new chat

Project create (`BusinessProjectDialog` / list panel): open **one** chat named `${project.name}` at `project-setup` (or first real work stage after setup completes — prefer create at setup, then reuse for analysis).

- [ ] **Step 1: Unit tests** for `resolveProjectParentSessionId`

- [ ] **Step 2: UI wiring**

- [ ] **Step 3: Manual checklist note** in QA doc

---

### Task 5: Stage handoff prompt in the same chat (not a new session)

**Files:**
- Modify: `apps/electron/src/renderer/pages/business-module-launcher.ts` — `buildBusinessTaskDraft` already stage-aware; add `buildStageHandoffDraft(module, project, stage, previousResult?)`
- Modify: Overview — when reusing parent and stageId changes, send **one** user message with handoff draft (via existing `openNewChat` input only on first create; on reuse use session send API if available, else rely on agent reading updated stage tools + Overview toast instructing user)

**Handoff draft must state:**

- Current `stageId` and what packs/artifacts are required next
- Explicit: continue in this conversation; do not assume a fresh context wipe
- Child-spawn policy unchanged (runtime owns dispatch for batch stages)
- Paths to previous stage formal MD / packs under project directory

Prefer injecting via whatever path `openNewChat({ input })` uses today; for reuse, call the same send-message IPC the composer uses (locate in AppShellContext / SessionManager send). If send-from-Overview is too invasive, MVP: open parent + show toast「主会话已切换到本阶段；发送阶段说明」and put draft into clipboard / composer draft atom — but **target is auto-send one handoff message**.

- [ ] **Step 1: Implement `buildStageHandoffDraft`**

- [ ] **Step 2: Wire auto-send when stage changes on existing parent**

- [ ] **Step 3: Smoke test mentally + unit test draft contains stage id and “do not spawn freely”**

---

### Task 6: Migration / compatibility for existing projects

**Files:**
- Modify: `packages/server-core/src/tender-orchestration-migrate.ts` (or extend Task 1 elect)
- Modify: Overview banner (already has `migratedFromLegacy`) — extend copy for multi-parent
- Modify: `docs/superpowers/plans/2026-08-10-v2.5-tender-orchestration-qa-checklist.md` — add single-parent checks

**Migration behavior (lazy, on first `runTenderStage` status/start after upgrade):**

1. `resolveOrElectProjectParent` runs.
2. All task-boards rewritten to `parentSessionId = elected`.
3. Elected session’s `businessContext.stageId` set to the **current actionable stage** (first incomplete in workflow order).
4. `legacyParentSessionIds` recorded; Overview banner:

   > 已合并为单一项目主会话。旧阶段会话仍保留在侧栏（可只读回顾）；请在主会话继续。可用「重置编排」清理异常队列，已验收 MD 保留。

5. **Do not auto-delete/archive** legacy parents in v1 (user may still want history). Optional later: archive button.

6. Child sessions under legacy parents remain orphans for history; new dispatch only from elected parent.

Compatibility matrix:

| Old state | After upgrade |
| --- | --- |
| No boards / no parents | First「进入阶段」creates the one parent |
| One parent per stage | Elect one; rebind boards; banner |
| Pointer already present | Trust pointer |
| User opens old stage chat | Allowed read-only; dispatch buttons still target project parent |

- [ ] **Step 1: Tests** for elect + rebind boards

- [ ] **Step 2: Banner copy**

- [ ] **Step 3: QA checklist update**

---

### Task 7: Keep / clarify child-session policy (no regression)

**Files:**
- Modify: `.agents/skills/tender-document-parsing/SKILL.md`
- Modify: `.agents/skills/tender-boq-five-step-pricing/SKILL.md`
- Modify: stage dispatch prompts in `tender-stage-executor.ts` / batch briefs if they say “main session per stage”

**Must state explicitly:**

- Parent conversation is project-lifetime continuous.
- Children are required for large PDF parse units and BOQ chapter batches.
- Parent must not re-do child work after timeout (existing rule).
- Children inherit stageId; when parent stage advances, **in-flight children keep old stageId until finish** (acceptable); new spawns get updated inherited context from parent at spawn time — verify `SessionManager` spawn copies parent.businessContext **at spawn** (snapshot). Document this.

- [ ] **Step 1: Skill + prompt wording**

- [ ] **Step 2: Confirm spawn copies businessContext by reference vs snapshot — if live reference, freeze snapshot at spawn in SessionManager (small fix if needed)**

---

### Task 8: Release notes + package smoke

**Files:**
- Modify: `apps/electron/resources/release-notes/next.md`
- Run: `bun run electron:dist:dev:win` when user asks to retest

**Bullet (CN/EN style matching repo):**

- **Single project parent session** — Tender stages no longer open a new main chat; `stageId` moves on one continuous parent. Document/BOQ child agents unchanged for parallel heavy work. Legacy multi-parent projects elect one canonical parent on open.

- [ ] **Step 1: Notes**

- [ ] **Step 2: Targeted tests**

```bash
cd packages/server-core && bun test src/tender-project-orchestration.test.ts src/tender-stage-run.test.ts src/tender-orchestration-migrate.test.ts
cd packages/shared && bun test src/sessions/__tests__/business-context.test.ts
cd apps/electron && bun test src/renderer/pages/business-tender-stage.test.ts
```

- [ ] **Step 3: Windows package when user requests**

---

## Out of scope (explicit)

- Deleting child sessions or forcing serial-only PDF parse in the parent
- Merging all historical stage chats into one transcript
- Project-global brain path rewrite (can be Phase 2 once single parent ships)
- Changing V2.5 artifact gates (MD review, dual XML, resource schedule)

## Risk notes

| Risk | Mitigation |
| --- | --- |
| Long parent context | Handoff drafts + formal MD/packs as SoR; children keep heavy text out of parent |
| Stage whitelist stale in live agent | Refresh `managed.businessContext` on metadata update; pi-agent already re-reads per tool call |
| User keeps typing in legacy stage chat | Banner + Overview actions always bind elected parent |
| In-flight children during stage advance | Don’t advance while stage board has running tasks (UI disable「下一阶段」) |

## Self-review

1. **Spec coverage:** single parent ✅, mutable stageId ✅, keep children ✅, migration ✅, UI ✅, whitelist retained ✅  
2. **Placeholders:** none intentional  
3. **Types:** `TenderProjectOrchestration`, `resolveOrElectProjectParent`, `setSessionBusinessStage`, `projectParentSessionId` used consistently  

---

## Execution Handoff

Plan saved to `docs/superpowers/plans/2026-08-11-tender-single-parent-session.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks  
2. **Inline Execution** — this session implements with checkpoints  

Which approach?

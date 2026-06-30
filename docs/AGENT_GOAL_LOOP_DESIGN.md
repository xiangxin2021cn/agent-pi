# Agent Goal Loop Design

Status: design plus implementation slice with workspace defaults
Scope: Agent Pi session execution quality control

## Why This Exists

Current agent execution is mostly SDK-terminal-event driven. When Claude Agent SDK or Pi emits a terminal `complete` event, Agent Pi treats the turn as finished unless there is a queued user message or an error path. This is correct for chat streaming, but weak for real work tasks: the model can decide that it is done even when the requested deliverable is missing, shallow, unverified, or below the expected quality bar.

The product problem is not "the model needs a longer prompt". The root problem is that "task achieved" is not represented as an application-level state. It is currently inferred from the model's stop condition.

Codex-style goal behavior is useful here because it separates:

- model stop: the provider finished one turn
- task completion: the requested objective has been checked against success criteria
- continuation decision: the application decides whether to exit, retry, ask the user, or mark needs-review

## Current Code Evidence

The stable insertion point is the session layer, not the provider backends.

- `packages/shared/src/agent/base-agent.ts`
  - `BaseAgent.chat()` prepares skill/source/file mention context, then delegates to provider-specific `chatImpl()`.
  - It does not know whether a task outcome is acceptable.

- `packages/shared/src/agent/backend/claude/event-adapter.ts`
  - Claude SDK result messages are mapped into Agent Pi events.
  - `complete` is emitted from SDK result handling.

- `packages/shared/src/agent/backend/pi/event-adapter.ts`
  - Pi `agent_end` is mapped into Agent Pi `complete`.

- `packages/server-core/src/sessions/SessionManager.ts`
  - `sendMessage()` runs `for await (const event of agent.chat(...))`.
  - On `event.type === 'complete'`, it calls `onProcessingStopped(sessionId, 'complete')`.
  - `onProcessingStopped()` sends the final UI `complete` when `managed.messageQueue.length === 0`.

This means the correct control boundary is between "provider turn ended" and "UI session is complete".

## Product Principle

Agent Pi should not force every casual conversation through a heavy audit loop. The goal loop should apply to work tasks where completion quality matters:

- file generation or formal outputs
- code changes
- long-form writing
- document analysis
- data extraction or tabulation
- tasks with explicit requirements, constraints, or acceptance criteria

For normal chat, Q&A, brainstorming, or exploratory conversation, the default should stay lightweight.

## Proposed Modes

1. Off
   - Current behavior.
   - Provider `complete` ends the turn.

2. Check Only
   - After provider `complete`, Agent Pi runs a lightweight goal audit.
   - The app shows pass/fail/needs-review, but does not auto-run another turn.

3. Auto Improve
   - After provider `complete`, Agent Pi audits the result.
   - If the result fails and limits are not exceeded, Agent Pi starts an internal improvement turn.
   - The final UI `complete` is delayed until the audit passes or the loop stops with a clear reason.

4. Strict Work
   - Same as Auto Improve, but with stronger artifact and evidence checks.
   - Intended for code, enterprise documents, tenders, contracts, financial tables, and other high-certainty workflows.

## Goal State

Add an application-level goal state to the session. This should be persisted so the app can recover after crash/restart.

```ts
interface SessionGoalState {
  id: string
  objective: string
  mode: 'off' | 'check_only' | 'auto_improve' | 'strict_work'
  status: 'idle' | 'running' | 'auditing' | 'improving' | 'passed' | 'needs_review' | 'failed' | 'cancelled'
  createdAt: number
  updatedAt: number
  iteration: number
  maxIterations: number
  criteria: GoalCriterion[]
  auditHistory: GoalAuditResult[]
  budgets?: {
    maxExtraTurns?: number
    maxExtraInputTokens?: number
    maxExtraOutputTokens?: number
    maxWallClockMs?: number
  }
}

interface GoalCriterion {
  id: string
  text: string
  kind: 'deliverable' | 'evidence' | 'format' | 'test' | 'coverage' | 'user_constraint' | 'safety'
  required: boolean
}

interface GoalAuditResult {
  iteration: number
  status: 'pass' | 'fail' | 'uncertain'
  summary: string
  missingCriteria: string[]
  correctivePrompt?: string
  evidence: GoalAuditEvidence[]
  createdAt: number
}
```

## Event Model

Add provider-agnostic session events. These are app events, not Claude/Pi SDK events.

- `goal_started`
- `goal_audit_started`
- `goal_audit_result`
- `goal_retry_started`
- `goal_completed`
- `goal_needs_review`
- `goal_cancelled`

These events let the UI show a visible "Goal" card: objective, checklist, current iteration, pass/fail reasons, and what the agent is improving.

## Runtime Architecture

Introduce a `GoalController` owned by `SessionManager`.

Responsibilities:

1. Detect whether a user turn should create or continue a goal.
2. Build or update acceptance criteria.
3. Observe turn events and final assistant output.
4. Audit completion after provider `complete`.
5. Decide whether to emit final UI `complete`, continue internally, or stop with needs-review.

The provider backends should remain thin:

- ClaudeAgent continues to emit normalized `AgentEvent`.
- PiAgent continues to emit normalized `AgentEvent`.
- SessionManager remains the orchestration point.

Current implementation slice:

- `SessionGoalState` is persisted on session config/header metadata.
- `GoalController` runs deterministic turn audits after provider completion.
- `check_only` can mark the goal passed or needs-review.
- `auto_improve` and `strict_work` can return an internal `continue` decision when explicit required criteria are still unproven and iteration limits remain.
- `SessionManager.onProcessingStopped()` routes `continue` into a hidden goal continuation turn before emitting final UI `complete`.
- Real queued user messages still take priority over goal continuation.
- `SessionManager` can use the active session agent's mini completion as a bounded reviewer for explicit required criteria.
- The first real user message can conservatively initialize an `auto_improve` goal when it looks like a work task; casual chat, hidden sessions, and mini sessions are left alone.
- Goal criteria now extract clearly listed user requirements such as "must include", "output requirements", and "acceptance criteria" into separate required user-constraint checks.
- Workspace settings can set the default goal-loop strategy for newly auto-detected work sessions: off, check only, or auto improve.
- User-uploaded attachments and file paths surfaced by tool input or tool output are verified against the local filesystem during goal audit. Missing, unreadable, non-file, or empty file evidence fails the audit and can trigger an automatic improvement pass.
- Requests that explicitly ask to create, save, export, or convert an output file add a required file-output criterion; if the turn produces no verifiable file path evidence, the audit fails before any reviewer can mark it complete.
- Source/read file paths no longer satisfy requested output-file evidence; the audit requires a path from a writing, editing, export, conversion, or explicit output field.
- When a formal output directory is available, requested output files must be written under `outputFolderPath`; files written elsewhere fail the audit before reviewer approval.
- Output-specific fields such as `destination_path` and `target_path` are also verified on disk, so a reviewer cannot pass an export whose file was never created.
- Requests that name output formats such as PDF, Word, Excel, Markdown, CSV, HTML, JSON, TXT, or PowerPoint add an explicit format criterion; produced output paths must cover the requested extension family before reviewer approval.
- Verified text, spreadsheet, Office, and text-extractable PDF outputs include a bounded content preview in audit evidence when readable, so the reviewer can inspect the actual artifact instead of relying only on the final assistant message.
- Verified source attachments and non-output source files use `source_file_preview` evidence, so the reviewer can distinguish grounding material from the produced deliverable.
- When required evidence criteria explicitly ask to cite source material, and source file evidence is available, the final response or a verified output preview must include a source citation marker before reviewer approval.
- Clearly listed required user items must appear in the final response or a verified output preview before reviewer approval.
- The reviewer prompt explicitly requires checking verified artifact previews when present, not just the final assistant response.
- Consecutive audits with the same missing criteria stop in `needs_review` instead of burning the remaining retry budget on the same failure.
- Tool errors still block automatic completion unless a later successful run of the same tool resolves the failure within the same turn.
- Code or app change requests conservatively add a required tool-verification criterion, even when the user did not explicitly say to run tests.
- Requests that explicitly ask to run tests, typecheck, build, lint, or validation add a required tool-verification criterion; if no successful verification tool evidence is captured, the audit fails before reviewer approval.
- Comprehensive, detailed, or high-quality requests add a required coverage criterion so shallow outputs remain visible to the reviewer and auto-improvement loop.
- Comprehensive, detailed, or high-quality requests now require a minimally substantive final response or verified output preview before reviewer approval, blocking obvious one-line completion claims.
- Document work that is source-sensitive, attachment-driven, or explicitly high-quality now adds a document-quality criterion. The deterministic audit scores structure, evidence grounding, paragraph granularity, numeric claims, table/list structure, placeholders, visible gaps, and expert dimensions for structure/evidence/numbers/spec/risk before the reviewer can pass the turn.
- Document tasks now persist a Document Plan with title, audience, tone, length, sections, tables, charts, citations, delivery formats, and readability enhancements.
- Visual enhancements such as charts, embedded HTML blocks, flow diagrams, and visual summaries must be based on verified source data or explicit user input; if support data is missing, the agent should say the visualization is unsupported instead of inventing data.
- The session info panel parses `document_quality_report` evidence into a visible document expert report with final score and dimension scores.
- Hidden auto-improvement turns reuse the previous turn's processed attachments, and can restore persisted user attachments after reload, so document/file-based work keeps source context without adding fake user messages.
- The Goal badge popover surfaces the latest audit summary, missing criteria, and evidence count so users can see why a session is continuing or needs review without opening the full session info panel.

## Where To Hook

The most stable hook is inside `SessionManager.onProcessingStopped()`.

Current simplified behavior:

```ts
if (managed.messageQueue.length > 0) {
  this.processNextQueuedMessage(sessionId)
} else {
  this.sendEvent({ type: 'complete', sessionId, ... })
}
```

Proposed behavior:

```ts
if (managed.messageQueue.length > 0) {
  this.processNextQueuedMessage(sessionId)
  return
}

const goalDecision = await goalController.onTurnComplete(managed)

if (goalDecision.action === 'continue') {
  this.processInternalGoalRetry(sessionId, goalDecision.prompt)
  return
}

this.sendEvent({ type: 'complete', sessionId, ... })
```

This preserves current queue semantics and only changes the final no-queue exit path.

## Internal Retry Must Not Look Like User Input

Do not implement auto-improvement by calling `sendMessage()` with a fake visible user message such as "please continue improving". That would pollute conversation history and confuse users.

Preferred implementation:

1. Extract the shared "run one agent turn" logic out of `sendMessage()`.
2. Keep `sendMessage()` responsible for creating real user messages.
3. Add an internal goal retry path that calls the shared turn runner without creating a `role: user` message.
4. Persist a compact `role: info` or future `role: goal` message for transparency, but send the actual corrective instruction as internal control context.

The first implementation slice uses a dedicated hidden continuation runner in `SessionManager` rather than fully extracting the send path. It still keeps history honest: the corrective instruction is sent as internal control context, while the visible conversation receives only an `info` marker and the improved assistant output. A later refactor should merge the duplicated turn-running details back into a shared helper.

## Audit Strategy

The audit should be layered. Do cheap deterministic checks first, then use an LLM reviewer only when needed.

### Deterministic Checks

- Did the turn produce a final assistant message?
- Did any required output file actually get created?
- Did formal output land in `outputFolderPath` when requested?
- Did tool calls fail without a later corrective action?
- Did requested or code-change-required tests/build/typechecks run?
- Did referenced files exist?
- For markdown/doc/pdf output, is the file non-empty and readable?
- For code tasks, is `git diff --check` clean?

These checks are cheap and should not burn model tokens.

### LLM Review

Use `agent.runMiniCompletion()` or `agent.queryLlm()` with a structured JSON prompt to judge:

- whether all acceptance criteria are satisfied
- whether key constraints were ignored
- whether the answer is superficial or missing deliverables
- whether another improvement turn is likely useful

The reviewer should be allowed to return `uncertain`. In `uncertain`, default to `needs_review` in Check Only mode and a single cautious retry in Auto Improve mode.

### Artifact-Aware Review

For high-certainty document work, feed the reviewer a bounded evidence summary:

- final assistant response
- output file list
- relevant tool success/failure summary
- final artifact excerpts
- explicit source/evidence references when available

Do not feed entire large documents into every audit. This keeps token cost controlled.

## Corrective Prompt Shape

The retry prompt should be terse and operational:

```text
<system-reminder>
Goal audit failed after iteration 1.

Objective:
...

Missing required criteria:
1. ...
2. ...

Corrective action:
- Fix only the missing items.
- Re-open or verify affected files before claiming completion.
- Update or create the required formal output.
- Do not ask the user unless blocked by missing input or permission.
</system-reminder>
```

The corrective prompt should not introduce new scope. It should only move the current task toward the original goal.

## Stop Conditions

The loop must stop when any of these is true:

- audit passes
- user stops or sends a new message
- max iterations reached
- budget exceeded
- auth/permission/human input is required
- repeated same failure occurs twice
- reviewer returns low confidence and cannot produce a concrete corrective prompt
- provider/tool error makes further retry unsafe

When stopped without pass, show `needs_review` or `failed`, not `complete`.

## UI Behavior

Minimal UI:

- A compact Goal card above or near the active turn.
- Shows objective, mode, iteration, checklist, and audit status.
- User controls:
  - Turn goal loop off for this session
  - Run one more improvement
  - Accept as done
  - Edit acceptance criteria

Do not hide the loop. Users should understand why the agent keeps running.

## Settings

Recommended default:

- Normal chat: Off
- Work sessions: Check Only
- File/code/formal output tasks: Auto Improve, max 2 retries
- Strict Work: user opt-in or workspace preset

Workspace setting:

- `goalLoop.defaultMode`
- `goalLoop.maxIterations`
- `goalLoop.reviewerModel`
- `goalLoop.strictArtifactChecks`
- `goalLoop.requireOutputFolderForDeliverables`

Session override should be visible in the input toolbar or session info panel.

## Relationship To Existing Features

### update_plan

`update_plan` remains a progress display tool. It is not a completion gate.

Goal loop can use plan state as audit evidence, but it should not assume a completed checklist proves the actual deliverable is good.

### SubmitPlan

`SubmitPlan` remains an execution approval gate for safe/explore mode.

Goal loop starts after execution begins and checks whether the accepted task was actually completed.

### Prompt Optimizer

Prompt optimization can improve the first instruction, but it cannot guarantee completion.

Goal loop should consume optimized prompts as the objective seed, not replace the runtime audit.

### Artifact Registry

Goal loop becomes much stronger when paired with an artifact registry:

- file created
- file promoted
- file indexed
- file reviewed
- file exported
- file opened successfully

Until that exists, the first version can use output folder scans and event summaries.

## Phased Implementation

### Phase 1: Goal State And Passive Audit

- Add `SessionGoalState` types.
- Persist goal state in session header/config.
- Add session events for goal audit status.
- Add deterministic checks and structured reviewer.
- Do not auto-retry yet.

Current status: implemented as a guarded first slice. Goal state persistence, audit events, deterministic checks, bounded mini-model JSON review, reviewer timeout handling, and stale `auditing`/`improving` recovery are in place. The active-session UI now shows live goal phase and recent audit history through the goal badge and session info panel.

Success criteria:

- A task can finish with visible `passed`, `failed`, or `needs_review`.
- Existing sessions without goal state behave exactly as before.
- No provider backend behavior changes.

### Phase 2: Internal Retry Refactor

- Extract common "run one agent turn" logic from `sendMessage()`.
- Add internal goal retry path that does not create fake user messages.
- Preserve existing user message queue behavior.
- Add cancellation and new-user-message preemption.

Current status: mostly implemented without a broad send-path refactor. Hidden goal continuation exists and does not create fake user messages. Queue priority, stale continuation guards, and user-message preemption are covered. The send path is still shared in place rather than extracted into a separate turn runner.

Success criteria:

- Auto-retry can run one improvement turn without polluting user history.
- User stop cancels the loop.
- Queued real user messages still take priority.

### Phase 3: Auto Improve Mode

- Enable max 1 to 2 retries for work tasks.
- Add UI Goal card and controls.
- Add settings for mode and budget.
- Add audit events to session persistence.

Current status: implemented as a conservative default for work-like tasks. Work-like first user messages can initialize `auto_improve`; source-sensitive requests get evidence criteria; clearly listed output requirements are extracted as user-constraint criteria; follow-up work can add constraints and extend exhausted budgets. The input badge exposes `auto_improve`, `check_only`, and `off`, latest audit summary, missing criteria, evidence count, plus manual "run one more improvement", "accept as done", and goal criteria editing actions. The session info panel shows status and audit history. Workspace settings now expose the default strategy for newly auto-detected work sessions.

Success criteria:

- The app does not emit final `complete` until pass, needs-review, or stop condition.
- Infinite loops are impossible by construction.
- Token/cost overhead is visible.

### Phase 4: Artifact-Aware Strict Work

- Add artifact/file registry events.
- Let goal audits verify output files, exports, previews, tests, and citations.
- Add templates for code, long document writing, data extraction, and enterprise document analysis.

Current status: first deterministic file-evidence and document-quality verification is implemented with a lightweight project memory event feed. The audit now checks user-uploaded attachments and file paths already surfaced by tool input or tool output, flags missing, unreadable, non-file, empty, wrong-location, or wrong-format output files, verifies requested deliverables land under `outputFolderPath` when the session exposes one, feeds bounded previews of verified text, spreadsheet, readable Office, and text-extractable PDF outputs into reviewer evidence, labels non-output source previews separately from output artifact previews, blocks reviewer approval when explicit source-citation criteria have source evidence but neither the final response nor verified output previews include a citation marker, requires clearly listed user items to appear in the final response or verified output preview, requires successful tool evidence for explicit verification requests and conservative code/app change requests, rejects obvious one-line completion claims for comprehensive/high-quality work, applies a deterministic document-quality audit for source-sensitive or high-quality document tasks before reviewer approval, and persists a task contract that captures the original request, follow-up requests, deliverables, hard constraints, evidence requirements, output formats, acceptance criteria, forbidden shortcuts, working directory, and a Document Plan for document tasks. The Document Plan captures title, audience, tone, length, sections, tables, charts, citations, delivery formats, and readability enhancements; visual enhancements must be grounded in verified source data or explicit user input. Reviewer prompts and automatic improvement prompts treat that task contract as binding so later passes do not fix one small item while forgetting the original granularity. The implementation also surfaces the document-quality report in the session info panel as a compact document expert card, writes formal-output review reports beside generated outputs under `_reviews/*.review.md` when Project Memory Lite can link the audit to an output file, records `GoalAuditCompleted`, `FormalOutputCreated`, and user-promotion `ArtifactCreated` events under `.agent-pi/brain`, appends prompt-loadable project memory entries to `entries.jsonl`, and locks project-bound sessions to their selected `workingDirectory` so Goal Loop evidence and project memory do not drift across physical project folders. Full artifact registry state transitions, native Office/PPT/Excel generation engines, scanned/binary preview checks, and citation-level checks remain future work.

Success criteria:

- For file-producing tasks, missing/empty/wrong-location outputs are caught.
- For code tasks, missing tests or dirty failed checks are caught.
- For document tasks, key factual claims are tied to source or derived artifacts.

## First Implementation Target

The first shippable slice is now split into two layers:

1. Backend foundation: persisted goal state, deterministic audit, and hidden continuation without fake user messages.
2. Product surface: workspace/session setting, Goal card, deterministic checks plus mini-review JSON, and explicit controls.

The backend foundation and a compact product surface are now in place. The next shippable slice should deepen Project Memory Lite retrieval, richer artifact registry state transitions, scanned/binary preview checks, citation-level checks, and expert-review gates after outputs are produced.

## Main Risks

- Reviewer hallucination: mitigate with deterministic checks first and bounded evidence.
- Token cost: use cheap checks and cap audits.
- Infinite loop: hard iteration and repeated-failure limits.
- User confusion: make loop state visible.
- History pollution: do not implement retry as fake user messages.
- Provider differences: keep logic in SessionManager and normalized AgentEvent layer.

## Bottom Line

This is feasible and fits Agent Pi well. The key is not to copy Codex as a prompt style, but to copy the product-level control loop:

1. Explicit objective
2. Explicit criteria
3. Turn result observation
4. Completion audit
5. Controlled retry or visible needs-review
6. Only then final complete

That mechanism should live above Claude/Pi providers in `SessionManager`, with provider-neutral events and a visible UI state.

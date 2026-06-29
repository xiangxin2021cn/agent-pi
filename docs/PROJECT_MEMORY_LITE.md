# Project Memory Lite

Status: implemented v1 slice

Project Memory Lite is Agent Pi's lightweight project memory layer for document-heavy workspaces. It is deliberately not a full RAG system in the first slice. The goal is to give every selected working directory a stable, inspectable memory home that future indexing, review, and optional gbrain integration can build on.

Product definition: Project gbrain is not treated as a generic extension. It is Agent Pi's project-level long-term memory engine. It should gradually absorb trusted artifacts and review results from the same physical working directory, connect facts, outputs, gaps, and sources across conversations, and give new sessions in that directory a bounded memory of known facts, logic chains, key data, and unresolved risks.

## Directory Layout

When a session has a valid working directory, Agent Pi initializes:

```text
<working-directory>/.agent-pi/brain/
  sources/
  artifacts/
  outputs/
    reviews/
  gbrain/
  decisions.md
  entries.jsonl
  facts.jsonl
  citations.jsonl
```

Current behavior:

- The folder is created when a session is created with a working directory.
- The folder is also initialized when a fresh session changes working directory before its first message.
- After a session has conversation history, SDK state, or an active runtime, the working directory is locked to prevent cross-project memory pollution.
- Existing files are never overwritten.
- Initialization failure is logged but does not block the user from creating or running a session.
- The path is exposed to the agent as `projectBrainPath` in `<session_state>`.
- Workspace Settings > Advanced exposes an optional gbrain project-memory backend switch.
- gbrain can be configured as local PGLite or remote MCP, but it stays disabled by default.
- When enabled, Agent Pi creates or updates the workspace source `agent-pi-gbrain`:
  - local PGLite uses stdio MCP via `gbrain serve`;
  - remote MCP uses the configured HTTP MCP URL with bearer authentication.
- The `agent-pi-gbrain` source is not stored in workspace default sources. It is injected at session runtime only when the session has a selected `workingDirectory`.
- Each project-bound session receives a namespace derived from its physical working directory. Only sessions with the same `workingDirectory` should reuse the same project gbrain memory.
- When enabled, the selected gbrain backend and source slug are announced in `<workspace_capabilities>`.
- Goal audits are recorded as append-only JSONL under `artifacts/goal-audits.jsonl`.
- Artifact events are recorded under `artifacts/events.jsonl`, currently including `ArtifactCreated`, `FormalOutputCreated`, and `GoalAuditCompleted`.
- Trusted project memory entries are appended to `entries.jsonl`; new same-directory sessions load a bounded summary from this file into `<project_memory_context>`.
- Source evidence from Goal audits is indexed under `sources/sources.jsonl`.
- Output evidence from Goal audits is indexed under `outputs/outputs.jsonl`.
- Formal output document expert reports are written beside the output under `_reviews/*.review.md` and indexed under `outputs/reviews.jsonl`.
- User-promoted process files are recorded as formal outputs and project memory entries.
- Project memory entries are mirrored to `gbrain/project-memory-sync.jsonl` and `gbrain/project-memory-sync.md` with `gbrain/sync-manifest.json` so the project gbrain backend has a working-directory scoped, Markdown-friendly sync feed.
- When local PGLite gbrain is enabled, Agent Pi attempts a bounded `gbrain doctor --json` followed by `gbrain import <brain>/gbrain` using the project `GBRAIN_HOME`; if embedding import fails, it falls back to `gbrain import <brain>/gbrain --no-embed` so the project memory feed can still enter the project-local store. Failure is recorded in `sync-manifest.json` and does not block the user workflow.
- Workspace Settings can check the selected project's gbrain status and run a bounded local initialization for that working directory. If the `gbrain` command is missing, the UI reports it as unavailable instead of implying that advanced memory is active.
- Source-to-audit links are appended to `citations.jsonl`.
- Document quality scores from Goal audits are appended to `facts.jsonl`.

## Intended Use

Use this folder for compact, durable project memory:

- `sources/`: index notes for original materials such as tender PDFs, contracts, BOQ workbooks, drawings, standards, and source extracts.
- `artifacts/`: process outputs such as analysis notes, risk lists, comparison tables, and draft reviews.
- `outputs/`: pointers or compact metadata for formal deliverables saved under `Agent Pi Outputs`.
- `entries.jsonl`: compact project memory entries that are safe to load into future same-directory sessions.
- `decisions.md`: human-readable project decisions and assumptions.
- `facts.jsonl`: concise verified facts with source references.
- `citations.jsonl`: source-to-artifact citation records.

Do not use Project Memory Lite for bulky extraction payloads, temporary scratch files, or final deliverables. Scratch files still belong in `dataFolderPath`; formal deliverables still belong in `outputFolderPath`.

## Isolation Rule

Project Memory Lite and Project gbrain are project-local by default. Each physical working directory owns its own `.agent-pi/brain` folder and its own gbrain namespace, and a started session must not be retargeted to another project folder. Shared company or industry knowledge belongs in an explicitly enabled source, such as a curated folder source, API source, MCP source, or future company knowledge layer. It should not be silently merged into project-local memory.

## Current JSONL Records

The first writer is the Goal Loop audit bridge:

- `artifacts/goal-audits.jsonl`: one record per Goal audit, including status, summary, missing criteria, evidence, and document quality score when available.
- `artifacts/events.jsonl`: append-only artifact lifecycle events, currently `GoalAuditCompleted`, `FormalOutputCreated`, and user-promotion `ArtifactCreated`.
- `entries.jsonl`: prompt-loadable project memory entries derived only from trusted sources: formal outputs, user-promoted process artifacts, Goal audit summaries, source-backed output previews, and explicit unresolved gaps.
- `sources/sources.jsonl`: source file evidence observed during audits.
- `outputs/outputs.jsonl`: output file evidence observed during audits.
- `outputs/reviews.jsonl`: formal output review reports generated from document expert scores.
- `gbrain/project-memory-sync.jsonl`: append-only audit feed prepared for the Project gbrain backend.
- `gbrain/project-memory-sync.md`: Markdown-friendly project memory feed intended for gbrain-style import/sync flows.
- `gbrain/sync-manifest.json`: last prepared gbrain sync metadata.
- `citations.jsonl`: source-to-audit links so later review can trace where a judgement came from.
- `facts.jsonl`: compact derived facts, currently including document quality scores.

These records are append-only. A later artifact registry can add deduplication, status transitions, richer review state, and richer gbrain indexing. The current slice deliberately imports only compact trusted project-memory entries, not every scratch artifact.

## Product Direction

This is the v1.2 foundation for a project-aware document workbench:

1. Keep a visible, file-based memory skeleton that non-technical users can inspect.
2. Let Goal Loop and future document experts record quality findings, source gaps, and accepted decisions.
3. Record trusted artifact events before building any heavy RAG layer.
4. Keep gbrain-style graph memory as a project-level long-term memory engine, not a global shared memory bucket.

The next useful increment is not "vectorize everything". It is to extract compact, traceable facts, conclusions, and citations from real document workflows, then let later retrieval tools and Project gbrain use those records safely.

## Project gbrain Advanced Mode

The current gbrain slice uses the existing Source/MCP system:

- `projectMemory.gbrain.enabled`: whether the workspace opts into the advanced backend.
- `projectMemory.gbrain.backend`: `local_pglite` or `remote_mcp`.
- `projectMemory.gbrain.localDatabasePath`: optional base folder for project gbrain stores. Agent Pi appends the per-project namespace under this folder. If omitted, local gbrain uses `<workingDirectory>/.agent-pi/gbrain`.
- `projectMemory.gbrain.remoteMcpUrl`: required http(s) MCP endpoint when remote MCP mode is enabled.

This deliberately does not replace Project Memory Lite. The file-based `.agent-pi/brain` layer remains the visible source of truth and the safe fallback. Project gbrain is the advanced execution-time memory backend: it gives the agent a stronger project knowledge boundary before and during work, while Goal Loop and future expert review remain downstream quality gates after outputs are produced.

Runtime binding rules:

- Fresh project sessions automatically include `agent-pi-gbrain` when gbrain is enabled and a valid `workingDirectory` exists.
- Local stdio sessions receive `GBRAIN_HOME`, `GBRAIN_NAMESPACE`, `AGENT_PI_PROJECT_ROOT`, `AGENT_PI_PROJECT_BRAIN_PATH`, and `AGENT_PI_PROJECT_GBRAIN_PATH`.
- Remote MCP sessions receive project namespace headers and base64-encoded project paths, so the remote service can isolate memory without relying on global app state.
- Runtime prompts load recent same-directory `entries.jsonl` records into `<project_memory_context>` before source state, so new conversations can reuse established project knowledge without scanning temporary files.
- Local gbrain status and initialization are exposed in Workspace Settings. Initialization runs against the selected working directory project store, not a global shared memory.
- Local gbrain import is best-effort. If `gbrain` is not installed, not initialized, or import fails, the visible Project Memory Lite files remain the source of truth and the manifest records the failure reason.
- Cross-project reuse must be modeled as a separate company or industry knowledge source, not by sharing Project gbrain namespaces.

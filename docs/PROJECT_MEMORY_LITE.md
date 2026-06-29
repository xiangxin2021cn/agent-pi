# Project Memory Lite

Status: implemented v1.1 baseline

Project Memory Lite is Agent Pi's zero-config project memory layer for document-heavy workspaces. It is intentionally file-based, inspectable, and bound to the selected working directory. The goal is not to build a heavy RAG system in v1.1; the goal is to make prior verified outputs, source evidence, document review results, and unresolved gaps available to later same-project sessions without asking users to configure extra services.

## Directory Layout

When a session has a valid working directory, Agent Pi initializes:

```text
<working-directory>/.agent-pi/brain/
  sources/
  artifacts/
  outputs/
    reviews/
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
- Goal audits are recorded as append-only JSONL under `artifacts/goal-audits.jsonl`.
- Artifact events are recorded under `artifacts/events.jsonl`, currently including `ArtifactCreated`, `FormalOutputCreated`, and `GoalAuditCompleted`.
- Trusted project memory entries are appended to `entries.jsonl`; new same-directory sessions load a bounded summary from this file into `<project_memory_context>`.
- Source evidence from Goal audits is indexed under `sources/sources.jsonl`.
- Output evidence from Goal audits is indexed under `outputs/outputs.jsonl`.
- Formal output document expert reports are written beside the output under `_reviews/*.review.md` and indexed under `outputs/reviews.jsonl`.
- User-promoted process files are recorded as formal outputs and project memory entries.
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

Project Memory Lite is project-local by default. Each physical working directory owns its own `.agent-pi/brain` folder, and a started session must not be retargeted to another project folder. Shared company or industry knowledge belongs in an explicitly enabled source, such as a curated folder source, API source, MCP source, or future company knowledge layer. It should not be silently merged into project-local memory.

## Current JSONL Records

The first writer is the Goal Loop audit bridge:

- `artifacts/goal-audits.jsonl`: one record per Goal audit, including status, summary, missing criteria, evidence, and document quality score when available.
- `artifacts/events.jsonl`: append-only artifact lifecycle events, currently `GoalAuditCompleted`, `FormalOutputCreated`, and user-promotion `ArtifactCreated`.
- `entries.jsonl`: prompt-loadable project memory entries derived only from trusted sources: formal outputs, user-promoted process artifacts, Goal audit summaries, source-backed output previews, and explicit unresolved gaps.
- `sources/sources.jsonl`: source file evidence observed during audits.
- `outputs/outputs.jsonl`: output file evidence observed during audits.
- `outputs/reviews.jsonl`: formal output review reports generated from document expert scores.
- `citations.jsonl`: source-to-audit links so later review can trace where a judgement came from.
- `facts.jsonl`: compact derived facts, currently including document quality scores.

These records are append-only. A later artifact registry can add deduplication, status transitions, richer review state, and stronger retrieval. The current slice deliberately stores only compact trusted project-memory entries, not every scratch artifact.

## Product Direction

This is the v1.1 foundation for a project-aware document workbench:

1. Keep a visible, file-based memory skeleton that non-technical users can inspect.
2. Let Goal Loop and future document experts record quality findings, source gaps, and accepted decisions.
3. Record trusted artifact events before building any heavier retrieval layer.
4. Keep project-local memory isolated unless the user explicitly enables a separate company or industry knowledge source.

The next useful increment is not "vectorize everything". It is to extract compact, traceable facts, conclusions, and citations from real document workflows, then use those records safely in future same-directory sessions.

---
name: tender-document-parsing
description: Parse each registered tender source into a professional, industry-jargon Markdown working memo for estimators; runtime merges document_analysis and boq_reconciliation. Soft gates — missing MD soft-blocks; human review is advisory.
---

# Tender Document Parsing

Use this skill for stage **招标文件解析** (`tender-document-analysis`). The first-class deliverable is a **professional tender reading note** per registered file — not a file catalog or path dump. Structured packs are merged by the runtime after batch reports pass.

## Guardrails

- The **project parent session is continuous** across all tender stages (`businessContext.stageId` mutates on that one chat). Do not open or assume a new main session per stage.
- Large PDF parse units **require child sessions**. The stage controller owns dispatch; the parent must not re-parse unfinished batches or rewrite child reports after timeout.
- Analyze only registered Tender Workspace sources. Do not scan the working directory as a corpus.
- Default max concurrency is **4**. The **parent session** dispatches via `spawn_session` using task-board brief/report paths; workbench 「下一步」 fills slots / resumes. Do not flood beyond concurrency.
- Child agents must **not** call `spawn_session`.
- Each child writes **both** the structured JSON handoff (`reportPath`) and the customer-facing Markdown (`markdownPath`). Readable MD is the first-class deliverable — **never** ask the parent to author per-document MD.
- Honor `brief.projectIndustry` and `brief.documentRole` (and the professional `objective`) — write in sector jargon for that role.
- `tender_workspace` document registration is owned by the stage source-boundary sync; do not re-`upsert_documents` unless the user is still in project-setup.
- Children inherit `businessContext` as a **spawn-time snapshot**; in-flight children may keep the old `stageId` until they finish — that is expected.
- Write **one Markdown file per registered document** at `brief.markdownPath` (project-scoped Official Outputs tree).
- Soft gate: missing or empty MD keeps the batch incomplete. Human accept/reject of MD is **advisory** and must not block stage completion.
- `evaluation_strategy` is **optional** and must not block this stage.
- Do **not** write `project_boundary`, `boq_five_step_pricing`, `construction_resource_schedule`, planning, or submission capability packs in this stage (stage tool whitelist will reject skip-ahead writes).
- **Writing:** Follow tender-intelligence-core `references/writing-contract.md`. Every customer-facing Markdown and stage summary in this stage must be tender-grounded professional bid writing with AI filler stripped.

## Professional Markdown (required body)

Write like an estimator / technical / commercial tender memo:

1. **One-line header** — source filename only (at most once). Do not center the report on `documentId`, absolute paths, `Agent Pi Outputs`, Working Folder, or “analysis scope” boilerplate.
2. **Bid-relevant summary** — what this document decides for price, method, programme, or compliance.
3. **Hard constraints** — mandatory requirements that bind the bid (use industry jargon from `projectIndustry` / `documentRole`).
4. **Implications for pricing / method / programme** — what the next stages must carry forward.
5. **Risks, gaps, clarifications needed** — open questions for the employer or internal assumptions.
6. **Useful locators only** — page / clause / sheet when they help a human verify; empty sourceRefs are accepted in JSON.

**Voice:** write as this tender's estimator using the source's own terms. Strip AI filler (Furthermore, 综上所述, 值得注意的是, leverage, robust, key takeaways).

**Anti-patterns (reject in your own draft):** long lists of paths; repeating `documentId`/`batchId`/`reportPath`; tutorial prose about packs or knowledge folders; generic “this file contains…” catalogs without bid consequences; chatbot recaps or textbook method essays that this document does not support.

## Workflow

1. Confirm registered sources via `tender_workspace` status and the stage task board / batch briefs.
2. For each assigned document **in the child session**, write:
   - Structured sections JSON → `brief.reportPath`
   - Professional MD → `brief.markdownPath` (body per section above)
3. Batch completion requires both artifacts; missing MD keeps the batch `invalid`. Parent must not regenerate child MD.
4. When every batch report is complete, prefer letting stage status/resume drive the deterministic `document_analysis` merge. Never hand-compress packs into the tool call.

## Completion

Report: documents covered, MD paths written, batch status, whether `document_analysis` / `boq_reconciliation` packs exist, and any optional `evaluation_strategy` notes. Do not claim the stage is complete until soft gates (usable MD + merge) pass.

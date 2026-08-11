---
name: tender-document-parsing
description: Parse each registered tender source into a human-readable Markdown analysis file, then let the runtime merge structured document_analysis and boq_reconciliation packs. Human review of each MD is required; evaluation_strategy is optional.
---

# Tender Document Parsing

Use this skill for stage **招标文件解析** (`tender-document-analysis`). The first-class deliverable is a per-file Markdown parse that a human can accept; structured packs are merged by the runtime after all batch reports pass.

## Guardrails

- The **project parent session is continuous** across all tender stages (`businessContext.stageId` mutates on that one chat). Do not open or assume a new main session per stage.
- Large PDF parse units **require child sessions**. The stage controller owns dispatch; the parent must not re-parse unfinished batches or rewrite child reports after timeout.
- Analyze only registered Tender Workspace sources. Do not scan the working directory as a corpus.
- Default max concurrency is **4**. The **parent session** dispatches via `spawn_session` using task-board brief/report paths; workbench 「下一步」 fills slots / resumes. Do not flood beyond concurrency.
- Child agents must **not** call `spawn_session`.
- Each child writes **both** the structured JSON handoff (`reportPath`) and the customer-facing Markdown (`markdownPath`). Readable MD is the first-class deliverable — **never** ask the parent to author per-document MD.
- `tender_workspace` document registration is owned by the stage source-boundary sync; do not re-`upsert_documents` unless the user is still in project-setup.
- Children inherit `businessContext` as a **spawn-time snapshot**; in-flight children may keep the old `stageId` until they finish — that is expected.
- Write **one Markdown file per registered document** under  
  `Agent Pi Outputs/<projectId>/document-analysis/<documentId>__<safe-name>.md`.
- Stage completion requires **human acceptance** of each MD (`document-review` ledger). Missing or pending MD blocks completion.
- `evaluation_strategy` is **optional** and must not block this stage.
- Do **not** write `boq_five_step_pricing`, `construction_resource_schedule`, planning, or submission capability packs in this stage (stage tool whitelist will reject skip-ahead writes).

## Workflow

1. Confirm registered sources via `tender_workspace` status and the stage task board / batch briefs.
2. For each assigned document **in the child session**, write:
   - Structured sections JSON → `brief.reportPath`
   - Customer-facing MD → `brief.markdownPath` covering identity, one-page summary, hard constraints, cross-references, risks/gaps, and source locators (page/clause where known)
3. Batch completion requires both artifacts; missing MD keeps the batch `invalid`. Parent must not regenerate child MD.
4. Pause for the user to mark each MD accepted in the workbench before treating the document as done.
5. When every batch report is accepted, call `tender_capability` `init`/`replace` for `document_analysis` **with no inline data** if the runtime merge path expects it — prefer letting stage status/resume drive the deterministic merge. Never hand-compress packs into the tool call.

## Completion

Report: documents covered, MD paths awaiting or accepted for human review, batch status, whether `document_analysis` / `boq_reconciliation` packs exist, and any optional `evaluation_strategy` notes. Do not claim the stage is complete until human review gates pass.

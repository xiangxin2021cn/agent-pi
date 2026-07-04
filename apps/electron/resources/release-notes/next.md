# Pending Release Notes

This file accumulates release notes for the next unreleased version. PRs that add user-visible behavior should append a bullet to the relevant section here. Versioned files (`X.Y.Z.md`) are owned by the release skill — never create them in feature commits.

## Features

- V1.3 document workflow foundation: task contracts now classify work into Quick, Professional Document, Strict Delivery, and Multi-Agent Deep modes, pass the mode into agent context, show the active mode in document-plan status chips, and route strict/deep document work through dedicated quality reviewers.
- Strict Delivery mode now activates deterministic document gates from the task contract itself, including requested export formats, document quality, professional visuals, and strict template fidelity when those requirements are present.
- Chat input now includes an explicit document workflow mode selector for the next message, allowing users to force Quick, Professional Document, Strict Delivery, or Multi-Agent Deep behavior instead of relying only on automatic classification.
- Multi-Agent Deep mode now creates a chapter-agent collaboration plan in the task contract, including chapter assignments, review stages, final synthesis ownership, and guardrails that prevent concurrent writes to the final deliverable.
- Multi-Agent Deep task context now instructs agents to use `spawn_session` when available for chapter-agent assignments, keep spawned sessions on handoff notes only, and inherit the current working directory unless an override is required.
- Multi-Agent Deep mode now adds deterministic Goal Loop audit evidence for chapter-agent handoffs, source-gap notes, cross-chapter consistency review, and final synthesis ownership.
- Multi-Agent Deep task context now includes an execution protocol that tells the agent to use chapter-agent assignments as the work breakdown, record handoff/source-gap notes, resolve cross-chapter conflicts, and let the final synthesis owner write the final artifact.
- Professional document contracts now include a structured evidence matrix for user-provided files or pending source evidence, and this matrix is injected into agent context for source-backed claims, tables, visuals, and gaps.
- Professional document task context now includes the planned sections, tables, charts, citation notes, enhancements, and delivery formats, making the chapter plan visible to the executing agent instead of only to UI review metadata.
- Professional Document mode now adds deterministic Goal Loop evidence-matrix auditing, so a document with matrix sources cannot be accepted if it contains no citations, matrix source references, or pending-evidence notes.
- Evidence-matrix auditing now requires claim-level citation context near a source reference; a bare filename list no longer counts as source coverage.
- Evidence-matrix auditing now checks every matrix source, requiring each source to be cited or marked with a source-specific pending-evidence note.
- Evidence-matrix audit failures are now classified as evidence gaps, which makes automatic improvement prompts ask the agent to locate sources, citations, or pending-evidence notes instead of treating the report as merely shallow.
- Professional Document and Strict Delivery task contexts now include mode-specific execution protocols for evidence planning, section/table/visual planning, quality review, gate evidence, and export verification.
- Construction Gantt visual plans now preserve requested A3 landscape page intent, and visual audits fail when rendered schedule visuals omit that A3 landscape metadata or caption intent.
- Knowledge Base ingestion now writes a global Markdown index of local file-memory sources so agents and users can inspect available categories, indexed files, original file provenance, and source slugs without opening each MCP one by one.
- The chat data-source picker now includes a Load Knowledge Base flow that groups knowledge sources by folder and supports selective loading or select-all loading into the current session.
- Explicit document quality modes now raise the Goal Loop review budget: Professional Document mode gets the extended document budget, while Strict Delivery and Multi-Agent Deep modes use the highest bounded improvement budget.
- Explicit Quick mode now stays lightweight even on high-friction document prompts: it keeps the conservative Goal Loop budget and does not attach document-quality, visual-block, or template-fidelity audit gates unless another explicit instruction requires a higher loop.
- Explicit Quick mode no longer turns ordinary chat messages into Goal Loop work items or casual follow-ups; higher document modes still intentionally force document workflow setup.
- The session info popover now surfaces document review details from the active document plan, including evidence sources, visual audits, template audit state, export formats, and chapter-agent assignments.
- Strict Delivery contracts now include a structured delivery review plan with explicit source, template, export, visual, and formatting gates; failed gates are recorded as Goal Loop missing criteria, audit evidence, and session-info review details.
- Strict Delivery source gates now fail when the produced document has no citations, source notes, or pending-evidence markers, preventing unauditable formal reports from being accepted.
- Strict Delivery formatting gates now fail unless the result documents rendered preview, exported-file inspection, manual review, or equivalent formatting-review evidence.
- Strict Delivery formatting gates no longer treat deferred or negative notes such as "not yet reviewed" as valid formatting-review evidence.

## Improvements

- Professional Document, Strict Delivery, and Multi-Agent Deep task contexts now include a bounded critical-reasoning protocol for deeper decomposition, opposing-case review, third-party challenge, and risk-qualified conclusions without forcing Quick mode into a rigid answer format.
- The left-sidebar Agent Pi brand mark now uses the updated transparent logo asset, crops only transparent padding, and displays at a smaller 60% scale so the full mark and subtitle remain visible.
- Knowledge Base sources now group indexed file-memory entries into collapsible folders and expose a "View knowledge base file" action that reuses the standard file preview, edit, and export workflow.

## Bug Fixes

- File and folder attachment pickers no longer expire after the default 60-second RPC handler window; user-driven native dialogs can remain open until the user selects or cancels.
- File attachments now use a single `All Files (*.*)` native picker filter so Windows does not reopen on an image-only filter and hide ordinary documents.
- Explicit Professional Document, Strict Delivery, and Multi-Agent Deep selections now keep their intended auto-improvement loop even when the workspace default is set to check-only review.
- Selecting a Knowledge Base source now stays inside the Knowledge Base source filter instead of falling back to the full Data Sources list.

## Breaking Changes

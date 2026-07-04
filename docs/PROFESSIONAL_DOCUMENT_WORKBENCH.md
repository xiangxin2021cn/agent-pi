# Professional Document Workbench Roadmap

Agent Pi should evolve from a general agent chat shell into a professional document production workbench. The key shift is from "the model writes text" to "the system produces auditable deliverables".

## Current v1.1.2 Scope

v1.1.2 implements the foundation:

- Task Contract persists the user's original request, follow-up requests, deliverables, hard requirements, evidence rules, output formats, acceptance criteria, forbidden shortcuts, and working directory.
- Document Plan is attached to document tasks and captures title, audience, tone, length, sections, tables, charts, citations, delivery formats, and readability enhancements.
- Goal Loop reviewer and improvement prompts treat the Task Contract and Document Plan as binding constraints.
- Visual enhancements are allowed only when grounded in verified source data or explicit user input. Unsupported chart, HTML, diagram, or visual-summary requests must be marked as unsupported instead of invented.

This release does not yet include a native Word, PowerPoint, or Excel generation engine. Markdown preview/export remains the current production path.

## Product Direction

The next direction is to make formal documents first-class artifacts:

1. Build a Document Plan before long document execution.
2. Let users provide `.docx` or `.pptx` files as style references.
3. Generate native `.docx` instead of relying mainly on Markdown conversion.
4. Generate charts from structured specs such as `chart.json`.
5. Generate Excel workbooks from structured workbook specs.
6. Upgrade Goal Loop from task completion review into deliverable review.
7. Package strong workflows as reusable skills.

## Agent Pi Document Workflow Modes

Agent Pi should not directly copy the upstream programming-oriented Superpowers workflow. The useful part is the discipline: explicit contracts, evidence before claims, planned execution, independent review, and verification before delivery. The product should express those ideas as Agent Pi's own document workflow modes.

| Mode | User intent | System behavior | Acceptance gate |
| --- | --- | --- | --- |
| Quick Mode | Keep the current low-friction flow for ordinary chat, small edits, and exploratory drafting. | Use the existing execution path with minimal interruption. Create stronger contracts only when the task or user request clearly requires them. | Normal completion rules. Do not block delivery for optional evidence or template checks. |
| Professional Document Mode | Produce a serious report, proposal, review memo, research note, or project document. | Automatically create a document contract, evidence matrix, chapter plan, and document-quality audit. Require source notes for key claims, tables, and visuals. | The document can complete when required sections, cited evidence, output files, and basic formatting checks pass. |
| Strict Delivery Mode | Treat the output as a formal deliverable that must be ready for review or external use. | Enforce source, template, export, chart/figure, and format audits. Failed checks should move the session to review or trigger automatic improvement instead of silently accepting weak output. | Must pass mandatory source integrity, template fidelity, export-file existence, visual evidence, and format checks. |
| Multi-Agent Deep Mode | Handle large tenders, engineering reports, investment reports, due diligence, and other complex work products. | Split work by chapter, discipline, evidence set, or review role. Use sub-agents for parallel drafting and specialist review, while a lead synthesizer controls final structure and file writes. | Completion requires chapter-level evidence coverage, cross-chapter consistency, role-review resolution, and final export verification. |

### Mode Selection Rules

- Quick Mode remains the default for simple tasks to avoid disturbing the current user experience.
- Professional Document Mode should auto-enable for long-form document generation, formal Markdown/PDF/DOCX deliverables, research reports, proposal writing, and tasks with explicit sources or references.
- Strict Delivery Mode should auto-suggest when the user uploads a template, asks to keep exact layout/style, requests final delivery files, or requires auditable sources, charts, or formatting.
- Multi-Agent Deep Mode should auto-suggest for large working directories, multi-chapter tenders, engineering/cost/planning tasks, investment or due diligence reports, and workflows that naturally split by discipline.

### Execution Framework

Each higher-quality mode should add only the minimum necessary structure:

1. Document Contract: user goal, deliverables, audience, required output formats, hard constraints, template requirements, and forbidden shortcuts.
2. Evidence Matrix: source file or external reference, claim supported, reliability note, citation fields, and reuse status.
3. Chapter Plan: outline, target depth, expected tables/figures, source coverage, and assigned agent or role when multi-agent work is enabled.
4. Quality Audit: structure, evidence, numbers, source citations, visuals, template fidelity, export files, and unresolved risks.
5. Improvement Loop: only retry when a required gate fails; otherwise leave the result editable and avoid unnecessary additional rounds.

### V1.3 Implementation Slice

The V1.3 foundation adds these code-level behaviors:

- Explicit document workflow modes can be selected before sending a message, while automatic classification remains available.
- Task Contracts carry the selected mode into agent context so review and improvement prompts can see the quality level.
- Professional Document and Strict Delivery task contexts include concrete execution protocols for evidence planning, section/table/visual planning, quality review, gate evidence, and export verification.
- Professional document task context now exposes the planned sections, tables, charts, citations, enhancements, and delivery formats to the executing agent, so the chapter plan is part of the work contract rather than only review metadata.
- Professional and stricter document modes create a structured evidence matrix from referenced files or pending source needs, then pass it into agent context for citations, source-backed tables, visuals, and gap tracking.
- Professional Document mode now audits evidence-matrix usage: when a matrix exists, the final artifact must cite a matrix source, cite source evidence, or explicitly mark evidence gaps as pending before Goal Loop can accept it.
- Strict Delivery mode creates deterministic gates for source, template, export, visual, and format review when the task contract requires them.
- Multi-Agent Deep mode creates a chapter-agent collaboration plan with chapter assignments, review stages, final synthesis ownership, and guardrails that prevent multiple agents from writing the final deliverable concurrently.
- Multi-Agent Deep mode now has deterministic Goal Loop audit evidence for chapter-agent handoff notes, source gaps/unresolved assumptions, cross-chapter consistency review, and final synthesis ownership.
- Multi-Agent Deep task context now includes a concrete execution protocol: split work by chapter-agent assignments, record handoff and source-gap notes, run cross-chapter conflict review, then let the final synthesis owner produce the formal artifact.
- The session document-plan status panel shows the active quality mode and chapter-agent chip when multi-agent assignments exist.
- The session info popover shows document review details from the active plan, including evidence matrix sources, visual audit kinds, template audit state, export formats, and chapter-agent assignments.
- Strict Delivery mode now carries a structured delivery review plan so source integrity, template fidelity, export files, visual evidence, and final formatting gates are explicit contract data rather than only reviewer prompt text.
- Goal Loop maps failed strict-delivery gates into deterministic missing criteria and `delivery_review_gate` audit evidence, so the improvement prompt can target the exact failed gate instead of giving only a generic quality warning.
- The source-integrity gate fails if a strict-delivery document has no citation marker, source note, or pending-evidence marker. Formal reports must either cite evidence or explicitly mark unresolved evidence gaps.

## Non-Goals For The Document Workflow

- Do not expose upstream Superpowers terminology as a user-facing product concept.
- Do not force programming workflows such as TDD, git branches, or commit discipline onto ordinary document users.
- Do not make every chat run through strict planning or multi-agent review.
- Do not let multiple agents write the same final file concurrently; final synthesis should remain controlled by one owner.
- Do not pass strict audit with prompt-only claims when code-level template or export verification is required.

## Word Report Engine

Target capabilities:

- Accept `.docx` templates as style references.
- Generate native `.docx` with heading styles, table of contents, page headers, footers, numbering, footnotes, tables, images, and charts.
- Preserve source citations and make them visible in the output.
- Run a document quality check before preview or export.

Minimum acceptance checks:

- Output file opens in Word or WPS.
- Required sections are present.
- Tables do not overflow page width.
- Charts have a source-data reference.
- Page margins and fonts are readable.
- Generated files are saved under the formal output directory.

## PPT Workbench

Target capabilities:

- Accept `.pptx` templates as visual references.
- Represent every slide as a slide spec.
- Generate title, conclusion, comparison, timeline, process, chart, and appendix slides.
- Export to PDF.

Minimum acceptance checks:

- Each slide has one clear purpose.
- Text fits within slide bounds.
- Charts and diagrams are backed by source data or explicit user input.
- The deck opens without repair prompts.

## Excel Workbook Engine

Target capabilities:

- Generate workbook specs for sheets, columns, formulas, formats, filters, and charts.
- Keep numeric facts and formula assumptions separate from prose.
- Support chart generation from workbook ranges.

Minimum acceptance checks:

- Workbook opens without repair prompts.
- Formulas calculate.
- Source sheets, derived sheets, and final summary sheets are distinguishable.
- No numeric claim is created without a source, formula, or explicit user instruction.

## Scenario Skills

Reusable skills should encode strong workflows for common work products:

- Tender technical proposal.
- Contract review report.
- BOQ analysis report.
- Teaching exam paper.
- Research briefing.
- PPT executive briefing.

Skills should produce or update a Task Contract and Document Plan before execution, then leave enough evidence for Goal Loop review.

## Non-Fabrication Rule

Professional formatting cannot become a license to invent. For every chart, diagram, table, or embedded HTML block:

- Use verified source data, calculated data with visible formulas, or explicit user input.
- If the source data is missing, state that the visual cannot be supported.
- Keep chart specs or source tables inspectable.
- Preserve citations in the formal artifact when the task depends on source material.

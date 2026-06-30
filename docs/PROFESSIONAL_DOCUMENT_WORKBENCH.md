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

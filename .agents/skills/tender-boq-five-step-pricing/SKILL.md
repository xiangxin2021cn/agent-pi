---
name: tender-boq-five-step-pricing
description: Build and validate item-by-item tender BOQ five-step direct-cost pricing from registered tender document analysis, BOQ reconciliation, specifications, productivity assumptions, resource rates, and controlled sub-agent handoff reports.
---

# Tender BOQ Five-Step Pricing

Use `tender_capability` as the BOQ five-step pricing system of record. This skill produces the structured pricing basis that later methodology, programme, resource, cost, and cash-flow planning depend on.

## Guardrails

- Use only user-selected sources, registered Tender Workspace records, and explicitly loaded knowledge-base entries.
- Do not scan the working directory as a source corpus.
- Require ready, non-stale `document_analysis` and `boq_reconciliation` packs.
- Price every selected BOQ item individually; never replace item analysis with a summary-only estimate.
- Each BOQ item must cover five steps: scope and quantity, method and productivity, resource consumption, sourced rates and direct cost, reconciliation and risk.
- Keep sourced facts, engineering assumptions, commercial assumptions, and unresolved gaps separate.
- Unverified assumptions may not enter the core conclusion as facts.
- Use controlled sub-agents only from the main session. Child agents must not call `spawn_session`.
- Child agents write structured handoff reports only; the main session owns merging, contradiction checks, and the final capability pack.
- A child retains exclusive ownership of its assigned BOQ range until its terminal structured handoff is ready. The main session must wait, retry, or request user review; it must never derive substitute rows or write the child report after a timeout.

## Workflow

1. Call `tender_workspace` with `status`, then call `tender_capability` with `status` for `document_analysis` and `boq_reconciliation`.
2. Confirm selected BOQ item scope, source priority, currency, rate basis, and required output format. Pause for user confirmation when those are ambiguous.
3. When the selected BOQ scope is large, create `orchestration/briefs` and `orchestration/reports`. Dispatch child agents by coherent BOQ sections or tables. Each brief may contain only assigned BOQ item IDs, the exact question, allowed sources, and the report path.
4. For every BOQ item, record:
   - exact BOQ item ID, code, unit, and quantity basis;
   - step narratives with source references;
   - labour, material, plant, subcontract, temporary works, and indirect resource consumption where applicable;
   - quantity, rate, amount, source type, source locator, and verification status for each cost component;
   - direct cost and unresolved assumptions.
5. Wait until `get_spawn_status.parentAction` is `merge` for every assigned child, then merge handoff reports. Run contradiction checks for duplicate item ownership, unit mismatch, quantity mismatch, unsupported productivity, and rate-source conflicts.
6. Call `tender_capability` with `configure` for `boq_five_step_pricing`.
7. Call `tender_capability` with `init`, or `replace` with the current `expectedRevision`.
8. Call `validate`. Resolve missing build-ups, incomplete five-step records, broken source refs, and arithmetic mismatches before downstream planning.

## Completion

Report the pack revision, readiness, item count, complete item count, estimated direct cost, unverified assumptions, rate gaps, and audit path. Keep pricing workpapers as internal control artifacts unless the user explicitly requests a formal pricing report.

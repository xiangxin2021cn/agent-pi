---
name: tender-boq-five-step-pricing
description: Build and validate item-by-item tender BOQ five-step direct-cost pricing from registered tender document analysis, BOQ reconciliation, specifications, productivity assumptions, resource rates, and controlled sub-agent handoff reports.
---

# Tender BOQ Five-Step Pricing

Use `tender_capability` as the BOQ five-step pricing system of record. This skill produces the structured pricing basis that later methodology, programme, resource, cost, and cash-flow planning depend on.

The required quality profile is `c51_pure_direct_cost_v1`. The C5.1 reference standard is an item-by-item workpaper: each BOQ row preserves its original identity, interprets exact specification and measurement clauses, derives a constructible method and bottleneck productivity, calculates per-unit resource consumption, applies traceable VAT-exclusive rates, and reconciles the pure direct unit rate and item total. A labour/material/equipment database is only a Step 3 rate source. It is never the stage deliverable.

## Guardrails

- Use only user-selected sources, registered Tender Workspace records, and explicitly loaded knowledge-base entries.
- Do not scan the working directory as a source corpus.
- Require ready, non-stale `document_analysis` and `boq_reconciliation` packs.
- Price every selected BOQ item individually; never replace item analysis with a summary-only estimate.
- Do not substitute a generic resource database, market-price report, chapter summary, unpriced scope register, or narrative methodology for item workpapers.
- Each BOQ item must cover five steps: scope and quantity, method and productivity, resource consumption, sourced rates and direct cost, reconciliation and risk.
- Keep item direct cost pure: exclude overhead, P&G, profit, general contingency, and escalation. Handle those in downstream commercial planning. All rates are VAT exclusive.
- Keep sourced facts, engineering assumptions, commercial assumptions, and unresolved gaps separate.
- Unverified assumptions may not enter the core conclusion as facts.
- Use controlled sub-agents only from the main session. Child agents must not call `spawn_session`.
- Child agents write structured handoff reports only; once every batch report is accepted, the **runtime** owns merging and writes the final capability pack deterministically — the main session must never hand-assemble, compress, or rewrite pricing content into `tender_capability`.
- A child retains exclusive ownership of its assigned BOQ range until its terminal structured handoff is ready. The main session must wait, retry, or request user review; it must never derive substitute rows or write the child report after a timeout.
- Key resource rates (fuel, wages, plant hire, cement, aggregates, asphalt, subcontract) must be verified against current market levels via web search/fetch; record each hit in `rateBasis.webEvidence` (`url` + `accessedAt`). Rates that cannot be verified online stay `assumptionStatus: unverified` — never invent a rate.
- Numeric fields are plain decimals without thousands separators; allocation weights and effective factors are 0–1 fractions (`0.85`, not `85`). Format slips are normalized by the runtime and surfaced as review warnings; completeness and BOQ identity are the hard gates.

## Workflow

1. Call `tender_workspace` with `status`, then call `tender_capability` with `status` for `document_analysis` and `boq_reconciliation`.
2. Confirm selected BOQ item scope, source priority, currency, pricing location/date, and rate basis. Pause for user confirmation when those are ambiguous.
3. Use only the backend-generated `boq_batch_manifest_path`, task board, and child briefs. Batches are segmented by BOQ sheet chapter (each BOQ page ≈ one COTO chapter, capped at 25 items; oversized chapters split by row order). Schedule summary rows and synthetic composite groupings are excluded from pricing by design. Do not enlarge, regroup, or bypass a batch.
4. Complete all five steps for every assigned item:
   - **Step 1 - scope and quantity:** copy code, description, unit, quantity, and row source exactly; cite specification plus measurement/payment clauses; list inclusions, exclusions, materials, acceptance tests, and method constraints. Use an explicit reasoned `not applicable` entry instead of silence.
   - **Step 2 - method and productivity:** state construction sequence, labour crew, plant fleet, working hours, controlling resource or cycle, theoretical output, effective factor, and the formula. Record optimistic, base, and pessimistic productivity in the same quantity/time unit. Base productivity must equal `planningBasis.productionRate`; duration must cover the BOQ quantity.
   - **Step 3 - resource consumption:** address labour, plant, material, subcontract, transport, and waste explicitly. For every included category calculate consumption per BOQ unit, show the calculation basis, cite sources, and link it to one cost component.
   - **Step 4 - sourced rates and pure direct cost:** for every component record per-unit quantity, unit, rate, amount, source locator, source type, acquisition mode, location, effective date, VAT-exclusive basis, and verification state. Verify key market rates online and attach `webEvidence` (`url`, `accessedAt`, optional `note`); unverifiable rates stay `unverified`. Reconcile category subtotals, unit direct cost, and `itemDirectCost = unitDirectCost x BOQ quantity`.
   - **Step 5 - reconciliation and item risk:** reconcile scope, unit, quantity, production, duration, and amount; record item-specific optimistic/base/pessimistic sensitivity, trigger, treatment, conditions, and unresolved evidence. Do not insert macro political or FX commentary unless it changes this item calculation.
5. A reviewed item must declare `pricingStandard: c51_pure_direct_cost_v1`, `vatTreatment: exclusive`, and `indirectCostPolicy: excluded_from_item_direct_cost`. Missing structured fields, unsupported numbers, unlinked resources, and unverified core rates prevent readiness.
6. Wait until the task board reports every child handoff accepted. Never price an unfinished child range in the main session. Then call `tender_capability` with `init` (or `replace`) for `boq_five_step_pricing` **with no inline data** — the runtime merges batch reports into the pack deterministically and runs duplicate, coverage, and cross-batch conflict checks. Hand-written packs cannot pass the merge gate.
7. Review the merge result with the user: normalization warnings, unverified rates, and draft items are review items, not blockers.
8. Call `validate`. Resolve every error before downstream planning. Initial item cash-flow allocations are optional here; schedule-based cash flow belongs to the later planning stage.

## Completion

Report the pack revision, readiness, BOQ item coverage, C5.1-complete item count, pure direct item-total cost, unverified assumptions, rate gaps, batch status, and audit path. The human-readable workpaper must contain a summary table followed by a full five-step section for every BOQ item. Keep it as an internal pricing control artifact unless the user explicitly requests a formal submission document.

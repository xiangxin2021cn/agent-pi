---
name: tender-cost-cashflow-planning
description: Build and validate tender-stage sourced cost build-ups, scenarios, and schedule-linked cash flow using exact decimal arithmetic. Use for tender pricing and bid cash-flow planning, not post-award budget baselines or cost control.
---

# Tender Cost and Cash-Flow Planning

Build the structured tender cost model before producing pricing schedules, cash-flow charts, or
commercial narratives. Use `tender_capability` as the cost-cash-flow system of record.

## Guardrails

- Use only user-selected sources and registered Tender Workspace records.
- Do not scan the working directory.
- Require ready, non-stale `boq_reconciliation` and `schedule_resources` packs.
- Do not use JavaScript floating-point arithmetic for financial reconciliation.
- Every sourced rate needs a registered source, currency, and effective date.
- Label unsupported values as `scenario` or `unverified`; do not present them as sourced facts.
- Keep labour, plant, material, subcontract, overhead, contingency, tax, escalation, financing,
  and other components explicit.
- Do not embed hard-coded market rates or productivity benchmarks.
- Link cash-flow periods to validated schedule activities and reconcile period, cumulative, and
  total amounts exactly.
- Do not create or overwrite a Project Delivery Controls budget baseline.
- A stale capability pack is not ready.
- Do not spawn nested agents.

## Workflow

1. Call `tender_workspace` with `status`, then call `tender_capability` with `status` for
   `boq_reconciliation` and `schedule_resources`.
2. Confirm both dependency packs are ready and non-stale. Pause for user confirmation when a
   rate basis, currency, effective date, productivity basis, tax, escalation, contingency,
   financing assumption, or schedule allocation is ambiguous.
3. Call `tender_capability` with `configure` for `cost_cashflow`.
4. Register source-traced rate records and explicit scenarios before using them in components.
5. Build each BOQ item from explicit decimal quantities and rates. Reconcile every component and
   BOQ build-up with exact decimal arithmetic.
6. Allocate costs to validated schedule activities and chronological periods. Reconcile each
   cumulative value and the final cash-flow total.
7. Call `tender_capability` with `init`, or `replace` with the current `expectedRevision`.
8. Call `validate`. Correct missing rate sources, currency mismatches, uncovered BOQ items,
   unknown schedule activities, and arithmetic differences instead of masking them in prose.
9. If status reports stale, refresh only affected rates, build-ups, or periods, replace the pack,
   and validate again.

## Outputs

After validation, report the pack revision, readiness, currency, rate-source count, unverified
components, estimated total, cash-flow total, and audit path. Any chart or office-document export
must be rendered from the validated structured data. Tender cost readiness is not approval of a
post-award budget, forecast, earned-value baseline, or actual-cost record.

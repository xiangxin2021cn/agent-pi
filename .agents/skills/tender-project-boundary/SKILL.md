---
name: tender-project-boundary
description: Register and confirm project boundary fence sources (enterprise KB, this-tender spec bindings, bidder-owned files), parse them into a project_boundary pack, and require human confirmation before BOQ pricing. Does not price BOQ items.
---

# Tender Project Boundary Conditions

Use this skill for stage **项目边界条件** (`project-boundary-conditions`). Produce a confirmed `project_boundary` capability pack that BOQ briefs inject as a **hard fence**. Do **not** start item pricing in this stage.

This stage applies to **every** tender project, not only SANRAL highway. SA/SANRAL bindings are one draft source; non-highway projects start from `generic-international`.

## Division of labour (same pattern as 项目资料登记 / 招标文件解析)

| Surface | Role |
|---|---|
| Overview panel | Registration desk + confirmation desk |
| Parent session | Command surface: dispatch parse children from the task board, then wait for merge |
| Child sessions | Parse one registered fence source each (JSON + customer-facing MD) |

Three source kinds stay separate:

1. **Employer tender files** — already registered in document analysis. Do **not** recatalog them here. Users may *bind* a specification/contract file already on the source boundary (`tender_spec_binding`, `parseStatus: not_required`).
2. **Enterprise knowledge base** — reusable COTO/FIDIC/quota/method entries. Multi-select existing KB sources; do not invent an ingest pipeline. If the entry has `sourceFilePath`, parse that file; otherwise keep `knowledgeSlug` with `parseStatus: not_required`.
3. **Bidder-owned files** — Excel/Word/PDF for plant, crews, camp, historical rates, organigram. Register paths into `boundary-sources.json`. **Never** add them to project `inputPaths` (that would send them into tender parse).

## Guardrails

- Parent session stays continuous. Spawn only for registered fence files that need parse memos (default max concurrency **4**).
- Do not call `spawn_session` for BOQ pages here.
- Do not write `boq_five_step_pricing` or planning packs (stage allowlist will reject).
- Prefer `tender_capability` `init`/`replace` for `project_boundary` with full pack data after runtime merge, or let the runtime merge child reports.
- Soft field gate (outline ≥ ~80 chars, measurement, pricingStandard, currency) is not enough for BOQ: the pack must also have `humanConfirmedAt`, and path sources must not still be `registered`.
- Changing registered sources clears confirmation.
- Suggestions from document analysis / bindings are drafts — require human confirmation.
- **Writing:** Follow tender-intelligence-core `references/writing-contract.md`. Boundary notes and organisation outline must use this tender's terms with AI filler stripped.

## Workflow

1. Read the panel desk / `boundary-sources.json`. Help the user pick KB entries, bind this-tender specs, and attach bidder files.
2. Dispatch children from exact `briefPath` / `reportPath` / `markdownPath` on the task board / `boundary_batch_manifest`. Parent must not author those MDs.
3. When every parse batch is complete, wait for runtime merge into `packs/project-boundary.json` (extracted inventory, technical specs, organisation notes).
4. Fill remaining control fields (profile, currency, measurement, pricingStandard, tax, rate location, organisation outline).
5. Ask the user to confirm. Do not tell BOQ the pack is ready until `humanConfirmedAt` is set.

## Completion

Report profileId, currency, measurementStandard, pricingStandard, source count / parse status, outline length, readiness, `humanConfirmedAt`, and whether BOQ can use the pack as a fence.

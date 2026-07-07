import { describe, expect, it } from 'bun:test'
import type { StoredAttachment } from '@craft-agent/core/types'
import {
  COMPREHENSIVE_QUALITY_CRITERION_TEXT,
  DOCUMENT_QUALITY_REQUIRED_CRITERION_TEXT,
  FILE_OUTPUT_REQUIRED_CRITERION_TEXT,
  TEMPLATE_FIDELITY_REQUIRED_CRITERION_TEXT,
  TOOL_VERIFICATION_REQUIRED_CRITERION_TEXT,
  VISUAL_BLOCK_AUDIT_REQUIRED_CRITERION_TEXT,
  buildGoalCriteriaFromMessage,
  buildGoalExecutionPolicyFromMessage,
  buildTaskContractFromMessage,
  mergeTaskContracts,
} from './goal-criteria'

function attachment(name: string): StoredAttachment {
  return {
    id: name,
    type: 'pdf',
    name,
    mimeType: 'application/octet-stream',
    size: 1,
    storedPath: `/tmp/${name}`,
  }
}

describe('buildGoalCriteriaFromMessage', () => {
  it('always includes the base deliverable criterion for work tasks', () => {
    const criteria = buildGoalCriteriaFromMessage({ message: '修复上传附件按钮' })

    expect(criteria).toContainEqual({
      text: 'Complete the user request, including any requested deliverables, constraints, referenced files, and verification steps.',
      kind: 'deliverable',
      required: true,
    })
  })

  it('adds evidence and format criteria for document work with attachments', () => {
    const criteria = buildGoalCriteriaFromMessage({
      message: '根据招标文件生成一份施工方案报告',
      storedAttachments: [attachment('tender.pdf')],
    })

    expect(criteria.map(criterion => criterion.kind)).toContain('evidence')
    expect(criteria.map(criterion => criterion.kind)).toContain('format')
    expect(criteria.some(criterion => criterion.text.includes('tender.pdf'))).toBe(true)
    expect(criteria).toContainEqual({
      text: DOCUMENT_QUALITY_REQUIRED_CRITERION_TEXT,
      kind: 'coverage',
      required: true,
    })
  })

  it('adds verification criteria when the request asks for tests or validation', () => {
    const criteria = buildGoalCriteriaFromMessage({
      message: '修复这个 bug 并验证测试通过',
    })

    expect(criteria).toContainEqual({
      text: 'Run or describe appropriate validation steps, and report the verification result clearly.',
      kind: 'test',
      required: true,
    })
  })

  it('adds evidence criteria for source-sensitive work even without explicit attachments', () => {
    const criteria = buildGoalCriteriaFromMessage({
      message: '根据招标文件条款和 BOQ 工程量清单写施工方案',
    })

    expect(criteria).toContainEqual({
      text: 'Ground key facts, figures, clauses, and requirements in user-selected sources, attachments, or explicitly named files/folders; clearly mark assumptions when source evidence is unavailable.',
      kind: 'evidence',
      required: true,
    })
  })

  it('does not duplicate generic source criteria when referenced files are present', () => {
    const criteria = buildGoalCriteriaFromMessage({
      message: '根据招标文件和 BOQ 工程量清单写施工方案',
      storedAttachments: [attachment('boq.xlsx')],
    })

    const evidenceCriteria = criteria.filter(criterion => criterion.kind === 'evidence')
    expect(evidenceCriteria).toHaveLength(1)
    expect(evidenceCriteria[0].text).toContain('boq.xlsx')
  })

  it('adds output-file evidence criteria when the request explicitly asks to create a file', () => {
    const criteria = buildGoalCriteriaFromMessage({
      message: '请生成 final-report.md 文件并保存到工作目录',
    })

    expect(criteria).toContainEqual({
      text: FILE_OUTPUT_REQUIRED_CRITERION_TEXT,
      kind: 'deliverable',
      required: true,
    })
  })

  it('adds output-file evidence criteria when the request asks to convert into a file format', () => {
    const criteria = buildGoalCriteriaFromMessage({
      message: '请将 tender.pdf 转换为 markdown 文件',
    })

    expect(criteria.some(criterion => criterion.text === FILE_OUTPUT_REQUIRED_CRITERION_TEXT)).toBe(true)
  })

  it('adds explicit output format criteria when the request names deliverable formats', () => {
    const criteria = buildGoalCriteriaFromMessage({
      message: '请生成 PDF 和 Word 版分析报告',
    })

    expect(criteria).toContainEqual({
      text: 'Create output file(s) in the requested format(s): PDF, DOCX.',
      kind: 'format',
      required: true,
    })
  })

  it('uses the target format instead of the source format for conversions', () => {
    const criteria = buildGoalCriteriaFromMessage({
      message: '请将 tender.pdf 转换为 markdown 文件',
    })

    const outputFormat = criteria.find(criterion =>
      criterion.kind === 'format'
      && criterion.text.startsWith('Create output file(s) in the requested format(s):')
    )
    expect(outputFormat?.text).toBe('Create output file(s) in the requested format(s): MD.')
  })

  it('does not require output-file evidence for source-only document analysis', () => {
    const criteria = buildGoalCriteriaFromMessage({
      message: '请分析 tender.pdf 的关键风险',
    })

    expect(criteria.some(criterion => criterion.text === FILE_OUTPUT_REQUIRED_CRITERION_TEXT)).toBe(false)
  })

  it('adds tool verification evidence criteria when the request asks to run tests', () => {
    const criteria = buildGoalCriteriaFromMessage({
      message: '请运行 typecheck 和测试，确认全部通过',
    })

    expect(criteria).toContainEqual({
      text: TOOL_VERIFICATION_REQUIRED_CRITERION_TEXT,
      kind: 'test',
      required: true,
    })
  })

  it('adds tool verification evidence criteria for code or app change requests', () => {
    const criteria = buildGoalCriteriaFromMessage({
      message: '请修复前端上传附件按钮的 bug',
    })

    expect(criteria).toContainEqual({
      text: TOOL_VERIFICATION_REQUIRED_CRITERION_TEXT,
      kind: 'test',
      required: true,
    })
  })

  it('does not require tool verification evidence when the request only asks to describe validation', () => {
    const criteria = buildGoalCriteriaFromMessage({
      message: '请描述这个方案的验证思路',
    })

    expect(criteria.some(criterion => criterion.text === TOOL_VERIFICATION_REQUIRED_CRITERION_TEXT)).toBe(false)
  })

  it('does not require tool verification evidence for ordinary document analysis', () => {
    const criteria = buildGoalCriteriaFromMessage({
      message: '请分析施工方案的关键风险',
    })

    expect(criteria.some(criterion => criterion.text === TOOL_VERIFICATION_REQUIRED_CRITERION_TEXT)).toBe(false)
  })

  it('adds a coverage criterion when the request asks for comprehensive high-quality work', () => {
    const criteria = buildGoalCriteriaFromMessage({
      message: '请全面详细分析这个项目并输出高质量报告',
    })

    expect(criteria).toContainEqual({
      text: COMPREHENSIVE_QUALITY_CRITERION_TEXT,
      kind: 'coverage',
      required: true,
    })
    expect(criteria).toContainEqual({
      text: DOCUMENT_QUALITY_REQUIRED_CRITERION_TEXT,
      kind: 'coverage',
      required: true,
    })
  })

  it('adds source grounding and quality gates for deep research improvement plans', () => {
    const criteria = buildGoalCriteriaFromMessage({
      message: '请深度调研 Hermes Agent 和 MoA，形成 1.1.3 改进方案',
    })

    expect(criteria).toContainEqual({
      text: 'Ground key facts, figures, clauses, and requirements in user-selected sources, attachments, or explicitly named files/folders; clearly mark assumptions when source evidence is unavailable.',
      kind: 'evidence',
      required: true,
    })
    expect(criteria).toContainEqual({
      text: COMPREHENSIVE_QUALITY_CRITERION_TEXT,
      kind: 'coverage',
      required: true,
    })
    expect(criteria).toContainEqual({
      text: DOCUMENT_QUALITY_REQUIRED_CRITERION_TEXT,
      kind: 'coverage',
      required: true,
    })
  })

  it('adds separate criteria for explicit required deliverable items', () => {
    const criteria = buildGoalCriteriaFromMessage({
      message: [
        '请生成施工方案报告，必须包含：',
        '1. 工程概况',
        '2. 风险清单',
        '3. 引用页码',
      ].join('\n'),
    })

    expect(criteria).toContainEqual({
      text: 'Must satisfy explicit user requirement: 工程概况.',
      kind: 'user_constraint',
      required: true,
    })
    expect(criteria).toContainEqual({
      text: 'Must satisfy explicit user requirement: 风险清单.',
      kind: 'user_constraint',
      required: true,
    })
    expect(criteria).toContainEqual({
      text: 'Must satisfy explicit user requirement: 引用页码.',
      kind: 'user_constraint',
      required: true,
    })
  })

  it('does not add a coverage criterion for ordinary short analysis requests', () => {
    const criteria = buildGoalCriteriaFromMessage({
      message: '请分析这个项目的关键风险',
    })

    expect(criteria.some(criterion => criterion.text === COMPREHENSIVE_QUALITY_CRITERION_TEXT)).toBe(false)
  })

  it('keeps explicit quick mode from adding document workflow audit criteria', () => {
    const criteria = buildGoalCriteriaFromMessage({
      message: '请严格按照上传的Word模板版式生成专业文档报告，包含A3横向甘特图。',
      storedAttachments: [attachment('reference-template.docx')],
      documentQualityMode: 'quick',
    })

    expect(criteria.some(criterion => criterion.text === DOCUMENT_QUALITY_REQUIRED_CRITERION_TEXT)).toBe(false)
    expect(criteria.some(criterion => criterion.text === VISUAL_BLOCK_AUDIT_REQUIRED_CRITERION_TEXT)).toBe(false)
    expect(criteria.some(criterion => criterion.text === TEMPLATE_FIDELITY_REQUIRED_CRITERION_TEXT)).toBe(false)
  })
})

describe('buildGoalExecutionPolicyFromMessage', () => {
  it('uses a conservative two-pass budget for ordinary work requests', () => {
    const policy = buildGoalExecutionPolicyFromMessage({ message: '修复上传附件按钮' })

    expect(policy).toEqual({
      mode: 'auto_improve',
      maxIterations: 2,
      maxWallClockMs: 15 * 60 * 1000,
    })
  })

  it('keeps the two-pass loop cap for comprehensive review requests with documents', () => {
    const policy = buildGoalExecutionPolicyFromMessage({
      message: '请全面详细分析招标文件并认真复核输出质量',
      storedAttachments: [attachment('tender.pdf')],
    })

    expect(policy.maxIterations).toBe(2)
    expect(policy.maxWallClockMs).toBe(30 * 60 * 1000)
  })

  it('keeps the two-pass loop cap for source-sensitive document work with attachments', () => {
    const policy = buildGoalExecutionPolicyFromMessage({
      message: '招标文件条款有哪些风险？',
      storedAttachments: [attachment('tender.pdf')],
    })

    expect(policy.maxIterations).toBe(2)
    expect(policy.maxWallClockMs).toBe(30 * 60 * 1000)
  })

  it('keeps the two-pass loop cap when the user explicitly asks for high-quality comprehensive work', () => {
    const policy = buildGoalExecutionPolicyFromMessage({
      message: '请全面详细分析这个项目并输出高质量报告',
    })

    expect(policy.maxIterations).toBe(2)
    expect(policy.maxWallClockMs).toBe(30 * 60 * 1000)
  })

  it('keeps automatic repair to two passes even when the user asks to continue until done', () => {
    const policy = buildGoalExecutionPolicyFromMessage({
      message: '反复检查并继续改进，直到成果满足要求再结束',
    })

    expect(policy.maxIterations).toBe(2)
    expect(policy.maxWallClockMs).toBe(45 * 60 * 1000)
  })

  it('keeps explicit quick mode on the conservative budget for high-friction document prompts', () => {
    const policy = buildGoalExecutionPolicyFromMessage({
      message: '请全面详细生成专业文档报告，包含A3横向甘特图和模板复核。',
      storedAttachments: [attachment('reference-template.docx')],
      documentQualityMode: 'quick',
    })

    expect(policy.maxIterations).toBe(2)
    expect(policy.maxWallClockMs).toBe(15 * 60 * 1000)
  })

  it('uses the professional document budget when the mode is explicitly selected', () => {
    const policy = buildGoalExecutionPolicyFromMessage({
      message: '整理一下这份材料。',
      documentQualityMode: 'professional_document',
    })

    expect(policy.maxIterations).toBe(2)
    expect(policy.maxWallClockMs).toBe(30 * 60 * 1000)
  })

  it('uses the strict delivery budget when the mode is explicitly selected', () => {
    const policy = buildGoalExecutionPolicyFromMessage({
      message: '整理一下这份材料。',
      documentQualityMode: 'strict_delivery',
    })

    expect(policy.maxIterations).toBe(2)
    expect(policy.maxWallClockMs).toBe(45 * 60 * 1000)
  })

  it('uses the multi-agent deep budget when the mode is explicitly selected', () => {
    const policy = buildGoalExecutionPolicyFromMessage({
      message: '整理一下这份材料。',
      documentQualityMode: 'multi_agent_deep',
    })

    expect(policy.maxIterations).toBe(2)
    expect(policy.maxWallClockMs).toBe(45 * 60 * 1000)
  })
})

describe('buildTaskContractFromMessage', () => {
  it('uses quick document workflow mode for ordinary small work', () => {
    const contract = buildTaskContractFromMessage({
      message: '修复上传附件按钮',
    })

    expect((contract as { documentQualityMode?: string }).documentQualityMode).toBe('quick')
  })

  it('uses professional document mode for formal long-form document work', () => {
    const contract = buildTaskContractFromMessage({
      message: '请根据招标文件生成一份专业文档报告，包含证据矩阵、章节计划和质量审查。',
      storedAttachments: [attachment('tender.pdf')],
    })

    expect((contract as { documentQualityMode?: string }).documentQualityMode).toBe('professional_document')
    expect(contract.evidenceRequirements).toContain('Build an evidence matrix that links key claims, tables, and visuals back to source files or explicit assumptions.')
    expect(contract.documentPlan?.enhancements).toContain('Use document workflow mode professional_document to drive the contract, evidence matrix, chapter plan, and quality audit depth.')
  })

  it('creates a reusable evidence matrix for professional document contracts', () => {
    const contract = buildTaskContractFromMessage({
      message: '请根据招标文件和BOQ生成专业文档报告，包含证据矩阵、风险表和趋势图。',
      storedAttachments: [attachment('tender.pdf'), attachment('boq.xlsx')],
    })

    expect(contract.documentPlan?.evidenceMatrix).toEqual([
      {
        id: 'evidence-source-1',
        source: 'tender.pdf',
        sourceType: 'file',
        supports: 'Source-backed claims, required sections, tables, visuals, and unresolved evidence gaps.',
        reliabilityNote: 'User-provided file; cite page, clause, table, figure, sheet, or extracted text before using claims as verified.',
        citationFields: ['source', 'locator', 'claim', 'excerpt_or_value', 'reliability_note'],
        reuseStatus: 'candidate',
      },
      {
        id: 'evidence-source-2',
        source: 'boq.xlsx',
        sourceType: 'file',
        supports: 'Source-backed claims, required sections, tables, visuals, and unresolved evidence gaps.',
        reliabilityNote: 'User-provided file; cite page, clause, table, figure, sheet, or extracted text before using claims as verified.',
        citationFields: ['source', 'locator', 'claim', 'excerpt_or_value', 'reliability_note'],
        reuseStatus: 'candidate',
      },
    ])
  })

  it('creates a bounded helper-agent plan for complex professional document tasks', () => {
    const contract = buildTaskContractFromMessage({
      message: [
        '请根据招标文件和BOQ生成专业文档报告，要求：',
        '1. 项目概况',
        '2. 技术方案',
        '3. 施工进度',
        '4. 成本风险',
      ].join('\n'),
      storedAttachments: [attachment('tender.pdf'), attachment('boq.xlsx')],
      documentQualityMode: 'professional_document',
    })

    const agentPlan = contract.documentPlan?.agentPlan

    expect(agentPlan?.mode).toBe('chapter_agents')
    expect(agentPlan?.finalSynthesisOwner).toBe('final_synthesis_owner')
    expect(agentPlan?.assignments.map(item => item.title)).toEqual([
      '项目概况',
      '技术方案',
      '施工进度',
      '成本风险',
    ])
  })

  it('uses an explicit document workflow mode over automatic classification', () => {
    const contract = buildTaskContractFromMessage({
      message: '整理一下这段会议纪要。',
      documentQualityMode: 'professional_document',
    })

    expect((contract as { documentQualityMode?: string }).documentQualityMode).toBe('professional_document')
    expect(contract.taskType).toBe('document')
    expect(contract.documentPlan?.enhancements).toContain('Use document workflow mode professional_document to drive the contract, evidence matrix, chapter plan, and quality audit depth.')
  })

  it('uses strict delivery mode when template and export gates are mandatory', () => {
    const contract = buildTaskContractFromMessage({
      message: '请严格按照上传的Word模板版式生成正式交付版 DOCX 和 PDF，必须通过来源、模板、导出、图表、格式审查。',
      storedAttachments: [attachment('reference-template.docx')],
    })

    expect((contract as { documentQualityMode?: string }).documentQualityMode).toBe('strict_delivery')
    expect(contract.evidenceRequirements).toContain('Pass strict delivery gates for sources, template fidelity, exports, visuals, and final formatting before claiming completion.')
  })

  it('creates a strict delivery review plan with explicit audit gates', () => {
    const contract = buildTaskContractFromMessage({
      message: '请严格按照上传的Word模板版式生成正式交付版 DOCX 和 PDF，必须通过来源、模板、导出、图表、格式审查。',
      storedAttachments: [attachment('reference-template.docx')],
    })

    const reviewPlan = contract.documentPlan?.deliveryReviewPlan

    expect(reviewPlan?.mode).toBe('strict_delivery')
    expect(reviewPlan?.failureAction).toBe('needs_review_or_auto_improve')
    expect(reviewPlan?.gates.map(gate => gate.id)).toEqual([
      'source_integrity',
      'template_fidelity',
      'export_files',
      'visual_evidence',
      'format_review',
    ])
    expect(reviewPlan?.gates.find(gate => gate.id === 'template_fidelity')?.evidence).toBe('Parsed template profile and exported DOCX/PDF structure evidence.')
  })

  it('uses multi-agent deep mode for large tender and due-diligence style deliverables', () => {
    const contract = buildTaskContractFromMessage({
      message: '针对大型投标工程报告启用多智能体深度模式，分章节智能体撰写并进行多角色评审后形成最终文件。',
      storedAttachments: [attachment('boq.xlsx'), attachment('drawings.pdf')],
    })

    expect((contract as { documentQualityMode?: string }).documentQualityMode).toBe('multi_agent_deep')
    expect(contract.evidenceRequirements).toContain('Use chapter-level or discipline-level evidence coverage and resolve cross-chapter inconsistencies before final synthesis.')
    expect(contract.forbiddenShortcuts).toContain('Do not let multiple agents write the same final artifact concurrently; use one final synthesis owner.')
  })

  it('creates a chapter-agent collaboration plan for multi-agent deep document work', () => {
    const contract = buildTaskContractFromMessage({
      message: [
        '针对大型投标工程报告启用多智能体深度模式，要求：',
        '1. 项目概况',
        '2. 技术方案',
        '3. 施工进度',
        '4. 成本风险',
        '最终由总编智能体统一合成。',
      ].join('\n'),
      storedAttachments: [attachment('boq.xlsx'), attachment('drawings.pdf')],
    })

    const agentPlan = contract.documentPlan?.agentPlan

    expect(agentPlan?.mode).toBe('chapter_agents')
    expect(agentPlan?.finalSynthesisOwner).toBe('final_synthesis_owner')
    expect(agentPlan?.assignments.map(item => item.title)).toEqual([
      '项目概况',
      '技术方案',
      '施工进度',
      '成本风险',
    ])
    expect(agentPlan?.reviewStages).toContain('Cross-chapter consistency review before final synthesis.')
    expect(agentPlan?.guardrails).toContain('Only the final synthesis owner may write or replace the final deliverable after chapter drafts are reviewed.')
  })

  it('creates sheet-level pricing agents for full BOQ workbook derivation', () => {
    const contract = buildTaskContractFromMessage({
      message: '请对 BOQ Excel 工作簿进行全量组价分析，每个表每个清单项都要推导报价。',
      storedAttachments: [attachment('pricing.xlsx')],
    })

    const agentPlan = contract.documentPlan?.agentPlan

    expect((contract as { documentQualityMode?: string }).documentQualityMode).toBe('multi_agent_deep')
    expect(agentPlan?.finalSynthesisOwner).toBe('final_pricing_synthesis_owner')
    expect(agentPlan?.assignments.map(item => item.role)).toContain('sheet_pricing_agent_dispatcher')
    expect(agentPlan?.guardrails).toContain('Run xlsx-tool info before xlsx-tool read/export on pricing workbooks.')
    expect(contract.evidenceRequirements).toContain('Inventory workbook sheets/tables with xlsx-tool info before pricing derivation, then record sheet/table coverage and item-level pricing evidence or gaps.')
    expect(contract.forbiddenShortcuts).toContain('Do not perform BOQ pricing derivation by reading or exporting the full workbook in one pass; inventory sheets first and split work by sheet/table/range.')
  })

  it('keeps a named BOQ page pricing request serial instead of escalating to deep multi-agent mode', () => {
    const contract = buildTaskContractFromMessage({
      message: '这次你只对 MEDIAN BARRIER 页的清单进行详细的每条清单项五步法推导成本，不要多做。',
      storedAttachments: [attachment('pricing.xlsx')],
    })

    expect((contract as { documentQualityMode?: string }).documentQualityMode).toBe('professional_document')
    expect(contract.documentPlan?.agentPlan).toBeUndefined()
    expect(contract.deliverables).toContain('Produce serial item-level pricing derivation only for the explicitly named BOQ page, sheet, or table; do not expand to other pages or workbook-wide synthesis.')
    expect(contract.evidenceRequirements).toContain('Record item-level pricing evidence and gaps for only the explicitly named BOQ page, sheet, or table.')
    expect(contract.forbiddenShortcuts).toContain('Do not spawn sub-agents, cross-chapter reviews, or workbook-wide synthesis for a narrow BOQ page/sheet pricing request unless the user explicitly asks.')
  })

  it('lets a narrow BOQ page instruction override an explicit deep multi-agent mode', () => {
    const contract = buildTaskContractFromMessage({
      message: '本次 only do the MEDIAN BARRIER worksheet item-by-item five-step pricing. 不要扩展到其他页。',
      documentQualityMode: 'multi_agent_deep',
      storedAttachments: [attachment('pricing.xlsx')],
    })

    expect((contract as { documentQualityMode?: string }).documentQualityMode).toBe('professional_document')
    expect(contract.documentPlan?.agentPlan).toBeUndefined()
    expect(contract.forbiddenShortcuts).toContain('Do not spawn sub-agents, cross-chapter reviews, or workbook-wide synthesis for a narrow BOQ page/sheet pricing request unless the user explicitly asks.')
  })

  it('captures deliverables, hard requirements, evidence, and formats without using a domain-specific template', () => {
    const contract = buildTaskContractFromMessage({
      message: [
        '请根据附件生成 PDF 和 Word 版分析报告，必须包含：',
        '1. 风险清单',
        '2. 引用页码',
        '不要精简。',
      ].join('\n'),
      storedAttachments: [attachment('source.pdf')],
      workingDirectory: '/project-a',
    })

    expect(contract.taskType).toBe('document')
    expect(contract.workingDirectory).toBe('/project-a')
    expect(contract.outputFormats).toEqual(['PDF', 'DOCX'])
    expect(contract.documentPlan?.sections).toContain('风险清单')
    expect(contract.documentPlan?.sections).toContain('引用页码')
    expect(contract.documentPlan?.deliveryFormats).toEqual(['PDF', 'DOCX'])
    expect(contract.documentPlan?.tables.some(item => item.includes('风险清单'))).toBe(true)
    expect(contract.documentPlan?.citations).toContain('Cite or reference source.pdf where it supports key facts.')
    expect(contract.deliverables.some(item => item.includes('structured'))).toBe(true)
    expect(contract.deliverables.some(item => item.includes('output file'))).toBe(true)
    expect(contract.mustPreserve).toContain('Explicit requirement: 风险清单')
    expect(contract.mustPreserve).toContain('Explicit requirement: 引用页码')
    expect(contract.mustPreserve).toContain('Referenced material: source.pdf')
    expect(contract.evidenceRequirements).toContain('Use the referenced material where relevant: source.pdf.')
    expect(contract.forbiddenShortcuts.some(item => item.includes('high-level outline'))).toBe(true)
  })

  it('merges follow-up requests into the same contract without losing the original contract boundary', () => {
    const current = buildTaskContractFromMessage({
      message: '请生成项目分析报告',
      workingDirectory: '/project-a',
    })
    const next = buildTaskContractFromMessage({
      message: '补充风险清单，必须包含预算风险',
      workingDirectory: '/project-a',
    })

    const merged = mergeTaskContracts(current, next)

    expect(merged.originalRequest).toBe('请生成项目分析报告')
    expect(merged.followUpRequests).toEqual(['补充风险清单，必须包含预算风险'])
    expect(merged.mustPreserve).toContain('Explicit requirement: 预算风险')
    expect(merged.documentPlan?.sections).toContain('预算风险')
    expect(merged.workingDirectory).toBe('/project-a')
  })

  it('captures chart and audience hints for formal document production', () => {
    const contract = buildTaskContractFromMessage({
      message: '请面向管理层生成研究简报，包含趋势图和对比表，语气正式，篇幅 5 页，导出为 PPTX。',
    })

    expect(contract.documentPlan?.audience).toBe('管理层')
    expect(contract.documentPlan?.tone).toBe('正式')
    expect(contract.documentPlan?.length).toBe('5 页')
    expect(contract.documentPlan?.charts).toContain('Generate chart specs from verified data first, then render charts as inspectable SVG/PNG before embedding in formal documents.')
    expect(contract.documentPlan?.enhancements).toContain('Use structured chart specifications such as chart.json before rendering visual assets; every data point must come from verified source data.')
    expect(contract.documentPlan?.tables).toContain('Use readable native tables for key structured data instead of plain text table-like paragraphs.')
    expect(contract.documentPlan?.deliveryFormats).toEqual(['PPTX'])
  })

  it('requires sources and uncertainty separation for research contracts without attachments', () => {
    const contract = buildTaskContractFromMessage({
      message: '请深度调研 Hermes Agent 和 MoA，形成 1.1.3 改进方案',
    })

    expect(contract.taskType).toBe('research')
    expect(contract.evidenceRequirements).toContain('Ground research claims in cited sources or clearly mark unavailable evidence and assumptions.')
    expect(contract.documentPlan?.sections).toContain('Evidence and sources')
    expect(contract.documentPlan?.sections).toContain('Risks or uncertainties')
    expect(contract.forbiddenShortcuts).toContain('Do not invent facts, figures, clauses, page numbers, file names, dates, prices, or technical parameters.')
  })

  it('keeps visual and HTML enhancements bound to verified data', () => {
    const contract = buildTaskContractFromMessage({
      message: '执行文档任务时请用图表和 HTML 内嵌增强专业可读性，但切记不能编造数据。',
    })

    expect(contract.documentPlan?.enhancements).toContain('Use structured chart specifications such as chart.json before rendering visual assets; every data point must come from verified source data.')
    expect(contract.documentPlan?.enhancements).toContain('HTML or embedded visual blocks may improve readability, but they must be based on verified data and remain inspectable.')
    expect(contract.evidenceRequirements).toContain('Create visual enhancements only from verified source data; if data is unavailable, state that the visualization cannot be supported.')
    expect(contract.forbiddenShortcuts).toContain('Do not create charts, HTML visual blocks, diagrams, or visual summaries from invented data; use verified data or mark the visualization basis as unavailable.')
  })

  it('creates visual criteria and a visual plan for professional document tasks', () => {
    const criteria = buildGoalCriteriaFromMessage({
      message: '请生成专业施工进度报告，必须包含WBS、基线/当前计划、关键路径、里程碑和A3横向甘特图。',
    })
    const contract = buildTaskContractFromMessage({
      message: '请生成专业施工进度报告，必须包含WBS、基线/当前计划、关键路径、里程碑和A3横向甘特图。',
    })

    expect(criteria).toContainEqual({
      text: VISUAL_BLOCK_AUDIT_REQUIRED_CRITERION_TEXT,
      kind: 'coverage',
      required: true,
    })
    expect(contract.documentPlan?.domain).toBe('construction')
    expect(contract.documentPlan?.visualPlan?.selectedKinds).toContain('construction-gantt')
    expect(contract.documentPlan?.visualPlan?.auditRequirements).toContain('Construction Gantt visuals requested as A3 landscape must preserve A3 landscape page intent in the rendered asset or caption metadata.')
    expect(contract.documentPlan?.enhancements).toContain('Render required professional visuals from verified data and include captions, source notes, and audit reasons.')
  })

  it('creates template fidelity criteria for strict uploaded-template requests', () => {
    const criteria = buildGoalCriteriaFromMessage({
      message: '请严格按照上传的Word模板版式、目录层级、字体和页面布局生成新的报告。',
      storedAttachments: [attachment('reference-template.docx')],
    })
    const contract = buildTaskContractFromMessage({
      message: '请严格按照上传的Word模板版式、目录层级、字体和页面布局生成新的报告。',
      storedAttachments: [attachment('reference-template.docx')],
    })

    expect(criteria).toContainEqual({
      text: TEMPLATE_FIDELITY_REQUIRED_CRITERION_TEXT,
      kind: 'coverage',
      required: true,
    })
    expect(contract.documentPlan?.strictTemplate).toBe(true)
    expect(contract.documentPlan?.templateProfileId).toBe('pending-template-profile')
    expect(contract.forbiddenShortcuts).toContain('Do not claim template fidelity from prompt wording alone; strict template mode requires a parsed template profile and export evidence.')
  })
})

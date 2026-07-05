import { describe, expect, it } from 'bun:test';
import { formatTaskContractContext } from './task-contract-context.ts';
import type { SessionTaskContract } from './types.ts';

const contract: SessionTaskContract = {
  originalRequest: 'Deeply research the market and produce a cited report.',
  taskType: 'research',
  documentQualityMode: 'professional_document',
  deliverables: [
    'Produce a structured report.',
    'Include a concise executive summary.',
    'Create a source table.',
    'List implementation recommendations.',
  ],
  mustPreserve: [
    'Explicit requirement: cite primary sources.',
    'Explicit requirement: include cost and latency tradeoffs.',
  ],
  evidenceRequirements: [
    'Cite source URLs for factual claims.',
    'Mark assumptions when evidence is unavailable.',
  ],
  outputFormats: ['MD'],
  acceptanceCriteria: [
    '[deliverable] Complete the user request.',
    '[evidence] Ground key facts in available source material.',
    '[coverage] Cover the requested scope comprehensively.',
    '[format] Produce a structured, readable deliverable.',
  ],
  forbiddenShortcuts: [
    'Do not provide a generic outline instead of the requested report.',
  ],
};

describe('formatTaskContractContext', () => {
  it('formats a bounded execution contract for prompt context', () => {
    const formatted = formatTaskContractContext(contract);

    expect(formatted).toContain('<goal_contract taskType="research" documentQualityMode="professional_document">');
    expect(formatted).toContain('Document workflow mode: professional_document');
    expect(formatted).toContain('Deliverables:');
    expect(formatted).toContain('1. Produce a structured report.');
    expect(formatted).toContain('Must preserve:');
    expect(formatted).toContain('Evidence requirements:');
    expect(formatted).toContain('Acceptance criteria:');
    expect(formatted).toContain('Forbidden shortcuts:');
    expect(formatted).toContain('Use only selected sources, attached files, and explicitly named file or folder paths as task input.');
    expect(formatted).toContain('Do not inventory the working directory as a source corpus unless the user explicitly requests folder discovery.');
    expect(formatted).toContain('Check instruction fidelity before improving document quality.');
    expect(formatted).toContain('Do not broaden requested scope, selected sources, output format, or response language during improvement passes.');
    expect(formatted).toContain('Document workflow execution protocol:');
    expect(formatted).toContain('Build or update the evidence matrix before drafting source-backed claims.');
    expect(formatted).toContain('Plan sections, tables, visuals, and citations before writing final prose.');
    expect(formatted).toContain('Run a document-quality pass before claiming completion.');
    expect(formatted).toContain('Critical reasoning protocol:');
    expect(formatted).toContain('Break the problem into three material dimensions and state why each dimension matters.');
    expect(formatted).toContain('Compare optimistic and pessimistic interpretations for each material dimension.');
    expect(formatted).toContain('Challenge the draft from a skeptical third-party reviewer view.');
    expect(formatted).toContain('End with a bounded conclusion that states conditions, risks, and what would change the answer.');
    expect(formatted).toContain('Use this as private reasoning scaffolding unless the requested deliverable explicitly asks for visible step headings.');
    expect(formatted).toContain('</goal_contract>');
    expect(formatted).not.toContain('4. List implementation recommendations.');
  });

  it('does not add critical reasoning scaffolding to quick document mode', () => {
    const formatted = formatTaskContractContext({
      ...contract,
      documentQualityMode: 'quick',
    });

    expect(formatted).toContain('Document workflow mode: quick');
    expect(formatted).not.toContain('Critical reasoning protocol:');
  });

  it('includes multi-agent document plan constraints when available', () => {
    const formatted = formatTaskContractContext({
      ...contract,
      taskType: 'document',
      documentQualityMode: 'multi_agent_deep',
      documentPlan: {
        sections: ['项目概况', '技术方案', '施工进度'],
        tables: [],
        charts: [],
        enhancements: [],
        citations: [],
        deliveryFormats: ['MD'],
        agentPlan: {
          mode: 'chapter_agents',
          finalSynthesisOwner: 'final_synthesis_owner',
          assignments: [
            {
              id: 'chapter-agent-1',
              title: '项目概况',
              role: 'source_evidence_agent',
              reviewFocus: '出处和范围边界',
            },
            {
              id: 'chapter-agent-2',
              title: '技术方案',
              role: 'technical_chapter_agent',
              reviewFocus: '技术完整性',
            },
            {
              id: 'chapter-agent-3',
              title: '施工进度',
              role: 'schedule_chapter_agent',
              reviewFocus: '进度逻辑',
            },
          ],
          reviewStages: ['Cross-chapter consistency review before final synthesis.'],
          guardrails: ['Only the final synthesis owner may write or replace the final deliverable after chapter drafts are reviewed.'],
        },
      },
    });

    expect(formatted).toContain('Document agent plan:');
    expect(formatted).toContain('Mode: chapter_agents');
    expect(formatted).toContain('Final synthesis owner: final_synthesis_owner');
    expect(formatted).toContain('1. 项目概况 - source_evidence_agent - 出处和范围边界');
    expect(formatted).toContain('Review stages:');
    expect(formatted).toContain('Guardrails:');
    expect(formatted).toContain('Document workflow execution protocol:');
    expect(formatted).toContain('Before drafting, restate the exact user-requested scope and selected sources.');
    expect(formatted).toContain('For multi-agent deep mode, create real spawned chapter sessions with spawn_session before final synthesis unless the user explicitly requests single-agent execution.');
    expect(formatted).toContain('Call spawn_session with help=true first, then spawn only the scoped chapter-agent assignments needed for the request.');
    expect(formatted).toContain('If the request names a single chapter, source, file, or folder, spawn only agents for that scoped input and do not spawn agents for other chapters or sources.');
    expect(formatted).toContain('Each spawned chapter prompt must name the selected knowledge-base/source slugs or inherit them, forbid broad working-directory discovery, and require source-grounded handoff notes.');
    expect(formatted).toContain('Each spawned chapter session must return a handoff note only and must not write or replace the final artifact.');
    expect(formatted).toContain('Omit workingDirectory in spawned chapter sessions unless a different directory is explicitly required, so they inherit the current session working directory.');
    expect(formatted).toContain('Record chapter-agent handoff notes with source gaps and unresolved assumptions.');
    expect(formatted).toContain('Only final_synthesis_owner may write the final synthesized deliverable after cross-chapter review.');
  });

  it('includes scoped orchestration instructions for complex professional document plans', () => {
    const formatted = formatTaskContractContext({
      ...contract,
      taskType: 'document',
      documentQualityMode: 'professional_document',
      documentPlan: {
        sections: ['项目概况', '技术方案', '施工进度', '成本风险'],
        tables: [],
        charts: [],
        enhancements: [],
        citations: [],
        deliveryFormats: ['MD'],
        agentPlan: {
          mode: 'chapter_agents',
          finalSynthesisOwner: 'final_synthesis_owner',
          assignments: [
            {
              id: 'chapter-agent-1',
              title: '项目概况',
              role: 'source_evidence_agent',
              reviewFocus: 'scope and evidence',
            },
          ],
          reviewStages: ['Chapter evidence review before synthesis.'],
          guardrails: ['Only the final synthesis owner may write or replace the final deliverable after chapter drafts are reviewed.'],
        },
      },
    });

    expect(formatted).toContain('Because a Document agent plan is present, the main session must decide orchestration before drafting and use spawn_session');
    expect(formatted).toContain('Spawned helper sessions must inherit selected sources or name the same knowledge-base/source slugs');
    expect(formatted).toContain('The main session remains the final synthesis owner and must resolve helper handoffs before writing the final deliverable.');
  });

  it('includes document evidence matrix entries when available', () => {
    const formatted = formatTaskContractContext({
      ...contract,
      taskType: 'document',
      documentPlan: {
        sections: ['摘要'],
        tables: [],
        charts: [],
        enhancements: [],
        citations: [],
        deliveryFormats: ['MD'],
        evidenceMatrix: [
          {
            id: 'evidence-source-1',
            source: 'tender.pdf',
            sourceType: 'file',
            supports: 'Source-backed claims, tables, visuals, and gaps.',
            reliabilityNote: 'User-provided file; cite page or clause before treating as verified.',
            citationFields: ['source', 'locator', 'claim'],
            reuseStatus: 'candidate',
          },
        ],
      },
    });

    expect(formatted).toContain('Evidence matrix:');
    expect(formatted).toContain('1. tender.pdf [file] supports Source-backed claims, tables, visuals, and gaps.');
    expect(formatted).toContain('Reliability: User-provided file; cite page or clause before treating as verified.');
    expect(formatted).toContain('Citation fields: source, locator, claim');
    expect(formatted).toContain('Reuse: candidate');
  });

  it('includes professional document section, table, chart, citation, and delivery plan items', () => {
    const formatted = formatTaskContractContext({
      ...contract,
      taskType: 'document',
      documentQualityMode: 'professional_document',
      documentPlan: {
        sections: ['执行摘要', '施工组织方案', '风险与对策'],
        tables: ['风险矩阵', '资源计划表'],
        charts: ['A3 landscape construction Gantt'],
        enhancements: ['Render professional visuals from verified source data.'],
        citations: ['Cite tender.pdf page or clause for key requirements.'],
        deliveryFormats: ['MD', 'DOCX'],
      },
    });

    expect(formatted).toContain('Document section plan:');
    expect(formatted).toContain('1. 执行摘要');
    expect(formatted).toContain('Document table plan:');
    expect(formatted).toContain('1. 风险矩阵');
    expect(formatted).toContain('Document chart plan:');
    expect(formatted).toContain('1. A3 landscape construction Gantt');
    expect(formatted).toContain('Document citation plan:');
    expect(formatted).toContain('1. Cite tender.pdf page or clause for key requirements.');
    expect(formatted).toContain('Document delivery formats:');
    expect(formatted).toContain('2. DOCX');
  });

  it('includes strict delivery review gates when available', () => {
    const formatted = formatTaskContractContext({
      ...contract,
      taskType: 'document',
      documentQualityMode: 'strict_delivery',
      documentPlan: {
        sections: ['摘要'],
        tables: [],
        charts: [],
        enhancements: [],
        citations: [],
        deliveryFormats: ['PDF', 'DOCX'],
        deliveryReviewPlan: {
          mode: 'strict_delivery',
          failureAction: 'needs_review_or_auto_improve',
          gates: [
            {
              id: 'source_integrity',
              requirement: 'Source-backed claims must cite evidence.',
              evidence: 'Evidence matrix entries with locators.',
            },
            {
              id: 'export_files',
              requirement: 'Requested export formats must exist.',
              evidence: 'Verified output files for PDF and DOCX.',
            },
          ],
        },
      },
    });

    expect(formatted).toContain('Delivery review plan:');
    expect(formatted).toContain('Failure action: needs_review_or_auto_improve');
    expect(formatted).toContain('1. source_integrity requires Source-backed claims must cite evidence. Evidence: Evidence matrix entries with locators.');
    expect(formatted).toContain('2. export_files requires Requested export formats must exist. Evidence: Verified output files for PDF and DOCX.');
    expect(formatted).toContain('Document workflow execution protocol:');
    expect(formatted).toContain('Resolve source, template, export, visual, and format gates before claiming strict delivery.');
    expect(formatted).toContain('Write missing gate evidence into the artifact or report the gate as blocked.');
  });

  it('returns undefined when no contract is available', () => {
    expect(formatTaskContractContext(undefined)).toBeUndefined();
  });
});

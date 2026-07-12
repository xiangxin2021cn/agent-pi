import type { Message } from '@craft-agent/core/types'
import type {
  SessionDocumentDeliveryGate,
  SessionDocumentEvidenceMatrixEntry,
  SessionGoalAuditEvidence,
  SessionGoalFailureCategory,
  SessionGoalAuditResult,
  SessionGoalState,
  SessionRequirementLedgerEntry,
  SessionTaskContract,
  ContextPressureInput,
} from '@craft-agent/shared/sessions'
import { getContextPressureSignal, getOrchestrationEntropySignal } from '@craft-agent/shared/sessions'
import { basename, extname } from 'path'
import { pathStartsWith } from '@craft-agent/shared/utils'
import { COMPREHENSIVE_QUALITY_CRITERION_TEXT, DOCUMENT_QUALITY_REQUIRED_CRITERION_TEXT, FILE_OUTPUT_REQUIRED_CRITERION_TEXT, MAX_AUTOMATIC_GOAL_REPAIR_PASSES, OUTPUT_FORMAT_REQUIRED_CRITERION_PREFIX, TEMPLATE_FIDELITY_REQUIRED_CRITERION_TEXT, TOOL_VERIFICATION_REQUIRED_CRITERION_TEXT, VISUAL_BLOCK_AUDIT_REQUIRED_CRITERION_TEXT, formatTaskContractForPrompt } from './goal-criteria'
import { analyzeDocumentQuality, formatDocumentQualityReport } from './document-quality'
import { analyzeVisualOpportunities } from '../documents/visual-opportunity'
import { auditTemplateFidelity, type TemplateFidelityAudit } from '../documents/template-fidelity'
import { auditExportedArtifact } from '../documents/export-quality'
import { validateEvidenceMatrixArtifact } from './evidence-matrix-artifact'
import { extractTenderSubmissionEvidence, extractTenderWorkspaceEvidence } from './tender-workspace-evidence'
import { extractDeliveryReportingEvidence, extractDeliveryWorkspaceEvidence } from './delivery-workspace-evidence'
import type { ExtractedTemplateProfile } from '../documents/template-profile'
import type { VisualPlan } from '@craft-agent/shared/document-visuals'

const SUBSTANTIVE_WORK_PRODUCT_MISSING = 'Substantive work product was not produced for the requested high-quality comprehensive deliverable.'
const EXPLICIT_USER_REQUIREMENT_PREFIX = 'Must satisfy explicit user requirement: '
const HUMAN_CONFIRMATION_REQUIRED_CRITERION = 'Assistant requested user confirmation before continuing.'
export const GOAL_FULL_TEXT_AUDIT_MAX_BYTES = 5 * 1024 * 1024

export type GoalControllerDecision =
  | { action: 'skip' }
  | { action: 'complete'; goalState: SessionGoalState; result: SessionGoalAuditResult; verifiedOutputPaths: string[] }
  | { action: 'needs_review'; goalState: SessionGoalState; result: SessionGoalAuditResult; reason: string }
  | { action: 'continue'; goalState: SessionGoalState; result: SessionGoalAuditResult; prompt: string }

export interface GoalReviewInput {
  goalState: SessionGoalState
  messages: Message[]
  finalAssistant: Message
  result: SessionGoalAuditResult
  reviewerPerformanceMemory?: string
}

export interface GoalReviewResult {
  status: SessionGoalAuditResult['status']
  summary: string
  missingCriteria?: string[]
  failureCategories?: SessionGoalFailureCategory[]
  correctivePrompt?: string
  evidence?: SessionGoalAuditEvidence[]
}

export interface GoalFileVerificationResult {
  exists: boolean
  readable?: boolean
  isFile?: boolean
  sizeBytes?: number
  preview?: string
  previewTruncated?: boolean
  auditContent?: string
  auditContentOversized?: boolean
  error?: string
}

export type GoalFileVerifier = (filePath: string) => Promise<GoalFileVerificationResult> | GoalFileVerificationResult

export interface GoalEvidencePackageInput {
  goalState: SessionGoalState
  messages: Message[]
  finalAssistant?: Message
  result: SessionGoalAuditResult
}

export type GoalEvidencePackageWriter = (input: GoalEvidencePackageInput) => Promise<SessionGoalAuditEvidence | undefined> | SessionGoalAuditEvidence | undefined

export interface GoalSpawnedSessionSummary {
  id: string
  name?: string
  messageCount: number
  hasFinalAssistant: boolean
  firstUserMessagePreview?: string
  finalAssistantPreview?: string
  taskId?: string
  reportPath?: string
  reportPathExists?: boolean
  reportSize?: number
  handoffStatus?: 'not_applicable' | 'pending' | 'ready' | 'missing' | 'failed'
  handoffContent?: string
}

export interface GoalTurnSnapshot {
  messages: Message[]
  turnStartFinalMessageId?: string
  stoppedReason: 'complete' | 'interrupted' | 'error' | 'timeout'
  now?: number
  expectedOutputDirectory?: string
  reviewer?: (input: GoalReviewInput) => Promise<GoalReviewResult>
  evidencePackageWriter?: GoalEvidencePackageWriter
  fileVerifier?: GoalFileVerifier
  contextPressure?: ContextPressureInput
  spawnedSessions?: GoalSpawnedSessionSummary[]
}

export class GoalController {
  async onTurnStopped(goalState: SessionGoalState | undefined, snapshot: GoalTurnSnapshot): Promise<GoalControllerDecision> {
    if (!goalState || goalState.mode === 'off') {
      return { action: 'skip' }
    }

    const now = snapshot.now ?? Date.now()
    const iteration = goalState.iteration + 1
    const turnMessages = getMessagesAfterFinalAssistant(snapshot.messages, snapshot.turnStartFinalMessageId)
    const finalAssistant = [...turnMessages].reverse().find(message =>
      message.role === 'assistant' && !message.isIntermediate && message.content.trim().length > 0
    )
    const errorMessages = turnMessages.filter(message => message.role === 'error')
    const failedTools = getUnresolvedFailedTools(turnMessages)
      .filter(message => !isTransientSessionDataToolFailure(message))
    const codeVerificationDiagnosticTools = getCodeVerificationDiagnosticTools(goalState, failedTools)
    const codeVerificationDiagnosticIds = new Set(codeVerificationDiagnosticTools.map(getMessageIdentity))
    const blockingFailedTools = failedTools.filter(message => !codeVerificationDiagnosticIds.has(getMessageIdentity(message)))
    const artifactWriteFailures = blockingFailedTools.filter(isLongDocumentArtifactWriteFailure)
    const unauthorizedWorkspaceDiscovery = getUnauthorizedWorkspaceDiscoveryMessages(goalState, turnMessages)

    const evidence: SessionGoalAuditEvidence[] = []
    const fileEvidencePaths = new Set<string>()
    const outputFileEvidencePaths = new Set<string>()
    const implicitOutputCandidatePaths = new Set<string>()
    const verifiedOutputPaths = new Set<string>()
    const tenderReadinessIssues: string[] = []
    const deliveryReadinessIssues: string[] = []
    if (finalAssistant) {
      evidence.push({
        type: 'message',
        label: 'final_assistant_message',
        detail: finalAssistant.id,
      })
    }
    const humanInputRequest = finalAssistant ? detectBlockingHumanInputRequest(finalAssistant.content) : undefined
    if (humanInputRequest) {
      evidence.push({
        type: 'message',
        label: 'human_input_requested',
        detail: humanInputRequest.slice(0, 500),
      })
    }
    for (const message of turnMessages) {
      if (message.role !== 'user') continue
      for (const attachment of message.attachments ?? []) {
        const path = attachment.storedPath.trim()
        if (!path) continue
        fileEvidencePaths.add(path)
        evidence.push({
          type: 'file',
          label: 'user_attachment',
          detail: path.slice(0, 500),
        })
      }
    }
    for (const message of turnMessages) {
      if (message.role !== 'tool') continue
      const inputPaths = extractFilePaths(message.toolInput)
      const resultPaths = extractFilePathsFromText(message.toolResult)
      if (isSuccessfulTool(message) && isCommandOutputCandidateTool(message.toolName)) {
        for (const path of resultPaths) implicitOutputCandidatePaths.add(path)
      }
      const paths = new Set([
        ...inputPaths,
        ...resultPaths,
      ])
      for (const path of extractOutputFilePaths(message, inputPaths, resultPaths)) {
        outputFileEvidencePaths.add(path)
        paths.add(path)
      }
      for (const path of paths) {
        fileEvidencePaths.add(path)
        evidence.push({
          type: 'file',
          label: message.toolName ?? 'tool_file',
          detail: path.slice(0, 500),
        })
      }
    }
    const tenderWorkspaceEvidence = extractTenderWorkspaceEvidence(turnMessages)
    const tenderSubmissionEvidence = extractTenderSubmissionEvidence(turnMessages)
    const deliveryWorkspaceEvidence = extractDeliveryWorkspaceEvidence(turnMessages)
    const deliveryReportingEvidence = extractDeliveryReportingEvidence(turnMessages)
    if (tenderWorkspaceEvidence) {
      evidence.push({
        type: 'tool',
        label: 'tender_workspace_readiness',
        detail: JSON.stringify({
          status: tenderWorkspaceEvidence.status,
          projectId: tenderWorkspaceEvidence.projectId,
          revision: tenderWorkspaceEvidence.revision,
          readiness: tenderWorkspaceEvidence.readiness,
          issueCodes: tenderWorkspaceEvidence.issueCodes,
          modelPath: tenderWorkspaceEvidence.modelPath,
          auditPath: tenderWorkspaceEvidence.auditPath,
          error: tenderWorkspaceEvidence.error,
        }),
      })
    }
    if (tenderSubmissionEvidence) {
      evidence.push({
        type: 'tool',
        label: 'tender_submission_readiness',
        detail: JSON.stringify(tenderSubmissionEvidence),
      })
    }
    if (deliveryWorkspaceEvidence) {
      evidence.push({
        type: 'tool',
        label: 'delivery_workspace_readiness',
        detail: JSON.stringify(deliveryWorkspaceEvidence),
      })
    }
    if (deliveryReportingEvidence) {
      evidence.push({
        type: 'tool',
        label: 'delivery_reporting_readiness',
        detail: JSON.stringify(deliveryReportingEvidence),
      })
    }
    if (requiresSubmissionReadyTender(goalState)) {
      if (!tenderWorkspaceEvidence) {
        tenderReadinessIssues.push('Submission-ready tender delivery requires a successful tender_workspace validation result.')
      } else if (tenderWorkspaceEvidence.status !== 'valid') {
        tenderReadinessIssues.push(`Tender Workspace evidence is ${tenderWorkspaceEvidence.status}: ${tenderWorkspaceEvidence.error ?? 'invalid readiness payload'}`)
      } else if (tenderWorkspaceEvidence.readiness !== 'ready') {
        tenderReadinessIssues.push(`Tender Workspace readiness is ${tenderWorkspaceEvidence.readiness}; submission-ready delivery requires ready.`)
      }
      if (!tenderSubmissionEvidence) {
        tenderReadinessIssues.push('Submission-ready tender delivery requires a successful submission_audit validation result.')
      } else if (tenderSubmissionEvidence.status !== 'valid') {
        tenderReadinessIssues.push(`Tender submission audit evidence is ${tenderSubmissionEvidence.status}: ${tenderSubmissionEvidence.error ?? 'invalid readiness payload'}`)
      } else if (tenderSubmissionEvidence.readiness !== 'ready') {
        tenderReadinessIssues.push(`Tender submission audit readiness is ${tenderSubmissionEvidence.readiness}; submission-ready delivery requires ready.`)
      }
    }
    if (requiresFormalDeliveryPeriodClose(goalState)) {
      if (!deliveryWorkspaceEvidence) {
        deliveryReadinessIssues.push('Formal delivery period close requires a successful delivery_workspace validation result.')
      } else if (deliveryWorkspaceEvidence.status !== 'valid') {
        deliveryReadinessIssues.push(`Delivery Workspace evidence is ${deliveryWorkspaceEvidence.status}: ${deliveryWorkspaceEvidence.error ?? 'invalid readiness payload'}`)
      } else if (deliveryWorkspaceEvidence.readiness !== 'ready') {
        deliveryReadinessIssues.push(`Delivery Workspace readiness is ${deliveryWorkspaceEvidence.readiness}; formal period close requires ready.`)
      }
      if (!deliveryReportingEvidence) {
        deliveryReadinessIssues.push('Formal delivery period close requires a successful reporting_audit validation result.')
      } else if (deliveryReportingEvidence.status !== 'valid') {
        deliveryReadinessIssues.push(`Delivery reporting audit evidence is ${deliveryReportingEvidence.status}: ${deliveryReportingEvidence.error ?? 'invalid readiness payload'}`)
      } else if (deliveryReportingEvidence.readiness !== 'ready') {
        deliveryReadinessIssues.push(`Delivery reporting audit readiness is ${deliveryReportingEvidence.readiness}; formal period close requires ready.`)
      }
    }

    const fileVerificationIssues: string[] = []
    const contentVerificationIssues: string[] = []
    const toolVerificationIssues: string[] = []
    const deterministicFailureCategories = new Set<SessionGoalFailureCategory>()
    if (goalState.taskContract) {
      evidence.push({
        type: 'system',
        label: 'task_contract',
        detail: formatTaskContractForPrompt(goalState.taskContract).slice(0, 3000),
      })
    }
    const contextPressure = getContextPressureSignal(snapshot.contextPressure ?? { enabledSourceCount: 0 })
    if (contextPressure) {
      evidence.push({
        type: 'system',
        label: `context_pressure_${contextPressure.level}`,
        detail: contextPressure.detail,
      })
    }
    if (unauthorizedWorkspaceDiscovery.length > 0) {
      deterministicFailureCategories.add('scope_gap')
      contentVerificationIssues.push('Unauthorized working directory discovery occurred under selected-source hard-boundary policy.')
      evidence.push({
        type: 'tool',
        label: 'unauthorized_workspace_discovery',
        detail: unauthorizedWorkspaceDiscovery.map(summarizeToolVerificationMessage).join('\n').slice(0, 1200),
      })
    }
    const requiredOutputFormats = getRequiredOutputFormats(goalState)
    promoteFormalOutputFileEvidencePaths({
      candidatePaths: implicitOutputCandidatePaths,
      outputFileEvidencePaths,
      expectedOutputDirectory: snapshot.expectedOutputDirectory,
      requiredOutputFormats,
    })
    if (requiresOutputFileEvidence(goalState) && outputFileEvidencePaths.size === 0) {
      fileVerificationIssues.push('No verifiable output file path was produced for the requested file deliverable.')
      evidence.push({
        type: 'file',
        label: 'file_evidence_missing',
        detail: 'No file path was captured from tool input or tool output.',
      })
    }
    const previousEvidenceCheckpointRequired = latestFailedAuditHasCategory(goalState.auditHistory, 'evidence_gap')
    if (previousEvidenceCheckpointRequired && fileEvidencePaths.size === 0) {
      fileVerificationIssues.push('Previous audit required file, source, or artifact evidence, but none was captured in this turn.')
      evidence.push({
        type: 'file',
        label: 'previous_evidence_checkpoint_missing',
        detail: 'No file path, source attachment, or artifact path was captured from the current turn.',
      })
    }
    if (requiresOutputFileEvidence(goalState) && snapshot.expectedOutputDirectory && outputFileEvidencePaths.size > 0) {
      for (const filePath of outputFileEvidencePaths) {
        if (pathStartsWith(filePath, snapshot.expectedOutputDirectory)) continue
        fileVerificationIssues.push(`Requested output file was not written to the formal output directory: ${filePath} (expected under: ${snapshot.expectedOutputDirectory})`)
        evidence.push({
          type: 'file',
          label: 'file_wrong_output_directory',
          detail: filePath.slice(0, 500),
        })
      }
    }
    if (requiredOutputFormats.length > 0) {
      const producedFormats = new Set([...outputFileEvidencePaths].flatMap(getOutputFormatsForPath))
      for (const format of requiredOutputFormats) {
        if (producedFormats.has(format)) continue
        fileVerificationIssues.push(`Requested output format was not produced: ${format}.`)
        evidence.push({
          type: 'file',
          label: 'file_wrong_output_format',
          detail: [...outputFileEvidencePaths].join(', ').slice(0, 500),
        })
      }
    }
    const outputAuditTexts: string[] = []
    const verifiedFileContents = new Map<string, string>()
    if (snapshot.fileVerifier && fileEvidencePaths.size > 0) {
      for (const filePath of fileEvidencePaths) {
        const verification = await snapshot.fileVerifier(filePath)
        const isOutputFile = outputFileEvidencePaths.has(filePath)
        const artifactDeliverable = isOutputFile
          ? findArtifactDeliverableForPath(goalState.taskContract, filePath)
          : undefined
        const issue = buildFileVerificationIssue(filePath, verification)
        if (artifactDeliverable && verification.exists && verification.readable !== false && verification.isFile !== false) {
          const visualPlan = goalState.taskContract?.documentPlan?.visualPlan
          const exportReport = await auditExportedArtifact({
            path: filePath,
            deliverable: artifactDeliverable,
            requireVisualEvidence: (visualPlan?.selectedKinds.length ?? 0) > 0,
            pageIntent: visualPlan?.auditRequirements.some(item => /landscape/i.test(item))
              ? { orientation: 'landscape' }
              : undefined,
          })
          evidence.push({
            type: 'file',
            label: exportReport.passed ? 'artifact_export_quality_passed' : 'artifact_export_quality_failed',
            detail: [
              filePath,
              `format=${exportReport.format}`,
              `validation=${exportReport.achievedValidationLevel}/${exportReport.declaredValidationLevel}`,
              ...exportReport.issues,
              ...exportReport.limitations,
            ].join('\n').slice(0, 3000),
          })
          if (!exportReport.passed) {
            contentVerificationIssues.push(`Export quality audit did not pass for ${filePath}: ${exportReport.issues.join(' ')}`)
          }
        }
        if (issue) {
          fileVerificationIssues.push(issue)
          evidence.push({
            type: 'file',
            label: buildFileVerificationEvidenceLabel(verification),
            detail: filePath.slice(0, 500),
          })
        } else {
          const size = typeof verification.sizeBytes === 'number' ? ` (${verification.sizeBytes} bytes)` : ''
          evidence.push({
            type: 'file',
            label: 'file_verified',
            detail: `${filePath}${size}`.slice(0, 500),
          })
          const preview = verification.preview?.trim()
          const verifiedContent = verification.auditContent?.trim() || preview
          if (verifiedContent) verifiedFileContents.set(filePath, verifiedContent)
          if (isOutputFile) {
            verifiedOutputPaths.add(filePath)
            evidence.push({
              type: 'file',
              label: 'output_file_verified',
              detail: filePath.slice(0, 500),
            })
          }
          if (isOutputFile && verification.auditContentOversized && requiresFullTextArtifactAudit(goalState)) {
            contentVerificationIssues.push(
              `Full document audit was not performed because output exceeds the ${GOAL_FULL_TEXT_AUDIT_MAX_BYTES} byte safety limit: ${filePath}`,
            )
            evidence.push({
              type: 'file',
              label: 'file_full_audit_oversized',
              detail: filePath.slice(0, 500),
            })
          }
          if (isOutputFile) {
            const auditContent = verification.auditContent?.trim() || preview
            if (auditContent) outputAuditTexts.push(auditContent)
          }
          if (preview) {
            evidence.push({
              type: 'file',
              label: buildFilePreviewEvidenceLabel(verification, isOutputFile),
              detail: `${filePath}\n${preview}`.slice(0, 3000),
            })
          }
        }
      }
    }
    const sourceFileEvidencePaths = [...fileEvidencePaths].filter(filePath => !outputFileEvidencePaths.has(filePath))
    if (
      finalAssistant
      && sourceFileEvidencePaths.length > 0
      && requiresSourceCitationMarker(goalState)
      && !hasSourceCitationMarker([finalAssistant.content, ...outputAuditTexts], sourceFileEvidencePaths)
    ) {
      fileVerificationIssues.push('Final response did not include a source citation marker for required source evidence.')
      evidence.push({
        type: 'message',
        label: 'source_citation_marker_missing',
        detail: finalAssistant.id,
      })
    }
    if (
      finalAssistant
      && requiresSubstantiveWorkProduct(goalState)
      && !hasSubstantiveWorkProduct([finalAssistant.content, ...outputAuditTexts])
    ) {
      contentVerificationIssues.push(SUBSTANTIVE_WORK_PRODUCT_MISSING)
      evidence.push({
        type: 'message',
        label: 'substantive_content_missing',
        detail: finalAssistant.id,
      })
    }
    const previousShallowOutputCheckpointRequired = latestFailedAuditHasCategory(goalState.auditHistory, 'shallow_output')
    if (
      finalAssistant
      && previousShallowOutputCheckpointRequired
      && !hasSubstantiveWorkProduct([finalAssistant.content, ...outputAuditTexts])
    ) {
      contentVerificationIssues.push('Previous audit required substantive content, but this turn still produced a shallow deliverable.')
      evidence.push({
        type: 'message',
        label: 'previous_shallow_output_checkpoint_missing',
        detail: finalAssistant.id,
      })
    }
    const outputTexts = finalAssistant ? [finalAssistant.content, ...outputAuditTexts] : outputAuditTexts
    const unverifiedMatrixClaims: string[] = []
    if (requiresEvidenceMatrixAudit(goalState)) {
      for (const filePath of fileEvidencePaths) {
        if (basename(filePath).toLowerCase() !== 'evidence-matrix.json') continue
        const matrixAudit = validateEvidenceMatrixArtifact(verifiedFileContents.get(filePath) ?? '')
        unverifiedMatrixClaims.push(...matrixAudit.unverifiedClaims)
        evidence.push({
          type: 'system',
          label: 'evidence_matrix_schema_audit',
          detail: [
            `status: ${matrixAudit.valid ? 'pass' : 'fail'}`,
            `sourceCount: ${matrixAudit.sourceCount}`,
            `verifiedClaimCount: ${matrixAudit.verifiedClaimCount}`,
            `issues: ${matrixAudit.issues.join(' ') || '(none)'}`,
          ].join('\n'),
        })
        if (!matrixAudit.valid) {
          contentVerificationIssues.push(`Evidence matrix schema audit did not pass: ${matrixAudit.issues.join(' ')}`)
        }
      }
    }
    if (finalAssistant && requiresDocumentQualityAudit(goalState)) {
      const report = analyzeDocumentQuality({
        contents: outputAuditTexts.length > 0 ? outputAuditTexts : [finalAssistant.content],
        sourceFilePaths: sourceFileEvidencePaths,
        strict: goalState.mode === 'strict_work' || isStrictDeliveryContract(goalState),
        allowVisibleInternalArtifacts: goalState.taskContract?.documentPlan?.artifactVisibility?.visibleInternal,
        tableLed: goalState.taskContract?.documentPlan?.artifactVisibility?.tableLed,
      })
      evidence.push({
        type: 'system',
        label: 'document_quality_report',
        detail: formatDocumentQualityReport(report).slice(0, 3000),
      })
      if (!report.passed) {
        const issueSummary = report.issues.length > 0 ? report.issues.join(' ') : 'Document quality score is below the required threshold.'
        contentVerificationIssues.push(`Document quality audit did not pass (${report.score}/${report.threshold}): ${issueSummary}`)
      }
    }
    if (finalAssistant && requiresEvidenceMatrixAudit(goalState)) {
      const report = auditEvidenceMatrixUsage(outputTexts, goalState)
      evidence.push({
        type: 'system',
        label: 'evidence_matrix_audit',
        detail: formatEvidenceMatrixAudit(report).slice(0, 3000),
      })
      if (!report.passed) {
        contentVerificationIssues.push(`Evidence matrix audit did not pass: ${report.issues.join(' ')}`)
      }
    }
    if (finalAssistant && requiresVisualBlockAudit(goalState)) {
      const report = auditVisualBlocks(outputTexts, goalState)
      evidence.push({
        type: 'system',
        label: 'visual_block_audit',
        detail: formatVisualBlockAudit(report).slice(0, 3000),
      })
      if (!report.passed) {
        contentVerificationIssues.push(`Visual block audit did not pass: ${report.issues.join(' ')}`)
      }
    }
    if (finalAssistant && requiresTemplateFidelityAudit(goalState)) {
      const report = auditTemplateOutput(outputTexts, goalState)
      evidence.push({
        type: 'system',
        label: 'template_fidelity_audit',
        detail: formatTemplateFidelityAudit(report).slice(0, 3000),
      })
      if (!report.passed) {
        contentVerificationIssues.push(`Template fidelity audit did not pass (${report.score}/100): ${report.issues.join(' ')}`)
      }
    }
    if (finalAssistant && requiresDocumentAgentPlanAudit(goalState)) {
      const report = auditDocumentAgentPlan(outputTexts, goalState, snapshot.spawnedSessions ?? [])
      evidence.push({
        type: 'system',
        label: 'document_agent_plan_audit',
        detail: formatDocumentAgentPlanAudit(report).slice(0, 3000),
      })
      if (!report.passed) {
        contentVerificationIssues.push(`Multi-agent deep audit did not pass: ${report.issues.join(' ')}`)
      }
    }
    const previousScopeCheckpointRequired = latestFailedAuditHasCategory(goalState.auditHistory, 'scope_gap')
    if (finalAssistant && goalState.taskContract && hasObviousScopeReduction(outputTexts)) {
      contentVerificationIssues.push('Task contract appears to have been reduced to a summary, outline, placeholder, or deferred follow-up instead of the requested deliverable.')
      evidence.push({
        type: 'message',
        label: 'task_contract_scope_reduced',
        detail: finalAssistant.id,
      })
    }
    if (finalAssistant && previousScopeCheckpointRequired && hasObviousScopeReduction(outputTexts)) {
      contentVerificationIssues.push('Previous audit required restoring full scope, but this turn still narrowed or deferred the requested deliverable.')
      evidence.push({
        type: 'message',
        label: 'previous_scope_checkpoint_missing',
        detail: finalAssistant.id,
      })
    }
    if (finalAssistant) {
      for (const requirement of getExplicitUserRequirements(goalState)) {
        if (hasExplicitUserRequirement([finalAssistant.content, ...outputAuditTexts], requirement)) continue
        contentVerificationIssues.push(`Final response or verified output preview did not address explicit user requirement: ${requirement}.`)
        evidence.push({
          type: 'message',
          label: 'explicit_user_requirement_missing',
          detail: requirement.slice(0, 500),
        })
      }
    }
    const toolVerificationMessages = getSuccessfulToolVerificationMessages(turnMessages)
    const previousVerificationCheckpointRequired = latestFailedAuditHasCategory(goalState.auditHistory, 'verification_gap')
    if (requiresToolVerificationEvidence(goalState) || previousVerificationCheckpointRequired) {
      if (toolVerificationMessages.length === 0) {
        toolVerificationIssues.push(previousVerificationCheckpointRequired
          ? 'Previous audit required verification evidence, but no successful tool evidence was produced in this turn.'
          : 'No successful tool evidence was produced for the requested verification step.')
        evidence.push({
          type: 'tool',
          label: previousVerificationCheckpointRequired ? 'previous_verification_checkpoint_missing' : 'tool_verification_missing',
          detail: 'No completed verification, test, build, lint, typecheck, or validation tool run was captured.',
        })
      } else {
        for (const message of toolVerificationMessages) {
          evidence.push({
            type: 'tool',
            label: 'tool_verification_evidence',
            detail: summarizeToolVerificationMessage(message),
          })
        }
      }
    }
    const deliveryReviewGateAudit = auditDeliveryReviewGates(goalState, {
      fileVerificationIssues,
      contentVerificationIssues,
      toolVerificationIssues,
      outputTexts,
      sourceFileEvidencePaths,
    })
    evidence.push(...deliveryReviewGateAudit.evidence)

    for (const message of errorMessages) {
      evidence.push({
        type: 'system',
        label: 'error_message',
        detail: message.content.slice(0, 500),
      })
    }
    for (const message of failedTools) {
      evidence.push({
        type: 'tool',
        label: message.toolName ?? 'tool_error',
        detail: message.toolResult?.slice(0, 500),
      })
    }
    if (finalAssistant) {
      const assumptionIssues = auditUnverifiedAssumptionsInCoreConclusions(outputTexts, unverifiedMatrixClaims)
      if (assumptionIssues.length > 0) {
        contentVerificationIssues.push(...assumptionIssues)
        evidence.push({
          type: 'system',
          label: 'unverified_assumption_conclusion_audit',
          detail: assumptionIssues.join('\n'),
        })
      }
    }
    for (const message of artifactWriteFailures) {
      evidence.push({
        type: 'tool',
        label: 'artifact_write_failure',
        detail: summarizeArtifactWriteFailure(message),
      })
    }
    if (codeVerificationDiagnosticTools.length > 0) {
      evidence.push({
        type: 'tool',
        label: 'code_verification_diagnostics',
        detail: codeVerificationDiagnosticTools.map(summarizeToolVerificationMessage).join('\n').slice(0, 1200),
      })
    }
    const orchestrationEntropy = getOrchestrationEntropySignal({
      enabledSourceCount: snapshot.contextPressure?.enabledSourceCount ?? goalState.orchestration?.policy.selectedSourceSlugs.length ?? 0,
      spawnedSessionCount: snapshot.spawnedSessions?.length ?? goalState.orchestration?.subAgents.length ?? 0,
      failedToolCount: blockingFailedTools.length,
      artifactWriteFailureCount: artifactWriteFailures.length,
      workspaceDiscoveryCount: unauthorizedWorkspaceDiscovery.length,
      now,
    })
    if (orchestrationEntropy) {
      evidence.push({
        type: 'system',
        label: `orchestration_entropy_${orchestrationEntropy.level}`,
        detail: `score=${orchestrationEntropy.score}; reasons=${orchestrationEntropy.reasons.join(', ')}`,
      })
    }

    const missingCriteria: string[] = []
    let status: SessionGoalAuditResult['status'] = 'pass'
    let summary = 'Goal audit passed deterministic completion checks.'

    if (snapshot.stoppedReason !== 'complete') {
      status = 'fail'
      deterministicFailureCategories.add('tool_failure')
      missingCriteria.push(`Turn stopped with reason: ${snapshot.stoppedReason}`)
      summary = `Goal audit failed because the turn stopped with reason: ${snapshot.stoppedReason}.`
    }

    if (!finalAssistant) {
      status = 'fail'
      deterministicFailureCategories.add('scope_gap')
      missingCriteria.push('No final assistant response was produced in this turn.')
      summary = 'Goal audit failed because no final assistant response was produced.'
    }

    if (humanInputRequest) {
      status = 'uncertain'
      missingCriteria.push(HUMAN_CONFIRMATION_REQUIRED_CRITERION)
      if (summary === 'Goal audit passed deterministic completion checks.') {
        summary = 'Goal audit paused because the assistant requested user confirmation before continuing.'
      }
    }

    if (errorMessages.length > 0 || blockingFailedTools.length > 0) {
      status = 'fail'
      deterministicFailureCategories.add('tool_failure')
      if (errorMessages.length > 0) missingCriteria.push(`${errorMessages.length} error message(s) were produced.`)
      if (blockingFailedTools.length > 0) missingCriteria.push(`${blockingFailedTools.length} tool failure(s) were produced.`)
      summary = 'Goal audit failed because this turn produced errors.'
    }

    if (codeVerificationDiagnosticTools.length > 0) {
      status = 'fail'
      deterministicFailureCategories.add('verification_gap')
      missingCriteria.push('Code verification diagnostics failed and must be fixed before completion.')
      if (summary === 'Goal audit passed deterministic completion checks.' || summary === 'Goal audit failed because requested verification tool evidence was missing.') {
        summary = 'Goal audit failed because code verification diagnostics reported errors.'
      }
    }

    if (latestFailedAuditHasCategory(goalState.auditHistory, 'tool_failure') && !turnMessages.some(isSuccessfulTool)) {
      status = 'fail'
      deterministicFailureCategories.add('tool_failure')
      missingCriteria.push('Previous audit required resolving a failed tool, but no successful tool execution was captured in this turn.')
      evidence.push({
        type: 'tool',
        label: 'previous_tool_failure_checkpoint_missing',
        detail: 'No completed tool execution was captured after a prior tool failure.',
      })
      if (summary === 'Goal audit passed deterministic completion checks.') {
        summary = 'Goal audit failed because the previous tool failure was not resolved with successful tool evidence.'
      }
    }

    if (fileVerificationIssues.length > 0) {
      status = 'fail'
      deterministicFailureCategories.add('evidence_gap')
      missingCriteria.push(...fileVerificationIssues)
      if (summary === 'Goal audit passed deterministic completion checks.') {
        summary = 'Goal audit failed because referenced file evidence could not be verified.'
      }
    }

    if (contentVerificationIssues.length > 0) {
      status = 'fail'
      deterministicFailureCategories.add(getContentVerificationFailureCategory(contentVerificationIssues))
      missingCriteria.push(...contentVerificationIssues)
      if (summary === 'Goal audit passed deterministic completion checks.') {
        summary = contentVerificationIssues.some(isEvidenceVerificationIssue)
          ? 'Goal audit failed because required evidence or source grounding was missing.'
          : 'Goal audit failed because the produced work product was too shallow for the requested quality criteria.'
      }
    }

    if (toolVerificationIssues.length > 0) {
      status = 'fail'
      deterministicFailureCategories.add('verification_gap')
      missingCriteria.push(...toolVerificationIssues)
      if (summary === 'Goal audit passed deterministic completion checks.') {
        summary = 'Goal audit failed because requested verification tool evidence was missing.'
      }
    }

    if (tenderReadinessIssues.length > 0) {
      status = 'fail'
      deterministicFailureCategories.add('evidence_gap')
      missingCriteria.push(...tenderReadinessIssues)
      if (summary === 'Goal audit passed deterministic completion checks.') {
        summary = 'Goal audit failed because the Tender Workspace is not ready for formal submission.'
      }
    }

    if (deliveryReadinessIssues.length > 0) {
      status = 'fail'
      deterministicFailureCategories.add('evidence_gap')
      missingCriteria.push(...deliveryReadinessIssues)
      if (summary === 'Goal audit passed deterministic completion checks.') {
        summary = 'Goal audit failed because Project Delivery Controls are not ready for formal period close.'
      }
    }

    if (deliveryReviewGateAudit.missingCriteria.length > 0) {
      status = 'fail'
      deterministicFailureCategories.add('evidence_gap')
      missingCriteria.push(...deliveryReviewGateAudit.missingCriteria)
      if (summary === 'Goal audit passed deterministic completion checks.') {
        summary = 'Goal audit failed because strict delivery review gates did not pass.'
      }
    }

    const pendingRequirementLedgerEntries = getPendingRequirementLedgerEntries(goalState)
    if (status === 'pass' && (
      goalState.criteria.some(criterion => criterion.required)
      || pendingRequirementLedgerEntries.length > 0
    )) {
      status = 'uncertain'
      missingCriteria.push(
        ...goalState.criteria
          .filter(criterion => criterion.required)
          .map(criterion => criterion.text),
        ...pendingRequirementLedgerEntries.map(entry => `[${entry.id}] ${entry.text}`),
      )
      summary = 'Goal audit could not prove all explicit criteria with deterministic checks only.'
    }

    let result: SessionGoalAuditResult = {
      iteration,
      status,
      summary,
      missingCriteria,
      failureCategories: status === 'pass' || deterministicFailureCategories.size === 0
        ? undefined
        : [...deterministicFailureCategories],
      evidence,
      createdAt: now,
    }

    if (snapshot.evidencePackageWriter && goalState.orchestration) {
      try {
        const packageEvidence = await snapshot.evidencePackageWriter({
          goalState,
          messages: turnMessages,
          finalAssistant,
          result,
        })
        if (packageEvidence) {
          evidence.push(packageEvidence)
          result = {
            ...result,
            evidence,
          }
        }
      } catch (error) {
        evidence.push({
          type: 'system',
          label: 'orchestration_evidence_package_error',
          detail: error instanceof Error ? error.message : String(error),
        })
        result = {
          ...result,
          evidence,
        }
      }
    }

    let reviewerFailed = false
    if (status === 'uncertain' && finalAssistant && snapshot.reviewer && !humanInputRequest) {
      try {
        const review = await snapshot.reviewer({
          goalState,
          messages: turnMessages,
          finalAssistant,
          result,
        })
        const reviewMissingCriteria = review.missingCriteria ?? (review.status === 'pass' ? [] : missingCriteria)
        const contradictoryPass = review.status === 'pass' && (reviewMissingCriteria.length > 0 || review.correctivePrompt !== undefined)
        status = contradictoryPass
          ? 'uncertain'
          : review.status
        summary = contradictoryPass
          ? 'Goal reviewer requested more work while marking the result as pass.'
          : review.summary
        result = {
          ...result,
          status,
          summary,
          missingCriteria: reviewMissingCriteria,
          failureCategories: mergeFailureCategories(result.failureCategories, review.failureCategories),
          correctivePrompt: review.correctivePrompt,
          evidence: review.evidence ? [...evidence, ...review.evidence] : evidence,
        }
      } catch (error) {
        reviewerFailed = true
        summary = 'Goal reviewer failed; manual review is required.'
        result = {
          ...result,
          status: 'uncertain',
          summary,
          evidence: [
            ...evidence,
            {
              type: 'system',
              label: 'reviewer_error',
              detail: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500),
            },
          ],
        }
      }
    }

    const repeatedFailure = hasRepeatedGoalFailure(goalState.auditHistory, result)
    const repeatedFailureCategories = getRepeatedFailureCategories(goalState.auditHistory, result)
    if (repeatedFailure) {
      result = {
        ...result,
        evidence: [
          ...result.evidence,
          {
            type: 'system',
            label: 'repeated_goal_failure',
            detail: 'The same missing criteria were reported in consecutive audits.',
          },
        ],
      }
    }
    if (repeatedFailureCategories.length > 0) {
      result = {
        ...result,
        evidence: [
          ...result.evidence,
          {
            type: 'system',
            label: 'repeated_failure_categories',
            detail: repeatedFailureCategories.join(','),
          },
        ],
      }
    }

    const shouldAutoImprove = !reviewerFailed
      && !humanInputRequest
      && !repeatedFailure
      && snapshot.stoppedReason === 'complete'
      && (status === 'uncertain' || (status === 'fail' && finalAssistant !== undefined && errorMessages.length === 0))
      && (goalState.mode === 'auto_improve' || goalState.mode === 'strict_work')
    const effectiveMaxIterations = getEffectiveMaxIterations(goalState)
    const hasRemainingIterations = iteration < effectiveMaxIterations
    const hasRemainingWallClock = goalState.budgets?.maxWallClockMs === undefined
      || now - goalState.createdAt < goalState.budgets.maxWallClockMs
    const correctivePrompt = shouldAutoImprove && hasRemainingIterations && hasRemainingWallClock
      ? buildCorrectivePrompt(goalState, result)
      : undefined
    if (correctivePrompt) {
      result.correctivePrompt = correctivePrompt
    }

    const nextGoalState: SessionGoalState = {
      ...goalState,
      taskContract: updateRequirementLedgerAfterAudit(goalState.taskContract, result),
      status: status === 'pass' ? 'passed' : correctivePrompt ? 'improving' : 'needs_review',
      iteration,
      updatedAt: now,
      orchestration: goalState.orchestration && orchestrationEntropy
        ? { ...goalState.orchestration, entropy: orchestrationEntropy, updatedAt: now }
        : goalState.orchestration,
      auditHistory: [...goalState.auditHistory, result],
    }

    if (status === 'pass') {
      return {
        action: 'complete',
        goalState: nextGoalState,
        result,
        verifiedOutputPaths: [...verifiedOutputPaths],
      }
    }

    if (correctivePrompt) {
      return {
        action: 'continue',
        goalState: nextGoalState,
        result,
        prompt: correctivePrompt,
      }
    }

    const reason = humanInputRequest
      ? 'Assistant requested user confirmation before continuing; manual review is required.'
      : repeatedFailure
      ? 'Repeated the same goal audit failure; manual review is required.'
      : shouldAutoImprove && !hasRemainingIterations
      ? `Reached maximum automatic repair passes (${effectiveMaxIterations}); manual review is required.`
      : shouldAutoImprove && !hasRemainingWallClock
      ? `Reached maximum goal wall-clock budget (${goalState.budgets?.maxWallClockMs}ms); manual review is required.`
      : status === 'uncertain'
      ? 'Deterministic audit could not prove the goal criteria.'
      : result.summary

    return {
      action: 'needs_review',
      goalState: nextGoalState,
      result,
      reason,
    }
  }
}

function buildFileVerificationIssue(filePath: string, verification: GoalFileVerificationResult): string | undefined {
  if (!verification.exists) {
    return `Referenced file was not found: ${filePath}`
  }
  if (verification.readable === false) {
    const suffix = verification.error ? ` (${verification.error})` : ''
    return `Referenced file could not be read: ${filePath}${suffix}`
  }
  if (verification.isFile === false) {
    return `Referenced path is not a file: ${filePath}`
  }
  if (verification.sizeBytes === 0) {
    return `Referenced file is empty: ${filePath}`
  }
  return undefined
}

function detectBlockingHumanInputRequest(content: string): string | undefined {
  const normalized = content.replace(/\s+/g, ' ').trim()
  if (!normalized) return undefined
  if (/<requires_user_decision\b[^>]*>[\s\S]*<\/requires_user_decision>/i.test(content)) {
    return normalized
  }

  const directRequest = /(?:我|我们)?(?:需要|需|请|请您|请你|烦请|麻烦)(?:您|你|用户|人工|手动)?[^。！？.!?]{0,80}(?:确认|选择|决定|指示|指引|补充|澄清|回答|提供)|(?:need|needs|require|requires|please)[^.!?]{0,80}(?:confirmation|input|approval|guidance|clarification|answer|choose|provide)/i.test(normalized)
  if (!directRequest) return undefined

  const blockingContext = /(?:在实际执行前|执行前|开始前|继续前|下一步前|请对以上问题|请先|等待|我会据此|才能继续|before (?:i |we )?(?:continue|proceed|start)|before continuing|before proceeding|waiting for|then (?:i|we) will proceed)/i.test(normalized)
  const questionCount = (content.match(/[?？]/g) ?? []).length
  const numberedQuestionCount = (content.match(/(?:^|\n)\s*\d+[.)、]/g) ?? []).length

  if (!blockingContext && questionCount + numberedQuestionCount < 2) {
    return undefined
  }

  return normalized
}

function getUnresolvedFailedTools(messages: Message[]): Message[] {
  const successfulToolKeys = new Set<string>()
  const unresolved: Message[] = []

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message.role !== 'tool') continue

    const key = getToolResolutionKey(message)
    if (isSuccessfulTool(message)) {
      if (key) successfulToolKeys.add(key)
      continue
    }

    if (!isFailedTool(message)) continue
    if (key && successfulToolKeys.has(key)) continue
    unresolved.unshift(message)
  }

  return unresolved
}

const CODE_VERIFICATION_TOOL_PATTERN = /(?:typecheck|tsc|test|tests|vitest|jest|pytest|playwright|lint|eslint|build|compile|check|verify|validate)/i

function getCodeVerificationDiagnosticTools(goalState: SessionGoalState, failedTools: Message[]): Message[] {
  if (goalState.taskContract?.taskType !== 'code') return []
  if (failedTools.length === 0) return []

  return failedTools.filter(message => CODE_VERIFICATION_TOOL_PATTERN.test(buildToolEvidenceText(message)))
}

function getMessageIdentity(message: Message): string {
  return message.id || message.toolUseId || `${message.role}:${message.toolName ?? ''}:${message.timestamp}:${message.content}`
}

function isFailedTool(message: Message): boolean {
  return message.role === 'tool' && (message.toolStatus === 'error' || message.isError === true)
}

function isSuccessfulTool(message: Message): boolean {
  return message.role === 'tool' && message.toolStatus === 'completed' && message.isError !== true
}

function getToolResolutionKey(message: Message): string | undefined {
  const key = message.toolName?.trim() || message.toolUseId?.trim()
  return key || undefined
}

function requiresOutputFileEvidence(goalState: SessionGoalState): boolean {
  return goalState.criteria.some(criterion =>
    criterion.required
    && criterion.kind === 'deliverable'
    && criterion.text === FILE_OUTPUT_REQUIRED_CRITERION_TEXT
  )
    || (goalState.taskContract?.artifactDeliverables?.some(deliverable => deliverable.required) ?? false)
    || (isStrictDeliveryContract(goalState) && getContractOutputFormats(goalState).length > 0)
}

function requiresSubmissionReadyTender(goalState: SessionGoalState): boolean {
  const contract = goalState.taskContract
  const text = [
    goalState.objective,
    contract?.originalRequest,
    ...(contract?.followUpRequests ?? []),
    ...(contract?.deliverables ?? []),
    ...(contract?.acceptanceCriteria ?? []),
  ].filter(Boolean).join('\n')
  const isTender = /\b(?:tender|bid)\b|投标|标书|招标/i.test(text)
  const requestsSubmissionReady = /submission[- ]ready|ready\s+for\s+(?:formal\s+)?submission|final\s+(?:tender|bid).{0,40}submission|正式递交|可(?:以)?提交|提交就绪|最终投标文件|完整投标文件/i.test(text)
  return isTender && requestsSubmissionReady
}

function requiresFormalDeliveryPeriodClose(goalState: SessionGoalState): boolean {
  const contract = goalState.taskContract
  const text = [
    goalState.objective,
    contract?.originalRequest,
    ...(contract?.followUpRequests ?? []),
    ...(contract?.deliverables ?? []),
    ...(contract?.acceptanceCriteria ?? []),
  ].filter(Boolean).join('\n')
  const isDeliveryControl = /\b(?:project delivery|delivery control|project controls?|implementation|management report)\b|项目实施|项目管理|实施控制|月报|管理报告/i.test(text)
  const requestsFormalClose = /\b(?:period close|close.{0,40}reporting period|approved management report|issue.{0,40}management report)\b|期间关闭|月度关闭|关闭.{0,20}期间|批准.{0,20}管理报告|正式月报/i.test(text)
  return isDeliveryControl && requestsFormalClose
}

function requiresToolVerificationEvidence(goalState: SessionGoalState): boolean {
  return goalState.criteria.some(criterion =>
    criterion.required
    && criterion.kind === 'test'
    && criterion.text === TOOL_VERIFICATION_REQUIRED_CRITERION_TEXT
  )
}

function requiresSourceCitationMarker(goalState: SessionGoalState): boolean {
  return goalState.criteria.some(criterion =>
    criterion.required
    && criterion.kind === 'evidence'
    && criterion.text.startsWith('Use and cite the referenced input material where relevant:')
  )
    || isStrictDeliveryContract(goalState)
}

function requiresSubstantiveWorkProduct(goalState: SessionGoalState): boolean {
  return goalState.criteria.some(criterion =>
    criterion.required
    && criterion.kind === 'coverage'
    && criterion.text === COMPREHENSIVE_QUALITY_CRITERION_TEXT
  )
}

function requiresDocumentQualityAudit(goalState: SessionGoalState): boolean {
  return goalState.criteria.some(criterion =>
    criterion.required
    && criterion.kind === 'coverage'
    && criterion.text === DOCUMENT_QUALITY_REQUIRED_CRITERION_TEXT
  )
    || requiresDocumentWorkflowQualityAudit(goalState)
    || (goalState.mode === 'strict_work' && goalState.criteria.some(criterion =>
      criterion.required
      && (criterion.text === COMPREHENSIVE_QUALITY_CRITERION_TEXT || criterion.text.includes('structured, readable deliverable'))
    ))
}

function requiresVisualBlockAudit(goalState: SessionGoalState): boolean {
  return goalState.criteria.some(criterion =>
    criterion.required
    && criterion.kind === 'coverage'
    && criterion.text === VISUAL_BLOCK_AUDIT_REQUIRED_CRITERION_TEXT
  )
    || (requiresDocumentWorkflowQualityAudit(goalState) && hasProfessionalVisualPlan(goalState))
}

function requiresTemplateFidelityAudit(goalState: SessionGoalState): boolean {
  return goalState.criteria.some(criterion =>
    criterion.required
    && criterion.kind === 'coverage'
    && criterion.text === TEMPLATE_FIDELITY_REQUIRED_CRITERION_TEXT
  )
    || (isStrictDeliveryContract(goalState) && hasStrictTemplatePlan(goalState))
}

function isStrictDeliveryContract(goalState: SessionGoalState): boolean {
  return goalState.taskContract?.documentQualityMode === 'strict_delivery'
}

function requiresDocumentWorkflowQualityAudit(goalState: SessionGoalState): boolean {
  const mode = goalState.taskContract?.documentQualityMode
  return mode === 'professional_document'
    || mode === 'strict_delivery'
    || mode === 'multi_agent_deep'
}

function hasProfessionalVisualPlan(goalState: SessionGoalState): boolean {
  const plan = goalState.taskContract?.documentPlan?.visualPlan
  return (plan?.selectedKinds.length ?? 0) > 0
    || (plan?.auditRequirements.length ?? 0) > 0
}

function hasStrictTemplatePlan(goalState: SessionGoalState): boolean {
  const plan = goalState.taskContract?.documentPlan
  return plan?.strictTemplate === true || Boolean(plan?.templateProfileId)
}

function requiresEvidenceMatrixAudit(goalState: SessionGoalState): boolean {
  const mode = goalState.taskContract?.documentQualityMode
  return mode !== undefined
    && mode !== 'quick'
    && (goalState.taskContract?.documentPlan?.evidenceMatrix?.length ?? 0) > 0
}

function hasSubstantiveWorkProduct(contents: string[]): boolean {
  const raw = contents.map(content => content.trim()).filter(Boolean).join('\n\n')
  const normalized = raw.replace(/\s+/g, ' ').trim()
  if (normalized.length >= 240) return true

  const structuralMarkers = raw.match(/(?:^|\n)\s*(?:#{1,6}\s+|\d+[.)、]\s+|[-*]\s+|[一二三四五六七八九十]+[、.．])/g)?.length ?? 0
  const paragraphCount = raw
    .split(/\n\s*\n/)
    .map(paragraph => paragraph.replace(/\s+/g, ' ').trim())
    .filter(paragraph => paragraph.length >= 30)
    .length
  const sentenceCount = normalized.split(/[.!?。！？；;]/).filter(sentence => sentence.trim().length >= 12).length

  return normalized.length >= 160
    && (structuralMarkers >= 3 || paragraphCount >= 3 || sentenceCount >= 4)
}

interface VisualBlockAudit {
  passed: boolean
  issues: string[]
  expectedKinds: string[]
  existingVisualCount: number
  opportunityCount: number
}

interface EvidenceMatrixAudit {
  passed: boolean
  issues: string[]
  sourceCount: number
  referencedSourceCount: number
  sourceIds: string[]
}

interface DocumentAgentPlanAudit {
  passed: boolean
  issues: string[]
  assignmentCount: number
  coveredAssignmentCount: number
  requiredSpawnedSessionCount: number
  actualSpawnedSessionCount: number
  completedSpawnedSessionCount: number
  missingRealSpawnedSessions: boolean
  missingFinalSynthesisOwner: boolean
  missingChapterHandoff: boolean
  missingSourceGapReview: boolean
  missingCrossChapterReview: boolean
  conflictingHandoffClaims: string[]
}

interface DeliveryReviewGateAuditInput {
  fileVerificationIssues: readonly string[]
  contentVerificationIssues: readonly string[]
  toolVerificationIssues: readonly string[]
  outputTexts: readonly string[]
  sourceFileEvidencePaths: readonly string[]
}

interface DeliveryReviewGateAudit {
  missingCriteria: string[]
  evidence: SessionGoalAuditEvidence[]
}

function auditEvidenceMatrixUsage(contents: string[], goalState: SessionGoalState): EvidenceMatrixAudit {
  const markdown = contents.map(content => content.trim()).filter(Boolean).join('\n\n')
  const evidenceMatrix = goalState.taskContract?.documentPlan?.evidenceMatrix ?? []
  const referencedSourceCount = evidenceMatrix.filter(entry => hasEvidenceMatrixEntryReference(markdown, entry)).length
  const mentionedSourceCount = evidenceMatrix.filter(entry => hasEvidenceMatrixEntryMention(markdown, entry)).length
  const missingSourceNames = evidenceMatrix
    .filter(entry => !hasEvidenceMatrixEntryReference(markdown, entry) && !hasEvidenceMatrixEntryPendingMarker(markdown, entry))
    .map(entry => basename(entry.source) || entry.source || entry.id)
  const issues: string[] = []

  if (evidenceMatrix.length > 0 && referencedSourceCount === 0) {
    issues.push(mentionedSourceCount > 0
      ? 'Missing claim-level evidence matrix citation with source, locator, or claim fields; zero required sources have claim-level coverage.'
      : 'Missing reference to evidence matrix sources or citations; zero required sources have claim-level coverage.')
  } else if (missingSourceNames.length > 0 && missingSourceNames.length < evidenceMatrix.length) {
    issues.push(`Missing evidence matrix coverage for sources: ${missingSourceNames.join(', ')}.`)
  }

  return {
    passed: issues.length === 0,
    issues,
    sourceCount: evidenceMatrix.length,
    referencedSourceCount,
    sourceIds: evidenceMatrix.map(entry => entry.id),
  }
}

function hasEvidenceMatrixEntryReference(markdown: string, entry: SessionDocumentEvidenceMatrixEntry): boolean {
  return getEvidenceMatrixMentionLines(markdown, entry).some(line =>
    /(?:locator|page|p\.|clause|section|claim|citation|source note|出处|来源|引用|页码|页|条款|章节|主张|结论|依据)\s*[:：#-]?/i.test(line)
  )
}

function hasEvidenceMatrixEntryMention(markdown: string, entry: SessionDocumentEvidenceMatrixEntry): boolean {
  return getEvidenceMatrixMentionLines(markdown, entry).length > 0
}

function hasEvidenceMatrixEntryPendingMarker(markdown: string, entry: SessionDocumentEvidenceMatrixEntry): boolean {
  return getEvidenceMatrixMentionLines(markdown, entry).some(line => hasPendingEvidenceMarker(line))
}

function getEvidenceMatrixMentionLines(markdown: string, entry: SessionDocumentEvidenceMatrixEntry): string[] {
  const normalizedMarkdown = normalizeRequirementText(markdown)
  const sourceName = basename(entry.source)
  const markers = [entry.id, entry.source, sourceName]
    .map(value => normalizeRequirementText(value))
    .filter(value => value.length >= 3)
  if (markers.length === 0 || !markers.some(value => normalizedMarkdown.includes(value))) return []

  return markdown
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => {
      const normalizedLine = normalizeRequirementText(line)
      return markers.some(value => normalizedLine.includes(value))
    })
}

function hasPendingEvidenceMarker(markdown: string): boolean {
  return /assumption|pending evidence|evidence unavailable|source unavailable|unresolved gap|source gap|假设|证据待补充|证据不可用|来源待核实|来源缺口|证据缺口|未解决缺口/i.test(markdown)
}

function formatEvidenceMatrixAudit(report: EvidenceMatrixAudit): string {
  return [
    `status: ${report.passed ? 'pass' : 'fail'}`,
    `sourceCoverage: ${report.referencedSourceCount}/${report.sourceCount}`,
    `sourceIds: ${report.sourceIds.join(', ') || '(none)'}`,
    `issues: ${report.issues.length > 0 ? report.issues.join(' ') : '(none)'}`,
  ].join('\n')
}

function getContentVerificationFailureCategory(issues: readonly string[]): SessionGoalFailureCategory {
  if (issues.some(issue => issue.includes('scope') || issue.includes('contract'))) return 'scope_gap'
  if (issues.some(isEvidenceVerificationIssue)) return 'evidence_gap'
  return 'shallow_output'
}

function isEvidenceVerificationIssue(issue: string): boolean {
  return /evidence matrix|source|citation|evidence|来源|引用|依据|证据/i.test(issue)
}

function auditDeliveryReviewGates(
  goalState: SessionGoalState,
  input: DeliveryReviewGateAuditInput,
): DeliveryReviewGateAudit {
  const gates = goalState.taskContract?.documentPlan?.deliveryReviewPlan?.gates ?? []
  if (!isStrictDeliveryContract(goalState) || gates.length === 0) {
    return { missingCriteria: [], evidence: [] }
  }

  const missingCriteria: string[] = []
  const evidence: SessionGoalAuditEvidence[] = []
  for (const gate of gates) {
    const issues = getDeliveryGateIssues(gate, input)
    const passed = issues.length === 0
    evidence.push({
      type: 'system',
      label: 'delivery_review_gate',
      detail: formatDeliveryReviewGateEvidence(gate, passed, issues).slice(0, 3000),
    })
    if (!passed) {
      missingCriteria.push(`Strict delivery gate failed: ${gate.id} - ${gate.requirement}`)
    }
  }

  return {
    missingCriteria: [...new Set(missingCriteria)],
    evidence,
  }
}

function getDeliveryGateIssues(
  gate: SessionDocumentDeliveryGate,
  input: DeliveryReviewGateAuditInput,
): string[] {
  switch (gate.id) {
    case 'source_integrity': {
      const issues = input.fileVerificationIssues.filter(issue => /source|citation|evidence|来源|引用|依据/i.test(issue))
      if (!hasSourceIntegrityMarker(input.outputTexts, input.sourceFileEvidencePaths)) {
        issues.push('Source integrity gate did not find citations, source notes, or pending evidence markers.')
      }
      return issues
    }
    case 'template_fidelity':
      return input.contentVerificationIssues.filter(issue => /Template fidelity audit/i.test(issue))
    case 'export_files':
      return input.fileVerificationIssues.filter(issue =>
        /Requested output format was not produced|No verifiable output file path|Requested output file was not written|Referenced file was not found|Referenced file is empty/i.test(issue)
      )
    case 'visual_evidence':
      return input.contentVerificationIssues.filter(issue => /Visual block audit/i.test(issue))
    case 'format_review':
      const issues = [
        ...input.contentVerificationIssues.filter(issue => /Document quality audit/i.test(issue)),
        ...input.toolVerificationIssues.filter(issue => /verification|review|check|验证|审查|检查/i.test(issue)),
      ]
      if (!hasFormatReviewEvidence(input.outputTexts)) {
        issues.push('Format review gate did not find rendered preview, exported inspection, or documented format review evidence.')
      }
      return issues
  }
}

function hasSourceIntegrityMarker(outputTexts: readonly string[], sourceFileEvidencePaths: readonly string[]): boolean {
  return hasSourceCitationMarker([...outputTexts], [...sourceFileEvidencePaths])
    || outputTexts.some(content => hasPendingEvidenceMarker(content))
}

function hasFormatReviewEvidence(outputTexts: readonly string[]): boolean {
  return outputTexts.some(content =>
    splitEvidenceSentences(content).some(sentence =>
      /format review|format audit|layout review|rendered preview|export(?:ed)?[- ]file inspection|manual review|格式审查|格式复核|版式审查|版式复核|渲染预览|导出检查|导出复核|人工复核/i.test(sentence)
      && !/not yet|has not|have not|not recorded|without|must be reviewed|should be reviewed|needs? to be reviewed|未记录|没有|尚未|待审查|待复核|需要审查|需要复核/i.test(sentence)
    )
  )
}

function splitEvidenceSentences(content: string): string[] {
  return content
    .split(/[\r\n]+|(?<=[.!?。！？])\s+/)
    .map(sentence => sentence.trim())
    .filter(Boolean)
}

function formatDeliveryReviewGateEvidence(
  gate: SessionDocumentDeliveryGate,
  passed: boolean,
  issues: string[],
): string {
  return [
    `status: ${passed ? 'pass' : 'fail'}`,
    `gate: ${gate.id}`,
    `requirement: ${gate.requirement}`,
    `expectedEvidence: ${gate.evidence}`,
    `issues: ${issues.length > 0 ? issues.join(' ') : '(none)'}`,
  ].join('\n')
}

function auditVisualBlocks(contents: string[], goalState: SessionGoalState): VisualBlockAudit {
  const markdown = contents.map(content => content.trim()).filter(Boolean).join('\n\n')
  const visualPlan = goalState.taskContract?.documentPlan?.visualPlan
  const expectedKinds = visualPlan?.selectedKinds ?? []
  const analysis = analyzeVisualOpportunities(markdown, {
    mode: visualPlan?.mode ?? 'professional',
    maxVisuals: 12,
  })
  const issues: string[] = []

  if (!hasRenderedVisualBlock(markdown)) {
    issues.push(`Missing rendered professional visual block for required kinds: ${expectedKinds.join(', ') || 'professional visual'}.`)
  }
  if (!hasVisualCaptionAndSource(markdown)) {
    issues.push('Missing caption and source note for professional visual evidence.')
  }
  if (expectedKinds.some(kind => kind.startsWith('investment') || kind.includes('cash-flow') || kind.includes('npv')) && !hasInvestmentContext(markdown)) {
    issues.push('Investment visual blocks must preserve currency, period/scenario, and source context.')
  }
  if (expectedKinds.some(kind => kind.startsWith('site-') || kind.startsWith('route-') || kind.startsWith('geospatial')) && !hasGeospatialContext(markdown)) {
    issues.push('Geospatial visual blocks must include CRS/coordinate, legend or scale, and source context.')
  }
  if (expectedKinds.some(kind => kind.startsWith('simulation') || kind === 'time-history-plot') && !hasSimulationContext(markdown)) {
    issues.push('Simulation visual blocks must include solver/source, load case or timestep, units, and result component context.')
  }
  if (requiresA3LandscapeConstructionVisual(visualPlan) && !hasA3LandscapePageIntent(markdown)) {
    issues.push('Construction Gantt visual requested as A3 landscape must include A3 landscape page intent in rendered asset metadata, filename, or caption.')
  }

  return {
    passed: issues.length === 0,
    issues,
    expectedKinds,
    existingVisualCount: analysis.existingVisualCount,
    opportunityCount: analysis.opportunities.length,
  }
}

function hasRenderedVisualBlock(markdown: string): boolean {
  return /```mermaid[\s\S]*?```/i.test(markdown)
    || /!\[[^\]]*]\([^)]+\)/.test(markdown)
    || /<svg\b/i.test(markdown)
    || /<figure\b/i.test(markdown)
    || /\|.+\|[\r\n]+\|?\s*:?-{3,}/.test(markdown)
}

function hasVisualCaptionAndSource(markdown: string): boolean {
  return /(?:Figure|Table|图|表)\s*\d*|caption|图注|表注/i.test(markdown)
    && /source|来源|依据|evidence|citation|引用/i.test(markdown)
}

function hasInvestmentContext(markdown: string): boolean {
  return /(?:currency|usd|zar|cny|rmb|元|美元|币种|period|scenario|期间|情景|source|来源)/i.test(markdown)
}

function hasGeospatialContext(markdown: string): boolean {
  return /(?:crs|coordinate|legend|scale|source|坐标系|坐标|图例|比例尺|来源)/i.test(markdown)
}

function hasSimulationContext(markdown: string): boolean {
  return /(?:solver|load case|time(?:step)?|component|unit|source|ansys|mpa|mm|求解器|工况|时步|分量|单位|来源)/i.test(markdown)
}

function requiresA3LandscapeConstructionVisual(visualPlan: VisualPlan | undefined): boolean {
  return (visualPlan?.selectedKinds ?? []).includes('construction-gantt')
    && (visualPlan?.auditRequirements ?? []).some(requirement => /A3\s*landscape|A3\s*横向/i.test(requirement))
}

function hasA3LandscapePageIntent(markdown: string): boolean {
  return /data-page-size=["']A3["'][\s\S]{0,160}data-orientation=["']landscape["']/i.test(markdown)
    || /data-orientation=["']landscape["'][\s\S]{0,160}data-page-size=["']A3["']/i.test(markdown)
    || /(?:page intent|page size|页面|幅面|版面|文件名|filename)?\s*[:：-]?\s*A3\s*(?:landscape|横向)/i.test(markdown)
    || /A3[-_\s]?landscape/i.test(markdown)
}

function formatVisualBlockAudit(report: VisualBlockAudit): string {
  return [
    `status: ${report.passed ? 'pass' : 'fail'}`,
    `expectedKinds: ${report.expectedKinds.join(', ') || '(unspecified)'}`,
    `existingVisualCount: ${report.existingVisualCount}`,
    `opportunityCount: ${report.opportunityCount}`,
    `issues: ${report.issues.length > 0 ? report.issues.join(' ') : '(none)'}`,
  ].join('\n')
}

function requiresDocumentAgentPlanAudit(goalState: SessionGoalState): boolean {
  return goalState.taskContract?.documentQualityMode !== undefined
    && goalState.taskContract.documentQualityMode !== 'quick'
    && (goalState.taskContract.documentPlan?.agentPlan?.assignments.length ?? 0) > 0
}

function auditDocumentAgentPlan(
  contents: string[],
  goalState: SessionGoalState,
  spawnedSessions: readonly GoalSpawnedSessionSummary[],
): DocumentAgentPlanAudit {
  const markdown = contents.map(content => content.trim()).filter(Boolean).join('\n\n')
  const agentPlan = goalState.taskContract?.documentPlan?.agentPlan
  const assignments = agentPlan?.assignments ?? []
  const spawnedEvidenceText = spawnedSessions
    .flatMap(session => [
      session.name,
      session.taskId,
      session.reportPath,
      session.handoffStatus === 'ready' ? 'structured handoff report ready' : undefined,
      session.firstUserMessagePreview,
      session.finalAssistantPreview,
      session.handoffContent,
    ])
    .map(value => value?.trim())
    .filter((value): value is string => Boolean(value))
    .join('\n\n')
  const allAgentEvidence = [markdown, spawnedEvidenceText].filter(Boolean).join('\n\n')
  const requiredSpawnedSessionCount = getRequiredSpawnedSessionCount(assignments.length)
  const actualSpawnedSessionCount = spawnedSessions.length
  const completedSpawnedSessionCount = spawnedSessions.filter(hasCompletedSpawnedHandoff).length
  const missingRealSpawnedSessions =
    requiredSpawnedSessionCount > 0 && actualSpawnedSessionCount < requiredSpawnedSessionCount
  const missingCompletedSpawnHandoffs =
    requiredSpawnedSessionCount > 0 && completedSpawnedSessionCount < requiredSpawnedSessionCount
  const coveredAssignmentCount = assignments.filter(assignment => hasAssignmentEvidence(allAgentEvidence, assignment.title) || hasAssignmentEvidence(allAgentEvidence, assignment.id)).length
  const missingFinalSynthesisOwner = !hasAssignmentEvidence(markdown, agentPlan?.finalSynthesisOwner ?? 'final_synthesis_owner')
  const missingChapterHandoff = missingCompletedSpawnHandoffs || !/(chapter[-\s]?agent|章节智能体|chapter handoff|handoff|移交|交接|分工)/i.test(allAgentEvidence)
  const missingSourceGapReview = !/(source gaps?|unresolved assumptions?|evidence gaps?|来源缺口|证据缺口|未解决假设|待核实|待补充)/i.test(allAgentEvidence)
  const missingCrossChapterReview = !/(cross[-\s]?chapter|consistency review|cross-discipline|跨章节|一致性审查|交叉审查|冲突解决)/i.test(allAgentEvidence)
  const conflictingHandoffClaims = findDirectionalMappingContradictions(
    spawnedSessions.map(session => session.handoffContent).filter((value): value is string => Boolean(value)),
  )
  const issues: string[] = []

  if (missingRealSpawnedSessions) {
    issues.push(`Only ${actualSpawnedSessionCount}/${requiredSpawnedSessionCount} required real spawned chapter sessions exist for the document agent plan.`)
  }
  if (missingCompletedSpawnHandoffs) {
    issues.push(`Only ${completedSpawnedSessionCount}/${requiredSpawnedSessionCount} required spawned chapter sessions returned a final handoff note.`)
  }
  if (coveredAssignmentCount < assignments.length) {
    issues.push('Not every chapter-agent assignment is reflected in the deliverable or handoff notes.')
  }
  if (missingChapterHandoff) {
    issues.push('Missing chapter-agent handoff evidence.')
  }
  if (missingSourceGapReview) {
    issues.push('Missing source-gap or unresolved-assumption handoff notes.')
  }
  if (missingCrossChapterReview) {
    issues.push('Missing cross-chapter consistency review evidence.')
  }
  if (missingFinalSynthesisOwner) {
    issues.push(`Missing final synthesis owner evidence: ${agentPlan?.finalSynthesisOwner ?? 'final_synthesis_owner'}.`)
  }
  if (conflictingHandoffClaims.length > 0) {
    issues.push(`Contradictory handoff claims must be resolved before merge: ${conflictingHandoffClaims.join(' ')}`)
  }

  return {
    passed: issues.length === 0,
    issues,
    assignmentCount: assignments.length,
    coveredAssignmentCount,
    requiredSpawnedSessionCount,
    actualSpawnedSessionCount,
    completedSpawnedSessionCount,
    missingRealSpawnedSessions,
    missingFinalSynthesisOwner,
    missingChapterHandoff,
    missingSourceGapReview,
    missingCrossChapterReview,
    conflictingHandoffClaims,
  }
}

function findDirectionalMappingContradictions(handoffContents: string[]): string[] {
  const mappings = new Map<'eastbound' | 'westbound', Set<'L' | 'R'>>()
  for (const content of handoffContents) {
    for (const line of content.split(/\r?\n/)) {
      const normalized = line.replace(/\*\*/g, '').trim()
      const direct = normalized.match(/(?:position\s*)?([lr])\s*(?:\([^)]*\))?\s*(?:=|:|is|对应|为)\s*(eastbound|westbound|东行(?:侧|线)?|西行(?:侧|线)?)/i)
      const reverse = normalized.match(/(eastbound|westbound|东行(?:侧|线)?|西行(?:侧|线)?)\s*(?:=|:|is|对应|为)\s*(?:position\s*)?([lr])/i)
      const side = direct?.[1]?.toUpperCase() ?? reverse?.[2]?.toUpperCase()
      const directionValue = direct?.[2] ?? reverse?.[1]
      if ((side !== 'L' && side !== 'R') || !directionValue) continue
      const direction = /eastbound|东行/i.test(directionValue) ? 'eastbound' : 'westbound'
      const sides = mappings.get(direction) ?? new Set<'L' | 'R'>()
      sides.add(side)
      mappings.set(direction, sides)
    }
  }

  return [...mappings.entries()]
    .filter(([, sides]) => sides.size > 1)
    .map(([direction, sides]) => `${direction} is mapped to both ${[...sides].join(' and ')}.`)
}

function auditUnverifiedAssumptionsInCoreConclusions(contents: string[], unverifiedClaims: string[] = []): string[] {
  const markdown = contents.join('\n\n')
  const conclusionLines = getCoreConclusionLines(markdown)
  const issues: string[] = []
  const hasUnverifiedSideMapping = markdown.split(/\r?\n/).some(line =>
    /(?:position\s*)?[lr].{0,50}(?:eastbound|westbound)|(?:eastbound|westbound).{0,50}(?:position\s*)?[lr]/i.test(line)
    && /unverified|not verified|未经验证|未验证|待确认|需确认|需验证|待核实/i.test(line)
  )
  if (hasUnverifiedSideMapping) {
    const promotedClaim = conclusionLines.find(line =>
      /eastbound|westbound|东行|西行/i.test(line)
      && /覆盖|coverage|排水|drain|不足|insufficient|缺口|gap/i.test(line)
      && !hasConditionalLanguage(line)
    )
    if (promotedClaim) {
      issues.push('Unverified side mapping was promoted to a definitive core conclusion; present conditional branches until the mapping is verified.')
    }
  }

  for (const claim of unverifiedClaims) {
    const promotedClaim = conclusionLines.find(line => claimsOverlap(claim, line) && !hasConditionalLanguage(line))
    if (promotedClaim) {
      issues.push(`Unverified evidence-matrix claim was promoted to a definitive core conclusion; keep it conditional until verified: ${claim}`)
    }
  }

  return [...new Set(issues)]
}

function hasConditionalLanguage(value: string): boolean {
  return /如果|若|假设|条件|可能|待确认|需确认|未验证|待核实|cannot determine|if\b|assuming|conditional|unverified|subject to|pending verification/i.test(value)
}

function claimsOverlap(claim: string, conclusion: string): boolean {
  const normalizedClaim = normalizeClaimText(claim)
  const normalizedConclusion = normalizeClaimText(conclusion)
  if (!normalizedClaim || !normalizedConclusion) return false
  if (normalizedConclusion.includes(normalizedClaim) || normalizedClaim.includes(normalizedConclusion)) return true

  const claimTokens = [...new Set(normalizedClaim.match(/[a-z0-9]+/g) ?? [])]
    .filter(token => token.length >= 2)
  if (claimTokens.length < 3) return false
  const matched = claimTokens.filter(token => normalizedConclusion.includes(token)).length
  return matched >= Math.max(3, Math.ceil(claimTokens.length * 0.6))
}

function normalizeClaimText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, ' ').trim().replace(/\s+/g, ' ')
}

function getCoreConclusionLines(markdown: string): string[] {
  const lines = markdown.split(/\r?\n/)
  const output: string[] = []
  let inConclusion = false
  let conclusionLevel = 0
  for (const line of lines) {
    const heading = line.match(/^(#{1,6})\s+(.+)$/)
    if (heading) {
      const level = heading[1].length
      if (/核心结论|主要结论|综合结论|core conclusion|key conclusion|conclusions?\b/i.test(heading[2])) {
        inConclusion = true
        conclusionLevel = level
        continue
      }
      if (inConclusion && level <= conclusionLevel) break
    }
    if (inConclusion && line.trim()) output.push(line.trim())
  }
  return output
}

function requiresFullTextArtifactAudit(goalState: SessionGoalState): boolean {
  return requiresDocumentQualityAudit(goalState)
    || requiresEvidenceMatrixAudit(goalState)
    || requiresTemplateFidelityAudit(goalState)
    || requiresVisualBlockAudit(goalState)
    || getExplicitUserRequirements(goalState).length > 0
}

function hasCompletedSpawnedHandoff(session: GoalSpawnedSessionSummary): boolean {
  return session.hasFinalAssistant
    || (
      session.handoffStatus === 'ready'
      && session.reportPathExists === true
      && (session.reportSize ?? 0) > 0
    )
}

function getRequiredSpawnedSessionCount(assignmentCount: number): number {
  if (assignmentCount <= 0) return 0
  return Math.max(1, Math.min(assignmentCount, 4))
}

function hasAssignmentEvidence(markdown: string, value: string): boolean {
  const normalizedNeedle = normalizeRequirementText(value)
  return Boolean(normalizedNeedle) && normalizeRequirementText(markdown).includes(normalizedNeedle)
}

function formatDocumentAgentPlanAudit(report: DocumentAgentPlanAudit): string {
  return [
    `status: ${report.passed ? 'pass' : 'fail'}`,
    `assignmentCoverage: ${report.coveredAssignmentCount}/${report.assignmentCount}`,
    `spawnedSessions: ${report.actualSpawnedSessionCount}/${report.requiredSpawnedSessionCount}`,
    `completedSpawnHandoffs: ${report.completedSpawnedSessionCount}/${report.requiredSpawnedSessionCount}`,
    `missingRealSpawnedSessions: ${report.missingRealSpawnedSessions ? 'yes' : 'no'}`,
    `missingChapterHandoff: ${report.missingChapterHandoff ? 'yes' : 'no'}`,
    `missingSourceGapReview: ${report.missingSourceGapReview ? 'yes' : 'no'}`,
    `missingCrossChapterReview: ${report.missingCrossChapterReview ? 'yes' : 'no'}`,
    `missingFinalSynthesisOwner: ${report.missingFinalSynthesisOwner ? 'yes' : 'no'}`,
    `conflictingHandoffClaims: ${report.conflictingHandoffClaims.join(' ') || '(none)'}`,
    `issues: ${report.issues.length > 0 ? report.issues.join(' ') : '(none)'}`,
  ].join('\n')
}

function auditTemplateOutput(contents: string[], goalState: SessionGoalState): TemplateFidelityAudit {
  return auditTemplateFidelity(
    contents.map(content => content.trim()).filter(Boolean).join('\n\n'),
    buildTemplateProfileFromGoal(goalState),
  )
}

function buildTemplateProfileFromGoal(goalState: SessionGoalState): ExtractedTemplateProfile {
  const plan = goalState.taskContract?.documentPlan
  const strictDocx = plan?.strictTemplate === true || plan?.deliveryFormats.some(format => /^docx?$/i.test(format))

  return {
    id: plan?.templateProfileId ?? 'template-request',
    sourcePath: 'user-template-request',
    sourceType: strictDocx ? 'docx' : 'markdown',
    layoutFidelity: strictDocx ? 'strict-docx-ooxml' : 'semantic-only',
    sectionOrder: plan?.sections ?? [],
    titleDepth: 1,
    styles: [],
    fonts: [],
    unknowns: strictDocx
      ? ['Strict template request is pending parsed DOCX profile and exported DOCX evidence.']
      : ['Exact source template profile is unavailable.'],
  }
}

function formatTemplateFidelityAudit(report: TemplateFidelityAudit): string {
  return [
    `status: ${report.passed ? 'pass' : 'fail'}`,
    `score: ${report.score}`,
    `approximation: ${report.approximation ? 'yes' : 'no'}`,
    `issues: ${report.issues.length > 0 ? report.issues.join(' ') : '(none)'}`,
    `strengths: ${report.strengths.length > 0 ? report.strengths.join(' ') : '(none)'}`,
  ].join('\n')
}

function getExplicitUserRequirements(goalState: SessionGoalState): string[] {
  return goalState.criteria
    .filter(criterion =>
      criterion.required
      && criterion.kind === 'user_constraint'
      && criterion.text.startsWith(EXPLICIT_USER_REQUIREMENT_PREFIX)
    )
    .map(criterion => criterion.text
      .slice(EXPLICIT_USER_REQUIREMENT_PREFIX.length)
      .replace(/\.$/, '')
      .trim())
    .filter(Boolean)
}

function getPendingRequirementLedgerEntries(goalState: SessionGoalState): SessionRequirementLedgerEntry[] {
  if (goalState.taskContract?.documentQualityMode === 'quick') return []
  return goalState.taskContract?.requirementLedger?.entries.filter(entry => entry.status === 'pending') ?? []
}

function updateRequirementLedgerAfterAudit(
  taskContract: SessionTaskContract | undefined,
  result: SessionGoalAuditResult,
): SessionTaskContract | undefined {
  const ledger = taskContract?.requirementLedger
  if (!taskContract || !ledger) return taskContract

  const missingText = normalizeRequirementText(result.missingCriteria.join('\n'))
  const humanDecisionBlocked = result.evidence.some(item => item.label === 'human_input_requested')
  return {
    ...taskContract,
    requirementLedger: {
      ...ledger,
      entries: ledger.entries.map(entry => {
        const evidenceRefs = selectRequirementEvidence(entry.kind, result)
        if (result.status === 'pass') {
          return {
            ...entry,
            status: 'satisfied' as const,
            evidenceRefs,
            failureReason: undefined,
            verifiedAt: result.createdAt,
          }
        }
        const entryText = normalizeRequirementText(entry.text)
        const failureReason = result.missingCriteria.find(item => item.includes(`[${entry.id}]`))
          ?? (entryText ? result.missingCriteria.find(item => normalizeRequirementText(item).includes(entryText)) : undefined)
        const explicitlyMissing = Boolean(failureReason) || Boolean(entryText && missingText.includes(entryText))
        return explicitlyMissing
          ? {
              ...entry,
              status: humanDecisionBlocked ? 'blocked' as const : 'failed' as const,
              evidenceRefs,
              failureReason: failureReason ?? entry.text,
              verifiedAt: result.createdAt,
            }
          : entry
      }),
    },
  }
}

function selectRequirementEvidence(
  kind: SessionRequirementLedgerEntry['kind'],
  result: SessionGoalAuditResult,
): SessionGoalAuditEvidence[] {
  const selected = result.evidence.filter(item => {
    switch (kind) {
      case 'deliverable':
      case 'format':
        return item.type === 'file'
          && item.label !== 'user_attachment'
          && !item.label.startsWith('source_file_')
      case 'evidence':
        return item.type === 'file'
          || item.label.includes('evidence')
          || item.label.includes('citation')
      case 'verification':
        return item.type === 'test'
          || item.type === 'tool'
          || item.label.includes('verification')
          || item.label.includes('audit')
      case 'constraint':
        return item.type === 'message'
          || item.label.includes('scope')
          || item.label === 'task_contract'
    }
  })
  if (selected.length > 0) return selected.slice(0, 8)
  return [{
    type: 'system',
    label: result.status === 'pass' ? 'goal_audit_requirement_pass' : 'goal_audit_requirement_gap',
    detail: result.summary.slice(0, 500),
  }]
}

function hasExplicitUserRequirement(contents: string[], requirement: string): boolean {
  const needle = normalizeRequirementText(requirement)
  if (!needle) return true
  return contents.some(content => normalizeRequirementText(content).includes(needle))
}

function normalizeRequirementText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[\s"'`*_#>()[\]{}:：,，.。!！?？;；\-—_/\\|]+/g, '')
    .trim()
}

function hasSourceCitationMarker(contents: string[], sourceFileEvidencePaths: string[]): boolean {
  return contents.some(content => hasSourceCitationMarkerInText(content, sourceFileEvidencePaths))
}

function hasSourceCitationMarkerInText(content: string, sourceFileEvidencePaths: string[]): boolean {
  const normalized = content.toLowerCase()
  for (const filePath of sourceFileEvidencePaths) {
    const name = basename(filePath).toLowerCase()
    if (name && normalized.includes(name)) return true

    const stem = name.slice(0, name.length - extname(name).length)
    if (stem && stem.length >= 3 && normalized.includes(stem)) return true
  }

  return /来源|依据|引用|参考|条款|章节|第\s*\d+\s*页|source|according to|based on|citation|cite|clause|section|page|§|\[[^\]]+\]/i.test(content)
}

function getRequiredOutputFormats(goalState: SessionGoalState): string[] {
  const criteriaFormats = goalState.criteria
    .filter(criterion =>
      criterion.required
      && criterion.kind === 'format'
      && criterion.text.startsWith(OUTPUT_FORMAT_REQUIRED_CRITERION_PREFIX)
    )
    .flatMap(criterion => criterion.text
      .slice(OUTPUT_FORMAT_REQUIRED_CRITERION_PREFIX.length)
      .replace(/\.$/, '')
      .split(',')
      .map(format => normalizeOutputFormatLabel(format))
      .filter((format): format is string => format !== undefined))
  const artifactFormats = (goalState.taskContract?.artifactDeliverables ?? [])
    .filter(deliverable => deliverable.required)
    .map(deliverable => normalizeOutputFormatLabel(deliverable.format))
    .filter((format): format is string => format !== undefined)

  return [...new Set([
    ...criteriaFormats,
    ...artifactFormats,
    ...(isStrictDeliveryContract(goalState) ? getContractOutputFormats(goalState) : []),
  ])]
}

function normalizeOutputFormatLabel(value: string): string | undefined {
  const normalized = value.trim().replace(/^\.+|\.+$/g, '').toUpperCase()
  return normalized || undefined
}

function getContractOutputFormats(goalState: SessionGoalState): string[] {
  return [...new Set([
    ...(goalState.taskContract?.outputFormats ?? []),
    ...(goalState.taskContract?.documentPlan?.deliveryFormats ?? []),
  ].map(format => normalizeOutputFormatLabel(format)).filter((format): format is string => format !== undefined))]
}

function getOutputFormatsForPath(filePath: string): string[] {
  const lower = filePath.toLowerCase()
  if (lower.endsWith('.pdf')) return ['PDF']
  if (lower.endsWith('.doc') || lower.endsWith('.docx')) return ['DOCX']
  if (lower.endsWith('.xls') || lower.endsWith('.xlsx') || lower.endsWith('.xlsm')) return ['XLSX']
  if (lower.endsWith('.ppt') || lower.endsWith('.pptx')) return ['PPTX']
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) return ['MD']
  if (lower.endsWith('.csv')) return ['CSV']
  if (lower.endsWith('.html') || lower.endsWith('.htm')) return ['HTML']
  if (lower.endsWith('.json')) return ['JSON']
  if (lower.endsWith('.txt')) return ['TXT']
  const extension = extname(filePath).replace(/^\./, '').trim().toUpperCase()
  return extension ? [extension] : []
}

function findArtifactDeliverableForPath(
  contract: SessionTaskContract | undefined,
  filePath: string,
): NonNullable<SessionTaskContract['artifactDeliverables']>[number] | undefined {
  const pathFormats = new Set(getOutputFormatsForPath(filePath))
  return contract?.artifactDeliverables?.find(deliverable =>
    deliverable.required && pathFormats.has(normalizeOutputFormatLabel(deliverable.format) ?? '')
  )
}

const TOOL_VERIFICATION_EVIDENCE_PATTERN = /测试|单测|验证|检查|构建|类型检查|source_test|skill_validate|\b(?:test|tests|verify|validate|check|typecheck|lint|build|tsc|pytest|vitest|jest|playwright|eslint)\b/i

function getSuccessfulToolVerificationMessages(messages: Message[]): Message[] {
  return messages.filter(message =>
    isSuccessfulTool(message)
    && TOOL_VERIFICATION_EVIDENCE_PATTERN.test(buildToolEvidenceText(message))
  )
}

function buildToolEvidenceText(message: Message): string {
  return [
    message.toolName,
    message.content,
    stringifyToolEvidenceValue(message.toolInput),
    stringifyToolEvidenceValue(message.toolResult),
  ].filter(Boolean).join('\n')
}

function getUnauthorizedWorkspaceDiscoveryMessages(goalState: SessionGoalState, messages: Message[]): Message[] {
  if (!goalState.orchestration?.policy.forbidWorkingDirectoryDiscovery) return []
  if (goalState.orchestration.policy.selectedSourceSlugs.length === 0) return []

  return messages.filter(message => message.role === 'tool' && isWorkingDirectoryDiscoveryTool(message))
}

function isWorkingDirectoryDiscoveryTool(message: Message): boolean {
  const toolName = (message.toolName ?? '').toLowerCase()
  const evidence = buildToolEvidenceText(message)
  if (/^(glob|grep|list directory|search files)$/.test(toolName)) return true
  if (/(?:list|search).{0,20}(?:directory|files)|(?:directory|files).{0,20}(?:list|search)/i.test(toolName)) return true
  if (toolName !== 'bash' && toolName !== 'powershell' && toolName !== 'shell') {
    return false
  }

  return /(?:^|[\s;&|])(?:ls|dir|find|rg|grep|fd|tree|gci|get-childitem)\b/i.test(evidence)
}

function isLongDocumentArtifactWriteFailure(message: Message): boolean {
  const toolName = message.toolName ?? ''
  if (!/(?:^|[_\-\s])(?:write|edit|multiedit|bash|run command)(?:$|[_\-\s])/i.test(toolName)) {
    return false
  }

  const text = buildToolEvidenceText(message)
  const paths = [
    ...extractFilePaths(message.toolInput),
    ...extractFilePathsFromText(message.toolResult),
    ...extractFilePathsFromText(message.content),
  ]
  const targetsMarkdown = paths.some(path => /\.(?:md|markdown|txt)$/i.test(path))
  const mentionsLongDocument = /long document|long markdown|formal deliverable|final artifact|artifact|完整长篇|长文档|正式交付|最终交付|施工组织|报告|方案/i.test(text)
  const mentionsWriteLimit = /exceeds?.{0,40}(?:limit|tool input|message|payload)|too large|truncat|截断|限制|7\s*KB|heredoc|here-doc|command line is too long|argument list too long|内容太长|输入过长/i.test(text)
  const missingTargetPath = isMissingTargetPathWriteFailure(text)
  const hasMarkdownPayload = /"content"\s*:\s*"#|^#{1,6}\s|\\n#{1,6}\s|正式审计|Handoff Note|证据矩阵/i.test(text)

  return (mentionsWriteLimit || missingTargetPath) && (targetsMarkdown || mentionsLongDocument || hasMarkdownPayload)
}

function isMissingTargetPathWriteFailure(text: string): boolean {
  return /validation failed for tool\s+"?(?:write|edit|multiedit)"?/i.test(text)
    && /(?:path|file_path).{0,80}must have required propert(?:y|ies)|must have required propert(?:y|ies).{0,80}(?:path|file_path)/i.test(text)
}

function summarizeArtifactWriteFailure(message: Message): string {
  const paths = [
    ...extractFilePaths(message.toolInput),
    ...extractFilePathsFromText(message.toolResult),
    ...extractFilePathsFromText(message.content),
  ]
  const target = paths.length > 0 ? `target=${paths[0]}; ` : ''
  const result = buildToolEvidenceText(message).replace(/\s+/g, ' ').trim().slice(0, 500)
  return `${target}${result}`
}

function stringifyToolEvidenceValue(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'string') return value.slice(0, 4000)
  try {
    return JSON.stringify(value).slice(0, 4000)
  } catch {
    return String(value).slice(0, 4000)
  }
}

function summarizeToolVerificationMessage(message: Message): string {
  const label = message.toolName?.trim() || 'tool'
  const result = typeof message.toolResult === 'string' && message.toolResult.trim()
    ? ` - ${message.toolResult.replace(/\s+/g, ' ').trim().slice(0, 300)}`
    : ''
  return `${label}${result}`.slice(0, 500)
}

function hasRepeatedGoalFailure(history: SessionGoalState['auditHistory'], result: SessionGoalAuditResult): boolean {
  if (result.status === 'pass' || result.missingCriteria.length === 0) {
    return false
  }

  const previous = [...history].reverse().find(item => item.status !== 'pass' && item.missingCriteria.length > 0)
  if (!previous) {
    return false
  }

  const currentMissing = normalizeMissingCriteria(result.missingCriteria)
  const previousMissing = normalizeMissingCriteria(previous.missingCriteria)
  return currentMissing.length > 0
    && currentMissing.length === previousMissing.length
    && currentMissing.every((criterion, index) => criterion === previousMissing[index])
}

function getRepeatedFailureCategories(
  history: SessionGoalState['auditHistory'],
  result: SessionGoalAuditResult,
): SessionGoalFailureCategory[] {
  if (result.status === 'pass' || !result.failureCategories?.length) {
    return []
  }

  const previous = [...history].reverse().find(item => item.status !== 'pass' && item.failureCategories?.length)
  if (!previous?.failureCategories?.length) {
    return []
  }

  const previousCategories = new Set(previous.failureCategories)
  return result.failureCategories.filter(category => previousCategories.has(category))
}

function latestFailedAuditHasCategory(
  history: SessionGoalState['auditHistory'],
  category: SessionGoalFailureCategory,
): boolean {
  const previous = [...history].reverse().find(item => item.status !== 'pass')
  return previous?.failureCategories?.includes(category) ?? false
}

function normalizeMissingCriteria(criteria: string[]): string[] {
  return [...new Set(criteria
    .map(criterion => criterion.replace(/\s+/g, ' ').trim().toLowerCase())
    .filter(Boolean))]
    .sort()
}

function buildFileVerificationEvidenceLabel(verification: GoalFileVerificationResult): string {
  if (!verification.exists) return 'file_missing'
  if (verification.readable === false) return 'file_unreadable'
  if (verification.isFile === false) return 'file_not_file'
  if (verification.sizeBytes === 0) return 'file_empty'
  return 'file_verification_failed'
}

function buildFilePreviewEvidenceLabel(verification: GoalFileVerificationResult, isOutputFile: boolean): string {
  const prefix = isOutputFile ? 'file_preview' : 'source_file_preview'
  return verification.previewTruncated ? `${prefix}_truncated` : prefix
}

const FILE_PATH_INPUT_KEYS = new Set([
  'file',
  'file_path',
  'file_paths',
  'filepath',
  'filepaths',
  'files',
  'filename',
  'notebook_path',
  'output',
  'output_file',
  'output_files',
  'output_path',
  'output_paths',
  'path',
  'paths',
])

const OUTPUT_FILE_PATH_INPUT_KEYS = new Set([
  'destination',
  'destination_file',
  'destination_files',
  'destination_path',
  'destination_paths',
  'output',
  'output_file',
  'output_files',
  'output_path',
  'output_paths',
  'target',
  'target_file',
  'target_files',
  'target_path',
  'target_paths',
])

const OUTPUT_TOOL_NAME_PATTERN = /(?:^|[_\-\s])(?:write|writemany|writefile|edit|multiedit|notebookedit|save|export|convert|generate|create|update|replace)(?:$|[_\-\s])/i
const COMMAND_OUTPUT_CANDIDATE_TOOL_NAME_PATTERN = /(?:^|[_\-\s])(?:bash|shell|powershell|pwsh|python|cmd|command|exec|execute|run)(?:$|[_\-\s])/i
const OUTPUT_RESULT_TEXT_PATTERN = /(?:created|wrote|written|saved|exported|converted|generated|updated|创建|生成|写入|保存|导出|转换|更新).{0,200}(?:[A-Za-z]:\\|\/)/i
const FILE_PATH_TEXT_PATTERN = /(?:[A-Za-z]:\\[^"'<>|\r\n]+?|\/[^\s"'<>|]+)\.(?:csv|docx?|html?|json|md|pdf|pptx?|txt|xlsx?|xml|yaml|yml)\b/gi
const QUOTED_FILE_PATH_TEXT_PATTERN = /["'`]((?:[A-Za-z]:\\|\/)[^"'`<>|\r\n]+?\.(?:csv|docx?|html?|json|md|pdf|pptx?|txt|xlsx?|xml|yaml|yml))["'`]/gi

function promoteFormalOutputFileEvidencePaths(input: {
  candidatePaths: Set<string>
  outputFileEvidencePaths: Set<string>
  expectedOutputDirectory?: string
  requiredOutputFormats: string[]
}): void {
  if (!input.expectedOutputDirectory || input.requiredOutputFormats.length === 0) {
    return
  }

  const requiredFormats = new Set(input.requiredOutputFormats)
  for (const filePath of input.candidatePaths) {
    if (input.outputFileEvidencePaths.has(filePath)) continue
    if (!pathStartsWith(filePath, input.expectedOutputDirectory)) continue
    if (!getOutputFormatsForPath(filePath).some(format => requiredFormats.has(format))) continue
    input.outputFileEvidencePaths.add(filePath)
  }
}

function isCommandOutputCandidateTool(toolName: string | undefined): boolean {
  return COMMAND_OUTPUT_CANDIDATE_TOOL_NAME_PATTERN.test(toolName ?? '')
}

function extractOutputFilePaths(message: Message, inputPaths: string[], resultPaths: string[]): string[] {
  if (!isSuccessfulTool(message)) {
    return []
  }

  const toolName = message.toolName ?? ''
  if (/(?:^|[_\-\s])document[_\-\s]?artifact$/i.test(toolName)) {
    const action = typeof message.toolInput === 'object' && message.toolInput !== null
      ? (message.toolInput as Record<string, unknown>).action
      : undefined
    return action === 'assemble' || action === 'validate'
      ? resultPaths.filter(path => getOutputFormatsForPath(path).length > 0)
      : []
  }

  const paths = new Set<string>(extractFilePaths(message.toolInput, undefined, OUTPUT_FILE_PATH_INPUT_KEYS))
  const toolResult = typeof message.toolResult === 'string' ? message.toolResult : ''

  if (OUTPUT_TOOL_NAME_PATTERN.test(toolName)) {
    for (const path of inputPaths) paths.add(path)
    for (const path of resultPaths) paths.add(path)
  } else if (OUTPUT_RESULT_TEXT_PATTERN.test(toolResult)) {
    for (const path of resultPaths) paths.add(path)
  }

  return [...paths]
}

function extractFilePaths(value: unknown, key?: string, pathKeys = FILE_PATH_INPUT_KEYS): string[] {
  if (typeof value === 'string') {
    return key && pathKeys.has(key.toLowerCase()) && value.trim()
      ? filterLocalFilePathCandidates([value.trim()])
      : []
  }

  if (Array.isArray(value)) {
    return value.flatMap(item => extractFilePaths(item, key, pathKeys))
  }

  if (!value || typeof value !== 'object') {
    return []
  }

  return Object.entries(value as Record<string, unknown>)
    .flatMap(([childKey, childValue]) => extractFilePaths(childValue, childKey, pathKeys))
}

function extractFilePathsFromText(value: unknown): string[] {
  if (typeof value !== 'string' || !value.trim()) {
    return []
  }

  return filterLocalFilePathCandidates([...new Set([
    ...[...value.matchAll(QUOTED_FILE_PATH_TEXT_PATTERN)].map(match => match[1]),
    ...[...value.matchAll(FILE_PATH_TEXT_PATTERN)].map(match => match[0]),
  ])])
}

function filterLocalFilePathCandidates(paths: string[]): string[] {
  return paths
    .map(normalizeLocalFilePathCandidate)
    .filter(path => path.length > 0 && !isWebUrlLikePath(path))
    .filter(path => !isTransientSessionDataPath(path))
}

function normalizeLocalFilePathCandidate(path: string): string {
  const trimmed = path.trim()
  if (!trimmed) return ''

  const decodedUnicode = trimmed.replace(/\\u([0-9a-fA-F]{4})/g, (_match, code) =>
    String.fromCharCode(Number.parseInt(code, 16))
  )
  return /^[A-Za-z]:\\\\/.test(decodedUnicode)
    ? decodedUnicode.replace(/\\\\/g, '\\')
    : decodedUnicode
}

function isTransientSessionDataPath(path: string): boolean {
  const normalized = path.replace(/\//g, '\\').toLowerCase()
  return normalized.startsWith('{{session_path}}\\data\\')
    || /\\sessions\\[^\\]+\\data\\/.test(normalized)
}

function isTransientSessionDataToolFailure(message: Message): boolean {
  if (!isFailedTool(message)) return false
  const details = [
    message.content,
    typeof message.toolResult === 'string' ? message.toolResult : '',
    safeStringify(message.toolInput),
  ].join('\n').replace(/\//g, '\\').toLowerCase()

  return details.includes('{{session_path}}\\data\\')
    || /\\sessions\\[^\\]+\\data\\/.test(details)
}

function safeStringify(value: unknown): string {
  if (value === undefined) return ''
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function isWebUrlLikePath(path: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(path)
    || /^\/\/[a-z0-9.-]+\.[a-z]{2,}(?:[/:?#]|$)/i.test(path)
}

function getMessagesAfterFinalAssistant(messages: Message[], turnStartFinalMessageId?: string): Message[] {
  if (!turnStartFinalMessageId) return messages
  const index = messages.findIndex(message => message.id === turnStartFinalMessageId)
  return index === -1 ? messages : messages.slice(index + 1)
}

function buildCorrectivePrompt(goalState: SessionGoalState, result: SessionGoalAuditResult): string {
  const missing = result.missingCriteria.length > 0
    ? result.missingCriteria.map((criterion, index) => `${index + 1}. ${criterion}`).join('\n')
    : '1. Re-check the deliverable against the original objective.'
  const evidence = result.evidence.length > 0
    ? result.evidence.map((item, index) => {
        const detail = item.detail ? ` - ${item.detail}` : ''
        return `${index + 1}. [${item.type}] ${item.label}${detail}`
      }).join('\n')
    : '(none)'
  const previousAudits = buildPreviousAuditSummary(goalState.auditHistory)
  const taskContract = formatTaskContractForPrompt(goalState.taskContract)
  const correctiveFocus = buildFailureCategoryGuidance(result.failureCategories)
  const repeatedFailurePattern = buildRepeatedFailureCategoryGuidance(result)
  const hardGateRecovery = buildHardGateRecoveryGuidance(result)
  const reviewerCorrection = result.correctivePrompt?.trim() || '(none)'

  return [
    '<goal-audit>',
    'This is an internal goal audit instruction, not a new user request.',
    '',
    'Objective:',
    goalState.objective,
    '',
    'Instruction-following gate:',
    buildInstructionFollowingGate(goalState),
    '',
    'Task contract:',
    taskContract,
    '',
    'The previous response could not be proven complete.',
    `Audit summary: ${result.summary}`,
    '',
    'Missing or unproven criteria:',
    missing,
    '',
    'Corrective focus:',
    correctiveFocus,
    '',
    'Reviewer correction:',
    reviewerCorrection,
    '',
    'Execution strategy:',
    buildExecutionStrategy(result),
    '',
    'Required checkpoints:',
    buildRequiredCheckpoints(result),
    '',
    'Hard gate recovery:',
    hardGateRecovery,
    '',
    'Repeated failure pattern:',
    repeatedFailurePattern,
    '',
    'Audit evidence:',
    evidence,
    '',
    'Previous goal audits:',
    previousAudits,
    '',
    'Continue from the existing conversation. First satisfy the instruction-following gate, then improve the actual deliverable while preserving the full task contract, verify the missing criteria, and finish with a concise summary of what changed.',
    '</goal-audit>',
  ].join('\n')
}

function getEffectiveMaxIterations(goalState: SessionGoalState): number {
  if (goalState.iteration < MAX_AUTOMATIC_GOAL_REPAIR_PASSES) {
    return Math.max(1, Math.min(goalState.maxIterations, MAX_AUTOMATIC_GOAL_REPAIR_PASSES))
  }
  return Math.max(goalState.iteration, goalState.maxIterations)
}

function buildInstructionFollowingGate(goalState: SessionGoalState): string {
  const contract = goalState.taskContract
  const followUps = contract?.followUpRequests?.length
    ? contract.followUpRequests.map((request, index) => `${index + 1}. ${request}`).join('\n')
    : '(none)'
  const mustPreserve = contract?.mustPreserve?.length
    ? contract.mustPreserve.map((item, index) => `${index + 1}. ${item}`).join('\n')
    : '(none)'
  const forbiddenShortcuts = contract?.forbiddenShortcuts?.length
    ? contract.forbiddenShortcuts.map((item, index) => `${index + 1}. ${item}`).join('\n')
    : '(none)'

  return [
    '1. Re-check the user instructions before judging document quality, evidence depth, or polish.',
    `2. Original user request: ${contract?.originalRequest?.trim() || goalState.objective}`,
    `3. Follow-up user instructions:\n${followUps}`,
    `4. Must preserve:\n${mustPreserve}`,
    `5. Forbidden broadening:\n${forbiddenShortcuts}`,
    '6. Do not broaden the scope beyond the original request or follow-up instructions.',
    '7. Preserve selected sources, named chapters/files/folders, requested output format, and response language.',
    '8. If the previous output analyzed extra chapters, sources, formats, or languages, discard that extra work and rebuild only the requested scope.',
    '9. Only after the instruction-following gate passes should you improve structure, citations, visuals, or wording.',
  ].join('\n')
}

function buildRequiredCheckpoints(result: SessionGoalAuditResult): string {
  const normalized = new Set(result.failureCategories ?? [])
  const checkpoints: string[] = []
  const labels = new Set(result.evidence.map(item => item.label))
  const councilDisagreement = result.evidence.find(item => item.label === 'quality_council_disagreement')?.detail
  const codeDiagnostics = result.evidence.find(item => item.label === 'code_verification_diagnostics')?.detail
  const contextPressure = result.evidence.find(item => item.label === 'context_pressure_high' || item.label === 'context_pressure_warning')?.detail
  const orchestrationEvidencePackage = result.evidence.find(item => item.label === 'orchestration_evidence_package')?.detail

  if (normalized.has('tool_failure')) {
    checkpoints.push('Resolve the failed tool or command and confirm the later attempt succeeded.')
  }
  if (labels.has('artifact_write_failure')) {
    checkpoints.push('After reassembly, verify the final artifact path, section count, required headings, and non-empty content.')
  }
  if (contextPressure) {
    checkpoints.push(`Reduce context/tool pressure by narrowing enabled sources, using only necessary source tools, or summarizing source evidence before the final answer: ${contextPressure}.`)
  }
  if (orchestrationEvidencePackage) {
    checkpoints.push(`Read the orchestration evidence package before scanning conversation history or working directories: ${orchestrationEvidencePackage}.`)
  }
  if (codeDiagnostics) {
    checkpoints.push(`Fix the reported code diagnostics, then rerun the failed verification command: ${codeDiagnostics}.`)
  }
  if (councilDisagreement) {
    checkpoints.push(`Resolve the Quality Council reviewer disagreement by addressing each failing or uncertain role before finalizing: ${councilDisagreement}.`)
  }
  if (normalized.has('scope_gap')) {
    checkpoints.push('Map the original requested scope to concrete sections, files, or outputs that now satisfy it.')
  }
  if (normalized.has('shallow_output')) {
    checkpoints.push('Replace outlines, placeholders, or generic summaries with substantive task-specific content.')
  }
  if (normalized.has('evidence_gap')) {
    checkpoints.push('Identify the exact source, file, artifact, or citation that proves the corrected claim.')
  }
  if (normalized.has('verification_gap')) {
    checkpoints.push('Run the requested verification or equivalent check and capture the concrete result.')
  }
  if (checkpoints.length === 0) {
    checkpoints.push('Re-check every missing criterion against the updated deliverable.')
  }
  checkpoints.push('Do not produce the final response until every checkpoint above is satisfied or explicitly reported as blocked.')

  return checkpoints.map((checkpoint, index) => `${index + 1}. ${checkpoint}`).join('\n')
}

function buildExecutionStrategy(result: SessionGoalAuditResult): string {
  const normalized = new Set(result.failureCategories ?? [])
  const labels = new Set(result.evidence.map(item => item.label))
  const steps: string[] = []

  if (labels.has('artifact_write_failure')) {
    steps.push('Resume from the artifact manifest and completed section chunks. Do not restart or rewrite the whole long document; retry only the failed section chunk, then reassemble the final Markdown artifact.')
    steps.push('When retrying Write/Edit, include the exact target path or file_path on every tool call. Do not resend document content without a path.')
  }
  if (normalized.has('tool_failure')) {
    steps.push('Resolve the failed command, tool call, or file operation first; do not continue from a broken intermediate state.')
  }
  if (normalized.has('scope_gap') || normalized.has('shallow_output')) {
    steps.push('Re-open the original objective and task contract, then update the actual deliverable instead of describing future work.')
  }
  if (normalized.has('evidence_gap')) {
    steps.push('Locate the source, artifact, or file evidence before finalizing, and include the concrete citation or path in the deliverable.')
  }
  if (normalized.has('verification_gap')) {
    steps.push('Run the required verification command or check after editing, and include the result in the final summary.')
  }
  if (steps.length === 0) {
    steps.push('Inspect the audit evidence, update the concrete deliverable, then verify the missing criteria before finishing.')
  }

  return steps.map((step, index) => `${index + 1}. ${step}`).join('\n')
}

function buildHardGateRecoveryGuidance(result: SessionGoalAuditResult): string {
  const labels = new Set(result.evidence.map(item => item.label))
  const guidance: string[] = []

  if (labels.has('previous_verification_checkpoint_missing')) {
    guidance.push('A previous verification gap is still open. Run and capture a successful verification tool before treating the goal as complete.')
  }
  if (labels.has('previous_evidence_checkpoint_missing')) {
    guidance.push('A previous evidence gap is still open. Capture a concrete file, source, artifact, or citation path before treating the goal as complete.')
  }
  if (labels.has('previous_shallow_output_checkpoint_missing')) {
    guidance.push('A previous shallow-output gap is still open. Replace the shallow response with substantive task-specific work product.')
  }
  if (labels.has('previous_scope_checkpoint_missing')) {
    guidance.push('A previous scope gap is still open. Restore the omitted requirements from the original task contract.')
  }
  if (labels.has('previous_tool_failure_checkpoint_missing')) {
    guidance.push('A previous tool failure is still open. Produce a successful tool run that resolves the failed step before treating the goal as complete.')
  }
  if (labels.has('delivery_review_gate')) {
    const failedGates = result.evidence
      .filter(item => item.label === 'delivery_review_gate' && /status:\s*fail/i.test(item.detail ?? ''))
      .map(item => item.detail?.match(/gate:\s*([^\n]+)/i)?.[1]?.trim())
      .filter((gate): gate is string => Boolean(gate))
    const suffix = failedGates.length > 0 ? ` Failed gates: ${[...new Set(failedGates)].join(', ')}.` : ''
    guidance.push(`Resolve each failed strict delivery gate before claiming the formal document is complete.${suffix}`)
  }

  return guidance.length > 0
    ? guidance.map((item, index) => `${index + 1}. ${item}`).join('\n')
    : '(none)'
}

function buildRepeatedFailureCategoryGuidance(result: SessionGoalAuditResult): string {
  const detail = result.evidence.find(item => item.label === 'repeated_failure_categories')?.detail
  if (!detail) return '(none)'

  return [
    `Repeated categories: ${detail}.`,
    'Do not finish until the repeated failure categories are directly resolved with concrete evidence in the deliverable.',
  ].join('\n')
}

function buildFailureCategoryGuidance(categories: SessionGoalFailureCategory[] | undefined): string {
  if (!categories || categories.length === 0) {
    return '1. Re-check the missing criteria and produce verifiable improvements.'
  }

  const guidance: Record<SessionGoalFailureCategory, string> = {
    scope_gap: 'Restore the full requested scope and explicitly cover each omitted requirement.',
    evidence_gap: 'Add concrete citations, source references, file paths, or artifact evidence that prove the claims.',
    verification_gap: 'Run or cite the required tests, builds, checks, validations, or other verification evidence.',
    shallow_output: 'Expand the deliverable with specific, substantive content instead of an outline or placeholder.',
    tool_failure: 'Resolve the failed tool or execution error before claiming the task is complete.',
  }

  return categories
    .filter(category => guidance[category])
    .map((category, index) => `${index + 1}. ${guidance[category]}`)
    .join('\n')
}

function mergeFailureCategories(
  existing: SessionGoalFailureCategory[] | undefined,
  incoming: SessionGoalFailureCategory[] | undefined,
): SessionGoalFailureCategory[] | undefined {
  const merged = [...new Set([...(existing ?? []), ...(incoming ?? [])])]
  return merged.length > 0 ? merged : undefined
}

const OBVIOUS_SCOPE_REDUCTION_PATTERN = /(?:由于篇幅|篇幅有限|这里只能|先给(?:你)?(?:一个)?(?:框架|大纲|示例|简版)|简化版|精简版|概要版|后续(?:再|可|可以).{0,20}(?:补充|完善)|placeholder|outline only|high[- ]level outline|brief sketch|will be completed later)/i

function hasObviousScopeReduction(contents: string[]): boolean {
  return contents.some(content => OBVIOUS_SCOPE_REDUCTION_PATTERN.test(content))
}

function buildPreviousAuditSummary(history: SessionGoalState['auditHistory']): string {
  if (history.length === 0) {
    return '(none)'
  }

  return history.slice(-3).map(result => {
    const missing = result.missingCriteria.length > 0
      ? `\n  Missing: ${result.missingCriteria.slice(0, 4).map(summarizePromptText).join('; ')}`
      : ''
    const correction = result.correctivePrompt
      ? `\n  Correction: ${summarizePromptText(result.correctivePrompt)}`
      : ''
    return `Iteration ${result.iteration}: ${result.status} - ${summarizePromptText(result.summary)}${missing}${correction}`
  }).join('\n')
}

function summarizePromptText(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, 1000) || '(empty)'
}

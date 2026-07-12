/**
 * Session Tool Definitions — Single Source of Truth
 *
 * Canonical Zod schemas, descriptions, and handler registry for all
 * session-scoped tools. Consumers derive what they need:
 *
 * - Claude SDK  → `.shape` extracts the plain `{ key: z.string() }` literal
 * - MCP / Pi    → `getToolDefsAsJsonSchema()` auto-converts to JSON Schema
 *
 * Adding a new tool: define the schema, description, handler import, and
 * one entry in SESSION_TOOL_DEFS.
 */

import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { SessionToolContext } from './context.ts';
import type { ToolResult } from './types.ts';

// Handlers
import { handleSubmitPlan } from './handlers/submit-plan.ts';
import { handleConfigValidate } from './handlers/config-validate.ts';
import { handleSkillValidate } from './handlers/skill-validate.ts';
import { handleMermaidValidate } from './handlers/mermaid-validate.ts';
import { handleSourceTest } from './handlers/source-test.ts';
import { handleFileMemorySourceCreate } from './handlers/file-memory-source-create.ts';
import { handleTenderWorkspace } from './handlers/tender-workspace.ts';
import { handleTenderCapability } from './handlers/tender-capability.ts';
import { handleDeliveryWorkspace } from './handlers/delivery-workspace.ts';
import { handleDeliveryCapability } from './handlers/delivery-capability.ts';
import {
  handleSourceOAuthTrigger,
  handleGoogleOAuthTrigger,
  handleSlackOAuthTrigger,
  handleMicrosoftOAuthTrigger,
} from './handlers/source-oauth.ts';
import { handleCredentialPrompt } from './handlers/credential-prompt.ts';
import { handleUpdatePreferences } from './handlers/update-preferences.ts';
import { handleTransformData } from './handlers/transform-data.ts';
import { handleDocumentArtifact } from './handlers/document-artifact.ts';
import { handleScriptSandbox } from './handlers/script-sandbox.ts';
import { handleRenderTemplate } from './handlers/render-template.ts';
import { handleSendDeveloperFeedback } from './handlers/send-developer-feedback.ts';
import { handleSetSessionLabels } from './handlers/set-session-labels.ts';
import { handleSetSessionStatus } from './handlers/set-session-status.ts';
import { handleGetSessionInfo } from './handlers/get-session-info.ts';
import { handleGetSpawnStatus } from './handlers/get-spawn-status.ts';
import { handleListSessions } from './handlers/list-sessions.ts';
import { handleSendAgentMessage } from './handlers/send-agent-message.ts';
import { handleListMessagingChannels, handleUnbindMessagingChannel } from './handlers/messaging.ts';

// ============================================================
// Canonical Zod Schemas
// ============================================================

export const SubmitPlanSchema = z.object({
  planPath: z.string().describe('Absolute path to the plan markdown file you wrote'),
});

export const ConfigValidateSchema = z.object({
  target: z.enum(['config', 'sources', 'statuses', 'preferences', 'permissions', 'automations', 'tool-icons', 'all'])
    .describe('Which config file(s) to validate'),
  sourceSlug: z.string().optional().describe('Validate a specific source by slug'),
});

export const SkillValidateSchema = z.object({
  skillSlug: z.string().describe('The slug of the skill to validate'),
});

export const MermaidValidateSchema = z.object({
  code: z.string().describe('The mermaid diagram code to validate'),
  render: z.boolean().optional().describe('Also attempt to render (catches layout errors)'),
});

export const SourceTestSchema = z.object({
  sourceSlug: z.string().describe('The slug of the source to test'),
  autoEnable: z
    .boolean()
    .optional()
    .describe(
      'Automatically enable and activate the source in the current session on successful validation. Defaults to true. Pass false to keep pure validation behavior.'
    ),
});

export const FileMemorySourceCreateSchema = z.object({
  filePath: z.string().describe('Absolute path, or path relative to the session working directory, for a text/Markdown/JSON file to index as one read-only MCP source'),
  name: z.string().optional().describe('Display name for the source. Defaults to the file name.'),
  sourceSlug: z.string().optional().describe('Optional source slug. If omitted, a file-memory-* slug is generated.'),
  originalSourceFilePath: z.string().optional().describe('Original user-selected source path when filePath points to a structured Markdown sidecar generated during import.'),
  chunkSize: z.number().min(1000).max(12000).optional().describe('Approximate characters per chunk. Defaults to 3000.'),
  overlap: z.number().min(0).max(2000).optional().describe('Characters of overlap between chunks. Defaults to 300.'),
  autoEnable: z.boolean().optional().describe('Validate, enable, and activate the source after creation. Defaults to true.'),
  knowledgeBase: z.object({
    category: z.string().min(1).describe('Knowledge base category or folder chosen or created by the user. Slash-separated folders are allowed.'),
  }).optional().describe('When present, create this file-memory source as a global Knowledge Base MCP source. MVP supports only .md, .txt, and .json files.'),
});

export const SourceOAuthTriggerSchema = z.object({
  sourceSlug: z.string().describe('The slug of the source to authenticate'),
});

export const CredentialPromptSchema = z.object({
  sourceSlug: z.string().describe('The slug of the source to authenticate'),
  mode: z.enum(['bearer', 'basic', 'header', 'query', 'multi-header']).describe('Type of credential input'),
  labels: z.object({
    credential: z.string().optional(),
    username: z.string().optional(),
    password: z.string().optional(),
  }).optional().describe('Custom field labels'),
  description: z.string().optional().describe('Description shown to user'),
  hint: z.string().optional().describe('Hint about where to find credentials'),
  headerNames: z.array(z.string()).optional().describe('Header names for multi-header auth (e.g., ["DD-API-KEY", "DD-APPLICATION-KEY"])'),
  passwordRequired: z.boolean().optional().describe('For basic auth: whether password is required'),
});

export const CallLlmSchema = z.object({
  prompt: z.string().describe('Instructions for the LLM'),
  attachments: z.array(z.union([
    z.string().describe('Simple file path'),
    z.object({
      path: z.string().describe('File path'),
      startLine: z.number().optional().describe('First line (1-indexed)'),
      endLine: z.number().optional().describe('Last line (1-indexed)'),
    }),
  ])).optional().describe('File paths on disk to attach (max 20). NOT for inline text — put text in prompt instead. Use {path, startLine, endLine} for large files.'),
  model: z.string().optional().describe('Model ID or short name. Defaults to a fast model.'),
  systemPrompt: z.string().optional().describe('Optional system prompt'),
  maxTokens: z.number().optional().describe('Max output tokens (1-64000). Defaults to 4096'),
  temperature: z.number().optional().describe('Sampling temperature 0-1'),
  thinking: z.boolean().optional().describe('Enable extended thinking. Incompatible with outputFormat/outputSchema'),
  thinkingBudget: z.number().optional().describe('Token budget for thinking (1024-100000). Defaults to 10000'),
  outputFormat: z.enum(['summary', 'classification', 'extraction', 'analysis', 'comparison', 'validation']).optional()
    .describe('Predefined output format'),
  outputSchema: z.object({
    type: z.literal('object'),
    properties: z.record(z.string(), z.unknown()),
    required: z.array(z.string()).optional(),
  }).optional().describe('Custom JSON Schema for structured output'),
});

export const UpdatePreferencesSchema = z.object({
  name: z.string().optional().describe("The user's preferred name or how they'd like to be addressed"),
  timezone: z.string().optional().describe("The user's timezone in IANA format (e.g., 'America/New_York', 'Europe/London')"),
  city: z.string().optional().describe("The user's city"),
  region: z.string().optional().describe("The user's state/region/province"),
  country: z.string().optional().describe("The user's country"),
  notes: z.string().optional().describe('Additional notes about the user that would be helpful to remember (preferences, context, etc.). Replaces any existing notes.'),
  includeCoAuthoredBy: z.boolean().optional().describe("Whether to include 'Co-Authored-By: Craft Agent' trailer on git commits. Defaults to true."),
});

export const TransformDataSchema = z.object({
  language: z.enum(['python3', 'node', 'bun']).describe('Script runtime to use'),
  script: z.string().describe('Transform script source code. Receives input file paths as command-line args (sys.argv[1:] or process.argv.slice(2)), last arg is the output file path.'),
  inputFiles: z.array(z.string()).describe('Input file paths relative to session dir (e.g., "long_responses/stripe_txns.txt")'),
  outputFile: z.string().describe('Output file name relative to session data/ dir (e.g., "transactions.json")'),
});

export const ScriptSandboxSchema = z.object({
  language: z.enum(['python3', 'node', 'bun']).describe('Script runtime to use'),
  script: z.string().describe('Inline script source to execute in a sandboxed subprocess.'),
  inputFiles: z.array(z.string()).optional().describe('Optional input file paths relative to the session directory.'),
  stdin: z.string().optional().describe('Optional stdin payload passed to the script process.'),
  timeoutMs: z.number().min(1).max(15000).optional().describe('Optional timeout in milliseconds (default 5000, max 15000).'),
});

export const RenderTemplateSchema = z.object({
  source: z.string().describe('Source slug (e.g., "linear", "gmail")'),
  template: z.string().describe('Template ID (e.g., "issue-detail", "issue-list")'),
  data: z.record(z.string(), z.unknown()).describe('JSON data to render into the template'),
});

export const SendDeveloperFeedbackSchema = z.object({
  message: z.string().describe('Freeform markdown feedback — be detailed, use headings, lists, code blocks. Include what happened, what you expected, what would help, or any ideas/suggestions.'),
});

// Browser tool schema (single CLI-like tool for all browser actions)
export const BrowserToolSchema = z.object({
  command: z.union([
    z.string(),
    z.array(z.string()),
  ]).describe('Browser command as a string (e.g., "click @e1") or array (e.g., ["evaluate", "var x = 1; x + 2"]). Array mode preserves semicolons and whitespace in arguments.'),
});

export const SpawnSessionSchema = z.object({
  help: z.boolean().optional().describe('If true, returns available connections, models, and sources instead of creating a session'),
  prompt: z.string().optional().describe('Instructions for the new session (required when not in help mode)'),
  name: z.string().optional().describe('Session name'),
  llmConnection: z.string().optional().describe('Connection slug (e.g., "anthropic-api", "codex")'),
  model: z.string().optional().describe('Model ID override'),
  enabledSourceSlugs: z.array(z.string()).optional().describe('Source slugs to enable in the new session'),
  permissionMode: z.enum(['safe', 'ask', 'allow-all']).optional().describe('Permission mode for the new session'),
  thinkingLevel: z.enum(['off', 'low', 'medium', 'high', 'xhigh', 'max']).optional()
    .describe('Reasoning level for the new session. Silently ignored on non-reasoning models (e.g. gpt-4o, gemini-2.5-flash). Omit to inherit the workspace default.'),
  labels: z.array(z.string()).optional().describe('Labels for the new session'),
  workingDirectory: z.string().optional().describe('Working directory for the new session'),
  attachments: z.array(z.object({
    path: z.string().describe('Absolute file path on disk'),
    name: z.string().optional().describe('Display name (defaults to file basename)'),
  })).optional().describe('Files to include with the prompt'),
});

// Session self-management tools
export const SetSessionLabelsSchema = z.object({
  sessionId: z.string().optional().describe('Session ID to update. Omit to update the current session.'),
  labels: z.array(z.string()).describe('Labels to set (replaces all existing labels)'),
});

export const SetSessionStatusSchema = z.object({
  sessionId: z.string().optional().describe('Session ID to update. Omit to update the current session.'),
  status: z.string().describe('Status to set (e.g., "todo", "in_progress", "done")'),
});

export const GetSessionInfoSchema = z.object({
  sessionId: z.string().optional().describe('Session ID to query. Omit to get info about the current session.'),
});

const TenderEntityInputSchema = z.record(z.string(), z.unknown());

export const TenderWorkspaceToolSchema = z.object({
  action: z.enum([
    'init',
    'upsert_documents',
    'upsert_requirements',
    'upsert_criteria',
    'upsert_deliverables',
    'upsert_responses',
    'status',
    'validate',
  ]).describe('Tender workspace operation to perform.'),
  projectId: z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/)
    .describe('Filesystem-safe stable tender project ID.'),
  project: TenderEntityInputSchema.optional().describe('Project fields required by init.'),
  documents: z.array(TenderEntityInputSchema).optional().describe('Full document entities for upsert_documents.'),
  requirements: z.array(TenderEntityInputSchema).optional().describe('Full requirement entities for upsert_requirements.'),
  criteria: z.array(TenderEntityInputSchema).optional().describe('Full evaluation criterion entities for upsert_criteria.'),
  deliverables: z.array(TenderEntityInputSchema).optional().describe('Full deliverable entities for upsert_deliverables.'),
  responses: z.array(TenderEntityInputSchema).optional().describe('Full response-plan entities for upsert_responses.'),
});

export const TenderCapabilityToolSchema = z.object({
  action: z.enum(['configure', 'init', 'replace', 'status', 'validate'])
    .describe('Capability-pack operation to perform.'),
  projectId: z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/)
    .describe('Filesystem-safe Tender Workspace project ID.'),
  capability: z.enum([
    'evaluation_strategy',
    'boq_reconciliation',
    'execution_plan',
    'schedule_resources',
    'cost_cashflow',
    'submission_audit',
  ]).describe('Tender capability pack to operate on.'),
  data: z.unknown().optional().describe('Complete capability data required by init and replace.'),
  expectedRevision: z.number().int().positive().optional()
    .describe('Optimistic concurrency revision required when replacing known state.'),
  enabled: z.boolean().optional().describe('Whether the capability is enabled for this tender.'),
  required: z.boolean().optional().describe('Whether the enabled capability must pass before submission.'),
});

export const DeliveryWorkspaceToolSchema = z.object({
  action: z.enum([
    'init', 'upsert_sources', 'upsert_snapshots', 'upsert_baselines',
    'upsert_knowledge_uses', 'status', 'validate',
  ]).describe('Delivery Workspace operation to perform.'),
  projectId: z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/)
    .describe('Filesystem-safe stable delivery project ID.'),
  project: TenderEntityInputSchema.optional().describe('Project fields required by init.'),
  sources: z.array(TenderEntityInputSchema).optional().describe('User-owned implementation source records.'),
  snapshots: z.array(TenderEntityInputSchema).optional().describe('Frozen optional tender or knowledge evidence snapshots.'),
  baselines: z.array(TenderEntityInputSchema).optional().describe('Delivery baseline records with local evidence references.'),
  knowledgeUses: z.array(TenderEntityInputSchema).optional().describe('Explicit enterprise knowledge use and verification records.'),
});

export const DeliveryCapabilityToolSchema = z.object({
  action: z.enum(['configure', 'init', 'replace', 'status', 'validate'])
    .describe('Delivery capability-pack operation.'),
  projectId: z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/),
  capability: z.enum([
    'contract_scope', 'programme_progress', 'resource_procurement', 'cost_commercial',
    'cashflow', 'risk_change', 'reporting_audit',
  ]),
  data: z.unknown().optional(),
  expectedRevision: z.number().int().positive().optional(),
  enabled: z.boolean().optional(),
  required: z.boolean().optional(),
});

export const DocumentArtifactSchema = z.object({
  action: z.enum(['init', 'write_section', 'status', 'prepare_merge', 'assemble', 'validate'])
    .describe('Transactional artifact operation.'),
  artifactId: z.string().describe('Stable artifact ID using letters, numbers, dot, underscore, or hyphen.'),
  outputFile: z.string().optional().describe('Final Markdown file name. Required for init.'),
  sections: z.array(z.object({
    id: z.string(),
    title: z.string(),
    order: z.number().int().min(0),
    required: z.boolean().optional(),
  })).optional().describe('Ordered section manifest. Required for init.'),
  overwrite: z.boolean().optional().describe('Replace an existing artifact manifest during init.'),
  sectionId: z.string().optional().describe('Declared section ID. Required for write_section.'),
  content: z.string().optional().describe('Complete content for one declared section. Required for write_section.'),
  requiredStrings: z.array(z.string()).optional().describe('Exact text fragments that must exist in the assembled file during validate.'),
});

export const GetSpawnStatusSchema = z.object({
  sessionId: z.string().optional().describe('Spawned session ID to query. Omit to query the current session.'),
});

export const ListSessionsSchema = z.object({
  status: z.string().optional().describe('Filter by status'),
  label: z.string().optional().describe('Filter by label'),
  search: z.string().optional().describe('Substring match on session name'),
  sortBy: z.enum(['recent', 'name', 'status']).optional().describe('Sort order (default: recent)'),
  limit: z.number().optional().describe('Max sessions to return (default 20, max 100)'),
  offset: z.number().optional().describe('Skip first N results (for pagination)'),
});

// Inter-session messaging
export const SendAgentMessageSchema = z.object({
  sessionId: z.string().describe('Target session ID to send the message to'),
  message: z.string().describe('The message to send to the target session'),
  attachments: z.array(z.object({
    path: z.string().describe('Absolute file path on disk'),
    name: z.string().optional().describe('Display name (defaults to file basename)'),
  })).optional().describe('Files to include with the message'),
});

export const ListMessagingChannelsSchema = z.object({
  sessionId: z.string().optional().describe('Session ID to list bindings for. Defaults to current session.'),
});

export const UnbindMessagingChannelSchema = z.object({
  platform: z.enum(['telegram', 'whatsapp']).optional().describe('Platform to unbind. If omitted, unbinds all.'),
});

// ============================================================
// Canonical Tool Descriptions (base — no DOC_REFS)
// ============================================================

export const TOOL_DESCRIPTIONS = {
  SubmitPlan: `Submit a plan for user review.

Call this after you have written your plan to a markdown file using the Write tool.
The plan will be displayed to the user in a special formatted view.

**IMPORTANT:** After calling this tool:
- Execution will be **automatically paused** to present the plan to the user
- No further tool calls or text output will be processed after this tool returns
- The conversation will resume when the user responds (accept, modify, or reject the plan)
- Do NOT include any text or tool calls after SubmitPlan - they will not be executed`,

  config_validate: `Validate Craft Agent configuration files.

Use this after editing configuration files to check for errors before they take effect.
Returns structured validation results with errors, warnings, and suggestions.

**Targets:**
- \`config\`: Validates config.json (workspaces, model, settings)
- \`sources\`: Validates all source config.json files
- \`statuses\`: Validates statuses config.json
- \`preferences\`: Validates preferences.json
- \`permissions\`: Validates permissions.json files
- \`automations\`: Validates automations.json configuration
- \`tool-icons\`: Validates tool-icons.json
- \`all\`: Validates all configuration files`,

  skill_validate: `Validate a skill's SKILL.md file.

Checks:
- Slug format (lowercase alphanumeric with hyphens)
- SKILL.md exists and is readable
- YAML frontmatter is valid with required fields (name, description)
- Content is non-empty after frontmatter
- Icon format if present (svg/png/jpg)`,

  mermaid_validate: `Validate Mermaid diagram syntax before outputting.

Use this when:
- Creating complex diagrams with many nodes/relationships
- Unsure about syntax for a specific diagram type
- Debugging a diagram that failed to render

Returns validation result with specific error messages if invalid.`,

  source_test: `Validate, test, and (by default) activate a source configuration.

**This tool performs:**
1. **Schema validation**: Validates config.json structure
2. **Icon handling**: Checks/downloads icon if configured
3. **Completeness check**: Warns about missing guide.md/icon/tagline
4. **Connection test**: Tests if the source is reachable
5. **Auth status**: Checks if source is authenticated
6. **Auto-enable** (default): If validation passes, flip \`enabled: true\` in config (if needed) and activate the source in the running session so its tools become available without a restart.

Pass \`autoEnable: false\` to keep pure validation behavior (no config or session mutations).`,

  file_memory_source_create: `Create a read-only file memory MCP source from a local text artifact.

Use this when the user wants a specific file, parsed artifact, tender excerpt, specification extract, or generated Markdown/JSON/TXT output to become a selectable source for future evidence lookup.

**What it does:**
1. Reads a file inside the current working directory/session/workspace.
2. Builds a local chunk manifest under the workspace \`file-memory/\` folder.
3. Creates a stdio MCP source under the workspace \`sources/\` folder.
4. Runs \`source_test\` so the source can be enabled and activated when possible.

This first version indexes text-like artifacts. For PDF, Excel, scanned documents, or images, extract them first with the existing document skills/tools, then call this tool on the generated Markdown/JSON/TXT file.`,

  tender_workspace: `Maintain the project-local Tender Workspace business register and deterministic readiness audit.

Use this as the system of record for tender documents, requirements, evaluation criteria, deliverables, and response plans. Register entities in dependency order. Every requirement and criterion must cite a registered source document. The tool never scans the working directory for source material.

Actions:
- init: create the versioned project model
- upsert_documents, upsert_requirements, upsert_criteria, upsert_deliverables, upsert_responses: validate and atomically persist full entities
- status: return the current model and computed audit without mutation
- validate: recompute and persist readiness-audit.json

Call validate before any completion claim. A ready result is a deterministic coverage state, not professional approval.`,

  tender_capability: `Maintain one versioned Tender Intelligence capability pack for an existing Tender Workspace.

Use this after tender_workspace has registered the authoritative project, sources, requirements, criteria, deliverables, and response plans. The tool stores capability data separately under the tender project, records core and upstream revisions, rejects stale optimistic updates, and returns deterministic readiness.

Actions:
- configure: set whether a capability is enabled and required
- init: create a capability pack from complete typed data
- replace: atomically replace the pack using expectedRevision when available
- status: inspect current data, audit, and stale dependencies
- validate: recompute and persist the capability audit

Only implemented capability packs can be initialized. A stale pack cannot be treated as ready. The tool never scans the working directory.`,

  delivery_workspace: `Maintain the independent Project Delivery Controls system of record.

Initialize this workspace from user-owned implementation records such as the contract, approved scope, BOQ, baseline programme, budget, organization, commitments, resources, or progress. Tender data is optional and may only be imported as a frozen, user-confirmed evidence snapshot. The tool never reads or writes Tender Workspace or Investment Workspace private stores and never scans the working directory.

Actions:
- init: create the delivery project model
- upsert_sources: register explicit user-owned project inputs
- upsert_snapshots: register frozen optional tender or knowledge snapshots
- upsert_baselines: register locally approved baseline records and evidence
- upsert_knowledge_uses: record corroborating, conflicting, derived, or superseding knowledge use
- status and validate: inspect or persist the deterministic readiness audit`,

  delivery_capability: `Maintain one versioned Project Delivery Controls capability pack.

Use this only after delivery_workspace has registered explicit user-owned implementation inputs and local baselines. Capability packs are stored only under business/delivery, record core and upstream revisions, and become stale after relevant delivery records change. Tender or enterprise-knowledge snapshots remain evidence and cannot replace required direct project support.

Actions: configure, init, replace, status, validate. Only implemented delivery capability packs can be initialized.`,

  source_oauth_trigger: `Start OAuth authentication for an MCP source.

This tool initiates the OAuth 2.0 + PKCE flow for sources that require authentication.

**Prerequisites:**
- Source must exist in the current workspace
- Source must be type 'mcp' with authType 'oauth'
- Source must have a valid MCP URL

**IMPORTANT:** After calling this tool, execution will be paused while OAuth completes.`,

  source_google_oauth_trigger: `Trigger Google OAuth authentication for a Google API source.

Opens a browser window for the user to sign in with their Google account.

**Supported services:** Gmail, Calendar, Drive, Docs, Sheets, YouTube, Search Console

**IMPORTANT:** After calling this tool, execution will be paused while OAuth completes.`,

  source_slack_oauth_trigger: `Trigger Slack OAuth authentication for a Slack API source.

Opens a browser window for the user to sign in with their Slack account.

**IMPORTANT:** After calling this tool, execution will be paused while OAuth completes.`,

  source_microsoft_oauth_trigger: `Trigger Microsoft OAuth authentication for a Microsoft API source.

Opens a browser window for the user to sign in with their Microsoft account.

**Supported services:** Outlook, Calendar, OneDrive, Teams, SharePoint

**IMPORTANT:** After calling this tool, execution will be paused while OAuth completes.`,

  source_credential_prompt: `Prompt the user to enter credentials for a source.

Use this when a source requires authentication that isn't OAuth.
The user will see a secure input UI with appropriate fields based on the auth mode.

**Auth Modes:**
- \`bearer\`: Single token field (Bearer Token, API Key)
- \`basic\`: Username and Password fields
- \`header\`: API Key with custom header name shown
- \`query\`: API Key for query parameter auth
- \`multi-header\`: Multiple API keys with custom header names

**IMPORTANT:** After calling this tool, execution will be paused for user input.`,

  update_user_preferences: `Update stored user preferences. Use this when you learn information about the user that would be helpful to remember for future conversations. This includes their name, timezone, location, or any other relevant notes. Only update fields you have confirmed information about - don't guess.`,

  transform_data: `Transform data files using a script and write structured output for datatable/spreadsheet blocks, or extract HTML content for html-preview blocks.

Use this tool when you need to transform large datasets (20+ rows) into structured JSON for display, or extract/decode content for rich previews. Write a transform script that reads the input file and produces an output file, then reference it via \`"src"\` in your datatable/spreadsheet/html-preview/pdf-preview/image-preview block.

**Workflow:**
1. Call \`transform_data\` with a script that reads input files and writes output
2. Output a datatable/spreadsheet block with \`"src": "data/output.json"\`, an html-preview block with \`"src": "data/output.html"\`, a pdf-preview block with \`"src": "data/output.pdf"\`, or an image-preview block with \`"src": "data/output.png"\`

**Script conventions:**
- Input file paths are passed as command-line arguments (last arg = output file path)
- Python: \`sys.argv[1:-1]\` = input files, \`sys.argv[-1]\` = output path
- Node/Bun: \`process.argv.slice(2, -1)\` = input files, \`process.argv.at(-1)\` = output path
- For datatable/spreadsheet: output must be valid JSON: \`{"title": "...", "columns": [...], "rows": [...]}\`
- For html-preview: output is an HTML file (any valid HTML)

**Security:** Runs in an isolated subprocess with no access to API keys or credentials. 30-second timeout.`,

  document_artifact: `Write long Markdown deliverables through an application-managed transactional workflow.

Use this instead of one oversized Write call or ad-hoc Bash/Python file construction:
1. init — declare the final file and ordered required sections
2. write_section — atomically replace one bounded section
3. status — inspect missing sections
4. prepare_merge — reject missing, empty, or externally changed sections and freeze hashes
5. assemble — atomically create the formal output only from the frozen section set
6. validate — verify exact required text in the assembled artifact

After prepare_merge, any section change invalidates assembly until prepare_merge runs again.`,

  script_sandbox: `Run quick inline diagnostics in a sandboxed subprocess with network isolation.

Use this for short Python/Node/Bun snippets when strict Explore-mode Bash parsing blocks inline diagnostics.

**Behavior:**
- Executes script source from \`script\` in a temporary file
- Returns stdout/stderr, exit code, duration, and timeout status
- Accepts optional input files and stdin
- Requires enforced network and filesystem isolation; if unsupported or unusable, execution is blocked

**Safety:**
- Sensitive credential env vars are stripped
- Input files are restricted to the current session directory
- Filesystem writes are restricted to the current session directory
- Timeout is capped (default 5000ms, max 15000ms)
- Network/filesystem isolation is required in all permission modes; if unavailable, execution is blocked`,

  render_template: `Render a source's HTML template with data.

Use this when a source provides HTML templates for rich rendering of its data (e.g., issue detail views, email threads, ticket summaries).

**Workflow:**
1. Fetch data from the source (via MCP tools or API calls)
2. Call \`render_template\` with the source slug, template ID, and data
3. Output an \`html-preview\` block with the returned file path as \`"src"\`

**Available templates** are documented in each source's \`guide.md\` under the "Templates" section.

Templates use Mustache syntax — the tool handles rendering and writes the output HTML to the session data folder.`,

  browser_tool: `Run browser actions using a CLI-like command (string or array input).

All browser interactions use this single tool with strict validation and actionable feedback.
String mode supports batching with semicolons: \`fill @e1 value; fill @e2 value; click @e3\`
Batch stops after navigation commands (click, navigate, back, forward) since page state may change.

Array mode bypasses string parsing and preserves raw arguments exactly (recommended for semicolons, tabs, and newlines):
- \`["evaluate", "var x = 1; var y = 2; x + y"]\`
- \`["paste", "Name\\tAge\\nAlice\\t30"]\`

Examples:
- \`--help\`
- \`open\`
- \`navigate https://example.com\`
- \`snapshot\`
- \`find login button\` — search elements by keyword
- \`click @e12\`
- \`click-at 350 200\` — click at pixel coordinates (for canvas elements)
- \`fill @e5 user@example.com\`
- \`type Hello World\` — type into currently focused element (no ref needed)
- \`select @e3 optionValue\`
- \`select @e75 CNAME --assert-text Target --timeout 3000\`
- \`set-clipboard Name\\tAge\\nAlice\\t30\` — write text to clipboard
- \`get-clipboard\` — read clipboard text content
- \`paste Name\\tAge\\nAlice\\t30\` — set clipboard and trigger Ctrl/Cmd+V
- \`scroll down 800\`
- \`evaluate document.title\`
- \`console 50 error\`
- \`screenshot\` — raw screenshot
- \`screenshot --annotated\` — screenshot with @eN labels overlaid on interactive elements
- \`screenshot-region 100 200 640 480\`
- \`screenshot-region --ref @e12 --padding 8\`
- \`screenshot-region --selector div[data-testid="chart"]\`
- \`window-resize 1440 900\`
- \`network 50 failed\`
- \`wait network-idle 8000\`
- \`key Enter\`
- \`key k meta\`
- \`downloads wait 15000\`
- \`focus [windowId]\` — focus existing browser window (no new window)
- \`windows\` — list current browser windows and ownership state
- \`release\` — dismiss the agent control overlay when done
- \`close\` — close and destroy the browser window
- \`hide\` — hide the window while preserving state`,

  call_llm: `Invoke a secondary LLM for focused subtasks. Use for:
- Cost optimization: use a smaller model for simple tasks (summarization, classification)
- Structured output: JSON schema compliance via prompt instructions
- Parallel processing: call multiple times in one message - all run simultaneously
- Context isolation: process content without polluting main context

Put text/content directly in the 'prompt' parameter. Do NOT pass inline text via attachments.
Only use 'attachments' for existing file paths on disk - the tool loads file content automatically.
For large files (>2000 lines), use {path, startLine, endLine} to select a portion.`,

  spawn_session: `Create a new session that runs independently with its own prompt, connection, model, and sources.

Use this to delegate tasks to parallel sessions — research, analysis, drafts, or any work that benefits from separate context.

Call with help=true first to discover available connections, models, and sources.
When spawning, the 'prompt' parameter is required.

Optional overrides: \`model\`, \`llmConnection\`, \`permissionMode\`, \`thinkingLevel\`, \`enabledSourceSlugs\`, \`labels\`, \`workingDirectory\`. Omitted fields inherit from the spawning session or the workspace default.
For document multi-agent deep mode, omit \`workingDirectory\` unless the user explicitly names a different folder, and either omit \`enabledSourceSlugs\` to inherit the selected sources or pass exactly the user-selected knowledge-base/source slugs.

\`thinkingLevel\` is silently ignored on non-reasoning models (e.g. gpt-4o, gemini-2.5-flash) — the SDK drops the reasoning param rather than erroring. Use it when you want to force deeper reasoning on a supported model, or set it to \`off\` when spawning a session that doesn't need to think.

The spawned session appears in the session list and runs fire-and-forget. The result may include taskId, briefPath, reportPath, pollAfterMs, and handoffRequired. If handoffRequired is true, wait at least pollAfterMs and call get_spawn_status for the session. Continue polling while handoffStatus is pending and lastActivityAt is advancing. Do not impose an arbitrary fixed timeout or treat user status values such as "todo" as failure. Only bypass a child when handoffStatus is failed/isStale is true, or pause for user review when the parent budget expires.
Only use 'attachments' for existing file paths on disk — the tool reads them automatically.`,

  send_developer_feedback: `Send freeform feedback to the Craft Agent development team.

Use this to share anything that would help improve the product — issues you hit, ideas for better tools, suggestions for improved workflows, or patterns you notice. Write in markdown with as much detail as possible. This is your direct line to the developers.`,

  set_session_labels: `Set labels on the current session or a specific session by ID. Replaces all existing labels.

Use this to tag sessions for filtering or to trigger label-based automations (LabelAdd/LabelRemove events).
Pass an empty array to clear all labels. Omit sessionId to target the current session.`,

  set_session_status: `Set the status of the current session or a specific session by ID (e.g., "todo", "in_progress", "done").

Use this to signal completion or trigger status-based automations (SessionStatusChange events).
Omit sessionId to target the current session.`,

  get_session_info: `Get metadata about the current session or a specific session by ID.

Returns labels, status, name, permission mode, and other details.
Call with no arguments to introspect your own session state.
For spawned sessions, do not interpret user status values such as "todo" as runtime state; call get_spawn_status for handoff progress.`,

  get_spawn_status: `Get runtime handoff status for a spawned session.

Use this after spawn_session to check whether the child is still processing, whether its structured report exists, and whether the handoff is ready.
Do not treat get_session_info.status="todo" as failure; use handoffStatus, isProcessing, reportPathExists, reportSize, lastActivityAt, and isStale from this tool instead. A running child is stale only when isStale is true; never merge around a pending child without an audited handoff.`,

  list_sessions: `List sessions in the workspace. Returns total count + paginated results.

Use filters (status, label, search) to narrow results instead of fetching everything. Default limit is 20 sessions.
Use get_session_info for full details on a specific session (list-then-detail pattern).`,

  send_agent_message: `Send a message to another session. The message is delivered with your session ID so the target can reply back.

Use this to coordinate with spawned sessions, send follow-up instructions, or relay information between sessions.
Use list_sessions to find session IDs, or use the sessionId returned by spawn_session.

The target session receives your message with a sender envelope containing your session ID, so it can use send_agent_message to reply.`,

  list_messaging_channels: `List messaging channels (Telegram, WhatsApp) bound to a session.
Shows which external chat apps are connected and can send/receive messages.`,

  unbind_messaging_channel: `Disconnect a messaging channel from the current session.
Messages will no longer be forwarded between the chat app and this session.`,
} as const;

// ============================================================
// Tool Definition Type
// ============================================================

/** Handler function signature for session tools. */
export type SessionToolHandler = (ctx: SessionToolContext, args: any) => Promise<ToolResult>;

/** Where a session tool is executed. */
export type SessionToolExecutionMode = 'registry' | 'backend';

/** Safe/Explore mode behavior for a session tool. */
export type SessionToolSafeMode = 'allow' | 'block';

interface SessionToolDefBase {
  name: string;
  description: string;
  inputSchema: z.ZodObject<z.ZodRawShape>;
  /** Whether this tool is allowed in Explore/Safe mode. */
  safeMode: SessionToolSafeMode;
  /** Whether this tool only reads data (no side effects). Enables parallel execution in backends that support it. */
  readOnly?: boolean;
}

/** Tool executed from the canonical registry (requires a concrete handler). */
export interface RegistrySessionToolDef extends SessionToolDefBase {
  executionMode: 'registry';
  handler: SessionToolHandler;
}

/** Tool executed by backend-specific adapters (Pi/Claude/session-mcp-server). */
export interface BackendSessionToolDef extends SessionToolDefBase {
  executionMode: 'backend';
  handler: null;
}

/** A single session tool definition combining name, description, schema, mode, and handler. */
export type SessionToolDef = RegistrySessionToolDef | BackendSessionToolDef;

// ============================================================
// Canonical Tool Registry
// ============================================================

export const SESSION_TOOL_DEFS: SessionToolDef[] = [
  { name: 'SubmitPlan', description: TOOL_DESCRIPTIONS.SubmitPlan, inputSchema: SubmitPlanSchema, executionMode: 'registry', safeMode: 'allow', handler: handleSubmitPlan },
  { name: 'config_validate', description: TOOL_DESCRIPTIONS.config_validate, inputSchema: ConfigValidateSchema, executionMode: 'registry', safeMode: 'allow', readOnly: true, handler: handleConfigValidate },
  { name: 'skill_validate', description: TOOL_DESCRIPTIONS.skill_validate, inputSchema: SkillValidateSchema, executionMode: 'registry', safeMode: 'allow', readOnly: true, handler: handleSkillValidate },
  { name: 'mermaid_validate', description: TOOL_DESCRIPTIONS.mermaid_validate, inputSchema: MermaidValidateSchema, executionMode: 'registry', safeMode: 'allow', readOnly: true, handler: handleMermaidValidate },
  { name: 'source_test', description: TOOL_DESCRIPTIONS.source_test, inputSchema: SourceTestSchema, executionMode: 'registry', safeMode: 'allow', handler: handleSourceTest },
  { name: 'file_memory_source_create', description: TOOL_DESCRIPTIONS.file_memory_source_create, inputSchema: FileMemorySourceCreateSchema, executionMode: 'registry', safeMode: 'allow', handler: handleFileMemorySourceCreate },
  { name: 'tender_workspace', description: TOOL_DESCRIPTIONS.tender_workspace, inputSchema: TenderWorkspaceToolSchema, executionMode: 'registry', safeMode: 'block', handler: handleTenderWorkspace },
  { name: 'tender_capability', description: TOOL_DESCRIPTIONS.tender_capability, inputSchema: TenderCapabilityToolSchema, executionMode: 'registry', safeMode: 'block', handler: handleTenderCapability },
  { name: 'delivery_workspace', description: TOOL_DESCRIPTIONS.delivery_workspace, inputSchema: DeliveryWorkspaceToolSchema, executionMode: 'registry', safeMode: 'block', handler: handleDeliveryWorkspace },
  { name: 'delivery_capability', description: TOOL_DESCRIPTIONS.delivery_capability, inputSchema: DeliveryCapabilityToolSchema, executionMode: 'registry', safeMode: 'block', handler: handleDeliveryCapability },
  { name: 'source_oauth_trigger', description: TOOL_DESCRIPTIONS.source_oauth_trigger, inputSchema: SourceOAuthTriggerSchema, executionMode: 'registry', safeMode: 'block', handler: handleSourceOAuthTrigger },
  { name: 'source_google_oauth_trigger', description: TOOL_DESCRIPTIONS.source_google_oauth_trigger, inputSchema: SourceOAuthTriggerSchema, executionMode: 'registry', safeMode: 'block', handler: handleGoogleOAuthTrigger },
  { name: 'source_slack_oauth_trigger', description: TOOL_DESCRIPTIONS.source_slack_oauth_trigger, inputSchema: SourceOAuthTriggerSchema, executionMode: 'registry', safeMode: 'block', handler: handleSlackOAuthTrigger },
  { name: 'source_microsoft_oauth_trigger', description: TOOL_DESCRIPTIONS.source_microsoft_oauth_trigger, inputSchema: SourceOAuthTriggerSchema, executionMode: 'registry', safeMode: 'block', handler: handleMicrosoftOAuthTrigger },
  { name: 'source_credential_prompt', description: TOOL_DESCRIPTIONS.source_credential_prompt, inputSchema: CredentialPromptSchema, executionMode: 'registry', safeMode: 'block', handler: handleCredentialPrompt },
  { name: 'update_user_preferences', description: TOOL_DESCRIPTIONS.update_user_preferences, inputSchema: UpdatePreferencesSchema, executionMode: 'registry', safeMode: 'block', handler: handleUpdatePreferences },
  { name: 'transform_data', description: TOOL_DESCRIPTIONS.transform_data, inputSchema: TransformDataSchema, executionMode: 'registry', safeMode: 'allow', handler: handleTransformData },
  { name: 'document_artifact', description: TOOL_DESCRIPTIONS.document_artifact, inputSchema: DocumentArtifactSchema, executionMode: 'registry', safeMode: 'allow', handler: handleDocumentArtifact },
  { name: 'script_sandbox', description: TOOL_DESCRIPTIONS.script_sandbox, inputSchema: ScriptSandboxSchema, executionMode: 'registry', safeMode: 'allow', handler: handleScriptSandbox },
  { name: 'render_template', description: TOOL_DESCRIPTIONS.render_template, inputSchema: RenderTemplateSchema, executionMode: 'registry', safeMode: 'allow', handler: handleRenderTemplate },
  { name: 'send_developer_feedback', description: TOOL_DESCRIPTIONS.send_developer_feedback, inputSchema: SendDeveloperFeedbackSchema, executionMode: 'registry', safeMode: 'allow', handler: handleSendDeveloperFeedback },
  { name: 'call_llm', description: TOOL_DESCRIPTIONS.call_llm, inputSchema: CallLlmSchema, executionMode: 'backend', safeMode: 'allow', readOnly: true, handler: null },
  { name: 'spawn_session', description: TOOL_DESCRIPTIONS.spawn_session, inputSchema: SpawnSessionSchema, executionMode: 'backend', safeMode: 'allow', handler: null },
  // Browser tool (backend-specific — requires BrowserPaneManager in Electron)
  // Single CLI-like tool that handles all browser actions via command string.
  { name: 'browser_tool', description: TOOL_DESCRIPTIONS.browser_tool, inputSchema: BrowserToolSchema, executionMode: 'backend', safeMode: 'allow', handler: null },
  // Session self-management tools (registry — use context callbacks to reach SessionManager)
  { name: 'set_session_labels', description: TOOL_DESCRIPTIONS.set_session_labels, inputSchema: SetSessionLabelsSchema, executionMode: 'registry', safeMode: 'block', handler: handleSetSessionLabels },
  { name: 'set_session_status', description: TOOL_DESCRIPTIONS.set_session_status, inputSchema: SetSessionStatusSchema, executionMode: 'registry', safeMode: 'block', handler: handleSetSessionStatus },
  { name: 'get_session_info', description: TOOL_DESCRIPTIONS.get_session_info, inputSchema: GetSessionInfoSchema, executionMode: 'registry', safeMode: 'allow', readOnly: true, handler: handleGetSessionInfo },
  { name: 'get_spawn_status', description: TOOL_DESCRIPTIONS.get_spawn_status, inputSchema: GetSpawnStatusSchema, executionMode: 'registry', safeMode: 'allow', readOnly: true, handler: handleGetSpawnStatus },
  { name: 'list_sessions', description: TOOL_DESCRIPTIONS.list_sessions, inputSchema: ListSessionsSchema, executionMode: 'registry', safeMode: 'allow', readOnly: true, handler: handleListSessions },
  // Inter-session messaging
  { name: 'send_agent_message', description: TOOL_DESCRIPTIONS.send_agent_message, inputSchema: SendAgentMessageSchema, executionMode: 'registry', safeMode: 'allow', handler: handleSendAgentMessage },
  // Messaging gateway tools
  { name: 'list_messaging_channels', description: TOOL_DESCRIPTIONS.list_messaging_channels, inputSchema: ListMessagingChannelsSchema, executionMode: 'registry', safeMode: 'allow', readOnly: true, handler: handleListMessagingChannels },
  { name: 'unbind_messaging_channel', description: TOOL_DESCRIPTIONS.unbind_messaging_channel, inputSchema: UnbindMessagingChannelSchema, executionMode: 'registry', safeMode: 'block', handler: handleUnbindMessagingChannel },
];

export interface SessionToolFilterOptions {
  /** Include the experimental send_developer_feedback tool. */
  includeDeveloperFeedback?: boolean;
}

/**
 * Return session tools with optional feature filtering.
 *
 * Callers should use this helper instead of filtering ad hoc so tool visibility
 * stays consistent across Claude, Pi, and session-mcp-server backends.
 */
export function getSessionToolDefs(options?: SessionToolFilterOptions): SessionToolDef[] {
  const includeDeveloperFeedback = options?.includeDeveloperFeedback ?? true;

  return SESSION_TOOL_DEFS.filter(def => {
    if (!includeDeveloperFeedback && def.name === 'send_developer_feedback') {
      return false;
    }
    return true;
  });
}

/**
 * Build a name->definition registry with optional feature filtering.
 */
export function getSessionToolRegistry(options?: SessionToolFilterOptions): Map<string, SessionToolDef> {
  return new Map(getSessionToolDefs(options).map(def => [def.name, def]));
}

/**
 * Return session tool names with optional feature filtering.
 */
export function getSessionToolNames(options?: SessionToolFilterOptions): Set<string> {
  return new Set(getSessionToolDefs(options).map(def => def.name));
}

/**
 * Return backend-executed tool names with optional feature filtering.
 */
export function getSessionBackendToolNames(options?: SessionToolFilterOptions): Set<string> {
  return new Set(getSessionToolDefs(options).filter(d => d.executionMode === 'backend').map(d => d.name));
}

/**
 * Return registry-executed tool names with optional feature filtering.
 */
export function getSessionRegistryToolNames(options?: SessionToolFilterOptions): Set<string> {
  return new Set(getSessionToolDefs(options).filter(d => d.executionMode === 'registry').map(d => d.name));
}

export interface SessionToolNameOptions extends SessionToolFilterOptions {
  /** Optional name prefix for consumers (e.g. 'mcp__session__'). */
  prefix?: string;
}

/**
 * Return session tool names that are allowed in Explore/Safe mode.
 */
export function getSessionSafeAllowedToolNames(options?: SessionToolNameOptions): Set<string> {
  const prefix = options?.prefix ?? '';
  return new Set(
    getSessionToolDefs(options)
      .filter(def => def.safeMode === 'allow')
      .map(def => `${prefix}${def.name}`)
  );
}

/**
 * Return session tool names that are blocked in Explore/Safe mode.
 */
export function getSessionSafeBlockedToolNames(options?: SessionToolNameOptions): Set<string> {
  const prefix = options?.prefix ?? '';
  return new Set(
    getSessionToolDefs(options)
      .filter(def => def.safeMode === 'block')
      .map(def => `${prefix}${def.name}`)
  );
}

// ============================================================
// Derived Lookups
// ============================================================

/** Set of session tool names for quick membership checks. */
export const SESSION_TOOL_NAMES = new Set(SESSION_TOOL_DEFS.map(d => d.name));

/** Session tool names that must be handled by backend-specific adapters (Pi/Claude/session-mcp-server). */
export const SESSION_BACKEND_TOOL_NAMES = new Set(
  SESSION_TOOL_DEFS.filter(d => d.executionMode === 'backend').map(d => d.name)
);

/** Session tool names that are always executable from the canonical registry. */
export const SESSION_REGISTRY_TOOL_NAMES = new Set(
  SESSION_TOOL_DEFS.filter(d => d.executionMode === 'registry').map(d => d.name)
);

/** Session tool names allowed in Explore/Safe mode (unfiltered canonical set). */
export const SESSION_SAFE_ALLOWED_TOOL_NAMES = new Set(
  SESSION_TOOL_DEFS.filter(d => d.safeMode === 'allow').map(d => d.name)
);

/** Session tool names blocked in Explore/Safe mode (unfiltered canonical set). */
export const SESSION_SAFE_BLOCKED_TOOL_NAMES = new Set(
  SESSION_TOOL_DEFS.filter(d => d.safeMode === 'block').map(d => d.name)
);

/** Map from tool name → definition for O(1) lookup. */
export const SESSION_TOOL_REGISTRY = new Map(SESSION_TOOL_DEFS.map(d => [d.name, d]));

// ============================================================
// JSON Schema Converter (for MCP / Pi consumers)
// ============================================================

export interface JsonSchemaToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/**
 * Convert session tool definitions to JSON Schema format.
 *
 * @param opts.prefix - Optional prefix for tool names (e.g., 'mcp__session__' for Pi)
 * @param opts.includeDeveloperFeedback - Include experimental feedback tool in output
 * @returns Array of tool definitions with JSON Schema inputSchema
 */
export function getToolDefsAsJsonSchema(opts?: {
  prefix?: string;
  includeDeveloperFeedback?: boolean;
}): JsonSchemaToolDef[] {
  const prefix = opts?.prefix || '';
  const defs = getSessionToolDefs({ includeDeveloperFeedback: opts?.includeDeveloperFeedback });

  return defs.map(def => {
    // Explicit `as any` avoids TS2589 ("type instantiation is excessively deep")
    // caused by zodToJsonSchema inferring deep generic chains from union schemas.
    const jsonSchema = zodToJsonSchema(def.inputSchema as any, { $refStrategy: 'none' }) as Record<string, unknown>;
    // Strip metadata not needed by MCP/Pi consumers
    delete jsonSchema.$schema;
    delete jsonSchema.additionalProperties;
    return {
      name: prefix + def.name,
      description: def.description,
      inputSchema: jsonSchema,
    };
  });
}

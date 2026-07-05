import {
  createReadToolDefinition as createSdkReadToolDefinition,
  defineTool,
  type ReadToolOptions,
} from '@earendil-works/pi-coding-agent';

const EOF_OFFSET_RE = /^Offset (\d+) is beyond end of file \((\d+) lines total\)$/;

export function createReadToolDefinition(cwd: string, options?: ReadToolOptions) {
  const tool = createSdkReadToolDefinition(cwd, options);
  const execute = tool.execute;
  const wrappedExecute: typeof tool.execute = async (toolCallId, input, signal, onUpdate, ctx) => {
    try {
      return await execute(toolCallId, input, signal, onUpdate, ctx);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const match = EOF_OFFSET_RE.exec(message);
      if (!match) throw error;

      const requestedOffset = Number(match[1]);
      const totalLines = Number(match[2]);
      return {
        content: [{
          type: 'text',
          text: `Reached end of file. Requested offset=${requestedOffset}, but the file has ${totalLines} lines total. There is no more content to read from this file; do not retry with a larger offset.`,
        }],
        details: undefined,
      };
    }
  };

  return defineTool({
    ...tool,
    description: `${tool.description} If a read reports that the requested offset is past the end of the file, treat the file as complete and stop paginating it.`,
    promptGuidelines: [
      ...(tool.promptGuidelines ?? []),
      'When continuing a large file, use exactly the next offset returned by read. If read reports end of file, stop paginating that file.',
    ],
    execute: wrappedExecute,
  });
}

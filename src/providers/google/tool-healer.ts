/**
 * Tool Call Argument Healing and Normalization for Google Cloud Code PA
 *
 * Resolves incompatibilities between Google Cloud Code PA function calling
 * and Anthropic/Claude Code CLI strict schema validation:
 * 1. Claude Code tools with empty input schemas (e.g. EnterPlanMode, TaskList, CronList)
 *    are augmented with a synthetic 'reason' parameter to satisfy Google PA protobuf constraints.
 *    This module strips those synthetic properties and guarantees `{}` is returned to Claude Code CLI.
 * 2. Gemini sometimes omits required parameters or aliases them (e.g. Glob called with only `{ path: "public" }`
 *    omitting `pattern`, or putting pattern into `path`). This module auto-heals these calls into valid invocations.
 */

export interface ToolDefinitionLike {
  name?: string;
  input_schema?: {
    type?: string;
    properties?: Record<string, any>;
    required?: string[];
    [key: string]: any;
  };
  parameters?: {
    type?: string;
    properties?: Record<string, any>;
    required?: string[];
    [key: string]: any;
  };
  function?: {
    name?: string;
    parameters?: {
      type?: string;
      properties?: Record<string, any>;
      required?: string[];
      [key: string]: any;
    };
  };
  [key: string]: any;
}

const KNOWN_EMPTY_TOOLS = new Set([
  'EnterPlanMode',
  'TaskList',
  'CronList',
  'ShowOnboardingRolePicker',
  'ReadNotifications'
]);

/**
 * Heals and normalizes tool call arguments from Google PA before emitting to clients
 * (Anthropic Messages API / Claude Code CLI, OpenAI Chat Completions).
 */
export function healGoogleToolCall(
  toolName: string,
  rawArgs: Record<string, any> = {},
  tools?: ToolDefinitionLike[]
): Record<string, any> {
  const args = { ...rawArgs };

  // 1. Locate original tool definition if available
  const originalTool = tools?.find(
    (t) => t.name === toolName || t.function?.name === toolName
  );
  const originalSchema =
    originalTool?.input_schema ||
    originalTool?.parameters ||
    originalTool?.function?.parameters;
  const originalProperties = originalSchema?.properties;
  const hasDeclaredProperties =
    Boolean(originalProperties) && Object.keys(originalProperties).length > 0;

  // 2. Empty-schema tools (e.g. EnterPlanMode, TaskList, CronList):
  // If original tool had NO properties or is a known empty tool without declared properties,
  // return `{}` strictly to avoid Claude Code's `additionalProperties: false` rejection.
  if (
    originalTool &&
    !hasDeclaredProperties
  ) {
    return {};
  }
  if (!originalTool && KNOWN_EMPTY_TOOLS.has(toolName)) {
    return {};
  }

  // 3. Strip synthetic 'reason' placeholder:
  // If 'reason' exists in args but was NOT defined in the tool's original schema,
  // it was injected as a synthetic placeholder by schema-sanitizer for Google PA.
  if ('reason' in args && hasDeclaredProperties && !originalProperties.reason) {
    delete args.reason;
  }

  // 4. Glob tool parameter auto-healing:
  // Claude Code Glob tool: required: ['pattern'], optional: ['path']
  if (toolName === 'Glob') {
    // If model passed glob parameter alias
    if (!args.pattern && args.glob) {
      args.pattern = args.glob;
      delete args.glob;
    }
    // If model passed directory aliases
    if (!args.path && (args.directory || args.dir || args.folder)) {
      args.path = args.directory || args.dir || args.folder;
      delete args.directory;
      delete args.dir;
      delete args.folder;
    }

    const hasWildcards = typeof args.path === 'string' && /[*?[\]{}]/.test(args.path);

    if (!args.pattern || typeof args.pattern !== 'string' || args.pattern.trim() === '') {
      if (hasWildcards) {
        // Model placed pattern inside path (e.g. path: "src/**/*.ts" or path: "*.json")
        args.pattern = args.path;
        delete args.path;
      } else if (args.path) {
        // Model called Glob with only path (e.g. path: "public" or path: "src")
        // Intending to list/match all files in that directory
        args.pattern = '**/*';
      } else {
        // Neither pattern nor path provided
        args.pattern = '**/*';
      }
    }
  }

  // 5. Grep tool parameter auto-healing:
  // Claude Code Grep tool: required: ['pattern'], optional: ['path', 'glob', ...]
  if (toolName === 'Grep') {
    if (!args.pattern && (args.query || args.search || args.regex)) {
      args.pattern = args.query || args.search || args.regex;
      delete args.query;
      delete args.search;
      delete args.regex;
    }
  }

  // 6. File tools parameter auto-healing:
  // FileRead, FileWrite, FileEdit require 'file_path'
  if (['FileRead', 'FileWrite', 'FileEdit', 'Read', 'Write', 'Edit'].includes(toolName)) {
    if (!args.file_path && (args.path || args.filename || args.filePath)) {
      args.file_path = args.path || args.filename || args.filePath;
      delete args.path;
      delete args.filename;
      delete args.filePath;
    }
  }

  // 7. Bash tool parameter auto-healing:
  // Bash requires 'command'
  if (toolName === 'Bash') {
    if (!args.command && (args.cmd || args.script)) {
      args.command = args.cmd || args.script;
      delete args.cmd;
      delete args.script;
    }
  }

  // 8. WebSearch tool parameter auto-healing:
  // Claude Code WebSearch requires 'query'
  if (toolName === 'WebSearch') {
    if (!args.query && (args.search || args.q || args.text || args.keyword)) {
      args.query = args.search || args.q || args.text || args.keyword;
      delete args.search;
      delete args.q;
      delete args.text;
      delete args.keyword;
    }
  }

  // 9. WebFetch tool parameter auto-healing:
  // Claude Code WebFetch requires 'url' and 'prompt'
  if (toolName === 'WebFetch') {
    if (!args.url && (args.link || args.uri || args.target)) {
      args.url = args.link || args.uri || args.target;
      delete args.link;
      delete args.uri;
      delete args.target;
    }
    if (!args.prompt) {
      args.prompt = 'Summarize or extract key content';
    }
  }

  return args;
}

import { execSync } from 'child_process';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import type { Capability, ToolDefinition, ToolResult } from '../types';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const MAX_OUTPUT_CHARS = 8000;
const EXEC_TIMEOUT_MS = 15_000;

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

const PROMPT = `# Web Browsing

You can browse the web to research topics, read articles, look up documentation, and extract information from web pages.

## Tools

- **web_open(url)** — Navigate to a URL. Always start here.
- **web_snapshot(interactive?)** — Get the page's accessibility tree. Use \`interactive: true\` to see only clickable/fillable elements with @ref tags (e.g. @e1, @e2).
- **web_get_text(selector?)** — Extract text content from the page or a specific CSS selector.
- **web_click(ref)** — Click an element by its @ref from a snapshot (e.g. "e3").
- **web_fill(ref, text)** — Fill a form field by its @ref.
- **web_screenshot(full?)** — Capture the page visually. Returns a file path.

## Workflow

1. \`web_open\` to navigate to a page
2. \`web_snapshot\` or \`web_get_text\` to read content
3. If you need to interact (click links, fill search boxes), use \`web_snapshot(interactive: true)\` to get @refs, then \`web_click\`/\`web_fill\`
4. After any navigation or click, re-snapshot to see the updated page

## Tips

- For simple content extraction, \`web_get_text\` is faster than snapshot
- Use \`web_snapshot(interactive: true)\` when you need to find and click links or buttons
- After clicking a link that navigates, the page changes — always re-snapshot
- If a page is very long, use \`web_get_text\` with a CSS selector to target specific sections`;

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'web_open',
    description: 'Navigate to a URL in the browser. Always call this first before other web tools.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'The URL to navigate to' },
      },
      required: ['url'],
    },
  },
  {
    name: 'web_snapshot',
    description: 'Get the accessibility tree of the current page. Use interactive: true to see only clickable/fillable elements with @ref tags for interaction.',
    parameters: {
      type: 'object',
      properties: {
        interactive: {
          type: 'boolean',
          description: 'If true, only show interactive elements with @ref tags for clicking/filling',
        },
      },
    },
  },
  {
    name: 'web_get_text',
    description: 'Extract text content from the current page, or from a specific element using a CSS selector.',
    parameters: {
      type: 'object',
      properties: {
        selector: {
          type: 'string',
          description: 'Optional CSS selector to scope text extraction (e.g. "main", "article", "#content")',
        },
      },
    },
  },
  {
    name: 'web_click',
    description: 'Click an element by its @ref from a snapshot (e.g. "e3"). Use web_snapshot with interactive: true first to get refs.',
    parameters: {
      type: 'object',
      properties: {
        ref: { type: 'string', description: 'Element ref from snapshot (e.g. "e3" or "@e3")' },
      },
      required: ['ref'],
    },
  },
  {
    name: 'web_fill',
    description: 'Fill a form field by its @ref from a snapshot. Use web_snapshot with interactive: true first to get refs.',
    parameters: {
      type: 'object',
      properties: {
        ref: { type: 'string', description: 'Element ref from snapshot (e.g. "e3" or "@e3")' },
        text: { type: 'string', description: 'Text to fill in the field' },
      },
      required: ['ref', 'text'],
    },
  },
  {
    name: 'web_screenshot',
    description: 'Take a screenshot of the current page. Returns the file path to the saved image.',
    parameters: {
      type: 'object',
      properties: {
        full: {
          type: 'boolean',
          description: 'If true, capture the full scrollable page instead of just the viewport',
        },
      },
    },
  },
];

// ---------------------------------------------------------------------------
// Helper: run agent-browser command
// ---------------------------------------------------------------------------

function sessionName(conversationId?: string): string {
  return `aurelius-${conversationId || 'default'}`;
}

function runBrowser(args: string[], conversationId?: string): string {
  const session = sessionName(conversationId);
  const cmd = ['npx', 'agent-browser', '--session', session, ...args]
    .map(a => {
      // Quote args that contain spaces or special chars
      if (/["\s$`\\]/.test(a)) return `"${a.replace(/["\\$`]/g, '\\$&')}"`;
      return a;
    })
    .join(' ');

  try {
    const output = execSync(cmd, {
      timeout: EXEC_TIMEOUT_MS,
      encoding: 'utf-8',
      maxBuffer: 1024 * 1024,
    });

    if (output.length > MAX_OUTPUT_CHARS) {
      return output.slice(0, MAX_OUTPUT_CHARS) + `\n\n[Truncated — ${output.length} total chars]`;
    }
    return output;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // execSync errors include stderr in the message
    return `Error: ${msg.slice(0, 2000)}`;
  }
}

// ---------------------------------------------------------------------------
// Tool handler
// ---------------------------------------------------------------------------

async function handleBrowserTool(
  toolName: string,
  toolInput: Record<string, unknown>,
  conversationId?: string,
): Promise<ToolResult | null> {
  switch (toolName) {
    case 'web_open': {
      const url = String(toolInput.url || '');
      if (!url) return { result: 'Error: url is required' };
      const output = runBrowser(['open', url], conversationId);
      return { result: output || `Navigated to ${url}` };
    }

    case 'web_snapshot': {
      const args = ['snapshot'];
      if (toolInput.interactive) args.push('-ic');
      const output = runBrowser(args, conversationId);
      return { result: output || 'Empty snapshot — page may not be loaded. Call web_open first.' };
    }

    case 'web_get_text': {
      const selector = String(toolInput.selector || 'body');
      const output = runBrowser(['get', 'text', selector], conversationId);
      return { result: output || 'No text content found.' };
    }

    case 'web_click': {
      const ref = String(toolInput.ref || '');
      if (!ref) return { result: 'Error: ref is required' };
      const refStr = ref.startsWith('@') ? ref : `@${ref}`;
      const output = runBrowser(['click', refStr], conversationId);
      return { result: output || `Clicked ${refStr}` };
    }

    case 'web_fill': {
      const ref = String(toolInput.ref || '');
      const text = String(toolInput.text || '');
      if (!ref || !text) return { result: 'Error: ref and text are required' };
      const refStr = ref.startsWith('@') ? ref : `@${ref}`;
      const output = runBrowser(['fill', refStr, text], conversationId);
      return { result: output || `Filled ${refStr} with "${text}"` };
    }

    case 'web_screenshot': {
      const tmpDir = mkdtempSync(path.join(tmpdir(), 'aurelius-screenshot-'));
      const screenshotPath = path.join(tmpDir, 'screenshot.png');
      const args = ['screenshot', screenshotPath];
      if (toolInput.full) args.push('--full');
      const output = runBrowser(args, conversationId);
      if (output.startsWith('Error:')) return { result: output };
      return { result: `Screenshot saved to ${screenshotPath}` };
    }

    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Export capability
// ---------------------------------------------------------------------------

export const browserCapability: Capability = {
  name: 'browser',
  tools: TOOL_DEFINITIONS,
  prompt: PROMPT,
  promptVersion: 1,
  handleTool: handleBrowserTool,
};

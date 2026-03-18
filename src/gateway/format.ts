/**
 * Convert standard markdown to platform-friendly format.
 *
 * - telegram: Markdown → Telegram HTML
 * - slack: Markdown → Slack mrkdwn
 * - discord / feishu / dingtalk / wecom / qq: pass-through (native markdown support)
 */
export function adaptMarkdown(text: string, platform: string): string {
  switch (platform) {
    case 'telegram':
      return toTelegramHtml(text);
    case 'slack':
      return toSlackMrkdwn(text);
    default:
      return text;
  }
}

// ---------------------------------------------------------------------------
// Telegram HTML conversion
// ---------------------------------------------------------------------------

function toTelegramHtml(text: string): string {
  const lines = text.split('\n');
  const result: string[] = [];
  let inCodeBlock = false;
  let codeBlockLang = '';
  let codeLines: string[] = [];

  for (const line of lines) {
    if (!inCodeBlock && line.trimStart().startsWith('```')) {
      inCodeBlock = true;
      codeBlockLang = line.trimStart().slice(3).trim();
      codeLines = [];
      continue;
    }

    if (inCodeBlock && line.trimStart().startsWith('```')) {
      inCodeBlock = false;
      const code = escapeHtml(codeLines.join('\n'));
      if (codeBlockLang) {
        result.push(`<pre><code class="language-${escapeHtml(codeBlockLang)}">${code}</code></pre>`);
      } else {
        result.push(`<pre>${code}</pre>`);
      }
      continue;
    }

    if (inCodeBlock) {
      codeLines.push(line);
      continue;
    }

    result.push(convertInlineMarkdownToHtml(line));
  }

  // Handle unclosed code block
  if (inCodeBlock) {
    const code = escapeHtml(codeLines.join('\n'));
    result.push(`<pre>${code}</pre>`);
  }

  return result.join('\n');
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function convertInlineMarkdownToHtml(line: string): string {
  let result = line;

  // Escape HTML entities first (but preserve what we'll convert)
  result = result.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // Inline code (must come before bold/italic to avoid conflicts)
  result = result.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Bold + italic (***text***)
  result = result.replace(/\*\*\*(.+?)\*\*\*/g, '<b><i>$1</i></b>');

  // Bold (**text**)
  result = result.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');

  // Italic (*text*)
  result = result.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<i>$1</i>');

  // Strikethrough (~~text~~)
  result = result.replace(/~~(.+?)~~/g, '<s>$1</s>');

  // Links [text](url)
  result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

  return result;
}

// ---------------------------------------------------------------------------
// Slack mrkdwn conversion
// ---------------------------------------------------------------------------

function toSlackMrkdwn(text: string): string {
  const lines = text.split('\n');
  const result: string[] = [];
  let inCodeBlock = false;

  for (const line of lines) {
    if (!inCodeBlock && line.trimStart().startsWith('```')) {
      inCodeBlock = true;
      result.push(line);
      continue;
    }

    if (inCodeBlock && line.trimStart().startsWith('```')) {
      inCodeBlock = false;
      result.push(line);
      continue;
    }

    if (inCodeBlock) {
      result.push(line);
      continue;
    }

    result.push(convertInlineMarkdownToSlack(line));
  }

  return result.join('\n');
}

function convertInlineMarkdownToSlack(line: string): string {
  let result = line;

  // Use zero-width placeholders to avoid re-matching converted bold markers
  const BOLD_OPEN = '\x01B';
  const BOLD_CLOSE = 'B\x01';

  // Bold + italic (***text***) → *_text_*
  result = result.replace(/\*\*\*(.+?)\*\*\*/g, `${BOLD_OPEN}_$1_${BOLD_CLOSE}`);

  // Bold (**text**) → *text*
  result = result.replace(/\*\*(.+?)\*\*/g, `${BOLD_OPEN}$1${BOLD_CLOSE}`);

  // Italic (*text*) → _text_
  result = result.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '_$1_');

  // Restore bold markers
  result = result.replace(/\x01B/g, '*').replace(/B\x01/g, '*');

  // Strikethrough (~~text~~) → ~text~
  result = result.replace(/~~(.+?)~~/g, '~$1~');

  // Links [text](url) → <url|text>
  result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<$2|$1>');

  return result;
}

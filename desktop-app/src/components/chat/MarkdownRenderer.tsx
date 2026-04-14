/**
 * GFM markdown renderer with syntax highlighting and code copy buttons.
 * Parses markdown and renders code blocks with the CodeBlock component.
 * Uses React elements instead of innerHTML for safety.
 */

import { useMemo, Fragment, type ReactNode } from "react";
import { CodeBlock } from "./CodeBlock";

interface MarkdownRendererProps {
  readonly content: string;
}

interface ParsedBlock {
  readonly type: "text" | "code";
  readonly content: string;
  readonly language?: string;
}

function parseBlocks(raw: string): readonly ParsedBlock[] {
  const blocks: ParsedBlock[] = [];
  const lines = raw.split("\n");
  let currentText = "";
  let inCodeBlock = false;
  let codeContent = "";
  let codeLang = "";

  for (const line of lines) {
    if (!inCodeBlock && line.startsWith("```")) {
      if (currentText.trim()) {
        blocks.push({ type: "text", content: currentText.trim() });
        currentText = "";
      }
      inCodeBlock = true;
      codeLang = line.slice(3).trim();
      codeContent = "";
    } else if (inCodeBlock && line.startsWith("```")) {
      blocks.push({ type: "code", content: codeContent, language: codeLang });
      inCodeBlock = false;
      codeContent = "";
      codeLang = "";
    } else if (inCodeBlock) {
      codeContent += (codeContent ? "\n" : "") + line;
    } else {
      currentText += (currentText ? "\n" : "") + line;
    }
  }

  if (inCodeBlock && codeContent) {
    blocks.push({ type: "code", content: codeContent, language: codeLang });
  }
  if (currentText.trim()) {
    blocks.push({ type: "text", content: currentText.trim() });
  }

  return blocks;
}

/** Parse inline markdown (bold, italic, code, links) into React nodes */
function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let remaining = text;
  let keyIndex = 0;

  while (remaining.length > 0) {
    // Bold: **text**
    const boldMatch = remaining.match(/^(.*?)\*\*(.+?)\*\*(.*)/s);
    if (boldMatch) {
      if (boldMatch[1]) nodes.push(<Fragment key={keyIndex++}>{boldMatch[1]}</Fragment>);
      nodes.push(
        <strong key={keyIndex++} className="font-semibold" style={{ color: "var(--color-text-primary)" }}>
          {boldMatch[2]}
        </strong>,
      );
      remaining = boldMatch[3] ?? "";
      continue;
    }

    // Italic: *text*
    const italicMatch = remaining.match(/^(.*?)\*(.+?)\*(.*)/s);
    if (italicMatch) {
      if (italicMatch[1]) nodes.push(<Fragment key={keyIndex++}>{italicMatch[1]}</Fragment>);
      nodes.push(
        <em key={keyIndex++} className="italic">
          {italicMatch[2]}
        </em>,
      );
      remaining = italicMatch[3] ?? "";
      continue;
    }

    // Inline code: `code`
    const codeMatch = remaining.match(/^(.*?)`(.+?)`(.*)/s);
    if (codeMatch) {
      if (codeMatch[1]) nodes.push(<Fragment key={keyIndex++}>{codeMatch[1]}</Fragment>);
      nodes.push(
        <code
          key={keyIndex++}
          className="px-1.5 py-0.5 rounded font-mono text-[13px]"
          style={{ color: "var(--color-primary)", background: "var(--surface-3)" }}
        >
          {codeMatch[2]}
        </code>,
      );
      remaining = codeMatch[3] ?? "";
      continue;
    }

    // Links: [text](url)
    const linkMatch = remaining.match(/^(.*?)\[([^\]]+)\]\(([^)]+)\)(.*)/s);
    if (linkMatch) {
      if (linkMatch[1]) nodes.push(<Fragment key={keyIndex++}>{linkMatch[1]}</Fragment>);
      nodes.push(
        <a
          key={keyIndex++}
          href={linkMatch[3]}
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-2 transition-colors"
          style={{ color: "var(--color-primary)" }}
        >
          {linkMatch[2]}
        </a>,
      );
      remaining = linkMatch[4] ?? "";
      continue;
    }

    // No more matches — emit the rest
    nodes.push(<Fragment key={keyIndex++}>{remaining}</Fragment>);
    break;
  }

  return nodes;
}

function TextBlock({ content }: { readonly content: string }) {
  const lines = content.split("\n");
  const elements: ReactNode[] = [];
  let listItems: string[] = [];
  let orderedItems: string[] = [];
  let elKey = 0;

  const flushList = () => {
    if (listItems.length > 0) {
      elements.push(
        <ul key={elKey++} className="list-disc list-inside space-y-1 my-2 ml-1">
          {listItems.map((item, i) => (
            <li key={i} className="text-sm leading-relaxed" style={{ color: "var(--color-text-secondary)" }}>
              {renderInline(item)}
            </li>
          ))}
        </ul>,
      );
      listItems = [];
    }
    if (orderedItems.length > 0) {
      elements.push(
        <ol key={elKey++} className="list-decimal list-inside space-y-1 my-2 ml-1">
          {orderedItems.map((item, i) => (
            <li key={i} className="text-sm leading-relaxed" style={{ color: "var(--color-text-secondary)" }}>
              {renderInline(item)}
            </li>
          ))}
        </ol>,
      );
      orderedItems = [];
    }
  };

  for (const line of lines) {
    // Headings
    const headingMatch = line.match(/^(#{1,4})\s+(.+)/);
    if (headingMatch) {
      flushList();
      const level = headingMatch[1]!.length;
      const text = headingMatch[2]!;
      const sizes: Record<number, string> = {
        1: "text-lg font-bold mt-4 mb-2",
        2: "text-base font-semibold mt-3 mb-2",
        3: "text-sm font-semibold mt-2 mb-1",
        4: "text-sm font-medium mt-2 mb-1",
      };
      elements.push(
        <div key={elKey++} className={sizes[level] ?? sizes[3]!} style={{ color: level <= 2 ? "var(--color-text-primary)" : "var(--color-text-primary)" }}>
          {renderInline(text)}
        </div>,
      );
      continue;
    }

    // Unordered list
    const ulMatch = line.match(/^[-*]\s+(.+)/);
    if (ulMatch) {
      if (orderedItems.length > 0) flushList();
      listItems.push(ulMatch[1]!);
      continue;
    }

    // Ordered list
    const olMatch = line.match(/^\d+\.\s+(.+)/);
    if (olMatch) {
      if (listItems.length > 0) flushList();
      orderedItems.push(olMatch[1]!);
      continue;
    }

    // Empty line
    if (!line.trim()) {
      flushList();
      continue;
    }

    // Paragraph
    flushList();
    elements.push(
      <p key={elKey++} className="text-sm leading-relaxed my-1" style={{ color: "var(--color-text-secondary)" }}>
        {renderInline(line)}
      </p>,
    );
  }

  flushList();
  return <>{elements}</>;
}

export function MarkdownRenderer({ content }: MarkdownRendererProps) {
  const blocks = useMemo(() => parseBlocks(content), [content]);

  return (
    <div className="space-y-0">
      {blocks.map((block, i) =>
        block.type === "code" ? (
          <CodeBlock key={i} code={block.content} language={block.language ?? ""} />
        ) : (
          <TextBlock key={i} content={block.content} />
        ),
      )}
    </div>
  );
}

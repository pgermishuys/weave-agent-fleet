"use client";

import { useState, useCallback, memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { Copy, Check } from "lucide-react";
import type { Components } from "react-markdown";
import type { ClassAttributes, HTMLAttributes } from "react";
import type { ExtraProps } from "react-markdown";
import { extractLanguage, extractText } from "@/lib/markdown-utils";
import { SlashCommandCode } from "./slash-command-code";

// ─── highlight.js dark theme ──────────────────────────────────────────────────
// Imported here so Next.js bundles it alongside the component.
import "highlight.js/styles/github-dark.css";

// ─── Module-level constants (referentially stable across renders) ─────────────

const REMARK_PLUGINS = [remarkGfm];
const REHYPE_PLUGINS = [rehypeHighlight];

// ─── CodeBlock sub-component ──────────────────────────────────────────────────

type PreProps = ClassAttributes<HTMLPreElement> &
  HTMLAttributes<HTMLPreElement> &
  ExtraProps;

function CodeBlock({ children, ...rest }: PreProps) {
  const [copied, setCopied] = useState(false);

  // Extract language from the child <code> element's className
  // rehype-highlight adds classes like "hljs language-typescript"
  let language = "";
  let codeText = "";

  const codeChild =
    children &&
    typeof children === "object" &&
    "props" in (children as React.ReactElement)
      ? (children as React.ReactElement<{ className?: string; children?: React.ReactNode }>)
      : null;

  if (codeChild) {
    const className: string = codeChild.props?.className ?? "";
    language = extractLanguage(className);

    // Extract raw text for clipboard — traverse children recursively
    codeText = extractText(codeChild.props?.children);
  }

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(codeText).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [codeText]);

  return (
    <div className="rounded-md border border-border/40 overflow-hidden my-2">
      {/* Header bar */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-muted/30 border-b border-border/40">
        <span className="text-[10px] text-muted-foreground font-mono uppercase tracking-wide">
          {language || "text"}
        </span>
        <button
          onClick={handleCopy}
          className="opacity-50 hover:opacity-100 transition-opacity flex items-center gap-1 text-[10px] text-muted-foreground"
          aria-label="Copy code"
          type="button"
        >
          {copied ? (
            <>
              <Check className="h-3 w-3 text-green-600 dark:text-green-400" />
              <span className="text-green-600 dark:text-green-400">Copied!</span>
            </>
          ) : (
            <Copy className="h-3 w-3" />
          )}
        </button>
      </div>
      {/* Code area */}
      <pre
        {...rest}
        className="overflow-x-auto bg-muted/20 p-3 rounded-b-md text-xs font-mono m-0"
      >
        {children}
      </pre>
    </div>
  );
}

// ─── Markdown component overrides ─────────────────────────────────────────────
// Defined at module level for referential stability (prevents react-markdown
// from rebuilding its pipeline on every render).

const MARKDOWN_COMPONENTS: Components = {
  // Headings
  h1: ({ children }) => (
    <h1 className="text-xl font-semibold text-foreground mt-3 mb-1 leading-snug">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="text-lg font-semibold text-foreground mt-3 mb-1 leading-snug">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="text-base font-semibold text-foreground mt-2 mb-1 leading-snug">{children}</h3>
  ),
  h4: ({ children }) => (
    <h4 className="text-sm font-semibold text-foreground mt-2 mb-0.5">{children}</h4>
  ),
  h5: ({ children }) => (
    <h5 className="text-sm font-medium text-foreground mt-2 mb-0.5">{children}</h5>
  ),
  h6: ({ children }) => (
    <h6 className="text-xs font-medium text-foreground/80 mt-2 mb-0.5">{children}</h6>
  ),

  // Paragraph
  p: ({ children }) => (
    <p className="text-sm text-foreground/90 leading-relaxed">{children}</p>
  ),

  // Links
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-primary hover:underline"
    >
      {children}
    </a>
  ),

  // Emphasis
  strong: ({ children }) => (
    <strong className="font-semibold text-foreground">{children}</strong>
  ),
  em: ({ children }) => <em className="italic">{children}</em>,

  // Lists
  ul: ({ children }) => (
    <ul className="list-disc ml-4 space-y-0.5 text-sm text-foreground/90">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="list-decimal ml-4 space-y-0.5 text-sm text-foreground/90">{children}</ol>
  ),
  li: ({ children }) => <li className="text-sm text-foreground/90">{children}</li>,

  // Blockquote
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-primary/50 pl-3 italic text-muted-foreground my-1">
      {children}
    </blockquote>
  ),

  // Tables
  table: ({ children }) => (
    <div className="overflow-x-auto my-2">
      <table className="w-full text-xs border-collapse">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border border-border/60 px-2 py-1 text-left font-semibold bg-muted/50">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border border-border/60 px-2 py-1">{children}</td>
  ),

  // Horizontal rule
  hr: () => <hr className="border-border/40 my-3" />,

  // Inline code
  code: ({ className, children, ...props }) => {
    // Block code is handled by the `pre` override (CodeBlock).
    // Inline code has no parent <pre> — detect by absence of language class.
    const isBlock = className?.includes("language-");
    if (isBlock) {
      // Pass through to the pre → CodeBlock handler
      return (
        <code className={className} {...props}>
          {children}
        </code>
      );
    }
    return <SlashCommandCode className={className} {...props}>{children}</SlashCommandCode>;
  },

  // Fenced code blocks
  pre: (props) => <CodeBlock {...props} />,

  // Strip images to avoid loading unexpected external resources
  img: () => null,
};

// ─── MarkdownRenderer ─────────────────────────────────────────────────────────

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

function MarkdownRendererInner({ content, className }: MarkdownRendererProps) {
  return (
    <div className={`prose-weave space-y-2 text-sm${className ? ` ${className}` : ""}`}>
      <ReactMarkdown
        remarkPlugins={REMARK_PLUGINS}
        rehypePlugins={REHYPE_PLUGINS}
        components={MARKDOWN_COMPONENTS}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

export const MarkdownRenderer = memo(MarkdownRendererInner);

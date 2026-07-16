import { openUrl } from "@tauri-apps/plugin-opener";
import type { ReactNode } from "react";
import { jumbojiCount } from "./jumboji";
import { type Inline, parseMessage } from "./parseMessage";

/**
 * Render a chat message string with inline formatting: leading autohost command,
 * inline code, bold, italic, and auto-linked URLs. Output is React nodes only -
 * no HTML injection. The command chip inherits its text colour (rather than
 * forcing an accent) so it stays legible on both the muted and primary bubbles.
 */
export function FormattedText({ text }: { text: string }) {
  // Jumboji: a message that is only a handful of emoji renders enlarged, the
  // way Slack/Discord do. Above the small cap it falls back to normal rendering.
  const jumbo = jumbojiCount(text);
  if (jumbo >= 1 && jumbo <= 3) {
    return <span className="text-5xl leading-none">{text.trim()}</span>;
  }
  return <>{render(parseMessage(text))}</>;
}

/** A list item. Split out so the key is built where the rest of them are, rather
 * than from an index at the JSX. */
function renderItem(item: Inline[], key: string): ReactNode {
  return <li key={key}>{render(item)}</li>;
}

function render(nodes: Inline[]): ReactNode[] {
  // Tokens are derived fresh from the text and never reorder, so a per-node
  // type+position key is stable for React's reconciliation.
  return nodes.map((n, i) => renderNode(n, `${i}-${n.type}`));
}

function renderNode(n: Inline, key: string): ReactNode {
  switch (n.type) {
    case "text":
      return <span key={key}>{n.value}</span>;
    case "code":
      return (
        <code key={key} className="rounded bg-foreground/10 px-1 font-mono">
          {n.value}
        </code>
      );
    case "codeblock":
      // `pre` for the block's own whitespace and horizontal scrolling: the
      // bubble wraps prose at any character, which would mangle indented code.
      // The `language-` class is the usual convention and is what a highlighter
      // would key off later.
      return (
        <pre
          key={key}
          className="my-1 overflow-x-auto rounded bg-foreground/10 p-2 font-mono text-xs"
        >
          <code className={n.lang ? `language-${n.lang}` : undefined}>
            {n.value}
          </code>
        </pre>
      );
    case "command":
      return (
        <span key={key} className="rounded bg-primary/20 px-1 font-medium">
          {n.value}
        </span>
      );
    case "url":
      return (
        <a
          key={key}
          href={n.value}
          className="underline"
          onClick={(e) => {
            e.preventDefault();
            openUrl(n.value).catch(() => {});
          }}
        >
          {n.value}
        </a>
      );
    case "bold":
      return (
        <strong key={key} className="font-semibold">
          {render(n.children)}
        </strong>
      );
    case "italic":
      return (
        <em key={key} className="italic">
          {render(n.children)}
        </em>
      );
    case "strike":
      return (
        <s key={key} className="line-through">
          {render(n.children)}
        </s>
      );
    case "list":
      // `list-inside` so a wrapped item's second line doesn't hang under its
      // own marker, which the bubble's narrow column makes common.
      return (
        <ul key={key} className="my-0.5 list-inside list-disc">
          {n.items.map((item, i) => renderItem(item, `${key}-${i}`))}
        </ul>
      );
    case "quote":
      // Inherit the bubble's text colour (own bubbles use a dark foreground);
      // opacity dims the whole quote so it reads as secondary on either bubble.
      return (
        <blockquote
          key={key}
          className="my-0.5 border-l-2 border-current pl-2 opacity-70"
        >
          {render(n.children)}
        </blockquote>
      );
    case "mention":
      // Mirror the command chip: subtle tint + weight, no forced text colour,
      // so it stays legible on both the primary and muted bubbles.
      return (
        <span key={key} className="rounded bg-primary/20 px-0.5 font-semibold">
          @{n.value}
        </span>
      );
  }
}

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
    return <span className="text-3xl leading-tight">{text.trim()}</span>;
  }
  return <>{render(parseMessage(text))}</>;
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
    case "quote":
      return (
        <blockquote
          key={key}
          className="my-0.5 border-l-2 border-foreground/30 pl-2 text-foreground/80"
        >
          {render(n.children)}
        </blockquote>
      );
    case "mention":
      return (
        <span
          key={key}
          className="rounded bg-primary/15 px-0.5 font-medium text-primary"
        >
          @{n.value}
        </span>
      );
  }
}

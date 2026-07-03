import { openUrl } from "@tauri-apps/plugin-opener";
import type { ReactNode } from "react";
import { type Inline, parseMessage } from "./parseMessage";

/**
 * Render a chat message string with inline formatting: leading autohost command,
 * inline code, bold, italic, and auto-linked URLs. Output is React nodes only -
 * no HTML injection. The command chip inherits its text colour (rather than
 * forcing an accent) so it stays legible on both the muted and primary bubbles.
 */
export function FormattedText({ text }: { text: string }) {
  return <>{render(parseMessage(text))}</>;
}

function render(nodes: Inline[]): ReactNode[] {
  return nodes.map((n, i) => {
    switch (n.type) {
      case "text":
        return <span key={i}>{n.value}</span>;
      case "code":
        return (
          <code key={i} className="rounded bg-foreground/10 px-1">
            {n.value}
          </code>
        );
      case "command":
        return (
          <span key={i} className="rounded bg-primary/20 px-1 font-medium">
            {n.value}
          </span>
        );
      case "url":
        return (
          <a
            key={i}
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
          <strong key={i} className="font-semibold">
            {render(n.children)}
          </strong>
        );
      case "italic":
        return (
          <em key={i} className="italic">
            {render(n.children)}
          </em>
        );
    }
  });
}

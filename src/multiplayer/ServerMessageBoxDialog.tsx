import { Button } from "@picoframe/frame";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { ReactNode } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * App-level modal for a `SERVERMSGBOX` — a server message the server explicitly
 * flagged as "make sure they see this". Unlike the plain `SERVERMSG` toast this is
 * blocking: it stays until the user acknowledges it. Rendered inside
 * `MultiplayerProvider` so it appears on any route.
 *
 * `text` is the front of the box queue (null when empty); `onDismiss` pops it. A
 * huge or malformed message can't break the lobby — the body scrolls and wraps,
 * and any `http(s)` URL in the text is turned into a clickable link opened in the
 * system browser.
 */
export function ServerMessageBoxDialog({
  text,
  onDismiss,
}: {
  text: string | null;
  onDismiss: () => void;
}) {
  return (
    <Dialog
      open={text != null}
      onOpenChange={(open) => {
        if (!open) onDismiss();
      }}
    >
      <DialogContent className="sm:max-w-lg" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>Server message</DialogTitle>
        </DialogHeader>
        <div className="max-h-72 overflow-y-auto whitespace-pre-wrap break-words rounded-md border border-border bg-muted/40 p-3 text-sm">
          {text != null ? linkify(text) : null}
        </div>
        <DialogFooter>
          <Button onClick={onDismiss}>OK</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Matches bare http(s) URLs so they can be rendered as openable links. Only these
// two schemes are linkified (they're what the Tauri opener allows for web links);
// everything else stays plain text.
const URL_RE = /(https?:\/\/[^\s]+)/g;

/**
 * Split `text` into plain runs and clickable links for any http(s) URL it contains.
 * Keyed by each segment's offset in the string (unique and stable) rather than the
 * array index.
 */
function linkify(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    const url = m[0];
    const start = m.index;
    if (start > last) {
      nodes.push(<span key={`t${last}`}>{text.slice(last, start)}</span>);
    }
    nodes.push(
      <button
        key={`u${start}`}
        type="button"
        className="text-primary underline underline-offset-2 hover:opacity-80"
        onClick={() => openUrl(url).catch(() => {})}
      >
        {url}
      </button>,
    );
    last = start + url.length;
  }
  if (last < text.length) {
    nodes.push(<span key={`t${last}`}>{text.slice(last)}</span>);
  }
  return nodes;
}

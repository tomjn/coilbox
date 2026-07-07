import { Button } from "@picoframe/frame";
import { ExternalLink, Play, RotateCcw } from "lucide-react";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { Link } from "react-router";
import {
  evalChunk,
  loadHistory,
  type ReplCell,
  resetSession,
  sessionKey,
  useReplSession,
} from "./luaReplSession";

/**
 * The archive Lua REPL: a dark terminal-style transcript over unitsync's parser.
 * State (chunks + cells) lives in the module-level session store keyed by
 * target+archive, so it survives the drawer closing and the "pop out" to a full
 * page. `fill` makes it grow to the parent's height (full page); otherwise it
 * caps the transcript height (drawer). `popOutTo` renders a link to the full
 * page; `onPopOut` lets the drawer close itself on that click.
 */
export function LuaRepl({
  enginePath,
  dataDir,
  archive,
  fill = false,
  popOutTo,
  onPopOut,
}: {
  enginePath: string;
  dataDir: string;
  archive: string;
  fill?: boolean;
  popOutTo?: string;
  onPopOut?: () => void;
}) {
  const key = sessionKey(dataDir, enginePath, archive);
  const session = useReplSession(key);
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<string[]>(() => loadHistory(archive));
  // Position within `history`; === history.length means "typing a fresh input".
  const [histPos, setHistPos] = useState(history.length);

  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll the transcript to the newest cell. The deps intentionally
  // trigger on new content though the body doesn't read them.
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll on cells/running change
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [session.cells, session.running]);

  const submit = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || session.running) return;
    setInput("");
    await evalChunk({ enginePath, dataDir, archive }, input);
    const next = loadHistory(archive);
    setHistory(next);
    setHistPos(next.length);
  }, [input, session.running, enginePath, dataDir, archive]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      const el = e.currentTarget;
      // Enter runs; Shift+Enter inserts a newline (terminal feel).
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        void submit();
        return;
      }
      // History recall only when the caret sits on the first / last line, so
      // arrows still move within a multi-line draft.
      if (e.key === "ArrowUp" && history.length > 0) {
        const onFirstLine = !el.value
          .slice(0, el.selectionStart)
          .includes("\n");
        if (onFirstLine && histPos > 0) {
          e.preventDefault();
          const pos = histPos - 1;
          setHistPos(pos);
          setInput(history[pos]);
        }
        return;
      }
      if (e.key === "ArrowDown" && history.length > 0) {
        const onLastLine = !el.value.slice(el.selectionEnd).includes("\n");
        if (onLastLine && histPos < history.length) {
          e.preventDefault();
          const pos = histPos + 1;
          setHistPos(pos);
          setInput(pos < history.length ? history[pos] : "");
        }
      }
    },
    [history, histPos, submit],
  );

  const reset = useCallback(() => resetSession(key), [key]);

  return (
    <div
      className={`flex ${fill ? "h-full min-h-0" : ""} flex-col overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950 text-zinc-200`}
    >
      <div
        ref={scrollRef}
        className={`${fill ? "flex-1" : "max-h-[24rem]"} min-h-0 overflow-auto p-3 font-mono text-xs`}
      >
        {session.cells.length === 0 ? (
          <p className="text-zinc-500">
            Globals persist across runs via replay — each Run re-executes the
            whole session against{" "}
            <span className="text-zinc-300">{archive}</span>. End with{" "}
            <span className="text-zinc-300">return …</span> to see a value.
            Enter runs; Shift+Enter for a newline.
          </p>
        ) : (
          <ol className="flex flex-col gap-3">
            {session.cells.map((cell, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: transcript is append-only and never reordered
              <ReplCellView key={i} cell={cell} />
            ))}
          </ol>
        )}
      </div>

      <div className="flex flex-col gap-2 border-t border-zinc-800 bg-zinc-900/60 p-2">
        <textarea
          value={input}
          spellCheck={false}
          aria-label="Lua input"
          placeholder="lua…"
          rows={3}
          disabled={session.running}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          className="w-full resize-y rounded-md border border-zinc-800 bg-zinc-950 px-2.5 py-2 font-mono text-xs text-zinc-100 outline-none placeholder:text-zinc-600 focus-visible:border-emerald-600/60 focus-visible:ring-[3px] focus-visible:ring-emerald-600/20 disabled:opacity-50"
        />
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            className="gap-1.5"
            disabled={session.running || input.trim() === ""}
            onClick={() => void submit()}
          >
            <Play className="size-4" /> {session.running ? "Running…" : "Run"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            disabled={session.running || session.cells.length === 0}
            onClick={reset}
          >
            <RotateCcw className="size-4" /> Reset session
          </Button>
          {popOutTo && (
            <Link
              to={popOutTo}
              onClick={onPopOut}
              className="ml-auto inline-flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-200 hover:underline"
            >
              <ExternalLink className="size-3.5" /> Open full page
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

/** One transcript cell: echoed input, then prints, then result or error. */
function ReplCellView({ cell }: { cell: ReplCell }) {
  return (
    <li className="flex flex-col gap-1">
      <div className="flex gap-2">
        <span className="select-none text-emerald-400">❯</span>
        <span className="whitespace-pre-wrap break-words text-zinc-300">
          {cell.input}
        </span>
      </div>
      {cell.prints != null && cell.prints !== "" && (
        <pre className="whitespace-pre-wrap break-words text-zinc-400">
          {cell.prints}
        </pre>
      )}
      {cell.error != null ? (
        // The worker already prefixes replay divergences ("session replay
        // diverged at chunk N: …"), so the message is self-describing.
        <pre className="whitespace-pre-wrap break-words text-red-400">
          {cell.error}
        </pre>
      ) : (
        cell.result != null && (
          <pre className="whitespace-pre-wrap break-words text-zinc-100">
            {cell.result}
          </pre>
        )
      )}
      {cell.diagnostics.length > 0 && (
        <details className="text-zinc-500">
          <summary className="cursor-pointer">
            Diagnostics ({cell.diagnostics.length})
          </summary>
          <ul className="mt-1 flex flex-col gap-1">
            {cell.diagnostics.map((d, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: diagnostics are append-only and never reordered
              <li key={i}>{d}</li>
            ))}
          </ul>
        </details>
      )}
    </li>
  );
}

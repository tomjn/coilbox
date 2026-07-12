import { Input } from "@picoframe/frame";
import { Hash, MessageSquare, Search, User } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  type ChatLogAccount,
  type ChatLogThread,
  type ChatMsg,
  mpChatLogOpen,
  mpChatLogs,
} from "../bindings";
import { FormattedText } from "../chat/FormattedText";

/** A thread selection: which account + thread is open. */
interface Selection {
  account: string;
  thread: ChatLogThread;
}

function fmtTime(ms: number): string {
  if (!ms) return "";
  return new Date(ms).toLocaleString();
}

/**
 * Browse the chat logs coilbox writes to disk (DM history + channel history),
 * without an active connection. The left column lists saved conversations per
 * account; selecting one loads its transcript on the right, where a search box
 * filters the lines. Log lines render through the same `FormattedText` as live
 * chat so they read identically.
 */
export default function ChatLogPage() {
  const [accounts, setAccounts] = useState<ChatLogAccount[]>([]);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    mpChatLogs({})
      .then((r) => setAccounts(r.accounts))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  // Load the selected thread's transcript.
  useEffect(() => {
    if (!selection) {
      setMessages([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    mpChatLogOpen({
      account: selection.account,
      kind: selection.thread.kind,
      name: selection.thread.name,
    })
      .then((r) => {
        if (!cancelled) setMessages(r.messages);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selection]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return messages;
    return messages.filter(
      (m) =>
        m.text.toLowerCase().includes(q) || m.from.toLowerCase().includes(q),
    );
  }, [messages, query]);

  const hasLogs = accounts.some((a) => a.threads.length > 0);

  return (
    <main className="flex h-full min-h-0 flex-col">
      <div className="border-b border-border px-4 py-3">
        <h1 className="text-base font-semibold">Chat logs</h1>
        <p className="text-xs text-muted-foreground">
          Past direct messages and channel conversations saved on this device.
        </p>
      </div>

      {error && (
        <p className="border-b border-destructive/40 bg-destructive/10 px-4 py-2 text-xs text-destructive">
          {error}
        </p>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-[18rem_1fr]">
        {/* Conversations list */}
        <nav className="min-h-0 space-y-4 overflow-y-auto border-r border-border p-3">
          {!hasLogs ? (
            <p className="px-1 py-8 text-center text-sm text-muted-foreground">
              No chat logs yet. Conversations you have while connected are saved
              here.
            </p>
          ) : (
            accounts.map((acc) => (
              <div key={acc.account}>
                <h2 className="mb-1 truncate px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {acc.account}
                </h2>
                <ul className="flex flex-col gap-0.5">
                  {acc.threads.map((t) => {
                    const active =
                      selection?.account === acc.account &&
                      selection.thread.kind === t.kind &&
                      selection.thread.name === t.name;
                    return (
                      <li key={`${t.kind}:${t.name}`}>
                        <button
                          type="button"
                          onClick={() =>
                            setSelection({ account: acc.account, thread: t })
                          }
                          className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${active ? "bg-accent text-accent-foreground" : "hover:bg-accent/50"}`}
                        >
                          {t.kind === "channel" ? (
                            <Hash className="size-4 shrink-0 text-muted-foreground" />
                          ) : (
                            <User className="size-4 shrink-0 text-muted-foreground" />
                          )}
                          <span className="min-w-0 flex-1 truncate">
                            {t.name}
                          </span>
                          <span className="shrink-0 text-xs text-muted-foreground">
                            {t.messageCount}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))
          )}
        </nav>

        {/* Transcript */}
        <section className="flex min-h-0 flex-col">
          {selection ? (
            <>
              <div className="flex items-center gap-2 border-b border-border px-4 py-2">
                <span className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
                  {selection.thread.kind === "channel" ? (
                    <Hash className="size-4 text-muted-foreground" />
                  ) : (
                    <User className="size-4 text-muted-foreground" />
                  )}
                  <span className="truncate">{selection.thread.name}</span>
                </span>
                <div className="relative ml-auto w-56">
                  <Search className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search this log"
                    className="h-8 pl-8"
                  />
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
                {loading ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    Loading…
                  </p>
                ) : filtered.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    {messages.length === 0
                      ? "This log is empty."
                      : "No lines match your search."}
                  </p>
                ) : (
                  <ul className="flex flex-col gap-1.5">
                    {filtered.map((m, i) => {
                      const key = `${m.from}-${m.at}-${i}`;
                      return (
                        <li
                          key={key}
                          className="grid grid-cols-[auto_1fr] gap-x-2 text-sm"
                        >
                          <span
                            className="whitespace-nowrap font-mono text-xs text-muted-foreground"
                            title={fmtTime(m.at)}
                          >
                            {new Date(m.at).toLocaleTimeString()}
                          </span>
                          <span className="min-w-0 break-words">
                            <span className="mr-1.5 font-semibold">
                              {m.from}
                            </span>
                            <FormattedText text={m.text} />
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 text-muted-foreground">
              <MessageSquare className="size-8" />
              <p className="text-sm">Select a conversation to read it.</p>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

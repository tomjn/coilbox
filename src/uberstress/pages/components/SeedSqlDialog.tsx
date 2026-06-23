import { Button, Input } from "@picoframe/frame";
import { AlertCircle, Check, Copy, Database, Loader2, X } from "lucide-react";
import { useState } from "react";
import { usSeedSql } from "../../bindings";
import { Field } from "./Field";

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Quick-action modal: generate the SQL that pre-seeds N accounts for load tests.
 * Delegates generation to uberstress's `gen-seed-sql` subcommand (single source
 * of truth for the account template and `base64(md5(pw))` password encoding).
 */
export default function SeedSqlDialog({
  defaultCount,
  defaultPrefix,
  defaultPassword,
  onClose,
}: {
  defaultCount: number;
  defaultPrefix: string;
  defaultPassword: string;
  onClose: () => void;
}) {
  const [count, setCount] = useState(Math.max(defaultCount, 2000));
  const [prefix, setPrefix] = useState(defaultPrefix);
  const [password, setPassword] = useState(defaultPassword);
  const [sql, setSql] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function generate() {
    setLoading(true);
    setError(null);
    setCopied(false);
    try {
      const { sql } = await usSeedSql({ count, prefix, password });
      setSql(sql);
    } catch (e) {
      setError(errMessage(e));
    } finally {
      setLoading(false);
    }
  }

  async function copy() {
    await navigator.clipboard.writeText(sql);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6"
      role="presentation"
      onClick={onClose}
    >
      {/* biome-ignore lint/a11y: dialog body; backdrop handles dismissal */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Generate seed SQL"
        className="flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-border bg-card shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-border px-5 py-3.5">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Database size={16} /> Generate seed SQL
          </h2>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close">
            <X />
          </Button>
        </header>

        <div className="space-y-4 overflow-auto p-5">
          <p className="text-sm text-muted-foreground">
            Creates accounts so a load test can run with registration off. Run the output against the server&apos;s
            database, then run a scenario with <span className="font-mono text-xs">register</span> unchecked.
          </p>

          <form
            className="grid grid-cols-1 gap-4 sm:grid-cols-3"
            onSubmit={(e) => {
              e.preventDefault();
              generate();
            }}
          >
            <Field label="Account count" hint="≥ max connections">
              <Input type="number" min={1} value={count} onChange={(e) => setCount(Number(e.target.value))} />
            </Field>
            <Field label="User prefix">
              <Input value={prefix} onChange={(e) => setPrefix(e.target.value)} className="font-mono text-xs" />
            </Field>
            <Field label="Password">
              <Input value={password} onChange={(e) => setPassword(e.target.value)} className="font-mono text-xs" />
            </Field>
            <div className="sm:col-span-3">
              <Button type="submit" disabled={loading}>
                {loading ? <Loader2 className="animate-spin" /> : <Database />}
                {loading ? "Generating…" : "Generate"}
              </Button>
            </div>
          </form>

          {error && (
            <p className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
              <AlertCircle size={15} className="mt-px shrink-0" />
              {error}
            </p>
          )}

          {sql && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">SQL</span>
                <Button variant="outline" size="sm" onClick={copy}>
                  {copied ? <Check /> : <Copy />}
                  {copied ? "Copied" : "Copy"}
                </Button>
              </div>
              <textarea
                readOnly
                value={sql}
                className="h-64 w-full resize-none rounded-md border border-border bg-muted/40 p-3 font-mono text-xs"
                onFocus={(e) => e.currentTarget.select()}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

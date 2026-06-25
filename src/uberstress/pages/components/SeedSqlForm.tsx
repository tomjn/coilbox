import { Button, Input } from "@picoframe/frame";
import { AlertCircle, Check, Copy, Database, Loader2 } from "lucide-react";
import { useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { usSeedSql } from "../../bindings";
import { Field } from "./Field";

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Seed-SQL generator, rendered as the body of the frame side drawer (the drawer
 * supplies the title/description/close chrome). Delegates generation to
 * uberstress's `gen-seed-sql` subcommand — the single source of truth for the
 * account template and `base64(md5(pw))` password encoding.
 */
export default function SeedSqlForm({
  defaultCount,
  defaultPrefix,
  defaultPassword,
}: {
  defaultCount: number;
  defaultPrefix: string;
  defaultPassword: string;
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
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Run the output against the server&apos;s database, then run a scenario
        with <span className="font-mono text-xs">register</span> unchecked.
      </p>

      <form
        className="grid grid-cols-1 gap-4 sm:grid-cols-3"
        onSubmit={(e) => {
          e.preventDefault();
          generate();
        }}
      >
        <Field label="Account count" hint="≥ max connections">
          <Input
            type="number"
            min={1}
            value={count}
            onChange={(e) => setCount(Number(e.target.value))}
          />
        </Field>
        <Field label="User prefix">
          <Input
            value={prefix}
            onChange={(e) => setPrefix(e.target.value)}
            className="font-mono text-xs"
          />
        </Field>
        <Field label="Password">
          <Input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="font-mono text-xs"
          />
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
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              SQL
            </span>
            <Button variant="outline" size="sm" onClick={copy}>
              {copied ? <Check /> : <Copy />}
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          <Textarea
            readOnly
            value={sql}
            className="h-64 resize-none bg-muted/40 font-mono text-xs"
            onFocus={(e) => e.currentTarget.select()}
          />
        </div>
      )}
    </div>
  );
}

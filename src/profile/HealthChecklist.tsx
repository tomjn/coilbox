import {
  AlertTriangle,
  CheckCircle2,
  CircleHelp,
  type LucideIcon,
  XCircle,
} from "lucide-react";
import type { HealthCheck, HealthStatus } from "./health";
import { useHealthChecks } from "./useHealthChecks";

const ICONS: Record<HealthStatus, LucideIcon> = {
  ok: CheckCircle2,
  warn: AlertTriangle,
  error: XCircle,
  unknown: CircleHelp,
};

const COLOURS: Record<HealthStatus, string> = {
  ok: "text-green-600 dark:text-green-500",
  warn: "text-amber-600 dark:text-amber-500",
  error: "text-destructive",
  unknown: "text-muted-foreground",
};

export default function HealthChecklist() {
  const { checks, loading } = useHealthChecks();

  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        Health
      </h3>
      {loading && checks.length === 0 ? (
        <p className="text-sm text-muted-foreground">Running checks…</p>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border text-sm">
          {checks.map((c) => (
            <Row key={c.id} check={c} />
          ))}
        </ul>
      )}
    </section>
  );
}

function Row({ check }: { check: HealthCheck }) {
  const Icon = ICONS[check.status];
  return (
    <li className="flex items-start gap-3 px-3 py-2">
      <Icon size={16} className={`mt-0.5 shrink-0 ${COLOURS[check.status]}`} />
      <div className="min-w-0">
        <p className="font-medium">{check.label}</p>
        {check.hint && <p className="text-muted-foreground">{check.hint}</p>}
      </div>
    </li>
  );
}

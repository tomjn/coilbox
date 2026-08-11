import { Button, Input } from "@picoframe/frame";
import { Loader2, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import type {
  EngineConfigSetting,
  EngineConfigWriteResult,
} from "../../bindings";

/**
 * One editable engine setting, rendered as the control its type calls for.
 *
 * The worker decides which that is, because only the engine knows: it reports
 * `bool`, `enum` (values with named meanings), `range` (both ends known),
 * `number` or `string`, along with any bounds. Everything used to arrive as a
 * number, which is why VSync was once a box you typed `-1` into.
 *
 * Committing differs by control, and follows what the control is for. A
 * checkbox, a select and a slider commit the moment you let go, because each
 * press is a whole decision. Text and number fields commit on blur or Enter, so
 * we don't spawn a worker per keystroke.
 *
 * The committed value is owned by the parent (updated on a successful write).
 * The field keeps only a transient `draft` while editing, and reverts it if the
 * write fails. Label and control share the parent grid via `contents`.
 */
export function EngineSettingField({
  setting: s,
  writable,
  onWrite,
}: {
  setting: EngineConfigSetting;
  writable: boolean;
  onWrite: (key: string, value: string) => Promise<EngineConfigWriteResult>;
}) {
  const id = `engineopt-${s.key}`;
  const [draft, setDraft] = useState(s.value);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Re-sync the draft when the committed value changes (reset, rescan, etc.).
  useEffect(() => setDraft(s.value), [s.value]);

  const changed = s.value !== s.default;
  const disabled = !writable || saving;

  async function commit(value: string) {
    if (value === s.value) return;
    setSaving(true);
    setErr(null);
    const res = await onWrite(s.key, value);
    setSaving(false);
    if (!res.ok) {
      setErr(res.errors[0] ?? "write failed");
      setDraft(s.value); // revert to the last committed value
    }
  }

  const reset = writable && changed && (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="h-7 gap-1 px-2 text-xs text-muted-foreground"
      title={`Reset to engine default (${s.default || "empty"})`}
      disabled={saving}
      onClick={() => commit(s.default)}
    >
      <RotateCcw className="size-3" />
      Reset
    </Button>
  );

  const status = saving ? (
    <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
  ) : err ? (
    <span className="truncate text-xs text-destructive" title={err}>
      {err}
    </span>
  ) : null;

  const label = (
    <div className="flex flex-col gap-0.5 py-1">
      <Label htmlFor={id} className="font-normal text-muted-foreground">
        {s.label}
      </Label>
      {s.hint && (
        <span className="text-xs leading-snug text-muted-foreground/70">
          {s.hint}
        </span>
      )}
    </div>
  );

  return (
    <div className="contents">
      {label}
      <div className="flex min-w-0 items-center gap-2">
        <Control
          setting={s}
          id={id}
          draft={draft}
          setDraft={setDraft}
          commit={commit}
          disabled={disabled}
        />
        {status}
        {reset}
      </div>
    </div>
  );
}

function Control({
  setting: s,
  id,
  draft,
  setDraft,
  commit,
  disabled,
}: {
  setting: EngineConfigSetting;
  id: string;
  draft: string;
  setDraft: (value: string) => void;
  commit: (value: string) => Promise<void>;
  disabled: boolean;
}) {
  if (s.type === "bool") {
    return (
      <Checkbox
        id={id}
        checked={s.value === "1"}
        disabled={disabled}
        onCheckedChange={(v) => commit(v === true ? "1" : "0")}
      />
    );
  }

  if (s.type === "enum") {
    // A value the engine accepts but the catalog has no word for still has to
    // be selectable, or opening the page and closing it would silently change
    // the setting. It joins the list as itself.
    const options = s.options ?? [];
    const known = options.some((o) => o.value === s.value);
    const shown = known
      ? options
      : [...options, { value: s.value, label: s.value }];
    return (
      <Select
        value={s.value}
        onValueChange={(v) => void commit(v)}
        disabled={disabled}
      >
        <SelectTrigger id={id} size="sm" className="w-56">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {shown.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  if (s.type === "range") {
    const min = s.min ?? 0;
    const max = s.max ?? 100;
    const current = Number(draft);
    const value = Number.isFinite(current) ? current : (s.min ?? 0);
    return (
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <Slider
          id={id}
          min={min}
          max={max}
          step={1}
          value={[value]}
          disabled={disabled}
          // Dragging updates the label only. The write waits for the release,
          // so one drag is one write rather than one per pixel.
          onValueChange={([v]) => setDraft(String(v))}
          onValueCommit={([v]) => void commit(String(v))}
          className="max-w-64 py-2"
        />
        <span className="w-10 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
          {value}
        </span>
      </div>
    );
  }

  return (
    <Input
      id={id}
      type={s.type === "number" ? "number" : "text"}
      value={draft}
      placeholder={s.default}
      min={s.min}
      max={s.max}
      disabled={disabled}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => commit(draft)}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit(draft);
      }}
    />
  );
}

import { useLingui } from "@lingui/react/macro";
import { Button, Input } from "@picoframe/frame";
import { Loader2, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";
import { SettingRow } from "@/components/SettingRow";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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
 * write fails. It is one `<SettingRow>`, so it goes in a `<SettingList>`, and
 * its Reset button needs a `TooltipProvider` above it.
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
  const { t } = useLingui();
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
      setErr(res.errors[0] ?? t`write failed`);
      setDraft(s.value); // revert to the last committed value
    }
  }

  const defaultValue =
    s.type === "enum"
      ? (s.options?.find((o) => o.value === s.default)?.label ?? s.default)
      : s.type === "bool"
        ? s.default === "1"
          ? t`On`
          : t`Off`
        : s.default || t`empty`;
  const resetLabel = t`Reset to engine default (${defaultValue})`;

  return (
    <SettingRow
      id={id}
      label={s.label}
      helpLabel={t`About ${s.label}`}
      help={s.hint && <p>{s.hint}</p>}
      error={err}
    >
      <div className="flex w-56 min-w-0 items-center justify-end">
        <Control
          setting={s}
          id={id}
          draft={draft}
          setDraft={setDraft}
          commit={commit}
          disabled={disabled}
        />
      </div>
      {/* Held open whether or not there is a Reset to put in it, so a row
          that is at its default lines up with one that is not. */}
      <div className="ml-1 flex size-8 shrink-0 items-center justify-center">
        {saving ? (
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
        ) : writable && changed ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-muted-foreground hover:text-foreground"
                aria-label={resetLabel}
                onClick={() => commit(s.default)}
              >
                <RotateCcw className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{resetLabel}</TooltipContent>
          </Tooltip>
        ) : null}
      </div>
    </SettingRow>
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
      <Switch
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
        <SelectTrigger id={id} size="sm" className="w-full">
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
      <div className="flex w-full min-w-0 items-center gap-3">
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
          className="py-2"
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
      // Several of these are fractions, such as an edge scroll width of 0.02,
      // which the default step of 1 would mark invalid.
      step={s.type === "number" ? "any" : undefined}
      className="w-full"
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

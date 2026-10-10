import { Button, Input } from "@picoframe/frame";
import { Layers } from "lucide-react";
import { useState } from "react";
import { CheckField } from "@/components/Field";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { ReplaySetMember, ReplaySetsApi } from "../../replaySets";

/**
 * A popover that adds one replay to sets or takes it out, and starts a new set
 * with it. It only changes set membership. The replay file is never touched.
 */
export function ReplaySetPicker({
  api,
  member,
  label = "Sets",
}: {
  api: ReplaySetsApi;
  member: ReplaySetMember;
  /** Visible text beside the icon. Leave empty for an icon button. */
  label?: string;
}) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const toggle = (setId: string, on: boolean) => {
    if (on) api.add(setId, [member]);
    else api.removeFrom(setId, [member.filename]);
  };

  const create = () => {
    const r = api.create(name, undefined, [member]);
    if ("error" in r) {
      setError(r.error);
      return;
    }
    setName("");
    setError(null);
  };

  const inCount = api.sets.filter((s) =>
    s.members.some((m) => m.filename === member.filename),
  ).length;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant={inCount > 0 ? "secondary" : "ghost"}
          size={label ? "sm" : "icon"}
          aria-label="Sets for this replay"
          title="Add to or remove from a set"
          className="gap-1.5"
        >
          <Layers
            className={`size-4 ${inCount > 0 ? "text-primary" : "text-muted-foreground"}`}
          />
          {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="flex w-72 flex-col gap-3">
        <p className="text-xs text-muted-foreground">
          A set groups replays. Adding or removing here never changes the replay
          file.
        </p>
        {api.sets.length === 0 ? (
          <p className="text-sm text-muted-foreground">No sets yet.</p>
        ) : (
          <ul className="flex max-h-48 flex-col gap-2 overflow-y-auto">
            {api.sets.map((s) => (
              <li key={s.id}>
                <CheckField
                  label={s.name}
                  checked={s.members.some(
                    (m) => m.filename === member.filename,
                  )}
                  onChange={(on) => toggle(s.id, on)}
                />
              </li>
            ))}
          </ul>
        )}
        <form
          className="flex flex-col gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            create();
          }}
        >
          <div className="flex gap-1.5">
            <Input
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setError(null);
              }}
              placeholder="New set name"
              aria-label="New set name"
              aria-invalid={error ? true : undefined}
              className="h-8"
            />
            <Button type="submit" size="sm" variant="outline">
              Create
            </Button>
          </div>
          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
        </form>
      </PopoverContent>
    </Popover>
  );
}

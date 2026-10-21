import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { Button, Input } from "@picoframe/frame";
import { Layers } from "lucide-react";
import { useState } from "react";
import { Field } from "@/components/Field";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import type {
  ReplaySet,
  ReplaySetMember,
  ReplaySetsApi,
  ResolvedSet,
} from "../../replaySets";

/** Name and description form for a new set or an existing one. */
function SetForm({
  initialName,
  initialDescription,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initialName: string;
  initialDescription: string;
  submitLabel: string;
  /** Returns an error message to show, or null when it worked. */
  onSubmit: (name: string, description: string) => string | null;
  onCancel?: () => void;
}) {
  const { t } = useLingui();
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription);
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const err = onSubmit(name, description);
        setError(err);
        if (!err && !initialName) {
          setName("");
          setDescription("");
        }
      }}
    >
      <Field label={t`Set name`}>
        <Input
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setError(null);
          }}
          aria-invalid={error ? true : undefined}
          className="h-8"
        />
      </Field>
      <Field label={t`Description (optional)`}>
        <Textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
        />
      </Field>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      <div className="flex gap-1.5">
        <Button type="submit" size="sm">
          {submitLabel}
        </Button>
        {onCancel && (
          <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
            <Trans>Cancel</Trans>
          </Button>
        )}
      </div>
    </form>
  );
}

function SetRow({
  set,
  resolved,
  api,
  shown,
  active,
  onFilter,
}: {
  set: ReplaySet;
  resolved: ResolvedSet<unknown>;
  api: ReplaySetsApi;
  shown: ReplaySetMember[];
  active: boolean;
  onFilter: (id: string) => void;
}) {
  const { t } = useLingui();
  const [mode, setMode] = useState<"view" | "edit" | "delete">("view");
  const missing = resolved.missing.length;
  const setName = set.name;

  if (mode === "edit") {
    return (
      <li className="rounded-md border border-border/60 p-2">
        <SetForm
          initialName={set.name}
          initialDescription={set.description ?? ""}
          submitLabel={t`Save`}
          onSubmit={(name, description) => {
            const err = api.update(set.id, name, description);
            if (!err) setMode("view");
            return err;
          }}
          onCancel={() => setMode("view")}
        />
      </li>
    );
  }

  return (
    <li className="flex flex-col gap-1.5 rounded-md border border-border/60 p-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-sm font-medium" title={set.name}>
          {set.name}
        </span>
        <span className="shrink-0 text-xs text-muted-foreground">
          <Plural value={set.members.length} one="# replay" other="# replays" />
        </span>
      </div>
      {set.description && (
        <p className="text-xs text-muted-foreground">{set.description}</p>
      )}
      {missing > 0 && (
        <p className="text-xs text-muted-foreground">
          {missing === 1 ? (
            <Trans>1 not in your library. It stays in the set.</Trans>
          ) : (
            <Trans>{missing} not in your library. They stay in the set.</Trans>
          )}
        </p>
      )}
      {mode === "delete" ? (
        <div className="flex flex-col gap-1.5">
          <p className="text-xs">
            <Trans>Delete the set “{setName}”? Only the set goes.</Trans>
            {set.members.length > 0 && " "}
            {set.members.length > 0 && (
              <Plural
                value={set.members.length}
                one="Its # replay stays in your library."
                other="Its # replays stay in your library."
              />
            )}
          </p>
          <div className="flex gap-1.5">
            <Button
              size="sm"
              variant="destructive"
              onClick={() => {
                api.remove(set.id);
                if (active) onFilter("");
              }}
            >
              <Trans>Delete set</Trans>
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setMode("view")}>
              <Trans>Cancel</Trans>
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          <Button
            size="sm"
            variant={active ? "default" : "outline"}
            aria-pressed={active}
            onClick={() => onFilter(active ? "" : set.id)}
          >
            {active ? <Trans>Showing</Trans> : <Trans>Show</Trans>}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={shown.length === 0}
            onClick={() => api.add(set.id, shown)}
            title={t`Add every replay in the list as filtered now`}
          >
            <Trans>Add the {shown.length} shown</Trans>
          </Button>
          {missing > 0 && (
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                api.removeFrom(
                  set.id,
                  resolved.missing.map((m) => m.filename),
                )
              }
            >
              <Trans>Forget {missing} missing</Trans>
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => setMode("edit")}>
            <Trans>Edit</Trans>
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setMode("delete")}>
            <Trans>Delete set</Trans>
          </Button>
        </div>
      )}
    </li>
  );
}

/**
 * Create, edit and delete sets, and choose one to filter the list by. Deleting
 * a set never deletes a replay.
 */
export function ReplaySetsManager({
  api,
  resolve,
  shown,
  activeId,
  onFilter,
}: {
  api: ReplaySetsApi;
  resolve: (set: ReplaySet) => ResolvedSet<unknown>;
  /** The replays the list shows right now, for "Add the shown". */
  shown: ReplaySetMember[];
  activeId: string;
  onFilter: (id: string) => void;
}) {
  const { t } = useLingui();
  const setCount = api.sets.length;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <Layers className="size-4" />{" "}
          {api.sets.length > 0 ? (
            <Trans>Sets ({setCount})</Trans>
          ) : (
            <Trans>Sets</Trans>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="flex max-h-[32rem] w-96 flex-col gap-3 overflow-y-auto"
      >
        <p className="text-xs text-muted-foreground">
          <Trans>
            A set is a named group of replays, such as a tournament or a night
            of games. Deleting a set never deletes the replays in it. To delete
            replays, use the replay's own page.
          </Trans>
        </p>
        {api.sets.length > 0 && (
          <ul className="flex flex-col gap-2">
            {api.sets.map((s) => (
              <SetRow
                key={s.id}
                set={s}
                resolved={resolve(s)}
                api={api}
                shown={shown}
                active={s.id === activeId}
                onFilter={onFilter}
              />
            ))}
          </ul>
        )}
        <div className="flex flex-col gap-1.5 border-t border-border/60 pt-3">
          <h3 className="text-sm font-medium">
            <Trans>New set</Trans>
          </h3>
          <SetForm
            initialName=""
            initialDescription=""
            submitLabel={t`Create set`}
            onSubmit={(name, description) => {
              const r = api.create(name, description);
              return "error" in r ? r.error : null;
            }}
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}

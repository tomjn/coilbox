import { Trans, useLingui } from "@lingui/react/macro";
import { Button, Input } from "@picoframe/frame";
import { Eye, X } from "lucide-react";
import { useState } from "react";
import { useReplaySets } from "../../replaySets";
import { useReplayUserState } from "../../replayUserState";
import { ReplaySetPicker } from "./ReplaySetPicker";

/** Watched flag + free-form tags for this replay (persisted locally by filename). */
export function ReplayNotes({
  filename,
  gameId,
}: {
  filename: string;
  gameId?: string;
}) {
  const { t } = useLingui();
  const userState = useReplayUserState();
  const replaySets = useReplaySets();
  const us = userState.get(filename);
  const tags = us.tags ?? [];
  const [draft, setDraft] = useState("");

  const addTag = () => {
    const tag = draft.trim();
    if (!tag || tags.includes(tag)) {
      setDraft("");
      return;
    }
    userState.setTags(filename, [...tags, tag]);
    setDraft("");
  };
  const removeTag = (tag: string) =>
    userState.setTags(
      filename,
      tags.filter((x) => x !== tag),
    );

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-medium">{t`Your notes`}</h2>
      <div className="flex flex-col gap-3 rounded-lg border border-border/50 bg-card p-3">
        <Button
          variant={us.watched ? "default" : "outline"}
          size="sm"
          onClick={() => userState.setWatched(filename, !us.watched)}
          aria-pressed={!!us.watched}
          className="w-fit gap-1.5"
        >
          <Eye className="size-4" /> {us.watched ? t`Watched` : t`Mark watched`}
        </Button>
        <div className="flex flex-wrap items-center gap-1.5">
          {tags.map((tag) => (
            <span
              key={tag}
              className="flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground"
            >
              {tag}
              <button
                type="button"
                onClick={() => removeTag(tag)}
                aria-label={t`Remove tag ${tag}`}
                className="hover:text-foreground"
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") addTag();
            }}
            onBlur={addTag}
            placeholder={t`Add tag…`}
            className="h-7 w-28"
          />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {replaySets.sets
            .filter((s) => s.members.some((m) => m.filename === filename))
            .map((s) => (
              <span
                key={s.id}
                className="rounded bg-primary/15 px-1.5 py-0.5 text-xs text-primary"
              >
                {s.name}
              </span>
            ))}
          <ReplaySetPicker
            api={replaySets}
            member={{ filename, gameId }}
            label={t`Sets`}
          />
        </div>
      </div>
    </section>
  );
}

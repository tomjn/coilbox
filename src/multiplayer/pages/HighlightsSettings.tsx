import { Trans, useLingui } from "@lingui/react/macro";
import { Button, Input, useSetting } from "@picoframe/frame";
import { Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { HelpPopover } from "@/components/HelpPopover";
import { SettingList, SettingRow } from "@/components/SettingRow";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { HIGHLIGHT_OWN_KEY, HIGHLIGHT_WORDS_KEY } from "../chat/highlight";

/**
 * Settings section at /settings/chat-highlights (issue #193). Manages the list of
 * words that flag a chat message, and whether your own username also flags one.
 * Highlight matching itself lives in `chat/highlight.ts`, and this only edits its
 * inputs.
 *
 * The sound a mention makes used to be a toggle here as well. It is now one row
 * of the events table in Sound settings, alongside every other sound, rather
 * than two screens owning one behaviour between them.
 */
export default function HighlightsSettings() {
  const { t } = useLingui();
  const [words, setWords] = useSetting<string[]>(HIGHLIGHT_WORDS_KEY, []);
  const [ownEnabled, setOwnEnabled] = useSetting<boolean>(
    HIGHLIGHT_OWN_KEY,
    true,
  );
  // The row Add word just made, focused once it renders so you can type.
  const [focusRow, setFocusRow] = useState<number | null>(null);
  useEffect(() => {
    if (focusRow === null) return;
    document.getElementById(`highlight-word-${focusRow}`)?.focus();
    setFocusRow(null);
  }, [focusRow]);

  // Rows are edited by index, as words may be blank while typing. The matcher
  // ignores empty entries, so there's no need to prune them on every keystroke.
  const updateWord = (i: number, value: string) =>
    setWords(words.map((w, idx) => (idx === i ? value : w)));
  const removeWord = (i: number) =>
    setWords(words.filter((_, idx) => idx !== i));
  const addWord = () => {
    setWords([...words, ""]);
    setFocusRow(words.length);
  };

  return (
    <div className="flex flex-col gap-10">
      <section className="flex flex-col gap-3">
        <div className="flex items-center gap-1">
          <h2 className="text-sm font-semibold">
            <Trans>Mentions</Trans>
          </h2>
          <HelpPopover label={t`About highlights`}>
            <p>
              <Trans>
                A message that names you or a highlight word is outlined in
                chat, flashes the window, plays a sound and shows a notice.
                Choose the sound under{" "}
                <Link
                  to="/settings/sound"
                  className="underline underline-offset-2"
                >
                  Sound
                </Link>
                .
              </Trans>
            </p>
          </HelpPopover>
        </div>
        <SettingList>
          <SettingRow
            id="highlight-own-username"
            label={t`Highlight my username`}
          >
            <Switch
              id="highlight-own-username"
              checked={ownEnabled}
              onCheckedChange={setOwnEnabled}
            />
          </SettingRow>
        </SettingList>
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-1">
            <h2 className="text-sm font-semibold">
              <Trans>Highlight words</Trans>
            </h2>
            <HelpPopover label={t`About highlight words`}>
              <p>
                <Trans>
                  A word counts only on its own and in any case, so "alice"
                  matches "Hi Alice!" but not "malice".
                </Trans>
              </p>
            </HelpPopover>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={addWord}>
            <Plus /> <Trans>Add word</Trans>
          </Button>
        </div>
        {words.length === 0 ? (
          <p className="rounded-md border border-border px-4 py-3 text-sm text-muted-foreground">
            <Trans>No highlight words.</Trans>
          </p>
        ) : (
          <TooltipProvider>
            <ul className="divide-y divide-border rounded-md border border-border">
              {words.map((w, i) => (
                <li
                  // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional (words may be blank/duplicate while editing)
                  key={i}
                  className="flex items-center gap-2 px-4 py-2"
                >
                  <Input
                    id={`highlight-word-${i}`}
                    value={w}
                    onChange={(e) => updateWord(i, e.target.value)}
                    placeholder={t`word`}
                    aria-label={t`Highlight word`}
                    className="min-w-0 flex-1"
                  />
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => removeWord(i)}
                        aria-label={w ? t`Remove ${w}` : t`Remove word`}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <Trans>Remove</Trans>
                    </TooltipContent>
                  </Tooltip>
                </li>
              ))}
            </ul>
          </TooltipProvider>
        )}
      </section>
    </div>
  );
}

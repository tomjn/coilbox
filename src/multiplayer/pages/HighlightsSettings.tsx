import { Button, Input, useSetting } from "@picoframe/frame";
import { Plus, Trash2 } from "lucide-react";
import { Link } from "react-router";
import { Switch } from "@/components/ui/switch";
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
  const [words, setWords] = useSetting<string[]>(HIGHLIGHT_WORDS_KEY, []);
  const [ownEnabled, setOwnEnabled] = useSetting<boolean>(
    HIGHLIGHT_OWN_KEY,
    true,
  );

  // Rows are edited by index (words may be blank while typing); empty entries are
  // ignored by the matcher, so there's no need to prune them on every keystroke.
  const updateWord = (i: number, value: string) =>
    setWords(words.map((w, idx) => (idx === i ? value : w)));
  const removeWord = (i: number) =>
    setWords(words.filter((_, idx) => idx !== i));
  const addWord = () => setWords([...words, ""]);

  return (
    <div className="flex flex-col gap-6">
      <label
        htmlFor="highlight-own-username"
        className="flex items-center justify-between gap-4"
      >
        <span className="flex flex-col">
          <span className="text-sm font-medium">Highlight my username</span>
          <span className="text-xs text-muted-foreground">
            Flag messages that mention your logged-in username.
          </span>
        </span>
        <Switch
          id="highlight-own-username"
          checked={ownEnabled}
          onCheckedChange={setOwnEnabled}
        />
      </label>

      <p className="text-xs text-muted-foreground">
        A matching message flashes the window and plays a sound. Choose which
        sound, and how loud, under{" "}
        <Link to="/settings/sound" className="underline underline-offset-2">
          Sound
        </Link>
        .
      </p>

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">Highlight words</span>
        <span className="text-xs text-muted-foreground">
          Whole-word, case-insensitive. Messages containing any of these are
          visually flagged.
        </span>
        {words.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            None yet. Add a word to have it flag matching chat messages.
          </p>
        ) : (
          <ul className="space-y-2">
            {words.map((w, i) => (
              <li
                // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional (words may be blank/duplicate while editing)
                key={i}
                className="grid grid-cols-[1fr_auto] items-center gap-2"
              >
                <Input
                  value={w}
                  onChange={(e) => updateWord(i, e.target.value)}
                  placeholder="word"
                  aria-label="Highlight word"
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => removeWord(i)}
                  aria-label={`Remove ${w || "word"}`}
                >
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
        )}
        <div>
          <Button variant="outline" size="sm" onClick={addWord}>
            <Plus /> Add word
          </Button>
        </div>
      </div>
    </div>
  );
}

import { Button, Input, useSetting } from "@picoframe/frame";
import { Plus, Trash2 } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import {
  HIGHLIGHT_OWN_KEY,
  HIGHLIGHT_SOUND_KEY,
  HIGHLIGHT_WORDS_KEY,
} from "../chat/highlight";

/**
 * Settings section at /settings/chat-highlights (issue #193). Manages the list of
 * words that flag a chat message, whether your own username also flags one, and
 * whether a matched incoming message plays a sound + flashes the window. Highlight
 * matching itself lives in `chat/highlight.ts`; this only edits its inputs.
 */
export default function HighlightsSettings() {
  const [words, setWords] = useSetting<string[]>(HIGHLIGHT_WORDS_KEY, []);
  const [ownEnabled, setOwnEnabled] = useSetting<boolean>(
    HIGHLIGHT_OWN_KEY,
    true,
  );
  const [sound, setSound] = useSetting<boolean>(HIGHLIGHT_SOUND_KEY, true);

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

      <label
        htmlFor="highlight-sound"
        className="flex items-center justify-between gap-4"
      >
        <span className="flex flex-col">
          <span className="text-sm font-medium">Play a sound on mention</span>
          <span className="text-xs text-muted-foreground">
            Play a chime and flash the window when an incoming message matches.
          </span>
        </span>
        <Switch
          id="highlight-sound"
          checked={sound}
          onCheckedChange={setSound}
        />
      </label>

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

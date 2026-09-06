import { Button, Input } from "@picoframe/frame";
import { useState } from "react";
import { Field } from "@/components/Field";
import { getProfile } from "../../profile/profile";
import {
  DEFAULT_HUB_URL,
  isValidHubUrl,
  resolveHubUrl,
  useHubUrlSetting,
} from "../config";
import { ShareAssetsPanel } from "./components/ShareAssetsPanel";

/**
 * The hub plugin's settings section (`/settings/hub`, issue #1353): lets a player
 * point coilbox at a different hub than the built-in default, or the one their
 * distribution profile sets via `hubUrl`, and clear that override to fall back.
 * Reachable only while the hub is enabled (see the `useVisible` gate on this
 * section in `../index.tsx`), because a distributor who has switched the hub off
 * has nothing here for the address to point at.
 *
 * Typing commits to the `hub.url` setting on every keystroke that still parses as
 * an http(s) URL, the same as the plain text fields elsewhere in settings (e.g.
 * `downloads/pages/SettingsSection.tsx`'s rapid master URL). Anything else is left
 * uncommitted and flagged inline, so a stray character can't silently break every
 * hub request. Clearing the field is not enough to fall back on its own, since an
 * empty *draft* is a valid URL fragment, so the button makes the intent explicit
 * rather than relying on the user backspacing everything by hand.
 *
 * Signing in (issue #1348) sits under the address, because which hub you are
 * pointed at decides which account you have. Changing the address above asks the
 * new hub who you are there.
 *
 * The import count (issue #1361) had a switch here and no longer does. It read
 * as a preference rather than as the one thing coilbox sends home, and what it
 * withheld was an item id the hub had just served, with no account and nothing
 * that points at the reader. See `../importCount.ts`. A distribution can still
 * switch the whole thing off with `hubImportCounts`.
 *
 * Signing in and the four sharing controls themselves are `ShareAssetsPanel`
 * (`./components/ShareAssetsPanel.tsx`), shared with the hub page's Share menu
 * (issue #2562) so the same panel does the work wherever it is opened from.
 */
export default function HubSettings() {
  const [userUrl, setUserUrl] = useHubUrlSetting();
  const [draft, setDraft] = useState(userUrl);
  const [error, setError] = useState<string | null>(null);

  const profileUrl = getProfile().hubUrl?.trim();
  const effective = resolveHubUrl(userUrl, profileUrl);
  const source = userUrl.trim()
    ? "your own address, set below"
    : profileUrl
      ? "the address your distribution set"
      : "the built-in default";

  const change = (value: string) => {
    setDraft(value);
    if (isValidHubUrl(value)) {
      setError(null);
      setUserUrl(value.trim());
    } else {
      setError(
        "Enter a web address starting with http:// or https://, or clear the field.",
      );
    }
  };

  const clearOverride = () => {
    setDraft("");
    setUserUrl("");
    setError(null);
  };

  return (
    // Each thing here is its own errand - which hub, and who you are on it - so
    // they are spaced as sections rather than as lines of one block.
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Coilbox is using <span className="font-mono text-xs">{effective}</span>,{" "}
        {source}.
      </p>
      <Field
        label="Your hub address"
        hint="Leave blank to use the default, or your distribution's address if it sets one."
      >
        <div className="flex gap-2">
          <Input
            value={draft}
            onChange={(e) => change(e.target.value)}
            placeholder={DEFAULT_HUB_URL}
            className="flex-1 font-mono text-xs"
          />
          {userUrl.trim() !== "" && (
            <Button variant="outline" size="sm" onClick={clearOverride}>
              Clear override
            </Button>
          )}
        </div>
      </Field>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <ShareAssetsPanel hubUrl={effective} />
    </div>
  );
}

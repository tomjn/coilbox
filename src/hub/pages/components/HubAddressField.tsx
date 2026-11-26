import { Trans, useLingui } from "@lingui/react/macro";
import { Button, Input } from "@picoframe/frame";
import { useState } from "react";
import { HelpPopover } from "@/components/HelpPopover";
import { SettingList } from "@/components/SettingRow";
import { Label } from "@/components/ui/label";
import { getProfile } from "../../../profile/profile";
import { isValidHubUrl, resolveHubUrl, useHubUrlSetting } from "../../config";

/**
 * The control for the `hub.url` user setting (issue #1353): lets a player point
 * coilbox at a different hub than the built-in default, or the one their
 * distribution profile sets via `hubUrl`, and clear that override to fall back.
 * It sits in Settings > Library > Sources (issue #4584), with the other places
 * content comes from.
 *
 * Typing commits to the `hub.url` setting on every keystroke that still parses as
 * an http(s) URL, the same as the plain text fields elsewhere in settings (e.g.
 * `downloads/pages/SettingsSection.tsx`'s rapid master URL). Anything else is left
 * uncommitted and flagged inline, so a stray character can't silently break every
 * hub request. Clearing the field is not enough to fall back on its own, since an
 * empty *draft* is a valid URL fragment, so the button makes the intent explicit
 * rather than relying on the user backspacing everything by hand.
 *
 * A blank field shows the address it falls back to as its placeholder, so the
 * address in use is always on screen without a sentence saying which it is.
 */
export function HubAddressField() {
  const { t } = useLingui();
  const [userUrl, setUserUrl] = useHubUrlSetting();
  const [draft, setDraft] = useState(userUrl);
  const [error, setError] = useState<string | null>(null);

  const profileUrl = getProfile().hubUrl?.trim();
  // What a blank field means, shown as its placeholder.
  const fallback = resolveHubUrl("", profileUrl);

  const change = (value: string) => {
    setDraft(value);
    if (isValidHubUrl(value)) {
      setError(null);
      setUserUrl(value.trim());
    } else {
      setError(
        t`Enter a web address starting with http:// or https://, or clear the field.`,
      );
    }
  };

  const clearOverride = () => {
    setDraft("");
    setUserUrl("");
    setError(null);
  };

  return (
    <SettingList>
      <li className="flex flex-col gap-2 px-4 py-3">
        <div className="flex items-center gap-1">
          <Label htmlFor="hub-url" className="text-sm font-medium">
            <Trans>Address</Trans>
          </Label>
          <HelpPopover label={t`About the hub address`}>
            <p>
              {profileUrl ? (
                <Trans>
                  Leave it blank to use the address your distribution set.
                </Trans>
              ) : (
                <Trans>Leave it blank to use the built-in address.</Trans>
              )}
            </p>
          </HelpPopover>
        </div>
        <div className="flex items-center gap-2">
          <Input
            id="hub-url"
            value={draft}
            onChange={(e) => change(e.target.value)}
            placeholder={fallback}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "hub-url-error" : undefined}
            className="min-w-0 flex-1 font-mono text-xs"
          />
          {userUrl.trim() !== "" && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={clearOverride}
            >
              <Trans>Use default</Trans>
            </Button>
          )}
        </div>
        {error && (
          <p
            id="hub-url-error"
            role="alert"
            className="text-xs text-destructive"
          >
            {error}
          </p>
        )}
      </li>
    </SettingList>
  );
}

import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@picoframe/frame";
import { Trash2 } from "lucide-react";
import { SettingList, SettingRow } from "@/components/SettingRow";
import { Switch } from "@/components/ui/switch";
import { describeSearch, useSavedBattleSearches } from "./savedSearch";

/**
 * The saved battle searches, each with its own switch. Searches are made from
 * the Battles page. Switching one off keeps it, so it can come back on without
 * being typed in again.
 */
export function SavedSearchSettings() {
  const { t } = useLingui();
  const { searches, update } = useSavedBattleSearches();

  return (
    <section className="flex flex-col gap-3" aria-labelledby="saved-searches">
      <h2 id="saved-searches" className="text-sm font-semibold">
        <Trans>Battle alerts</Trans>
      </h2>
      {searches.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          <Trans>
            None yet. Use Alert me on the Battles page to be told when a battle
            you want appears.
          </Trans>
        </p>
      ) : (
        <SettingList>
          {searches.map((s) => {
            const description = describeSearch(s);
            return (
              <SettingRow key={s.id} label={description}>
                <div className="flex items-center gap-2">
                  <Switch
                    checked={s.enabled}
                    aria-label={t`Alert for ${description}`}
                    onCheckedChange={(enabled) =>
                      update((cur) =>
                        cur.map((o) => (o.id === s.id ? { ...o, enabled } : o)),
                      )
                    }
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8 shrink-0"
                    aria-label={t`Delete the alert for ${description}`}
                    onClick={() =>
                      update((cur) => cur.filter((o) => o.id !== s.id))
                    }
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </SettingRow>
            );
          })}
        </SettingList>
      )}
    </section>
  );
}

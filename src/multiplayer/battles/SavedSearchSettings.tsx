import { Button } from "@picoframe/frame";
import { Trash2 } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { describeSearch, useSavedBattleSearches } from "./savedSearch";

/**
 * The saved battle searches, each with its own switch. Searches are made from
 * the Battles page. Switching one off keeps it, so it can come back on without
 * being typed in again.
 */
export function SavedSearchSettings() {
  const { searches, update } = useSavedBattleSearches();

  return (
    <section className="flex flex-col gap-2" aria-labelledby="saved-searches">
      <h2 id="saved-searches" className="text-sm font-medium">
        Battle alerts
      </h2>
      {searches.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          None yet. Use Alert me on the Battles page to be told when a battle
          you want appears.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {searches.map((s) => (
            <li key={s.id} className="flex items-center gap-3">
              <span className="min-w-0 flex-1 truncate text-sm">
                {describeSearch(s)}
              </span>
              <Switch
                checked={s.enabled}
                aria-label={`Alert for ${describeSearch(s)}`}
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
                aria-label={`Delete the alert for ${describeSearch(s)}`}
                onClick={() =>
                  update((cur) => cur.filter((o) => o.id !== s.id))
                }
              >
                <Trash2 className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

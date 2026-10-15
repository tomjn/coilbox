import { Button, Input, useSetting } from "@picoframe/frame";
import { Plus, Server, Swords, Trash2 } from "lucide-react";
import { Field } from "@/components/Field";
import { Switch } from "@/components/ui/switch";
import { AUTO_DOWNLOAD_ON_JOIN_KEY } from "../../multiplayer/battle/autoDownload";
import { useDownloadsConfig } from "../config";

/**
 * The downloads plugin's settings section (frame settings page at
 * `/settings/downloads`). Two concerns, both persisted immediately (no Save
 * button):
 *  - the list of rapid masters offered in the Browse Rapid / Games dropdowns
 *  - whether joining a battle fetches missing content on its own (issue #439)
 *
 * Where downloads are written is not here. It is chosen beside the folders
 * themselves, in the content plugin's Content folders page.
 *
 * The auto-download opt-out was a settings page of its own holding one switch,
 * which is not a page. It reads the multiplayer plugin's setting key, so the
 * behaviour stays with the battle code that acts on it and only the control
 * lives here, next to the other answers to "what does downloading do".
 *
 * Engine downloads live in the content plugin's Engines settings page (below the
 * engine list).
 */
export default function DownloadsSettings() {
  const [cfg, setCfg] = useDownloadsConfig();
  const [autoOnJoin, setAutoOnJoin] = useSetting<boolean>(
    AUTO_DOWNLOAD_ON_JOIN_KEY,
    true,
  );

  const addRepo = () =>
    setCfg({
      ...cfg,
      rapidRepos: [
        ...cfg.rapidRepos,
        { id: crypto.randomUUID(), name: "", url: "" },
      ],
    });
  const updateRepo = (id: string, key: "name" | "url", value: string) =>
    setCfg({
      ...cfg,
      rapidRepos: cfg.rapidRepos.map((r) =>
        r.id === id ? { ...r, [key]: value } : r,
      ),
    });
  const removeRepo = (id: string) =>
    setCfg({ ...cfg, rapidRepos: cfg.rapidRepos.filter((r) => r.id !== id) });

  return (
    <div className="space-y-8">
      {/* Rapid masters */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            <Server size={15} /> Rapid repositories
          </h2>
          <Button variant="outline" size="sm" onClick={addRepo}>
            <Plus /> Add repository
          </Button>
        </div>
        {cfg.rapidRepos.length === 0 ? (
          <p className="rounded-md border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
            No rapid repositories. Add one to browse and download games from it.
          </p>
        ) : (
          <ul className="space-y-2">
            {cfg.rapidRepos.map((r) => (
              <li key={r.id} className="flex items-end gap-2">
                <Field label="Name" className="flex-1">
                  <Input
                    value={r.name}
                    onChange={(e) => updateRepo(r.id, "name", e.target.value)}
                    placeholder="Beyond All Reason"
                  />
                </Field>
                <Field label="Master URL" className="flex-[2]">
                  <Input
                    value={r.url}
                    onChange={(e) => updateRepo(r.id, "url", e.target.value)}
                    placeholder="https://repos-cdn.beyondallreason.dev"
                    className="font-mono text-xs"
                  />
                </Field>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => removeRepo(r.id)}
                  aria-label={`Remove ${r.name || r.url || "repository"}`}
                >
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Joining a battle */}
      <section className="space-y-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          <Swords size={15} /> Joining a battle
        </h2>
        <label
          htmlFor="auto-download-on-join"
          className="flex items-center justify-between gap-4"
        >
          <span className="flex flex-col">
            <span className="text-sm font-medium">
              Download missing content automatically
            </span>
            <span className="text-xs text-muted-foreground">
              When you join a battle whose game or map you don't have, start the
              download straight away instead of waiting for a click. The
              Download button stays available to pause or retry.
            </span>
          </span>
          <Switch
            id="auto-download-on-join"
            checked={autoOnJoin}
            onCheckedChange={setAutoOnJoin}
          />
        </label>
      </section>
    </div>
  );
}

import { Button, Input, useDrawer } from "@picoframe/frame";
import { Plus, RefreshCw, X } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import type { LegoProject } from "@/lego/model";
import { loadPack } from "@/lego/pack";
import { useLegoProjects } from "@/lego/projects";
import { loadRawGeometryIfAny } from "@/lego/rawGeometry";
import { useModProjects } from "@/workshop/project";
import type { Campaign } from "../../model";
import {
  attachRefusal,
  attachUnit,
  detachCopy,
  libraryChanged,
  type UnitSource,
  type UnitsOwner,
  updateUnit,
  withoutUnit,
  withUnit,
} from "../../units";

/**
 * The unit builder's saved units, so one can be attached. A unit already
 * attached, or one that cannot be, is shown with the reason and cannot be
 * picked. `onLeave` runs when the link to the builder takes the player away.
 */
export function UnitPickerList({
  owner,
  projects,
  onPick,
  onLeave,
}: {
  owner: Pick<UnitsOwner, "units">;
  projects: LegoProject[];
  onPick: (project: LegoProject) => void;
  onLeave?: () => void;
}) {
  const [query, setQuery] = useState("");
  const attached = new Set((owner.units ?? []).map((u) => u.projectId));
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return projects.filter(
      (p) =>
        !q ||
        p.name.toLowerCase().includes(q) ||
        p.unitName.toLowerCase().includes(q),
    );
  }, [projects, query]);

  if (projects.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No saved units yet. Build one in the{" "}
        <Link
          className="font-medium underline underline-offset-4"
          to="/lego"
          onClick={onLeave}
        >
          unit builder
        </Link>
        .
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search units…"
        className="h-8"
      />
      <ul className="flex max-h-72 flex-col gap-1.5 overflow-y-auto">
        {filtered.map((p) => {
          const refusal = attached.has(p.id)
            ? "Already attached"
            : attachRefusal(owner, p);
          return (
            <li key={p.id}>
              <button
                type="button"
                disabled={!!refusal}
                onClick={() => onPick(p)}
                className="flex w-full flex-col gap-0.5 rounded-md border border-border/50 bg-card p-3 text-left enabled:hover:border-border enabled:hover:bg-muted/40 disabled:opacity-60"
              >
                <span className="truncate text-sm font-medium">{p.name}</span>
                <span className="truncate font-mono text-xs text-muted-foreground">
                  {p.unitName}
                </span>
                {refusal && (
                  <span className="text-xs text-muted-foreground">
                    {refusal}
                  </span>
                )}
              </button>
            </li>
          );
        })}
        {filtered.length === 0 && (
          <li className="text-xs text-muted-foreground">No units match.</li>
        )}
      </ul>
    </div>
  );
}

/**
 * Drawer body listing the unit builder's saved units, so one can be attached
 * to the campaign. Picking one hands it back and closes.
 */
export function UnitPickerDrawer({
  campaign,
  projects,
  onPick,
}: {
  campaign: Campaign;
  projects: LegoProject[];
  onPick: (project: LegoProject) => void;
}) {
  const drawer = useDrawer();
  return (
    <UnitPickerList
      owner={campaign}
      projects={projects}
      onPick={(project) => {
        onPick(project);
        drawer.close();
      }}
      onLeave={() => drawer.close()}
    />
  );
}

/**
 * The campaign's units from the unit builder (issue #4516). Each is a copy,
 * taken when it is attached and changed only by Update from library.
 *
 * `onChange` is handed a change rather than a document, because a copy takes a
 * moment to build and the page's document may have moved on by the time it is
 * stored.
 */
export function CampaignUnits({
  campaign,
  onChange,
}: {
  campaign: Campaign;
  onChange: (change: (c: Campaign) => Campaign) => Promise<void>;
}) {
  const drawer = useDrawer();
  const { projects } = useLegoProjects();
  const { projects: workshopProjects } = useModProjects();
  /** The project id or unit name being worked on, with what is happening. */
  const [busy, setBusy] = useState<{ key: string; label: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const units = campaign.units ?? [];

  const source = async (project: LegoProject): Promise<UnitSource> => ({
    project,
    pack: await loadPack(),
    raw: await loadRawGeometryIfAny(project.id),
    workshopProjects,
  });

  const work = async (
    key: string,
    label: string,
    task: () => Promise<void>,
  ) => {
    setBusy({ key, label });
    setError(null);
    try {
      await task();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const attach = (project: LegoProject) =>
    work(project.id, `Copying ${project.name}…`, async () => {
      const unit = await attachUnit(campaign, await source(project));
      await onChange((c) => withUnit(c, unit));
    });

  const update = (project: LegoProject) =>
    work(project.id, `Copying ${project.name}…`, async () => {
      const { unit, replaces } = await updateUnit(
        campaign,
        await source(project),
      );
      await onChange((c) => withUnit(c, unit));
      if (replaces) await detachCopy(campaign.id, replaces);
    });

  const remove = (unitName: string, name: string) =>
    work(unitName, `Removing ${name}…`, async () => {
      await onChange((c) => withoutUnit(c, unitName));
      await detachCopy(campaign.id, unitName);
    });

  const openPicker = () =>
    drawer.open({
      title: "Attach a unit",
      width: "32rem",
      content: (
        <UnitPickerDrawer
          campaign={campaign}
          projects={projects}
          onPick={(project) => void attach(project)}
        />
      ),
    });

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold">Units ({units.length})</h2>
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5"
          disabled={!!busy}
          onClick={openPicker}
        >
          <Plus className="size-4" /> Attach unit
        </Button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      {busy && <p className="text-xs text-muted-foreground">{busy.label}</p>}
      {units.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {units.map((u) => {
            const project = projects.find((p) => p.id === u.projectId);
            const status = !project
              ? "Not in the library"
              : libraryChanged(u, project)
                ? "Changed in the library"
                : null;
            return (
              <li
                key={u.unitName}
                className="flex items-center gap-3 rounded-md border border-border/50 bg-card px-3 py-2"
              >
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm font-medium">{u.name}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    <span className="font-mono">{u.unitName}</span>
                    {status && ` · ${status}`}
                  </span>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5"
                  disabled={!project || !!busy}
                  onClick={() => project && void update(project)}
                >
                  <RefreshCw className="size-4" /> Update from library
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`Remove ${u.name}`}
                  disabled={!!busy}
                  onClick={() => void remove(u.unitName, u.name)}
                >
                  <X className="size-4" />
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

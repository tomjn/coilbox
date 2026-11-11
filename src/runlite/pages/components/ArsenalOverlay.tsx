import { useLingui } from "@lingui/react/macro";
import { Wrench } from "lucide-react";
import { useEffect, useMemo } from "react";
import type { UnitDatasetEntry } from "@/content/bindings";
import { buildPicMissing } from "@/content/buildPicMissing";
import { useUnitsyncUnitBuildpics } from "@/content/config";
import { classifyUnit, type UnitCategory } from "@/content/unitCategory";
import { unitIconSrc } from "@/content/unitIcon";
import { BackToMapButton } from "../../../conquest/pages/components/BackToMapButton";
import { BracketFrame } from "../../../conquest/pages/components/hudChrome";

type Group =
  | "factory"
  | "builder"
  | "offence"
  | "defence"
  | "economy"
  | "intelligence"
  | "other";

const GROUP_ORDER: Group[] = [
  "factory",
  "builder",
  "offence",
  "defence",
  "economy",
  "intelligence",
  "other",
];

function groupOf(category: UnitCategory): Group {
  return category === "transport" || category === "unclassified"
    ? "other"
    : category;
}

/**
 * The units the player can build now, as large build pictures under their
 * display names, grouped by role. Chrome matches the node overlays: a backdrop
 * button closes it, and so does Escape.
 */
export function ArsenalOverlay({
  units,
  unlocked,
  total,
  enginePath,
  dataDir,
  gameArchive,
  onClose,
}: {
  /** The faction's arsenal, which this narrows to what is unlocked. */
  units: UnitDatasetEntry[];
  /** The run's unlocked unit names. */
  unlocked: string[];
  /** The faction's whole arsenal size, when known. */
  total?: number;
  enginePath?: string;
  dataDir?: string;
  gameArchive?: string;
  onClose: () => void;
}) {
  const { t } = useLingui();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const buildable = useMemo(() => {
    const have = new Set(unlocked.map((u) => u.toLowerCase()));
    return units.filter((u) => have.has(u.name.toLowerCase()));
  }, [units, unlocked]);
  const ids = useMemo(
    () => buildable.map((u) => u.name.toLowerCase()),
    [buildable],
  );
  const pics = useUnitsyncUnitBuildpics(enginePath, dataDir, gameArchive, ids);
  const picsPending =
    !pics && ids.length > 0 && !!enginePath && !!dataDir && !!gameArchive;

  const groups = useMemo(() => {
    const byGroup = new Map<Group, UnitDatasetEntry[]>();
    for (const u of buildable) {
      const g = groupOf(classifyUnit(u));
      byGroup.set(g, [...(byGroup.get(g) ?? []), u]);
    }
    const label = (u: UnitDatasetEntry) => u.fullName?.trim() || u.name;
    return GROUP_ORDER.flatMap((g) => {
      const list = byGroup.get(g);
      return list
        ? [
            {
              group: g,
              units: [...list].sort((a, b) => label(a).localeCompare(label(b))),
            },
          ]
        : [];
    });
  }, [buildable]);

  const heading = (g: Group): string => {
    switch (g) {
      case "factory":
        return t`Factories`;
      case "builder":
        return t`Builders`;
      case "offence":
        return t`Offence`;
      case "defence":
        return t`Defence`;
      case "economy":
        return t`Economy`;
      case "intelligence":
        return t`Intelligence`;
      case "other":
        return t`Other`;
    }
  };

  const count = total
    ? `${buildable.length} / ${total}`
    : `${buildable.length}`;

  return (
    <div
      role="dialog"
      aria-label={t`Arsenal`}
      className="absolute inset-0 z-20 flex items-center justify-center bg-background/60 p-4 backdrop-blur-sm"
    >
      <button
        type="button"
        aria-label={t`Back to map`}
        onClick={onClose}
        className="absolute inset-0 cursor-default"
      />
      <BracketFrame className="flex max-h-full w-[60rem] max-w-full flex-col gap-3 p-5">
        <BackToMapButton
          onClick={onClose}
          className="absolute right-full top-0 mr-4"
        />
        <header className="flex items-center justify-between gap-3">
          <h1 className="flex items-center gap-2 font-display text-lg font-semibold uppercase tracking-wide">
            <Wrench className="size-5 text-muted-foreground" aria-hidden />
            {t`Arsenal`}
          </h1>
          <span className="font-mono text-sm tabular-nums text-muted-foreground">
            {count}
          </span>
        </header>
        <div className="flex min-h-0 flex-wrap content-start gap-x-8 gap-y-4 overflow-y-auto pr-1">
          {groups.map(({ group, units: list }) => (
            <section key={group} className="flex flex-col gap-2">
              <h2 className="font-display text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {heading(group)} ({list.length})
              </h2>
              <ul className="flex flex-wrap gap-2">
                {list.map((u) => (
                  <li
                    key={u.name}
                    className="flex w-20 flex-col items-center gap-1 text-center"
                  >
                    <BuildPic
                      display={pics?.units[u.name.toLowerCase()]}
                      pending={picsPending}
                    />
                    <span className="text-[11px] leading-tight">
                      {u.fullName?.trim() || u.name}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </BracketFrame>
    </div>
  );
}

/** A 64px build picture, a pulsing box while the pictures load, or a labelled box when the game has none. */
function BuildPic({
  display,
  pending,
}: {
  display?: Parameters<typeof unitIconSrc>[0];
  pending: boolean;
}) {
  const box = "size-16 shrink-0 rounded";
  const src = unitIconSrc(display);
  if (src) {
    return (
      <img
        src={src}
        alt=""
        loading="lazy"
        className={`${box} object-contain`}
      />
    );
  }
  if (pending) {
    return <span aria-hidden className={`${box} animate-pulse bg-muted`} />;
  }
  const missing = buildPicMissing(display);
  return (
    <span
      title={missing.title}
      className={`${box} flex items-center justify-center bg-muted p-1 text-center text-[0.6rem] leading-tight text-muted-foreground`}
    >
      {missing.label}
    </span>
  );
}

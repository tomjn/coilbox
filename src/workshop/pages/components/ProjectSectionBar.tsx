/**
 * The open project's sections, one click each (issue #3111): Units, Weapons,
 * Collections, Checks and Package, each a page with its own URL.
 *
 * A tab bar under the project title rather than a rail down the side. The
 * Units section already spends the left of the page on its unit list, so a
 * rail would be a third column squeezing the field editor, where a bar costs
 * one short row. Links rather than `Tabs`, because each entry is a route:
 * the browser's back button, a copied URL and a middle click all work, and
 * the unit editor's own Fields, Weapons and Explosions tabs keep the `tab`
 * role to themselves.
 *
 * `tools` sits at the right-hand end of the row, for the things that act
 * across many units without being a section: the reference table, which is a
 * page of its own, and batch edit until issue #3113 folds it into that table.
 */
import { cn } from "@picoframe/frame";
import {
  Crosshair,
  FolderTree,
  type LucideIcon,
  Package,
  ShieldCheck,
  SquareStack,
} from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { PROJECT_SECTIONS, type ProjectSection } from "../../routes";
import { ChecksBadge, type ProjectChecksState } from "./ProjectChecks";

const ICONS: Record<ProjectSection, LucideIcon> = {
  units: SquareStack,
  weapons: Crosshair,
  collections: FolderTree,
  checks: ShieldCheck,
  package: Package,
};

export function ProjectSectionBar({
  current,
  hrefOf,
  shown,
  counts,
  checks,
  tools,
}: {
  current: ProjectSection;
  /** Where each section is. The page decides, since Units carries the unit
   *  and tab you last had open and a project not started yet carries its
   *  game. */
  hrefOf: (section: ProjectSection) => string;
  /** Which sections to offer. A project not saved yet has nothing to
   *  package, so the page leaves Package out until it has. */
  shown: (section: ProjectSection) => boolean;
  /** A count beside a section's name, where there is one worth giving. */
  counts: Partial<Record<ProjectSection, number>>;
  /** The checks' verdict, for the Checks entry. Undefined while there is no
   *  game read to check against, which is when the header used to leave the
   *  checks button off too. */
  checks: ProjectChecksState | undefined;
  tools?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-2 border-b border-border">
      <nav aria-label="Project sections" className="-mb-px">
        <ul className="flex flex-wrap items-end gap-1">
          {PROJECT_SECTIONS.filter((s) => shown(s.id)).map(({ id, label }) => {
            const Icon = ICONS[id];
            const active = id === current;
            const count = counts[id];
            return (
              <li key={id}>
                <Link
                  to={hrefOf(id)}
                  aria-current={active ? "page" : undefined}
                  // The verdict joins the name, so a screen reader hears
                  // "Checks, 1 blocker found" rather than a bare icon.
                  aria-label={
                    id === "checks" && checks
                      ? `${label}, ${checks.summary}`
                      : undefined
                  }
                  title={id === "checks" ? checks?.summary : undefined}
                  className={cn(
                    "inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    active
                      ? "border-foreground text-foreground"
                      : "border-transparent text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Icon className="size-4 shrink-0" aria-hidden="true" />
                  {label}
                  {count !== undefined && count > 0 && (
                    <span className="text-xs font-normal text-muted-foreground">
                      {count}
                    </span>
                  )}
                  {id === "checks" && checks && <ChecksBadge checks={checks} />}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      {tools && <div className="flex items-center gap-2 pb-1.5">{tools}</div>}
    </div>
  );
}

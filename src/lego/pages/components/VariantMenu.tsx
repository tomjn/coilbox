/**
 * Make a heavier, lighter or different weapon variant of a generated unit
 * (issue #3240).
 *
 * The variant is saved as a new unit beside the original, which stays open and
 * as it was. A kind that cannot be made says why on its item.
 */

import { t } from "@lingui/core/macro";
import { Button } from "@picoframe/frame";
import { GitFork } from "lucide-react";
import { useMemo, useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { describeError } from "@/i18n/uiError";
import { notify } from "@/notify/notify";
import type { LegoProject } from "../../model";
import type { LoadedPack } from "../../pack";
import { saveProject } from "../../projects";
import { starterModules } from "../../starterModules";
import {
  makeVariant,
  VARIANT_KINDS,
  type VariantKind,
  variantRefusal,
} from "../../variant";

export function VariantMenu({
  project,
  pack,
  projects,
}: {
  project: LegoProject;
  pack: LoadedPack;
  /** The saved units, so the variant's name is a free one. */
  projects: readonly LegoProject[];
}) {
  const [busy, setBusy] = useState(false);
  const modules = useMemo(() => starterModules(pack), [pack]);

  async function make(kind: VariantKind) {
    setBusy(true);
    try {
      const result = makeVariant(project, kind, { pack, modules, projects });
      if (result.status === "failed") {
        void notify({
          title: t`Variant`,
          body: result.message,
          level: "error",
        });
        return;
      }
      const saved = await saveProject(result.unit);
      const name = saved.name;
      void notify({
        title: t`Variant`,
        body: t`Saved "${name}" beside this unit.`,
        level: "success",
      });
    } catch (error) {
      const reason = describeError(error);
      void notify({
        title: t`Variant`,
        body: t`Could not save the variant: ${reason}`,
        level: "error",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          aria-label={t`Make a variant`}
          title={t`Make a variant of this unit as a new unit`}
        >
          <GitFork size={14} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {VARIANT_KINDS.map((kind) => {
          const refusal = variantRefusal(project, kind.id, modules);
          return (
            <DropdownMenuItem
              key={kind.id}
              disabled={refusal !== null}
              title={refusal ?? undefined}
              onSelect={() => void make(kind.id)}
            >
              {kind.label}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

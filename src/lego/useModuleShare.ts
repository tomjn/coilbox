/**
 * Sharing a module (#3272): the drawer that shows its code and the hub, and
 * the import a shared code or a hub item lands on the parts page with.
 */

import { t } from "@lingui/core/macro";
import { useDrawer } from "@picoframe/frame";
import { createElement, useCallback, useEffect, useRef } from "react";
import { useImportParam } from "@/deeplink/useImportParam";
import { nextDrawerKey } from "@/general/drawerKey";
import { useRecordHubImport } from "@/hub/imports";
import { describeError } from "@/i18n/uiError";
import { notify } from "@/notify/notify";
import type { LegoProject } from "./model";
import { sharedModuleToSave } from "./moduleShare";
import type { LoadedPack } from "./pack";
import { saveCompound, useLegoCompounds } from "./projects";

/** Open the share drawer for a module. */
export function useShareModule(): (module: LegoProject) => void {
  const drawer = useDrawer();
  return useCallback(
    (module: LegoProject) => {
      const moduleName = module.name;
      void import("./pages/components/ShareModuleForm").then(
        ({ ShareModuleForm }) =>
          drawer.open({
            title: t`Share ${moduleName}`,
            width: "28rem",
            content: createElement(ShareModuleForm, {
              key: nextDrawerKey(),
              module,
            }),
          }),
      );
    },
    [drawer],
  );
}

/**
 * Add the module a shared code carries, once the pack has loaded or failed to
 * and the saved modules have loaded. `modules` is every module in the list,
 * built in ones included.
 */
export function useSharedModuleImport(
  pack: LoadedPack | null,
  packSettled: boolean,
  modules: LegoProject[],
): void {
  const param = useImportParam();
  const { loading } = useLegoCompounds();
  const recordHubImport = useRecordHubImport();
  // The param object, not the code, so the same link opened twice adds twice.
  const done = useRef<object | null>(null);
  const run = useRef<(code: string, hubItemId?: string) => void>(() => {});
  run.current = (code, hubItemId) => {
    const known = new Set((pack?.parts ?? []).map((part) => part.id));
    const read = sharedModuleToSave(code, modules, known, {
      id: crypto.randomUUID(),
      now: new Date().toISOString(),
    });
    if (!read.ok) {
      notify({
        title: t`Could not add the module`,
        body: read.reason,
        level: "error",
      });
      return;
    }
    void saveCompound(read.project).then(
      (saved) => {
        recordHubImport(hubItemId, [saved.id], "/lego/parts");
        const savedName = saved.name;
        const parts = read.missingParts.join(", ");
        notify(
          read.missingParts.length > 0
            ? {
                title: t`Added ${savedName}, with parts missing`,
                body: t`No installed pack has the parts for: ${parts}.`,
                level: "warning",
              }
            : { title: t`Added ${savedName}`, level: "success" },
        );
      },
      (error: unknown) =>
        notify({
          title: t`Could not add the module`,
          body: describeError(error),
          level: "error",
        }),
    );
  };

  const ready = packSettled && !loading;
  useEffect(() => {
    if (!param.code || !ready || done.current === param) return;
    done.current = param;
    run.current(param.code, param.hubItemId);
  }, [param, ready]);
}

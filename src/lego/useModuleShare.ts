/**
 * Sharing a module (#3272): the drawer that shows its code and the hub, and
 * the import a shared code or a hub item lands on the parts page with.
 */

import { useDrawer } from "@picoframe/frame";
import { createElement, useCallback, useEffect, useRef } from "react";

import { useImportParam } from "@/deeplink/useImportParam";
import { nextDrawerKey } from "@/general/drawerKey";
import { useRecordHubImport } from "@/hub/imports";
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
      void import("./pages/components/ShareModuleForm").then(
        ({ ShareModuleForm }) =>
          drawer.open({
            title: `Share ${module.name}`,
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
        title: "Could not add the module",
        body: read.reason,
        level: "error",
      });
      return;
    }
    void saveCompound(read.project).then(
      (saved) => {
        recordHubImport(hubItemId, [saved.id], "/lego/parts");
        notify(
          read.missingParts.length > 0
            ? {
                title: `Added ${saved.name}, with parts missing`,
                body: `No installed pack has the parts for: ${read.missingParts.join(", ")}.`,
                level: "warning",
              }
            : { title: `Added ${saved.name}`, level: "success" },
        );
      },
      (error: unknown) =>
        notify({
          title: "Could not add the module",
          body: error instanceof Error ? error.message : String(error),
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

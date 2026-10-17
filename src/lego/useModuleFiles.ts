/** The two module file actions as handlers for a page that shows the inventory. */

import { useMemo } from "react";

import { notify } from "@/notify/notify";
import type { LegoProject } from "./model";
import { loadModuleFromFile, saveModuleToFile } from "./moduleFileIo";
import type { LoadedPack } from "./pack";

export function useModuleFiles(
  pack: LoadedPack | null,
  modules: LegoProject[],
) {
  return useMemo(
    () => ({
      saveFile: (module: LegoProject) =>
        void saveModuleToFile(module).then((out) => out && notify(out)),
      loadFile: () => {
        const known = new Set((pack?.parts ?? []).map((part) => part.id));
        void loadModuleFromFile(modules, known).then(
          (out) => out && notify(out),
        );
      },
    }),
    [pack, modules],
  );
}

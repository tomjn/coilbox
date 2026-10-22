/**
 * Save a module to a file and load one from a file (issue #3307): the dialogs,
 * the disk and the store around the pure rules in moduleFile.ts.
 *
 * Each function returns the message to show, or null when the user cancelled.
 */

import { t } from "@lingui/core/macro";
import { ask, open, save } from "@tauri-apps/plugin-dialog";
import { describeError } from "@/i18n/uiError";

import type { NotifyInput } from "@/notify/notify";
import { legoReadTextFile, legoWriteTextFile } from "./bindings";
import type { LegoProject } from "./model";
import {
  needsChoice,
  parseModuleFile,
  resolveLoad,
  serializeModuleFile,
} from "./moduleFile";
import { saveCompound } from "./projects";

const filters = () => [{ name: t`Coilbox module`, extensions: ["json"] }];

function message(error: unknown): string {
  return describeError(error);
}

/** Ask where, then write the module there. */
export async function saveModuleToFile(
  module: LegoProject,
): Promise<NotifyInput | null> {
  const target = await save({
    title: t`Save the module`,
    defaultPath: `${module.name}.coilbox-module.json`,
    filters: filters(),
  });
  if (typeof target !== "string") return null;
  try {
    await legoWriteTextFile({
      path: target,
      text: serializeModuleFile(module),
    });
  } catch (error) {
    return {
      title: t`Could not save the module`,
      body: message(error),
      level: "error",
    };
  }
  const name = module.name;
  return { title: t`Saved ${name}`, body: target, level: "success" };
}

/**
 * Ask which file, check it, and add it to the user's modules. `existing` is
 * every module in the list, built in ones included.
 */
export async function loadModuleFromFile(
  existing: LegoProject[],
  knownPartIds: ReadonlySet<string>,
): Promise<NotifyInput | null> {
  const picked = await open({
    title: t`Load a module`,
    multiple: false,
    directory: false,
    filters: filters(),
  });
  if (typeof picked !== "string") return null;

  const failed = (body: string): NotifyInput => ({
    title: t`Could not load the module`,
    body,
    level: "error",
  });

  let text: string;
  try {
    text = (await legoReadTextFile({ path: picked })).text;
  } catch (error) {
    return failed(message(error));
  }
  const parsed = parseModuleFile(text, knownPartIds);
  if (!parsed.ok) return failed(parsed.reason);

  const { project, missingParts } = parsed.piece;
  const installedName = project.name;
  const replace = needsChoice(project, existing)
    ? await ask(
        t`A module with this id is already installed: ${installedName}.`,
        {
          title: t`Load a module`,
          okLabel: t`Replace`,
          cancelLabel: t`Keep both`,
        },
      )
    : false;
  const toSave = resolveLoad(
    project,
    existing,
    replace ? "replace" : "keep-both",
    { id: crypto.randomUUID(), now: new Date().toISOString() },
  );
  try {
    await saveCompound(toSave);
  } catch (error) {
    return failed(message(error));
  }

  const loadedName = toSave.name;
  if (missingParts.length > 0) {
    const parts = missingParts.join(", ");
    return {
      title: t`Loaded ${loadedName}, with parts missing`,
      body: t`No installed pack has the parts for: ${parts}.`,
      level: "warning",
    };
  }
  return { title: t`Loaded ${loadedName}`, level: "success" };
}

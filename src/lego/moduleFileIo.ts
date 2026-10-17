/**
 * Save a module to a file and load one from a file (issue #3307): the dialogs,
 * the disk and the store around the pure rules in moduleFile.ts.
 *
 * Each function returns the message to show, or null when the user cancelled.
 */

import { ask, open, save } from "@tauri-apps/plugin-dialog";

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

const FILTERS = [{ name: "Coilbox module", extensions: ["json"] }];

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Ask where, then write the module there. */
export async function saveModuleToFile(
  module: LegoProject,
): Promise<NotifyInput | null> {
  const target = await save({
    title: "Save the module",
    defaultPath: `${module.name}.coilbox-module.json`,
    filters: FILTERS,
  });
  if (typeof target !== "string") return null;
  try {
    await legoWriteTextFile({
      path: target,
      text: serializeModuleFile(module),
    });
  } catch (error) {
    return {
      title: "Could not save the module",
      body: message(error),
      level: "error",
    };
  }
  return { title: `Saved ${module.name}`, body: target, level: "success" };
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
    title: "Load a module",
    multiple: false,
    directory: false,
    filters: FILTERS,
  });
  if (typeof picked !== "string") return null;

  const failed = (body: string): NotifyInput => ({
    title: "Could not load the module",
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
  const replace = needsChoice(project, existing)
    ? await ask(
        `A module with this id is already installed: ${project.name}.`,
        {
          title: "Load a module",
          okLabel: "Replace",
          cancelLabel: "Keep both",
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

  if (missingParts.length > 0) {
    return {
      title: `Loaded ${toSave.name}, with parts missing`,
      body: `No installed pack has the parts for: ${missingParts.join(", ")}.`,
      level: "warning",
    };
  }
  return { title: `Loaded ${toSave.name}`, level: "success" };
}

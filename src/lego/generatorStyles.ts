/**
 * The saved generator styles (#3237): the list in the app's settings, and a
 * style saved to or loaded from a file of its own.
 *
 * Every write folds over what is stored rather than over the list this render
 * holds, for the reason `updateStoredSetting` gives.
 */

import { t } from "@lingui/core/macro";
import { useSetting } from "@picoframe/frame";
import { open, save } from "@tauri-apps/plugin-dialog";
import { useMemo } from "react";
import { describeError } from "@/i18n/uiError";
import { updateStoredSetting } from "@/lib/storedSetting";
import type { NotifyInput } from "@/notify/notify";

import { legoReadTextFile, legoWriteTextFile } from "./bindings";
import {
  freeStyleName,
  GENERATOR_STYLES_KEY,
  type GeneratorStyle,
  parseStyleFile,
  parseStyles,
  serializeStyleFile,
  withCopy,
  withStyle,
} from "./generatorStyle";

export function useGeneratorStyles() {
  const [stored, setStored] = useSetting<unknown>(GENERATOR_STYLES_KEY, []);
  const styles = useMemo(() => parseStyles(stored), [stored]);

  const write = (change: (prev: GeneratorStyle[]) => GeneratorStyle[]) =>
    updateStoredSetting<unknown>(GENERATOR_STYLES_KEY, [], setStored, (prev) =>
      change(parseStyles(prev)),
    );

  /** Add a style with nothing chosen yet, and return its id. */
  function create(): string {
    const id = crypto.randomUUID();
    write((prev) => [
      ...prev,
      { id, name: freeStyleName(t`New style`, prev), shapes: [] },
    ]);
    return id;
  }

  /** Add a copy of `style` under a new id and name, and return the id. A
   *  loaded file comes in this way too, so it never replaces a saved style. */
  function copy(style: GeneratorStyle): string {
    const id = crypto.randomUUID();
    write((prev) => withCopy(prev, style, id));
    return id;
  }

  const update = (style: GeneratorStyle) =>
    write((prev) => withStyle(prev, style));
  const remove = (id: string) =>
    write((prev) => prev.filter((s) => s.id !== id));

  return { styles, create, copy, update, remove };
}

const filters = () => [{ name: t`Coilbox style`, extensions: ["json"] }];

/** Ask where, then write the style there. Null when the user cancelled. */
export async function saveStyleToFile(
  style: GeneratorStyle,
): Promise<NotifyInput | null> {
  const target = await save({
    title: t`Save the style`,
    defaultPath: `${style.name}.coilbox-style.json`,
    filters: filters(),
  });
  if (typeof target !== "string") return null;
  try {
    await legoWriteTextFile({ path: target, text: serializeStyleFile(style) });
  } catch (error) {
    return {
      title: t`Could not save the style`,
      body: describeError(error),
      level: "error",
    };
  }
  const name = style.name;
  return { title: t`Saved ${name}`, body: target, level: "success" };
}

/** Ask which file and read the style in it. Null when the user cancelled. */
export async function loadStyleFromFile(): Promise<
  { style: GeneratorStyle } | { failed: NotifyInput } | null
> {
  const picked = await open({
    title: t`Load a style`,
    multiple: false,
    directory: false,
    filters: filters(),
  });
  if (typeof picked !== "string") return null;
  const failed = (body: string) => ({
    failed: {
      title: t`Could not load the style`,
      body,
      level: "error" as const,
    },
  });
  let text: string;
  try {
    text = (await legoReadTextFile({ path: picked })).text;
  } catch (error) {
    return failed(describeError(error));
  }
  const style = parseStyleFile(text);
  return style ? { style } : failed(t`This file is not a coilbox style.`);
}

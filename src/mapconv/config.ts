import { useSetting } from "@picoframe/frame";
import type { Config } from "./bindings";

/** Default config: no remembered dirs yet, "no compression" default, remember on. */
export const defaultConfig: Config = {
  defaultCompressionType: 1,
  rememberDirs: true,
};

/**
 * The plugin's config, persisted through the frame settings store (Tauri-backed)
 * under a single key. Reactive: the Compile/Decompile pages and the settings
 * section stay in sync.
 */
export function useMapconvConfig() {
  return useSetting<Config>("mapconv.config", defaultConfig);
}

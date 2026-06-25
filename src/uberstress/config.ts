import { useSetting } from "@picoframe/frame";
import type { Config } from "./bindings";

/** Default config: empty server list, uberstress's own flag defaults elsewhere. */
export const defaultConfig: Config = {
  servers: [],
  bench: {
    serverDir: "",
    serverPython: "",
    port: 8300,
    natport: 8301,
    db: {
      driver: "mysql+pymysql",
      host: "127.0.0.1",
      port: 3306,
      user: "root",
      password: "root",
      name: "uberstress_ab",
      mysqlBin: "mysql",
    },
    dbReset: true,
  },
  defaults: {
    scenario: "login-storm",
    conns: 100,
    duration: "30s",
    ramp: "10s",
  },
};

/**
 * The plugin's config, persisted through the frame settings store (Tauri-backed)
 * under a single key. Reactive: the Run page and the settings section stay in
 * sync. Replaces the old us_config_get/set Rust commands.
 */
export function useUberstressConfig() {
  return useSetting<Config>("uberstress.config", defaultConfig);
}

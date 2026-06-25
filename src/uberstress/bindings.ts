import { defineCommand } from "@picoframe/plugin-sdk";
import type { Channel } from "@tauri-apps/api/core";

/**
 * Typed bindings to `plugin:coilbox-uberstress|*`. The first `defineCommand`
 * argument is the Tauri ACL identifier (crate name minus `tauri-plugin-`).
 * Argument keys are camelCase; Tauri maps them to the crate's snake_case params,
 * and nested objects (RunOpts, Config) use serde `rename_all = "camelCase"`.
 */

/** Latency summary for one command type (mirrors uberstress's on-disk JSON). */
export interface CmdStat {
  command: string;
  count: number;
  /** Failed attempts of this command. Absent on reports saved before this field existed. */
  error_count?: number;
  p50_ms: number;
  p95_ms: number;
  p99_ms: number;
  max_ms: number;
  per_second: number;
}

/** A full saved run report. */
export interface Report {
  scenario: string;
  addr: string;
  ref?: string;
  commit_sha?: string;
  server_version?: string;
  params?: Record<string, string>;
  started_at: string;
  duration_sec: number;
  commands: CmdStat[];
  counters: Record<string, number>;
}

/** Condensed history row (camelCase, from ReportSummary). */
export interface ReportSummary {
  file: string;
  scenario: string;
  gitRef?: string;
  commitSha?: string;
  serverVersion?: string;
  startedAt: string;
  durationSec: number;
  loginP99Ms?: number;
  pingP99Ms?: number;
  errorCount: number;
}

export interface Server {
  id: string;
  name: string;
  addr: string;
}

export interface DbConfig {
  driver: string;
  host: string;
  port: number;
  user: string;
  password: string;
  name: string;
  mysqlBin: string;
}

export interface BenchConfig {
  serverDir: string;
  serverPython: string;
  port: number;
  natport: number;
  db: DbConfig;
  dbReset: boolean;
}

export interface Defaults {
  scenario: string;
  conns: number;
  duration: string;
  ramp: string;
}

export interface Config {
  servers: Server[];
  bench: BenchConfig;
  defaults: Defaults;
}

/** One streamed output line from a run. */
export interface LogLine {
  stream: "out" | "err";
  line: string;
}

/** A run request. `mode` selects the uberstress subcommand. */
export interface RunOpts {
  mode: "load" | "bench";
  addr: string;
  scenario: string;
  conns: number;
  duration: string;
  ramp: string;
  register: boolean;
  userPrefix?: string;
  password?: string;
  channel?: string;
  channels?: number;
  sayInterval?: string;
  battleHosts?: number;
  pingers?: number;
  pingInterval?: string;
  refLabel?: string;
  // bench-only
  launch?: boolean;
  serverDir?: string;
  serverPython?: string;
  port?: number;
  natport?: number;
  readyTimeout?: string;
  compareTo?: string;
  db?: DbConfig;
  dbReset?: boolean;
}

export const usScenarios = defineCommand<undefined, { scenarios: string[] }>(
  "coilbox-uberstress",
  "us_scenarios",
);

export const usRun = defineCommand<
  { opts: RunOpts; runId: string; onLog: Channel<LogLine> },
  { reportFile: string; report: Report }
>("coilbox-uberstress", "us_run");

export const usCancel = defineCommand<
  { runId: string },
  { cancelled: boolean }
>("coilbox-uberstress", "us_cancel");

export const usHistory = defineCommand<undefined, { runs: ReportSummary[] }>(
  "coilbox-uberstress",
  "us_history",
);

export const usReport = defineCommand<{ file: string }, { report: Report }>(
  "coilbox-uberstress",
  "us_report",
);

/** Whole settings map (opaque JSON-encoded string values), for the frame's SettingsStorage. */
export const usSettingsLoad = defineCommand<
  undefined,
  { entries: Record<string, string> }
>("coilbox-uberstress", "us_settings_load");

export const usSettingsSave = defineCommand<
  { entries: Record<string, string> },
  Record<string, never>
>("coilbox-uberstress", "us_settings_save");

export const usSeedSql = defineCommand<
  { count: number; prefix?: string; password?: string },
  { sql: string }
>("coilbox-uberstress", "us_seed_sql");

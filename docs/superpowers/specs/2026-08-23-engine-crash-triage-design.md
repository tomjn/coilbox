# Engine crash triage

2026-08-23. Design for issue #379: when the engine exits abnormally, show the player what happened instead of closing the window and leaving them guessing.

Every engine fact below was read out of the RecoilEngine checkout, cited by file and line, and the write-dir claim was checked against this machine's disk rather than recalled.

## What is wrong today

A game that crashes and a game that ends look identical from inside coilbox. `play_launch` resolves, `PlayProvider` clears the run, the badge disappears, and nothing says the engine died. The player is left with an app that looks like it did nothing.

Two things have to be fixed before any of that can be shown.

**Coilbox reports a crash as a clean exit.** `launch_blocking` flattens the exit status with `code.unwrap_or(0)` (`crates/tauri-plugin-coilbox-play/src/lib.rs:141`). A segfault kills the process by signal, `ExitStatus::code()` returns `None`, and the launch resolves `{ exitCode: 0 }`, which is indistinguishable from quitting normally. The exact failure this issue exists for is the one currently reported as success.

**The log is not where the issue says it is.** The issue assumes `infolog.txt` lands in the data root. It does not.

`CLogOutput::CreateFilePath` writes the log into the process's current working directory:

```cpp
return (FileSystem::EnsurePathSepAtEnd(FileSystem::GetCwd()) + fileName);
```

(`LogOutput.cpp:135-138`, with `fileName` set to `infolog.txt` in the constructor at `:125`.) `DataDirLocater::ChangeCwdToWriteDir` chdirs to the write dir before that happens (`DataDirLocater.cpp:491-498`), so the log follows the write dir.

The write dir is not the one coilbox names. Coilbox sets `SPRING_DATADIR` and nothing else (`lib.rs:110`, `launch.rs:6-14` is always called with `write_dir: None`). `SPRING_DATADIR` is a LEVEL 3 data dir, added after the home dirs (`DataDirLocater.cpp:419-440`), `FindWriteableDataDir` takes the first writable entry (`:248-260`), and `IsWriteableDir` *creates* a missing candidate rather than skipping it (`:238-246`). On unix `~/.config/spring` is added before `~/.spring` (`:317-321`), so it always wins.

The proof is on this machine. `~/.config/spring/infolog.txt` was written on 21 August. The copy inside the coilbox content root, `~/.spring/infolog.txt`, is from 4 August. Line 3 of the newer file says it outright:

```
[t=00:00:00.006086] [DataDirLocater::FindWriteableDataDir] using writeable data-directory "/Users/tomjn/.config/spring/"
```

## Engine facts this is built on

| Fact | Source |
| --- | --- |
| `infolog.txt` is written to the process cwd | `LogOutput.cpp:125`, `:135-138` |
| The engine chdirs to its write dir before logging | `DataDirLocater.cpp:491-498` |
| `SPRING_WRITEDIR` is LEVEL 1, ahead of everything | `DataDirLocater.cpp:400-409` |
| Unix home candidates are `$XDG_CONFIG_HOME/spring` then `~/.spring`, in that order | `DataDirLocater.cpp:317-321` |
| Windows home candidates are `Documents/My Games/Spring`, `Documents/Spring`, `%ProgramData%/Applications/Spring` | `DataDirLocater.cpp:292-316` |
| `SPRING_DATADIR` is LEVEL 3, behind the home dirs | `DataDirLocater.cpp:430-440` |
| A missing candidate dir is created, not skipped, so the first one always wins | `DataDirLocater.cpp:238-246` |
| A log line's level prefix is written only above `Notice`, behind an optional `[Section]` | `DefaultFormatter.cpp:52-64` |
| The level names are `Debug`, `Info`, `Notice`, `Deprecated`, `Warning`, `Error`, `Fatal` | `LogUtil.c:8-20` |
| The crash handler logs its stack trace at `Error` level | `Linux/CrashHandler.cpp:778`, `:785-787` |

That last pair is what makes highlighting cheap. A crash trace is already `Error:`-prefixed, so one line classifier covers both ordinary errors and the stack trace.

## Scope

In: telling a crash from a clean exit, finding the right log, showing it after an abnormal exit, and reaching it on demand from settings.

Out, and each worth its own issue:

- Pinning `--write-dir` to the content root. It would make the write dir deterministic, but it relocates the player's engine config, keybinds and LuaUI settings, so games would suddenly launch with defaults.
- The replay-detection drift that follows from the same cause. `tagFreshReplay` scans the content root for a fresh demo (`useSkirmishDebrief.ts:66-71`) while the engine writes demos beside its log. On a default install the skirmish debrief reports "no replay was found" every time.

## Part 1: honest exit status

`launch_blocking` returns an outcome instead of a flattened code:

```rust
struct ExitOutcome { code: Option<i32>, signal: Option<i32> }
```

`signal` comes from `std::os::unix::process::ExitStatusExt::signal()` on unix and is always `None` on Windows, which has no signals. `LaunchEvent::Exited` and the results of `play_launch`, `play_launch_replay` and `play_launch_save` all gain it.

`exitCode` keeps exactly its current meaning, so the callers that destructure `{ exitCode }` need no change.

The three states the frontend can now tell apart:

| Result | Meaning |
| --- | --- |
| `{ exitCode: 0, signal: null }` | clean exit |
| `{ exitCode: null, signal: null }` | cancelled, because `play_cancel` took the child out of the registry (`lib.rs:136`) |
| `{ signal: n }`, or `{ exitCode: n }` where n is nonzero | abnormal |

## Part 2: finding and reading the log

A new module, `crates/tauri-plugin-coilbox-play/src/infolog.rs`, and one new command:

```
play_infolog(dataDir: String, maxLines: usize) -> InfologTail
```

```rust
struct InfologTail {
    path: String,
    modified_ms: u64,
    total_lines: usize,
    lines: Vec<String>,   // the last `max_lines`
    truncated: bool,
}
```

It looks for `infolog.txt` in every dir the engine might have used and returns the one with the newest mtime. The candidate list mirrors the engine's own order:

1. `$SPRING_WRITEDIR`, inherited from coilbox's environment
2. `$XDG_CONFIG_HOME/spring` or `~/.config/spring`, then `~/.spring` (unix)
3. `Documents/My Games/Spring`, `Documents/Spring`, `%ProgramData%/Applications/Spring` (Windows)
4. the content root passed in as `dataDir`

`candidate_dirs(os, base, data_dir)` is pure and takes an injected `LogBaseDirs` built from environment variables, the same shape and for the same reason as `paths::candidate_roots` in the content crate. The ordering is the part worth testing, and it cannot be tested against a real home directory.

The command reports the newest log and its timestamp and makes no judgement about whether it belongs to a given run. The caller knows when its launch started, so the caller decides. That is what lets one command serve both the crash drawer and the settings page.

Reads decode lossily, so a log with a mangled byte still opens rather than failing at the point the player most needs it.

The command needs its name in `build.rs`'s `COMMANDS` and in `permissions/default.toml`, like every other command in the plugin.

## Part 3: pure frontend logic

`src/play/crash.ts`, matching the split the play module already uses between `debrief.ts` and `useSkirmishDebrief.ts`. Pure logic sits apart from the Tauri-calling orchestration, so it is directly testable without mocking plugin commands.

```ts
type ExitKind = "clean" | "cancelled" | "signal" | "failed";
classifyExit(o: { exitCode: number | null; signal: number | null }): ExitKind;
classifyLine(line: string): "error" | "warning" | "normal";
buildCrashReport(r: CrashReport): string;
```

`classifyLine` matches the engine's formatter rather than searching for the word "error" anywhere in the line. After the `[t=…]` or `[f=…]` stamp comes an optional `[Section]`, then the level and a colon, and only for levels above `Notice` (`DefaultFormatter.cpp:60-63`). `Error` and `Fatal` count as errors. `Warning` and `Deprecated` count as warnings. Everything else is normal, including a stack trace's unprefixed continuation lines.

Only an abnormal exit opens the drawer. A clean exit stays silent even when the log holds `Error:` lines, because the engine logs errors on a perfectly healthy run. A missing sound file is an error and is not a crash. Error markers drive the highlighting, not the appearing.

## Part 4: the crash drawer

`CrashDrawer`, a right-hand sheet built like `DebriefDrawer` (`play/pages/components/DebriefDrawer.tsx`), per the repo's preference for drawers over modal dialogs.

`PlayProvider` renders it beside `{children}` and opens it from `start()`. Every launch in the app funnels through that one function, so the drawer covers skirmish, campaign, conquest, warpath, replays, savegames, lobby battles, and the lego and scenario test runs, with no change at any call site.

The context comes from what `PlayProvider` already holds. `launch()` receives the `BattleConfig`, so `mapName` and `gameType` are to hand, and it receives the executable path. The engine version is in the log's own opening lines, so nothing has to be threaded through for it.

The drawer shows what exited and how, the game and map, the log path and when it was written, the tail with error lines in `text-destructive` and warnings in amber, a copy button, and a button that opens the log through `contentOpenPath`.

When the newest log predates the launch, the drawer says the engine wrote no log for this run and shows the exit status alone. An engine that dies before `CLogOutput::Initialize` leaves nothing behind, and a stale log from yesterday's session would be worse than no log, because it reads as evidence.

`buildCrashReport` produces plain text for pasting into Discord or a bug report: a header naming the exit status, run kind, game, map and log path, then every error and fatal line, then the last 60 lines. It is not trimmed to Discord's 2000 character limit, because a useful crash tail does not fit in one and silently cutting the trace would defeat the point.

## Part 5: the settings entry

A settings page under Engine Settings, `parent: "engine-settings"`, order 70, so it sits last, after Saved configs. It is the diagnostic rather than a setting, which is why it goes at the end. It is declared from `src/play/index.ts` into the group the content plugin owns, which is how other plugins already contribute there (`content/index.ts:42-44`).

Same viewer, no run context: the newest log, its path and timestamp, the highlighted tail, copy, and open. This is the "it worked yesterday" case the issue names. The log survives the session, so it is still readable the next morning.

## Testing

Rust, in `infolog.rs`:

- `candidate_dirs` ordering for each OS, from injected base dirs.
- Newest mtime wins across several `infolog.txt` files in temp dirs.
- A file shorter than `maxLines` returns every line with `truncated` false.
- A longer file returns the last `maxLines` with `truncated` true and an accurate `total_lines`.
- A file holding invalid UTF-8 still reads.

Rust, in `lib.rs`: `ExitOutcome` built from a real `ExitStatus`, for a clean exit and for a nonzero one.

`src/play/crash.test.ts`:

- Every `classifyExit` branch, including cancelled.
- `classifyLine` against real lines copied from a genuine log: a plain `[t=…]` line, a `[Section]` line, a `Warning:` line, an `Error:` line behind a section, and a stack trace continuation line.
- `buildCrashReport` includes the exit status, the log path, and the error lines.

`src/play/pages/components/CrashDrawer.dom.test.tsx`, with the `// @vitest-environment happy-dom` docblock the suite uses for React tests (`vitest.config.ts:17-19`):

- An abnormal exit renders the tail with the error line marked.
- A log older than the launch renders the no-log message instead of the tail.

## Verification

The engine cannot start on this machine, because it exits immediately with no OpenGL context, so a real crash cannot be produced end to end here. What can be checked directly, and will be:

- `play_infolog` finds `~/.config/spring/infolog.txt` rather than the content root's stale copy, which is the whole premise of Part 2.
- The drawer renders against that real log's content.

A live crash stays unverified, and the PR will say so.

//! Locate and run the bundled `pr-downloader` sidecar, plus pure parsers for its
//! human-readable output (it has no `--json` mode).
//!
//! The binary is bundled as a Tauri *resource folder* (`prdownloader/`), not an
//! `externalBin`: the Windows build is MinGW and loads libcurl/zlib/winpthread
//! DLLs from its own directory, so it must ship beside those DLLs (externalBin
//! copies only the lone binary — a clean Windows machine then hits
//! STATUS_DLL_NOT_FOUND). We resolve it under `resource_dir()/prdownloader/`
//! rather than going through the shell plugin, so the plugin's ACL grant stays
//! uniform with every other picoframe plugin (just `coilbox-downloads:default`,
//! no extra shell-execute scope).

use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

/// App resource dir, captured once at plugin setup (where the `AppHandle` is
/// available) so the handle-free `run_sidecar*` helpers can resolve the bundled
/// folder without threading an `AppHandle` through every command.
static RESOURCE_DIR: OnceLock<Option<PathBuf>> = OnceLock::new();

/// Directories of installed engines, each of which may hold its own
/// pr-downloader beside a complete, self-matched set of runtime DLLs (a Recoil
/// build ships pr-downloader next to `spring`). Registered from the frontend via
/// `dl_set_engine_dirs` and consulted on every resolve, so a freshly installed
/// engine is used without a restart. Preferred over the bundled bootstrap copy.
static ENGINE_DIRS: Mutex<Vec<PathBuf>> = Mutex::new(Vec::new());

/// Record the app resource dir at plugin setup. First write wins; later calls are
/// no-ops (there is only one resource dir per process).
pub fn set_resource_dir(dir: Option<PathBuf>) {
    let _ = RESOURCE_DIR.set(dir);
}

/// Replace the set of installed-engine directories to search for a bundled
/// pr-downloader. Called whenever the content roots / engines change.
pub fn set_engine_dirs(dirs: Vec<PathBuf>) {
    if let Ok(mut guard) = ENGINE_DIRS.lock() {
        *guard = dirs;
    }
}

/// First registered engine directory that actually contains a pr-downloader
/// binary named `name`, if any.
fn engine_sidecar(name: &str) -> Option<PathBuf> {
    let dirs = ENGINE_DIRS.lock().ok()?;
    dirs.iter().map(|d| d.join(name)).find(|c| c.exists())
}

/// Resolve the sidecar path (`.exe` suffix added on Windows), in priority order:
/// 1. `PRD_SIDECAR` env override (dev and tests);
/// 2. an installed engine's own pr-downloader (a complete, self-matched runtime);
/// 3. the bundled `prdownloader/` resource folder (bootstrap copy);
/// 4. next to the current executable (legacy/fallback layout).
pub fn resolve_sidecar() -> Option<PathBuf> {
    if let Ok(p) = std::env::var("PRD_SIDECAR") {
        if !p.is_empty() {
            return Some(PathBuf::from(p));
        }
    }
    let name = format!("pr-downloader{}", std::env::consts::EXE_SUFFIX);
    if let Some(p) = engine_sidecar(&name) {
        return Some(p);
    }
    if let Some(Some(dir)) = RESOURCE_DIR.get() {
        // The Windows installer tucks the resource folder into `.coilbox` to keep
        // the install root clean; fall back to the plain resource layout (macOS/
        // Linux, and if the move didn't run). The whole `prdownloader/` folder
        // moves together, so its sibling DLLs stay beside the binary.
        let tucked = dir.join(".coilbox").join("prdownloader").join(&name);
        if tucked.exists() {
            return Some(tucked);
        }
        let candidate = dir.join("prdownloader").join(&name);
        if candidate.exists() {
            return Some(candidate);
        }
    }
    let exe = std::env::current_exe().ok()?;
    let candidate = exe.parent()?.join(&name);
    candidate.exists().then_some(candidate)
}

/// Extract the version token from `pr-downloader --version` output, e.g.
/// `pr-downloader 0.7-767-g1b95b70 (macos_arm64)` -> `0.7-767-g1b95b70`. Falls
/// back to the first non-empty trimmed line when the expected shape is absent.
pub fn parse_version(output: &str) -> Option<String> {
    let line = output.lines().map(str::trim).find(|l| !l.is_empty())?;
    let rest = line.strip_prefix("pr-downloader ").unwrap_or(line);
    let token = rest.split_whitespace().next().unwrap_or(rest);
    Some(token.to_string())
}

/// Outcome of a download run: success flag plus a one-line human summary.
#[derive(Debug, Clone, PartialEq)]
pub struct DownloadOutcome {
    pub success: bool,
    pub message: String,
}

/// Interpret a finished `pr-downloader` download. Exit code is authoritative for
/// success; the message is the most relevant log line (it has no structured
/// output). `stdout`/`stderr` are searched together since pr-downloader logs to
/// both depending on level.
pub fn parse_download(stdout: &str, stderr: &str, exit_code: Option<i32>) -> DownloadOutcome {
    let combined: Vec<&str> = stdout
        .lines()
        .chain(stderr.lines())
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .collect();
    let contains = |needle: &str| {
        combined
            .iter()
            .rev()
            .find(|l| l.to_lowercase().contains(needle))
            .copied()
    };

    if exit_code == Some(0) {
        let message = contains("complete")
            .or_else(|| contains("download"))
            .map(str::to_string)
            .unwrap_or_else(|| "Download finished.".to_string());
        DownloadOutcome {
            success: true,
            message,
        }
    } else {
        let message = contains("error")
            .or_else(|| contains("failed"))
            .map(str::to_string)
            .unwrap_or_else(|| match exit_code {
                Some(c) => format!("pr-downloader exited with code {c}."),
                None => "pr-downloader was terminated.".to_string(),
            });
        DownloadOutcome {
            success: false,
            message,
        }
    }
}

use crate::progress::{percent, DownloadProgress};

/// pr-downloader's first word about unpacking an archive, and very nearly its
/// last. It prints this once, then one `extracting (<path>)` per file, then
/// `done`. None of those carries a byte count or a percentage.
///
/// The header is what coilbox reads, rather than the per-file lines, because one
/// line per file is a burst rather than a heartbeat: a real 18 MB engine printed
/// 223 of them in 657 milliseconds, and 638 of those milliseconds went on a
/// single file. The other 222 events tell a player nothing the first one has not
/// told them already.
const EXTRACT_START: &str = "extract():Extracting ";

/// Parse one line of pr-downloader stdout into a progress sample, or `None` when
/// the line carries no progress. Tolerant by design: matches a line containing a
/// `[Progress]`/`Progress` marker and an `NN%` token, and additionally captures a
/// `downloaded/total` byte pair when present (e.g.
/// `[Progress] 42% [===>   ] 123456/294000`).
///
/// The `%` is required as well as the word, because pr-downloader prints one
/// `extracting (<path>)` line per file in an archive, so any path with
/// "progress" in its name walks into the word match and comes back out with a
/// percentage scraped from whatever number the path happens to end in.
///
/// Unpacking is its own phase and is reported as one. `--download-engine`
/// downloads and unpacks the archive itself, and an engine is thousands of
/// files, so a transfer that ends at 100% followed by minutes of silence is the
/// unpacking rather than a download that died (issue #1826).
pub fn parse_progress_line(line: &str) -> Option<DownloadProgress> {
    if line.contains(EXTRACT_START) {
        // No bytes and no percentage because there are none to be had: this is
        // the absence of a measurement, not a measurement of zero, and both the
        // watchdog and the bar read it that way. See
        // [`DownloadProgress::is_measured`].
        return Some(DownloadProgress {
            phase: "extracting".into(),
            downloaded_bytes: 0,
            total_bytes: None,
            percent: None,
            bytes_per_sec: None,
        });
    }
    let lower = line.to_lowercase();
    if !lower.contains("progress") || !line.contains('%') {
        return None;
    }
    // Percent: the token immediately before a '%'.
    let pct = line.split('%').next().and_then(|head| {
        head.rsplit(|c: char| !(c.is_ascii_digit() || c == '.'))
            .find(|t| !t.is_empty())
            .and_then(|t| t.parse::<f64>().ok())
    })?;

    // Optional "downloaded/total" pair: first whitespace-delimited token of the
    // form <digits>/<digits>. Taking the first is safe rather than lucky:
    // pr-downloader has one progress format string, and the only other token in
    // it is a bar drawn from `=` and spaces.
    let pair = line.split_whitespace().find_map(|tok| {
        let (a, b) = tok.split_once('/')?;
        Some((a.parse::<u64>().ok()?, b.parse::<u64>().ok()?))
    });

    // A zero total is pr-downloader saying it does not know the size, not a
    // download of nothing: a rapid download served by streamer.cgi reports the
    // whole archive as `0/0`. Passing that on as a measured zero draws a
    // determinate bar pinned at 0% captioned "0 B of 0 B". Unknown draws the
    // indeterminate bar instead, which is what the app has for a size nobody
    // reported.
    let (downloaded, total) = match pair {
        Some((d, t)) => (d, (t > 0).then_some(t)),
        None => (0, None),
    };

    Some(DownloadProgress {
        phase: "downloading".into(),
        downloaded_bytes: downloaded,
        total_bytes: total,
        // Prefer a byte-derived percent when the pair carries a usable total.
        // Only a line with no pair at all falls back to the printed number,
        // because pr-downloader works its own percentage out from that same
        // total: the 0% beside `0/0` means "size unknown", not "nothing yet".
        percent: match pair {
            Some(_) => percent(downloaded, total),
            None => Some(pct.min(100.0)),
        },
        bytes_per_sec: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_version_token() {
        assert_eq!(
            parse_version("pr-downloader 0.7-767-g1b95b70 (macos_arm64)\n").as_deref(),
            Some("0.7-767-g1b95b70")
        );
    }

    #[test]
    fn version_falls_back_to_first_line() {
        assert_eq!(
            parse_version("\n  weird-output  \n").as_deref(),
            Some("weird-output")
        );
    }

    #[test]
    fn version_empty_is_none() {
        assert_eq!(parse_version("   \n\n"), None);
    }

    #[test]
    fn download_success_picks_complete_line() {
        let out = "[Progress] 50%\nDownload complete!\n";
        let o = parse_download(out, "", Some(0));
        assert!(o.success);
        assert_eq!(o.message, "Download complete!");
    }

    #[test]
    fn download_success_without_complete_line_has_default() {
        let o = parse_download("[Info] some chatter\n", "", Some(0));
        assert!(o.success);
        assert_eq!(o.message, "Download finished.");
    }

    #[test]
    fn download_failure_picks_error_line() {
        let err = "Failed to find 'nope' for download\n";
        let o = parse_download("", err, Some(1));
        assert!(!o.success);
        assert_eq!(o.message, "Failed to find 'nope' for download");
    }

    #[test]
    fn download_failure_without_error_line_reports_code() {
        let o = parse_download("", "", Some(3));
        assert!(!o.success);
        assert_eq!(o.message, "pr-downloader exited with code 3.");
    }

    #[test]
    fn progress_percent_only() {
        let p = parse_progress_line("[Progress] 50% [=====     ]").unwrap();
        assert_eq!(p.percent, Some(50.0));
        assert_eq!(p.total_bytes, None);
        assert_eq!(p.phase, "downloading");
    }

    #[test]
    fn progress_with_byte_pair() {
        let p = parse_progress_line("[Progress] 42% [==>  ] 123456/294000").unwrap();
        assert_eq!(p.downloaded_bytes, 123456);
        assert_eq!(p.total_bytes, Some(294000));
        // byte-derived percent wins over the printed token
        assert_eq!(p.percent, super::percent(123456, Some(294000)));
    }

    #[test]
    fn progress_non_progress_line_is_none() {
        assert!(parse_progress_line("[Info] connecting to repo").is_none());
        assert!(parse_progress_line("Download complete!").is_none());
    }

    #[test]
    fn the_line_that_opens_an_extraction_is_a_phase_of_its_own() {
        let p = parse_progress_line(
            "[Info] src/FileSystem/FileSystem.cpp:587:extract():Extracting \
             /data/engine/spring.7z to /data/engine/linux64/105.1.1",
        )
        .unwrap();
        assert_eq!(p.phase, "extracting");
        assert_eq!(p.total_bytes, None);
        assert_eq!(p.percent, None);
        assert!(!p.is_measured());
    }

    #[test]
    fn the_files_an_extraction_names_are_not_samples_of_their_own() {
        // One of these per file is a burst, not a heartbeat, and the phase has
        // already been reported by the line above them.
        assert!(parse_progress_line(
            "[Info] src/FileSystem/FileSystem.cpp:632:extract():extracting \
             (/data/engine/linux64/105.1.1/springsettings.cfg)"
        )
        .is_none());
    }
}

/// The parsers run over stdout captured from real `pr-downloader` runs, one
/// fixture per download kind. `tests/fixtures/README.md` records the exact
/// commands and what was trimmed.
///
/// These exist because the numbers this parser pulls out are now the size, the
/// rate, the time left and the stall verdict on every download surface in the
/// app (issue #1798), and nothing had checked them against output pr-downloader
/// actually produces.
#[cfg(test)]
mod fixture_tests {
    use super::*;

    const MAP: &str = include_str!("../tests/fixtures/map-smalldivide.stdout.txt");
    const RAPID_POOL: &str = include_str!("../tests/fixtures/rapid-pool.stdout.txt");
    const RAPID_STREAMER: &str = include_str!("../tests/fixtures/rapid-streamer.stdout.txt");
    const ENGINE: &str = include_str!("../tests/fixtures/engine-bar105.stdout.txt");
    const ENGINE_MISSING_OUT: &str =
        include_str!("../tests/fixtures/engine-unavailable.stdout.txt");
    const ENGINE_MISSING_ERR: &str =
        include_str!("../tests/fixtures/engine-unavailable.stderr.txt");

    /// Every progress sample the reader in `lib.rs` would emit for this output,
    /// in order. That reader ends a segment at either `\n` or `\r`, because
    /// pr-downloader redraws its progress bar in place.
    fn events(raw: &str) -> Vec<DownloadProgress> {
        raw.split(['\n', '\r'])
            .filter(|s| !s.is_empty())
            .filter_map(parse_progress_line)
            .collect()
    }

    /// One line per sample, carrying everything the frontend reads off it:
    /// `phase downloaded/total percent`, with `?` for a total nobody reported
    /// and `-` for no percentage. Written out as text so a whole run reads as
    /// one assertion rather than a pile of indexed field checks.
    fn transcript(raw: &str) -> String {
        events(raw)
            .iter()
            .map(|p| {
                let total = p.total_bytes.map_or("?".to_string(), |t| t.to_string());
                let pct = p.percent.map_or("-".to_string(), |v| format!("{v:.1}%"));
                format!("{} {}/{total} {pct}", p.phase, p.downloaded_bytes)
            })
            .collect::<Vec<_>>()
            .join("\n")
    }

    /// A map fetched over HTTP from springfiles: a byte pair on every line, and
    /// a byte-derived percentage that agrees with the one pr-downloader printed.
    #[test]
    fn map_download_reports_bytes_throughout() {
        assert_eq!(
            transcript(MAP),
            "downloading 1/1 100.0%\n\
             downloading 7981/2631449 0.3%\n\
             downloading 447981/2631449 17.0%\n\
             downloading 2631449/2631449 100.0%"
        );
    }

    /// A rapid tag fetched file by file from the pool, which is the path a
    /// Beyond All Reason download takes. Byte accurate the whole way.
    #[test]
    fn rapid_pool_download_reports_bytes_throughout() {
        assert_eq!(
            transcript(RAPID_POOL),
            "downloading 1/1 100.0%\n\
             downloading 2995/2766069 0.1%\n\
             downloading 90555/2766069 3.3%\n\
             downloading 573104/2766069 20.7%\n\
             downloading 680739/2766069 24.6%\n\
             downloading 942284/2766069 34.1%\n\
             downloading 1624254/2766069 58.7%\n\
             downloading 1769397/2766069 64.0%\n\
             downloading 1849537/2766069 66.9%\n\
             downloading 2446295/2766069 88.4%"
        );
    }

    /// The same kind of rapid tag served by `streamer.cgi`, which is the default
    /// when no rapid master is named. The response has no length, so
    /// pr-downloader prints `0/0` once and then nothing at all for the rest of
    /// the archive. This fixture is a 77 MB download reported in four lines.
    ///
    /// The parser's job here is to say the size is unknown rather than zero, so
    /// that what follows can tell a download with nothing to report apart from
    /// one that stopped reporting. See
    /// [`the_streamer_path_reports_nothing_measurable`].
    #[test]
    fn rapid_streamer_download_reports_no_size_at_all() {
        assert_eq!(
            transcript(RAPID_STREAMER),
            "downloading 1/1 100.0%\n\
             downloading 0/1 0.0%\n\
             downloading 1/1 100.0%\n\
             downloading 0/? -"
        );
    }

    /// An engine archive over HTTP, and then the unpacking, which is the part a
    /// player used to spend staring at the word "stalled" (issue #1826).
    ///
    /// The transfer ends at 100% and the next thing pr-downloader says is that
    /// it has started extracting. That one sample is the whole of the phase: the
    /// several hundred `extracting (<path>)` lines under it still parse as
    /// nothing, and the `done` that closes it is not a sample either.
    #[test]
    fn engine_download_reports_bytes_then_says_it_is_extracting() {
        assert_eq!(
            transcript(ENGINE),
            "downloading 1/1 100.0%\n\
             downloading 0/17985637 0.0%\n\
             downloading 2202081/17985637 12.2%\n\
             downloading 5242054/17985637 29.1%\n\
             downloading 8339438/17985637 46.4%\n\
             downloading 10485760/17985637 58.3%\n\
             downloading 13434066/17985637 74.7%\n\
             downloading 16596196/17985637 92.3%\n\
             downloading 17985637/17985637 100.0%\n\
             extracting 0/? -"
        );
    }

    /// Every download opens with a `1/1` at 100% before the real archive starts
    /// again from the bottom. It is pr-downloader fetching the rapid repo
    /// master, and it is the sequence that broke an earlier version of the rate
    /// smoothing in #1796, so it is worth naming rather than leaving implied by
    /// the transcripts above.
    ///
    /// The `1` is not a byte. pr-downloader gives a download it has not sized
    /// yet an `approx_size` of 1 and sums those into the total it prints, so a
    /// fetch of unknown size counts as one unit and finishes at `1/1`. Coilbox
    /// therefore shows "1 B of 1 B" for a moment on every download, which is
    /// wrong but harmless next to the real archive that follows.
    #[test]
    fn every_download_opens_with_an_unsized_fetch_at_full() {
        for raw in [MAP, RAPID_POOL, RAPID_STREAMER, ENGINE] {
            let e = events(raw);
            assert_eq!(e[0].downloaded_bytes, 1);
            assert_eq!(e[0].total_bytes, Some(1));
            assert_eq!(e[0].percent, Some(100.0));
            assert!(
                e[1].percent < Some(100.0),
                "the next sample should start again from the bottom"
            );
        }
    }

    /// Which downloads have a signal a watching timer can trust.
    ///
    /// Every sample of a map or pool download carries bytes or a percentage, so
    /// silence from one of those means something went wrong and the watchdog
    /// should act. Two runs end on a sample carrying neither, and in both the
    /// silence that follows is work rather than trouble: an archive served by
    /// `streamer.cgi`, and an engine being unpacked. `next_idle` reads exactly
    /// this to decide whether to kill a quiet download.
    #[test]
    fn a_run_that_ends_unmeasured_is_one_that_is_still_working() {
        for raw in [MAP, RAPID_POOL] {
            assert!(
                events(raw).iter().all(DownloadProgress::is_measured),
                "every sample of a sized download is a measurement"
            );
        }
        for raw in [RAPID_STREAMER, ENGINE] {
            let samples = events(raw);
            let (last, earlier) = samples.split_last().expect("progress samples");
            assert!(earlier.iter().all(DownloadProgress::is_measured));
            assert!(!last.is_measured());
        }
        // The streamer run: the repo master and the sdp, both of which finish,
        // then 77 MB with nothing said about it at all.
        assert_eq!(events(RAPID_STREAMER).len(), 4);
        // The engine run: a transfer reported to the byte, then the unpacking.
        assert_eq!(events(ENGINE).last().unwrap().phase, "extracting");
    }

    /// The `[Info]` lines carry version strings, timings, file paths and repo
    /// counts, and plenty of them hold an `a/b` shaped token (`HTTP/1.1`,
    /// `AI/Interfaces/C/0.1`). Two kinds of line say something about a download
    /// and every other kind says nothing, which is the worry issue #1798 was
    /// filed on. Naming the phase each one produces keeps the second kind from
    /// widening into "any line with the word extract in it": there are 223
    /// `extracting (<path>)` lines under the one that counts.
    #[test]
    fn only_a_progress_bar_or_the_start_of_an_extraction_is_read() {
        for raw in [MAP, RAPID_POOL, RAPID_STREAMER, ENGINE, ENGINE_MISSING_OUT] {
            for seg in raw.split(['\n', '\r']).filter(|s| !s.is_empty()) {
                let expected = if seg.starts_with("[Progress]") {
                    Some("downloading")
                } else if seg.contains("extract():Extracting ") {
                    Some("extracting")
                } else {
                    None
                };
                assert_eq!(
                    parse_progress_line(seg).map(|p| p.phase).as_deref(),
                    expected,
                    "wrong verdict on {seg:?}"
                );
            }
        }
    }

    /// pr-downloader prints one of these per file it extracts, so an archive
    /// holding a path with "progress" in its name walks straight into the word
    /// match, and the percentage comes out of whatever number the path ends in.
    /// No capture happens to contain such a path, so this line is made up. The
    /// hundreds of real ones it sits among are not.
    #[test]
    fn an_extracted_path_named_progress_is_not_progress() {
        let line = "[Info] src/FileSystem/FileSystem.cpp:632:extract():extracting \
                    (/data/games/anims/progressbar_02.png)";
        assert!(parse_progress_line(line).is_none());
    }

    /// The verdict lines, read off the same captures.
    #[test]
    fn finished_runs_report_their_own_last_word() {
        for raw in [MAP, RAPID_POOL, RAPID_STREAMER, ENGINE] {
            let o = parse_download(raw, "", Some(0));
            assert!(o.success);
            assert!(o.message.ends_with("Download complete!"), "{}", o.message);
        }
    }

    /// springfiles publishes no `engine_macosx_arm64` builds, so asking for an
    /// engine on an Apple Silicon Mac gets as far as the repo master and stops.
    /// The reason is on stderr and the exit code is 1.
    #[test]
    fn an_engine_with_no_build_for_this_platform_fails() {
        let o = parse_download(ENGINE_MISSING_OUT, ENGINE_MISSING_ERR, Some(1));
        assert!(!o.success);
        assert!(
            o.message.ends_with("Error occurred while downloading: 1"),
            "{}",
            o.message
        );
    }
}

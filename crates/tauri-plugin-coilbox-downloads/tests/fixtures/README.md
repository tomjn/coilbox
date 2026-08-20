# pr-downloader output captures

Raw stdout (and one stderr) from real `pr-downloader` runs, used by the parser tests in `src/sidecar.rs`. They are captures, not hand written examples: the point of them is to show what pr-downloader does rather than what the parser assumes it does.

Every file keeps the carriage returns pr-downloader uses to redraw its progress bar in place, so the tests split segments the same way the streaming reader in `lib.rs` does. `.gitattributes` marks the captures `-text` to keep them, because `core.autocrlf` flattens the CRLF endings in `engine-unavailable.stderr.txt` otherwise. Add a seventh capture and it needs to land under that same rule.

## What was captured

All of it with `pr-downloader 0.7-768-g09a1f37 (macos_arm64)`, the bundled sidecar at `src-tauri/prdownloader/pr-downloader`, on 20 August 2026. Each run wrote into a throwaway directory that was deleted afterwards.

| File | Command |
| --- | --- |
| `map-smalldivide.stdout.txt` | `--download-map SmallDivide` (2.6 MB from springfiles) |
| `rapid-pool.stdout.txt` | `PRD_RAPID_USE_STREAMER=false --download-game chiliui:stable` (2.8 MB, file by file from the rapid pool, which is the path a Beyond All Reason download takes) |
| `rapid-streamer.stdout.txt` | `--download-game chobby:stable` (77 MB through `streamer.cgi`, the default when no rapid master is named) |
| `engine-bar105.stdout.txt` | `--download-engine "105.1.1-2314-g9e0bf7d BAR105"` (18 MB) |
| `engine-unavailable.stdout.txt`, `.stderr.txt` | `--download-engine 95.0`, which is what an engine download does on an Apple Silicon Mac |

## Two things worth knowing about these captures

springfiles publishes no `engine_macosx_arm64` builds, so no engine download can succeed through pr-downloader on this machine. `engine-unavailable.*` is that real failure. To get a successful engine capture as well, `PRD_HTTP_SEARCH_URL` pointed at a local server returning the springfiles record for the Linux build of that engine with its category rewritten to `engine_macosx_arm64`. The search response is the only synthetic part. pr-downloader then really did resolve, download, verify and extract a real 18 MB engine archive through its engine code path, and the progress lines are its own.

`engine-bar105.stdout.txt` is trimmed. pr-downloader prints one `extracting (<path>)` line per file in the archive, and 220 of the 223 were dropped. Nothing else was touched, in any file.

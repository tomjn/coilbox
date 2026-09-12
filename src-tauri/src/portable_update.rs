//! Windows portable-mode self update.
//!
//! Everywhere except Windows, Tauri's updater replaces the running app in place:
//! it derives an extract path from `current_exe()` and unpacks over it, so a
//! portable `.app` bundle or AppImage updates itself and nothing else.
//!
//! Windows is the exception, and it is why this module exists. There the updater
//! runs the NSIS installer, and NSIS chooses its own target folder. With no `/D=`
//! on the command line the installer falls back to `RestorePreviousInstallLocation`,
//! which reads the install path out of `HKCU\Software\<publisher>\Coilbox`. The
//! machine's *ordinary* Coilbox install wrote that key. So a portable copy inside a
//! game's folder downloads an update and then installs it over the player's normal
//! Coilbox, leaving itself on the old version. With no ordinary install present it
//! is no better: the update lands in `%LOCALAPPDATA%\Coilbox`, registers an
//! uninstall entry and creates shortcuts.
//!
//! Passing `/D=` to point NSIS at the portable folder fixes the file copy and
//! breaks something worse. Every registry write in the installer's `Install`
//! section is unconditional and has no flag to suppress it, so the portable update
//! would repoint the machine's `coilbox://` handler, its Add/Remove Programs entry
//! and the install-location key at the game's folder. That is the same boundary
//! violation aimed the other way, and harder to notice.
//!
//! So a portable Windows update does not use the installer at all. Coilbox fetches
//! a plain zip of the same payload, checks it against the updater's own minisign
//! key, unpacks it into `.coilbox/update-staging`, and hands over to the staged
//! `coilbox.exe` to copy itself into place once we have exited (see [`handoff`]
//! and `main.rs`'s `--apply-portable-update`). Nothing outside the app folder is
//! read or written.
//!
//! Most of the work here is platform-neutral on purpose. CI lints and tests on
//! Linux only, so keeping the download, the signature check, the unpack and the
//! copy off `#[cfg(windows)]` means clippy and `cargo test` still cover them.

use std::path::{Path, PathBuf};

use tauri::{AppHandle, Emitter, Runtime};

/// Where the verified payload is unpacked, under the portable root.
///
/// Inside `.coilbox` so an interrupted update leaves nothing outside the app
/// folder, and so the staged files land on the same volume they will be copied
/// to.
pub const STAGING_DIR: &str = "update-staging";

/// Argument that puts a staged `coilbox.exe` into swap mode instead of starting
/// the app. Read in `main` before any Tauri plugin is registered, because the
/// single-instance plugin would otherwise kill this process as a duplicate.
pub const APPLY_ARG: &str = "--apply-portable-update";

/// Event carrying download progress to the frontend, so a portable update draws
/// the same topbar indicator as the ordinary one.
const PROGRESS_EVENT: &str = "portable-update://progress";

/// Folders the NSIS installer clears before writing (see `nsis-hooks.nsh`), so a
/// file dropped from a later release does not linger.
///
/// Everything else is merged rather than replaced, which is what keeps a portable
/// update off the distribution's own files: `.coilbox/data`, `.coilbox/cache`,
/// `.coilbox/profile.json` and a distribution's replacement `.coilbox/legoparts`
/// pack are all outside this list and are never deleted. Note that the installer's
/// own copy of the parts pack goes to `.coilbox/resources/legoparts`, which is not
/// the same folder.
const REPLACED_DIRS: &[&str] = &[
    ".coilbox/prdownloader",
    ".coilbox/mapconv",
    ".coilbox/resources",
];

#[derive(Clone, serde::Serialize)]
struct Progress {
    downloaded: u64,
    total: Option<u64>,
}

/// Whether this build can update itself in place.
///
/// True only for a portable Windows install. An ordinary Windows install wants
/// the NSIS installer, which is what it is for, and mac and Linux already replace
/// themselves in place through the updater plugin.
#[tauri::command]
pub fn portable_update_supported() -> bool {
    cfg!(target_os = "windows") && coilbox_portable::is_portable()
}

/// Download the portable zip at `url`, check it against the updater's public key,
/// and unpack it into `.coilbox/update-staging`.
///
/// `signature` is the base64 `.sig` body from `latest.json`, in the same encoding
/// the updater plugin uses for its own artifacts.
///
/// Returns without touching the installed files. Call [`portable_update_finish`]
/// to hand over to the staged build.
#[tauri::command]
pub async fn portable_update_stage<R: Runtime>(
    app: AppHandle<R>,
    url: String,
    signature: String,
) -> Result<(), String> {
    let root = coilbox_portable::portable_root().ok_or("not a portable install")?;
    let pubkey = updater_pubkey(&app)?;

    let bytes = download(&app, &url).await?;
    verify(&bytes, &signature, &pubkey)?;

    let staging = root.join(STAGING_DIR);
    // A previous attempt that got as far as unpacking and no further would
    // otherwise leave files the new payload does not overwrite.
    if staging.exists() {
        std::fs::remove_dir_all(&staging).map_err(|e| format!("could not clear staging: {e}"))?;
    }
    unpack(&bytes, &staging)?;
    Ok(())
}

/// Start the staged `coilbox.exe` in swap mode and exit so it can overwrite ours.
///
/// Never returns on Windows: the process ends here, which is also what the
/// updater plugin's own Windows path does.
#[tauri::command]
pub fn portable_update_finish() -> Result<(), String> {
    let root = coilbox_portable::portable_root().ok_or("not a portable install")?;
    let target = coilbox_portable::app_dir().ok_or("could not resolve the app folder")?;
    handoff(&root.join(STAGING_DIR), &target)
}

/// Remove a staging folder left behind by an update that has already been applied.
///
/// Best effort, and called at startup. The swap process is still running from
/// inside the staging folder for a moment after it launches us, and Windows will
/// not delete a running executable's file, so a failure here means the next
/// launch clears it instead.
pub fn clear_staging() {
    let Some(root) = coilbox_portable::portable_root() else {
        return;
    };
    let staging = root.join(STAGING_DIR);
    if staging.is_dir() {
        let _ = std::fs::remove_dir_all(&staging);
    }
}

/// The updater's minisign public key, read back out of the Tauri config rather
/// than repeated here, so the zip is checked against exactly the key that signs
/// every other release artifact.
fn updater_pubkey<R: Runtime>(app: &AppHandle<R>) -> Result<String, String> {
    app.config()
        .plugins
        .0
        .get("updater")
        .and_then(|c| c.get("pubkey"))
        .and_then(|k| k.as_str())
        .map(str::to_string)
        .ok_or_else(|| "no updater public key in the app config".to_string())
}

/// Fetch `url` into memory, emitting progress as it goes.
///
/// Held in memory rather than streamed to disk because the signature covers the
/// whole file: nothing should reach the filesystem before it has been checked.
async fn download<R: Runtime>(app: &AppHandle<R>, url: &str) -> Result<Vec<u8>, String> {
    let mut response = reqwest::get(url)
        .await
        .map_err(|e| format!("could not fetch the update: {e}"))?
        .error_for_status()
        .map_err(|e| format!("could not fetch the update: {e}"))?;

    let total = response.content_length();
    let mut bytes: Vec<u8> = Vec::with_capacity(total.unwrap_or(0) as usize);
    let _ = app.emit(
        PROGRESS_EVENT,
        Progress {
            downloaded: 0,
            total,
        },
    );
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|e| format!("the update download failed: {e}"))?
    {
        bytes.extend_from_slice(&chunk);
        let _ = app.emit(
            PROGRESS_EVENT,
            Progress {
                downloaded: bytes.len() as u64,
                total,
            },
        );
    }
    Ok(bytes)
}

/// Check `data` against a base64 minisign signature and public key.
///
/// Both encodings match the updater plugin's `verify_signature`: `latest.json`
/// carries the base64 of the `.sig` and `.pub` file bodies, not of the raw key
/// material, so each is decoded to text first.
fn verify(data: &[u8], signature: &str, pubkey: &str) -> Result<(), String> {
    use base64::Engine as _;

    let decode = |s: &str, what: &str| -> Result<String, String> {
        let raw = base64::engine::general_purpose::STANDARD
            .decode(s)
            .map_err(|e| format!("malformed {what}: {e}"))?;
        String::from_utf8(raw).map_err(|e| format!("malformed {what}: {e}"))
    };

    let pubkey = minisign_verify::PublicKey::decode(&decode(pubkey, "public key")?)
        .map_err(|e| format!("malformed public key: {e}"))?;
    let signature = minisign_verify::Signature::decode(&decode(signature, "signature")?)
        .map_err(|e| format!("malformed signature: {e}"))?;
    pubkey
        .verify(data, &signature, true)
        .map_err(|_| "the update was not signed by Coilbox's release key".to_string())
}

/// Unpack a zip into `dest`.
///
/// Entries whose path escapes `dest` are refused rather than skipped. The payload
/// is signed, so a traversing entry means something is wrong with the whole
/// archive and unpacking the rest of it is not a safe thing to do.
fn unpack(bytes: &[u8], dest: &Path) -> Result<(), String> {
    let mut archive = zip::ZipArchive::new(std::io::Cursor::new(bytes))
        .map_err(|e| format!("the update is not a readable zip: {e}"))?;

    for i in 0..archive.len() {
        let mut entry = archive
            .by_index(i)
            .map_err(|e| format!("could not read the update: {e}"))?;
        let rel = entry
            .enclosed_name()
            .ok_or_else(|| format!("the update contains an unsafe path: {}", entry.name()))?;
        let out = dest.join(&rel);
        if entry.is_dir() {
            std::fs::create_dir_all(&out).map_err(|e| format!("could not unpack: {e}"))?;
            continue;
        }
        if let Some(parent) = out.parent() {
            std::fs::create_dir_all(parent).map_err(|e| format!("could not unpack: {e}"))?;
        }
        let mut file =
            std::fs::File::create(&out).map_err(|e| format!("could not unpack {rel:?}: {e}"))?;
        std::io::copy(&mut entry, &mut file).map_err(|e| format!("could not unpack: {e}"))?;
        #[cfg(unix)]
        if let Some(mode) = entry.unix_mode() {
            use std::os::unix::fs::PermissionsExt as _;
            let _ = std::fs::set_permissions(&out, std::fs::Permissions::from_mode(mode));
        }
    }
    Ok(())
}

/// Copy a staged payload over an installed one.
///
/// Merges rather than mirrors: a file present in `target` and absent from
/// `staging` is left alone, because in a portable install the app folder is also
/// the game's folder. The exception is [`REPLACED_DIRS`], cleared first so those
/// keep matching what the installer would have produced.
///
/// Public for `main.rs`'s swap mode, and for its tests.
pub fn apply_payload(staging: &Path, target: &Path) -> std::io::Result<()> {
    for dir in REPLACED_DIRS {
        // Only clear a folder this payload is going to refill. A release that
        // stops shipping one should not delete the installed copy and leave
        // nothing in its place.
        if staging.join(dir).is_dir() {
            let victim = target.join(dir);
            if victim.is_dir() {
                std::fs::remove_dir_all(&victim)?;
            }
        }
    }
    copy_over(staging, target)
}

/// Recursively copy `from` into `to`, overwriting files and creating folders.
/// Never deletes.
fn copy_over(from: &Path, to: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(to)?;
    for entry in std::fs::read_dir(from)? {
        let entry = entry?;
        let src = entry.path();
        let dst = to.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_over(&src, &dst)?;
        } else {
            std::fs::copy(&src, &dst)?;
        }
    }
    Ok(())
}

/// Windows: start the staged build in swap mode and exit.
#[cfg(target_os = "windows")]
fn handoff(staging: &Path, target: &Path) -> Result<(), String> {
    let staged_exe = staging.join(our_filename()?);
    if !staged_exe.is_file() {
        return Err(format!("no staged build at {}", staged_exe.display()));
    }

    // Outside the job object, or the kernel would kill it the moment we exit,
    // which is the very thing we are asking it to wait for. See win_job.rs.
    coilbox_proc::command_that_outlives_us(&staged_exe)
        .arg(APPLY_ARG)
        .arg(target)
        .arg(std::process::id().to_string())
        .spawn()
        .map_err(|e| format!("could not start the update: {e}"))?;

    // Exiting releases coilbox.exe and, through the job object, every sidecar
    // holding its own .exe open. Only then can the swap overwrite them.
    std::process::exit(0);
}

/// Everywhere else there is nothing to hand off to: the updater plugin replaces
/// the app in place, so this path is never reached.
#[cfg(not(target_os = "windows"))]
fn handoff(_staging: &Path, _target: &Path) -> Result<(), String> {
    Err("in-place update is only needed on Windows".to_string())
}

/// Swap mode, run by the staged build after the app it replaces has exited.
///
/// Waits for `parent_pid` to go, copies this folder over `target`, and starts
/// Coilbox again from there. Called from `main` before Tauri is built.
///
/// Coilbox is always restarted, including after a failed copy. By the time this
/// runs the app the user was looking at has already closed, so leaving without
/// starting anything would leave them with nothing on screen and no way to tell
/// an update apart from a crash. A copy that failed outright leaves the old build
/// in place and it comes back unchanged. One that failed partway comes back
/// however far it got, which is no worse than not coming back at all.
///
/// The error goes to a log file for the same reason. A release build has no
/// console attached on Windows, so anything written to stderr here is discarded.
pub fn run_swap(target: &Path, parent_pid: u32) -> Result<(), String> {
    let staging = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(Path::to_path_buf))
        .ok_or("could not resolve the staging folder")?;
    let exe = target.join(our_filename()?);

    wait_for_exit(parent_pid);
    let applied =
        apply_payload(&staging, target).map_err(|e| format!("could not apply the update: {e}"));
    if let Err(e) = &applied {
        let _ = std::fs::write(target.join(".coilbox").join("update-error.log"), e);
    }

    coilbox_proc::command_that_outlives_us(&exe)
        .spawn()
        .map_err(|e| format!("Coilbox would not restart after the update: {e}"))?;
    applied
}

/// This executable's own filename, for naming the same binary in another folder.
fn our_filename() -> Result<PathBuf, String> {
    std::env::current_exe()
        .ok()
        .and_then(|p| p.file_name().map(PathBuf::from))
        .ok_or_else(|| "could not resolve our own filename".to_string())
}

/// Block until `pid` is gone, or until we have waited long enough that it is not
/// going to be.
///
/// The bound matters more than the wait. If the old process is somehow stuck, the
/// user is sitting in front of a closed app, and copying over a locked file fails
/// with a message they can act on. Hanging here gives them nothing at all.
fn wait_for_exit(pid: u32) {
    const POLL: std::time::Duration = std::time::Duration::from_millis(100);
    const GIVE_UP_AFTER: std::time::Duration = std::time::Duration::from_secs(30);

    let deadline = std::time::Instant::now() + GIVE_UP_AFTER;
    while coilbox_proc::is_running(pid) && std::time::Instant::now() < deadline {
        std::thread::sleep(POLL);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write(path: &Path, text: &str) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, text).unwrap();
    }

    fn read(path: &Path) -> String {
        std::fs::read_to_string(path).unwrap()
    }

    /// A portable install's own state lives under the same `.coilbox` folder the
    /// payload writes into, so the one thing the copy must never do is take it
    /// out with the sidecars.
    #[test]
    fn apply_keeps_the_distributions_own_files() {
        let tmp = tempfile::tempdir().unwrap();
        let staging = tmp.path().join("staging");
        let target = tmp.path().join("app");

        write(&staging.join("coilbox.exe"), "new");
        write(&staging.join(".coilbox/uberstress.exe"), "new");

        write(&target.join("coilbox.exe"), "old");
        write(&target.join(".coilbox/profile.json"), "{}");
        write(&target.join(".coilbox/data/settings.json"), "mine");
        write(&target.join(".coilbox/cache/thumb.png"), "cached");
        write(&target.join(".coilbox/legoparts/parts.lua"), "distribution");

        apply_payload(&staging, &target).unwrap();

        assert_eq!(read(&target.join("coilbox.exe")), "new");
        assert_eq!(read(&target.join(".coilbox/uberstress.exe")), "new");
        assert_eq!(read(&target.join(".coilbox/profile.json")), "{}");
        assert_eq!(read(&target.join(".coilbox/data/settings.json")), "mine");
        assert_eq!(read(&target.join(".coilbox/cache/thumb.png")), "cached");
        assert_eq!(
            read(&target.join(".coilbox/legoparts/parts.lua")),
            "distribution"
        );
    }

    /// The installer clears these before writing, so a file dropped from a later
    /// release must not survive a portable update either.
    #[test]
    fn apply_clears_the_folders_the_installer_replaces() {
        let tmp = tempfile::tempdir().unwrap();
        let staging = tmp.path().join("staging");
        let target = tmp.path().join("app");

        write(&staging.join(".coilbox/mapconv/mapcompile.exe"), "new");
        write(&target.join(".coilbox/mapconv/mapcompile.exe"), "old");
        write(&target.join(".coilbox/mapconv/dropped.dll"), "gone in 2.0");

        apply_payload(&staging, &target).unwrap();

        assert_eq!(read(&target.join(".coilbox/mapconv/mapcompile.exe")), "new");
        assert!(!target.join(".coilbox/mapconv/dropped.dll").exists());
    }

    /// A release that stops shipping one of those folders should leave the
    /// installed copy alone rather than deleting it and putting nothing back.
    #[test]
    fn apply_leaves_a_replaced_folder_the_payload_omits() {
        let tmp = tempfile::tempdir().unwrap();
        let staging = tmp.path().join("staging");
        let target = tmp.path().join("app");

        write(&staging.join("coilbox.exe"), "new");
        write(&target.join(".coilbox/mapconv/mapcompile.exe"), "old");

        apply_payload(&staging, &target).unwrap();

        assert_eq!(read(&target.join(".coilbox/mapconv/mapcompile.exe")), "old");
    }

    /// A signed payload is the only thing that should ever be unpacked, so a
    /// traversing entry fails the whole archive rather than being skipped.
    #[test]
    fn unpack_refuses_a_path_that_escapes() {
        let tmp = tempfile::tempdir().unwrap();
        let mut buf = Vec::new();
        {
            let mut w = zip::ZipWriter::new(std::io::Cursor::new(&mut buf));
            w.start_file::<_, ()>("../escaped.txt", zip::write::SimpleFileOptions::default())
                .unwrap();
            std::io::Write::write_all(&mut w, b"nope").unwrap();
            w.finish().unwrap();
        }

        let err = unpack(&buf, &tmp.path().join("dest")).unwrap_err();
        assert!(err.contains("unsafe path"), "{err}");
        assert!(!tmp.path().join("escaped.txt").exists());
    }

    #[test]
    fn unpack_writes_nested_entries() {
        let tmp = tempfile::tempdir().unwrap();
        let mut buf = Vec::new();
        {
            let mut w = zip::ZipWriter::new(std::io::Cursor::new(&mut buf));
            w.start_file::<_, ()>(
                ".coilbox/mapconv/mapcompile.exe",
                zip::write::SimpleFileOptions::default(),
            )
            .unwrap();
            std::io::Write::write_all(&mut w, b"binary").unwrap();
            w.finish().unwrap();
        }

        let dest = tmp.path().join("dest");
        unpack(&buf, &dest).unwrap();
        assert_eq!(
            read(&dest.join(".coilbox/mapconv/mapcompile.exe")),
            "binary"
        );
    }

    /// A throwaway key pair, and `b"hello\n"` signed with it, both produced by
    /// `tauri signer` exactly as the release workflow will produce the real ones.
    ///
    /// The encodings are the whole point of this test. `latest.json` carries the
    /// base64 of the `.pub` and `.sig` *file bodies*, not of the key material, and
    /// getting that wrong would reject every correctly signed release in the field
    /// and nowhere else.
    const TEST_PUBKEY: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDMyNDBBQ0Y2RkI4ODY0OTgKUldTWVpJajc5cXhBTXVOZ25uaUZpYVhXMllQZzFVbjVXYjJmdXYxOTd6RStkZXY2cCtWcS83aUgK";
    const TEST_SIGNATURE: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIHRhdXJpIHNlY3JldCBrZXkKUlVTWVpJajc5cXhBTWhsTXplQXAxTUlSN1BaSFNFd01DQzhEWmI5bTRhVDhySVRlcVRvMytCN1JwbFMyRytaRDN5bW0rUEQ4ZHV6OTVaak1ZeHZZclgrYTMxcXZYZS85NGdvPQp0cnVzdGVkIGNvbW1lbnQ6IHRpbWVzdGFtcDoxNzg5MjE5NDM1CWZpbGU6cGF5bG9hZC50eHQKRTgrTVdHcVgrVzNaNmh5bzByQVdkVDhrbUdiWEhBZWFXaUdWazU3WVRnNUt3NWFXbUN0VVVSVWVkMW9KRnhjRzEwcUh6eU9hQTJDSGt2dHRLRlpGQ0E9PQo=";

    #[test]
    fn verify_accepts_a_correctly_signed_payload() {
        verify(b"hello\n", TEST_SIGNATURE, TEST_PUBKEY).unwrap();
    }

    #[test]
    fn verify_rejects_a_tampered_payload() {
        let err = verify(b"hello!\n", TEST_SIGNATURE, TEST_PUBKEY).unwrap_err();
        assert!(err.contains("not signed by Coilbox's release key"), "{err}");
    }

    /// The live release key must reject a signature made by any other key, which
    /// is what stops a valid-looking zip from somewhere else being unpacked.
    #[test]
    fn verify_rejects_a_payload_the_signature_does_not_cover() {
        // The live release key, as it appears in tauri.conf.json.
        let pubkey = "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDY1QTYzQUU2OTZBN0QyMTcKUldRWDBxZVc1anFtWlVOM0t2NEFxbXhLMmJaYmtZVm9ZM1V6QVVwaDEwTWJvRWFZdTM4NUZDNlUK";
        // 1.13.4's Windows signature, over a file this is not.
        let signature = "dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIHRhdXJpIHNlY3JldCBrZXkKUlVRWDBxZVc1anFtWlJCUHNxQVFmaG16MVNLQlNVUytpS0lDZmY4UVZZbDlBU0JnSE9ENEtIVnVRU3F5MWJ1UVVqTTM0ajVYN2NxRzJoaGV3YThDYUxCWjI4UmJsYlBTTXdRPQp0cnVzdGVkIGNvbW1lbnQ6IHRpbWVzdGFtcDoxNzg5MjE2OTQxCWZpbGU6Q29pbGJveF8xLjEzLjRfeDY0LXNldHVwLmV4ZQpkMk04ZHFWUngzMjE3Y1lDU1AwQVl5bGlTRUNRVVlyZ01KLzRpN3ZkamFVV1EzMmhzRkVXUmJFYlI3WTJCNzVoMTJzeFJHRGJvZzdMbmtib0hDSDFDdz09Cg==";

        let err = verify(b"not the release", signature, pubkey).unwrap_err();
        assert!(err.contains("not signed by Coilbox's release key"), "{err}");
    }

    #[test]
    fn verify_reports_a_malformed_signature_separately() {
        let pubkey = "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDY1QTYzQUU2OTZBN0QyMTcKUldRWDBxZVc1anFtWlVOM0t2NEFxbXhLMmJaYmtZVm9ZM1V6QVVwaDEwTWJvRWFZdTM4NUZDNlUK";
        let err = verify(b"payload", "bm90IGEgc2lnbmF0dXJl", pubkey).unwrap_err();
        assert!(err.contains("malformed signature"), "{err}");
    }
}

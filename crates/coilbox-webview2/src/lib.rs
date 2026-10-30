//! Windows-only: say so when the WebView2 runtime is missing, before Tauri tries
//! to open the window (issue #4873).
//!
//! Coilbox draws its interface with Microsoft's WebView2 runtime. Without it Tauri
//! shows its own error dialog from inside window creation and leaves a blank
//! window behind, with no mention of coilbox. The installer fetches the runtime
//! during setup, but the portable zip installs nothing, so a machine without the
//! runtime always lands there.
//!
//! The caller says whether the runtime is there. The app passes
//! `tauri::webview_version().is_ok()`, the same call Tauri makes to decide whether
//! the runtime is installed. Where it succeeds we do nothing and carry on as
//! before. Where it fails, Tauri's own call fails a moment later and the app
//! cannot start, so the check cannot lock out a machine that would have run.
//!
//! This is a crate of its own so CI can compile and lint the Win32 calls on a
//! Windows runner without building the whole app there.
//!
//! Showing the message is best effort. If the message box itself cannot be shown,
//! we carry on and Tauri's dialog appears as it did before.

/// Microsoft's Evergreen bootstrapper, the same address the NSIS installer
/// downloads from.
#[cfg(any(windows, test))]
const DOWNLOAD_URL: &str = "https://go.microsoft.com/fwlink/p/?LinkId=2124703";

#[cfg(windows)]
const TITLE: &str = "Coilbox";

#[cfg(any(windows, test))]
const OFFER: &str = "Coilbox needs the Microsoft WebView2 Runtime, and it is not installed on this computer.\n\nOpen the Microsoft download now? Run the installer, then start Coilbox again.";

#[cfg(any(windows, test))]
fn address_note() -> String {
    format!("Coilbox could not open your browser. Download the WebView2 Runtime from:\n\n{DOWNLOAD_URL}")
}

/// A null-terminated UTF-16 copy of `s`, for the wide Win32 calls.
#[cfg(any(windows, test))]
fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

/// Show `text` in a message box titled "Coilbox". Returns the button pressed, or
/// `None` when the box could not be shown.
#[cfg(windows)]
fn message_box(text: &str, style: u32) -> Option<i32> {
    use windows_sys::Win32::UI::WindowsAndMessaging::{MessageBoxW, MB_SETFOREGROUND, MB_TOPMOST};

    let text = wide(text);
    let title = wide(TITLE);
    // SAFETY: both buffers are null-terminated and outlive the call. A null owner
    // window is allowed, and no window exists yet.
    let pressed = unsafe {
        MessageBoxW(
            core::ptr::null_mut(),
            text.as_ptr(),
            title.as_ptr(),
            style | MB_SETFOREGROUND | MB_TOPMOST,
        )
    };
    // Zero is the documented failure return.
    (pressed != 0).then_some(pressed)
}

/// Open the download page in the default browser. False when Windows refused.
#[cfg(windows)]
fn open_download() -> bool {
    use windows_sys::Win32::UI::Shell::ShellExecuteW;
    use windows_sys::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

    let verb = wide("open");
    let url = wide(DOWNLOAD_URL);
    // SAFETY: the buffers are null-terminated and outlive the call.
    let result = unsafe {
        ShellExecuteW(
            core::ptr::null_mut(),
            verb.as_ptr(),
            url.as_ptr(),
            core::ptr::null(),
            core::ptr::null(),
            SW_SHOWNORMAL,
        )
    };
    // ShellExecuteW returns a value above 32 on success and an error code up to
    // 32 otherwise.
    result as usize > 32
}

/// Stop with a message of our own when the WebView2 runtime is missing. Returns
/// when `runtime_present` says it is there, or when the message could not be
/// shown.
#[cfg(windows)]
pub fn exit_if_runtime_missing(runtime_present: impl FnOnce() -> bool) {
    use windows_sys::Win32::UI::WindowsAndMessaging::{IDYES, MB_ICONERROR, MB_OK, MB_YESNO};

    if runtime_present() {
        return;
    }

    match message_box(OFFER, MB_YESNO | MB_ICONERROR) {
        // The box never appeared. Carry on and let Tauri report it.
        None => return,
        Some(IDYES) => {
            if !open_download() {
                message_box(&address_note(), MB_OK | MB_ICONERROR);
            }
        }
        Some(_) => {}
    }
    std::process::exit(1);
}

/// No WebView2 outside Windows, so there is nothing to check.
#[cfg(not(windows))]
pub fn exit_if_runtime_missing(_runtime_present: impl FnOnce() -> bool) {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wide_ends_with_a_single_null() {
        assert_eq!(wide("ab"), vec![b'a' as u16, b'b' as u16, 0]);
        assert_eq!(wide(""), vec![0]);
    }

    #[test]
    fn wide_encodes_non_ascii_as_utf16() {
        assert_eq!(wide("\u{1F600}"), vec![0xD83D, 0xDE00, 0]);
    }

    #[test]
    fn the_offer_names_coilbox_and_what_is_missing() {
        assert!(OFFER.contains("Coilbox"));
        assert!(OFFER.contains("WebView2 Runtime"));
    }

    #[test]
    fn the_address_note_carries_the_download_address() {
        assert!(address_note().contains(DOWNLOAD_URL));
        assert!(DOWNLOAD_URL.starts_with("https://"));
    }
}

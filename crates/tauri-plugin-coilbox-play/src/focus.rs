//! Best-effort "bring the running engine's window to the foreground" per platform.
//!
//! The frontend never sees a PID: `play_focus` maps a run id to the live child and
//! calls [`focus_pid`]. Wayland (and any unsupported target) is a graceful no-op
//! returning `false` — the pill still shows, the click just does nothing, because
//! no application can force-focus another under Wayland.

/// Raise the window owned by `pid`. Returns whether a focus request was dispatched
/// (not a guarantee the OS honoured it — foreground policy can still refuse).
#[cfg(target_os = "macos")]
pub fn focus_pid(pid: u32) -> bool {
    use objc2_app_kit::{NSApplicationActivationOptions, NSRunningApplication};
    // `runningApplicationWithProcessIdentifier` takes `libc::pid_t` (= i32 on Apple).
    match NSRunningApplication::runningApplicationWithProcessIdentifier(pid as i32) {
        Some(app) => app.activateWithOptions(NSApplicationActivationOptions::ActivateAllWindows),
        None => false,
    }
}

#[cfg(target_os = "windows")]
pub fn focus_pid(pid: u32) -> bool {
    use windows::Win32::Foundation::{BOOL, FALSE, HWND, LPARAM, TRUE};
    use windows::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetWindowThreadProcessId, IsWindowVisible, SetForegroundWindow,
    };

    struct Search {
        pid: u32,
        hwnd: HWND,
    }

    unsafe extern "system" fn cb(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let search = &mut *(lparam.0 as *mut Search);
        let mut wpid: u32 = 0;
        GetWindowThreadProcessId(hwnd, Some(&mut wpid));
        if wpid == search.pid && IsWindowVisible(hwnd).as_bool() {
            search.hwnd = hwnd;
            return FALSE; // found a visible top-level window; stop enumerating
        }
        TRUE // keep going
    }

    let mut search = Search {
        pid,
        hwnd: HWND(std::ptr::null_mut()),
    };
    unsafe {
        // `EnumWindows` returns Err when the callback stops early — expected here.
        let _ = EnumWindows(Some(cb), LPARAM(&mut search as *mut _ as isize));
        if !search.hwnd.0.is_null() {
            return SetForegroundWindow(search.hwnd).as_bool();
        }
    }
    false
}

#[cfg(target_os = "linux")]
x11rb::atom_manager! {
    Atoms: AtomsCookie {
        _NET_CLIENT_LIST,
        _NET_WM_PID,
        _NET_ACTIVE_WINDOW,
    }
}

#[cfg(target_os = "linux")]
pub fn focus_pid(pid: u32) -> bool {
    focus_x11(pid).unwrap_or(false)
}

/// X11 activation via EWMH: find the managed window whose `_NET_WM_PID` matches and
/// send `_NET_ACTIVE_WINDOW` to the root. Under pure Wayland `connect` fails and we
/// return `Ok(false)`; only XWayland clients that set `_NET_WM_PID` are reachable.
#[cfg(target_os = "linux")]
fn focus_x11(pid: u32) -> Result<bool, Box<dyn std::error::Error>> {
    use x11rb::connection::Connection;
    use x11rb::protocol::xproto::{AtomEnum, ClientMessageEvent, ConnectionExt, EventMask};

    let (conn, screen_num) = x11rb::connect(None)?;
    let root = conn.setup().roots[screen_num].root;
    let atoms = Atoms::new(&conn)?.reply()?;

    let clients = conn
        .get_property(
            false,
            root,
            atoms._NET_CLIENT_LIST,
            AtomEnum::WINDOW,
            0,
            u32::MAX,
        )?
        .reply()?;
    let windows = match clients.value32() {
        Some(w) => w,
        None => return Ok(false),
    };

    for win in windows {
        let prop = conn
            .get_property(false, win, atoms._NET_WM_PID, AtomEnum::CARDINAL, 0, 1)?
            .reply()?;
        if prop.value32().and_then(|mut v| v.next()) == Some(pid) {
            // data: [source=1 (application), timestamp, requestor active win, 0, 0]
            let event = ClientMessageEvent::new(
                32,
                win,
                atoms._NET_ACTIVE_WINDOW,
                [1u32, x11rb::CURRENT_TIME, 0, 0, 0],
            );
            conn.send_event(
                false,
                root,
                EventMask::SUBSTRUCTURE_NOTIFY | EventMask::SUBSTRUCTURE_REDIRECT,
                event,
            )?;
            conn.flush()?;
            return Ok(true);
        }
    }
    Ok(false)
}

/// Wayland-only Unixes and any other target: no-op.
#[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
pub fn focus_pid(_pid: u32) -> bool {
    false
}

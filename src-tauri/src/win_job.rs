//! Windows-only: confine child processes to a Job Object so they die with us.
//!
//! On Windows a running executable's file is locked, and terminating a parent does
//! NOT terminate its children. During an NSIS update the installer closes
//! `coilbox.exe` and then overwrites files in the install dir — but any sidecar we
//! spawned (unitsync worker, pr-downloader, engine, uberstress) keeps running,
//! holding its own `.exe` open, and the installer fails with "Error opening file
//! for writing". Putting our process in a Job Object with KILL_ON_JOB_CLOSE makes
//! the kernel terminate every child the instant `coilbox.exe` dies, releasing those
//! locks before the installer extracts over them.
//!
//! Best-effort throughout: any failure leaves us running without the guard rather
//! than refusing to start.
//!
//! The guard has to be lifted for two processes, in two different ways.
//!
//! The update installer is the first. The updater plugin starts it with
//! `ShellExecuteW` and calls `std::process::exit(0)` on the next line, so the
//! installer is one of our children and the kernel kills it the instant we go. See
//! `stop_confining_new_children` below.
//!
//! The relay agent is the second, and it is the reason for
//! `JOB_OBJECT_LIMIT_BREAKAWAY_OK`. A relayed battle is carried by that sidecar
//! rather than by us, so killing it when coilbox closes drops every other player
//! from a game the host carries on playing (issue #2033). That flag does not let
//! anything out of the job on its own: it only means a child that asks with
//! `CREATE_BREAKAWAY_FROM_JOB` is allowed to leave, and the relay agent is the
//! only one that asks (`coilbox_proc::command_that_outlives_us`). Everything else
//! we spawn stays in the job and still dies with us, which is the behaviour the
//! installer depends on.

/// The job we put ourselves in, as a raw handle value. Zero until
/// `confine_children_to_job` succeeds. Stored raw because `HANDLE` is a pointer
/// and so neither `Send` nor `Sync`. Only the two functions here touch it.
#[cfg(target_os = "windows")]
static JOB: std::sync::atomic::AtomicIsize = std::sync::atomic::AtomicIsize::new(0);

#[cfg(target_os = "windows")]
pub fn confine_children_to_job() {
    use windows::core::PCWSTR;
    use windows::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
        SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_BREAKAWAY_OK, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };
    use windows::Win32::System::Threading::GetCurrentProcess;

    unsafe {
        // Unnamed job, default security.
        let job = match CreateJobObjectW(None, PCWSTR::null()) {
            Ok(h) if !h.is_invalid() => h,
            _ => return,
        };

        // BREAKAWAY_OK has to be here rather than added later, because
        // CreateProcess reads it at the moment the child is created: a child
        // passing CREATE_BREAKAWAY_FROM_JOB to a job without it is refused
        // outright, so the relay agent would fail to spawn at all rather than
        // quietly joining the job.
        let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        info.BasicLimitInformation.LimitFlags =
            JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE | JOB_OBJECT_LIMIT_BREAKAWAY_OK;
        if SetInformationJobObject(
            job,
            JobObjectExtendedLimitInformation,
            &info as *const _ as *const core::ffi::c_void,
            core::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        )
        .is_err()
        {
            return;
        }

        // Children spawned after this inherit the job (none set
        // CREATE_BREAKAWAY_FROM_JOB), so every sidecar is covered.
        if AssignProcessToJobObject(job, GetCurrentProcess()).is_err() {
            return;
        }
        JOB.store(job.0 as isize, std::sync::atomic::Ordering::Relaxed);

        // `job` is intentionally not closed: the handle must stay open for our whole
        // lifetime, since closing the last handle trips KILL_ON_JOB_CLOSE and would
        // kill us too. `windows`' HANDLE has no Drop, so simply not calling
        // CloseHandle keeps it open until the OS reclaims it at process exit — which
        // is the trigger we want.
    }
}

/// Let anything we start from now on run outside the job, so it survives us.
///
/// Called just before the updater launches the NSIS installer. Adding
/// SILENT_BREAKAWAY_OK only affects processes created after this point, so every
/// sidecar already running stays in the job and is still killed when we exit,
/// which is what frees their .exe files for the installer to overwrite. Without
/// this the installer is a job member too and dies with us, which is why a Windows
/// update closed the app and then did nothing at all (issue #1691).
///
/// Errors are returned rather than swallowed: if the breakaway does not take, the
/// update is going to fail the same silent way, and the caller should say so.
#[cfg(target_os = "windows")]
pub fn stop_confining_new_children() -> Result<(), String> {
    use windows::Win32::Foundation::HANDLE;
    use windows::Win32::System::JobObjects::{
        JobObjectExtendedLimitInformation, SetInformationJobObject,
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_BREAKAWAY_OK,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE, JOB_OBJECT_LIMIT_SILENT_BREAKAWAY_OK,
    };

    let handle = JOB.load(std::sync::atomic::Ordering::Relaxed);
    if handle == 0 {
        // We never got into a job, so nothing confines the installer anyway.
        return Ok(());
    }

    // The flags replace the set, they do not add to it, so BREAKAWAY_OK is
    // named again here. Dropping it would take away the one thing
    // CreateProcess checks for a child asking with CREATE_BREAKAWAY_FROM_JOB,
    // and the documentation for that flag names BREAKAWAY_OK specifically
    // rather than either breakaway limit, so a relay agent started after an
    // update had begun might be refused.
    let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
    info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
        | JOB_OBJECT_LIMIT_BREAKAWAY_OK
        | JOB_OBJECT_LIMIT_SILENT_BREAKAWAY_OK;
    unsafe {
        SetInformationJobObject(
            HANDLE(handle as *mut core::ffi::c_void),
            JobObjectExtendedLimitInformation,
            &info as *const _ as *const core::ffi::c_void,
            core::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        )
    }
    .map_err(|e| format!("could not let the installer leave the job object: {e}"))
}

#[cfg(not(target_os = "windows"))]
pub fn confine_children_to_job() {}

/// No job object outside Windows, so nothing to lift.
#[cfg(not(target_os = "windows"))]
pub fn stop_confining_new_children() -> Result<(), String> {
    Ok(())
}

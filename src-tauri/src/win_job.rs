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

#[cfg(target_os = "windows")]
pub fn confine_children_to_job() {
    use windows::core::PCWSTR;
    use windows::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
        SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };
    use windows::Win32::System::Threading::GetCurrentProcess;

    unsafe {
        // Unnamed job, default security.
        let job = match CreateJobObjectW(None, PCWSTR::null()) {
            Ok(h) if !h.is_invalid() => h,
            _ => return,
        };

        let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
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
        let _ = AssignProcessToJobObject(job, GetCurrentProcess());

        // `job` is intentionally not closed: the handle must stay open for our whole
        // lifetime, since closing the last handle trips KILL_ON_JOB_CLOSE and would
        // kill us too. `windows`' HANDLE has no Drop, so simply not calling
        // CloseHandle keeps it open until the OS reclaims it at process exit — which
        // is the trigger we want.
    }
}

#[cfg(not(target_os = "windows"))]
pub fn confine_children_to_job() {}

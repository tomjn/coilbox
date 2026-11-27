use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde_json::{json, Value};

use super::fakes::{FakeHub, FakeMirror, Finish, UPLOAD_ID};
use super::*;

/// The archive these tests send. Its bytes are all different, so a chunk sent
/// from the wrong place shows up in a comparison.
const ARCHIVE: &[u8] = b"0123456789";

fn archive_dir(tag: &str) -> PathBuf {
    let dir =
        std::env::temp_dir().join(format!("coilbox-hub-uploads-{}-{tag}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

fn facts_for(sha256: &str, size: u64) -> ArchiveFacts {
    ArchiveFacts {
        sha256: sha256.into(),
        size,
        filename: "persepolis.sd7".into(),
        kind: ArchiveKind::Map,
        internal_name: "Persepolis 1".into(),
        version: "1".into(),
        shortname: None,
        author: Some("Someone".into()),
        description: None,
        platform: None,
        note: None,
    }
}

/// Short waits and a chunk of any size, so a whole run takes milliseconds.
fn quick() -> Pacing {
    Pacing {
        retry_backoff: Duration::from_millis(1),
        poll_during: Duration::from_secs(3600),
        poll_after: Duration::from_millis(5),
        chunk_target: u64::MAX,
        chunk_timeout: Duration::from_secs(10),
    }
}

/// What a test sets up before it runs and reads afterwards.
struct Rig {
    mirror: FakeMirror,
    hub: FakeHub,
    path: PathBuf,
    facts: ArchiveFacts,
    pacing: Pacing,
    cancel: Arc<AtomicBool>,
}

impl Rig {
    /// A mirror taking chunks of up to `max_chunk` bytes, and a hub that sends
    /// uploads to it.
    fn new(tag: &str, max_chunk: u64) -> Self {
        let path = archive_dir(tag).join("persepolis.sd7");
        std::fs::write(&path, ARCHIVE).unwrap();
        let size = ARCHIVE.len() as u64;
        let mirror = FakeMirror::new(size, max_chunk);
        let hub = FakeHub::new(&mirror.base);
        Self {
            mirror,
            hub,
            path,
            facts: facts_for(&"a".repeat(64), size),
            pacing: quick(),
            cancel: Arc::new(AtomicBool::new(false)),
        }
    }

    fn with_hub(mut self, change: impl FnOnce(FakeHub) -> FakeHub) -> Self {
        self.hub = change(self.hub);
        self
    }

    async fn run(&self) -> (UploadState, Vec<UploadState>) {
        self.run_reporting(|_| {}).await
    }

    /// Run, calling `also` on every report as well as keeping them.
    async fn run_reporting(
        &self,
        also: impl Fn(&UploadState) + Send + Sync,
    ) -> (UploadState, Vec<UploadState>) {
        let reports = Mutex::new(Vec::new());
        let report = |state: &UploadState| {
            reports.lock().unwrap().push(state.clone());
            also(state);
        };
        let token = || -> TokenFuture { Box::pin(async { Ok("hub-bearer".to_owned()) }) };
        let env = Env {
            hub_url: &self.hub.base,
            token: &token,
            pacing: self.pacing,
            cancel: &self.cancel,
            report: &report,
        };
        let state = run(
            &env,
            state_for(&self.facts, &self.hub.base),
            &self.path,
            &Sending::Archive(&self.facts),
        )
        .await;
        (state, reports.into_inner().unwrap())
    }
}

fn state_for(facts: &ArchiveFacts, hub_url: &str) -> UploadState {
    UploadState {
        op_id: "op".into(),
        hub_url: hub_url.into(),
        filename: facts.filename.clone(),
        kind: facts.kind,
        sha256: facts.sha256.clone(),
        phase: Phase::Reserving,
        sent: 0,
        size: facts.size,
        upload_id: None,
        page_url: None,
        held_already: false,
        outcome: None,
    }
}

/// The code and source a run stopped on.
fn stopped(state: &UploadState) -> (Source, String) {
    match &state.outcome {
        Some(Outcome::Stopped { source, code, .. }) => (*source, code.clone()),
        other => panic!("expected a stop, got {other:?}"),
    }
}

fn lengths(mirror: &FakeMirror) -> Vec<usize> {
    mirror.posts().iter().map(|p| p.len).collect()
}

fn offsets(mirror: &FakeMirror) -> Vec<String> {
    mirror.posts().into_iter().map(|p| p.offset).collect()
}

// ------------------------------------------------------------------ sending

#[tokio::test]
async fn an_archive_that_fits_in_one_chunk_is_sent_in_one_and_listed() {
    let rig = Rig::new("one-chunk", 1 << 20);

    let (state, reports) = rig.run().await;

    assert_eq!(state.outcome, Some(Outcome::Listed));
    assert_eq!(rig.mirror.held(), ARCHIVE);
    assert_eq!(lengths(&rig.mirror), vec![ARCHIVE.len()]);
    assert_eq!(rig.mirror.posts()[0].token, "token-1");
    assert_eq!(state.upload_id.as_deref(), Some(UPLOAD_ID));
    assert_eq!(state.sent, ARCHIVE.len() as u64);

    let phases: Vec<Phase> = reports.iter().map(|r| r.phase).collect();
    assert_eq!(phases.first(), Some(&Phase::Sending));
    assert!(phases.contains(&Phase::Waiting));
    assert_eq!(phases.last(), Some(&Phase::Done));
}

#[tokio::test]
async fn the_hub_is_sent_the_facts_and_the_signed_in_token() {
    let rig = Rig::new("facts", 1 << 20);

    rig.run().await;

    let (auth, body) = rig.hub.reservations().remove(0);
    assert_eq!(auth.as_deref(), Some("Bearer hub-bearer"));
    let sent: Value = serde_json::from_str(&body).unwrap();
    assert_eq!(sent["sha256"], "a".repeat(64));
    assert_eq!(sent["size"], ARCHIVE.len());
    assert_eq!(sent["filename"], "persepolis.sd7");
    assert_eq!(sent["kind"], "map");
    assert_eq!(sent["internal_name"], "Persepolis 1");
    assert_eq!(sent["author"], "Someone");
    assert_eq!(sent["shortname"], Value::Null);
}

#[test]
fn a_map_s_request_has_no_engine_fields_and_an_engine_s_has_both() {
    let map = serde_json::to_value(facts_for(&"a".repeat(64), 3)).unwrap();
    assert!(map.get("platform").is_none());
    assert!(map.get("note").is_none());

    let engine: ArchiveFacts = serde_json::from_value(json!({
        "sha256": "b".repeat(64),
        "size": 12,
        "filename": "recoil_2026.09.03_arm64-macos.7z",
        "kind": "engine",
        "internal_name": "recoil",
        "version": "2026.09.03",
        "shortname": null,
        "author": null,
        "description": null,
        "platform": "arm64-macos",
        "note": "Built from main for Apple silicon.",
    }))
    .unwrap();
    assert_eq!(engine.kind, ArchiveKind::Engine);
    let sent = serde_json::to_value(&engine).unwrap();
    assert_eq!(sent["kind"], "engine");
    assert_eq!(sent["platform"], "arm64-macos");
    assert_eq!(sent["note"], "Built from main for Apple silicon.");
}

#[tokio::test]
async fn a_small_chunk_limit_splits_the_archive_in_order() {
    let rig = Rig::new("split", 4);

    let (state, _) = rig.run().await;

    assert_eq!(state.outcome, Some(Outcome::Listed));
    assert_eq!(lengths(&rig.mirror), vec![4, 4, 2]);
    assert_eq!(offsets(&rig.mirror), vec!["0", "4", "8"]);
    assert_eq!(rig.mirror.held(), ARCHIVE);
}

#[tokio::test]
async fn this_side_keeps_chunks_under_its_own_target_when_the_mirror_allows_more() {
    let mut rig = Rig::new("target", 1 << 20);
    rig.pacing.chunk_target = 3;

    let (state, _) = rig.run().await;

    assert_eq!(state.outcome, Some(Outcome::Listed));
    assert_eq!(lengths(&rig.mirror), vec![3, 3, 3, 1]);
    assert_eq!(rig.mirror.held(), ARCHIVE);
}

#[tokio::test]
async fn progress_reports_the_bytes_the_mirror_holds_after_each_chunk() {
    let rig = Rig::new("progress", 4);

    let (_, reports) = rig.run().await;

    let sent: Vec<u64> = reports
        .iter()
        .filter(|r| r.phase == Phase::Sending)
        .map(|r| r.sent)
        .collect();
    // Once for the first state, then after each accepted chunk.
    assert_eq!(sent, vec![0, 0, 4, 8]);
}

// ------------------------------------------------------------------ resuming

#[tokio::test]
async fn a_transfer_carries_on_from_what_the_mirror_already_holds() {
    let rig = Rig::new("resume", 1 << 20);
    rig.mirror.state.lock().unwrap().held = ARCHIVE[..6].to_vec();

    let (state, _) = rig.run().await;

    assert_eq!(state.outcome, Some(Outcome::Listed));
    assert_eq!(offsets(&rig.mirror), vec!["6"]);
    assert_eq!(lengths(&rig.mirror), vec![4]);
    assert_eq!(rig.mirror.held(), ARCHIVE);
}

#[tokio::test]
async fn a_lost_answer_is_recovered_through_bad_offset() {
    let rig = Rig::new("bad-offset", 4);
    rig.mirror.state.lock().unwrap().drop_next_response = true;

    let (state, _) = rig.run().await;

    assert_eq!(state.outcome, Some(Outcome::Listed));
    // The first chunk landed and its answer did not. The same offset is sent
    // again, the mirror says it already holds 4, and the transfer goes on from
    // there without sending anything twice.
    assert_eq!(offsets(&rig.mirror), vec!["0", "0", "4", "8"]);
    assert_eq!(rig.mirror.held(), ARCHIVE);
}

#[tokio::test]
async fn a_mirror_that_finished_earlier_goes_straight_to_waiting_for_the_hub() {
    let rig = Rig::new("complete", 4);
    rig.mirror.with_state(|m| {
        m.held = ARCHIVE.to_vec();
        m.complete = true;
    });

    let (state, _) = rig.run().await;

    assert_eq!(state.outcome, Some(Outcome::Listed));
    assert!(rig.mirror.posts().is_empty());
}

#[tokio::test]
async fn a_mirror_holding_every_byte_but_not_finished_is_nudged_with_one_byte() {
    let rig = Rig::new("nudge", 4);
    rig.mirror.with_state(|m| m.held = ARCHIVE.to_vec());

    let (state, _) = rig.run().await;

    assert_eq!(state.outcome, Some(Outcome::Listed));
    assert_eq!(lengths(&rig.mirror), vec![1]);
    assert_eq!(rig.mirror.held(), ARCHIVE);
}

#[tokio::test]
async fn an_expired_token_is_replaced_by_asking_the_hub_again() {
    let rig = Rig::new("expired", 4);
    rig.mirror.state.lock().unwrap().expired = vec!["token-1".into()];

    let (state, _) = rig.run().await;

    assert_eq!(state.outcome, Some(Outcome::Listed));
    assert_eq!(rig.hub.reservations().len(), 2);
    let tokens: Vec<String> = rig.mirror.posts().into_iter().map(|p| p.token).collect();
    assert_eq!(tokens, vec!["token-1", "token-2", "token-2", "token-2"]);
    assert_eq!(rig.mirror.held(), ARCHIVE);
}

#[tokio::test]
async fn a_mirror_that_always_says_expired_ends_after_a_few_tries() {
    let rig = Rig::new("always-expired", 4);
    rig.mirror.with_state(|m| {
        m.expired = (1..=10).map(|n| format!("token-{n}")).collect();
    });

    let (state, _) = rig.run().await;

    assert_eq!(stopped(&state), (Source::Mirror, "expired".into()));
    assert_eq!(rig.hub.reservations().len() as u32, UPLOAD_ATTEMPTS);
}

// ----------------------------------------------------------------- cancelling

#[tokio::test]
async fn cancelling_after_the_first_chunk_stops_before_the_second() {
    let rig = Rig::new("cancel-between", 4);
    let flag = rig.cancel.clone();

    let (state, _) = rig
        .run_reporting(move |s| {
            if s.phase == Phase::Sending && s.sent > 0 {
                flag.store(true, Ordering::Relaxed);
            }
        })
        .await;

    assert_eq!(state.outcome, Some(Outcome::Cancelled));
    assert_eq!(state.phase, Phase::Done);
    assert_eq!(lengths(&rig.mirror), vec![4]);
}

#[tokio::test]
async fn cancelling_drops_a_chunk_that_is_still_in_flight() {
    let rig = Rig::new("cancel-in-flight", 4);
    rig.mirror
        .with_state(|m| m.post_hangs_for = Some(Duration::from_secs(20)));
    let flag = rig.cancel.clone();
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_millis(300)).await;
        flag.store(true, Ordering::Relaxed);
    });
    let started = Instant::now();

    let (state, _) = rig.run().await;

    assert_eq!(state.outcome, Some(Outcome::Cancelled));
    assert!(started.elapsed() < Duration::from_secs(10));
}

#[tokio::test]
async fn cancelling_while_waiting_for_the_hub_ends_the_wait() {
    let rig = Rig::new("cancel-waiting", 1 << 20).with_hub(|hub| hub.polling(&["uploading"]));
    let flag = rig.cancel.clone();
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_millis(300)).await;
        flag.store(true, Ordering::Relaxed);
    });

    let (state, _) = rig.run().await;

    assert_eq!(state.outcome, Some(Outcome::Cancelled));
    assert_eq!(rig.mirror.held(), ARCHIVE);
}

// ------------------------------------------------------------- hub polling

#[tokio::test]
async fn the_hub_is_asked_until_it_lists_the_archive() {
    let rig = Rig::new("polling", 1 << 20)
        .with_hub(|hub| hub.polling(&["uploading", "uploading", "listed"]));

    let (state, _) = rig.run().await;

    assert_eq!(state.outcome, Some(Outcome::Listed));
    assert_eq!(rig.hub.polls(), 3);
}

#[tokio::test]
async fn the_hub_is_asked_between_chunks_as_well() {
    let mut rig = Rig::new("polling-during", 4)
        .with_hub(|hub| hub.polling(&["uploading", "uploading", "uploading", "listed"]));
    rig.pacing.poll_during = Duration::ZERO;

    let (state, _) = rig.run().await;

    assert_eq!(state.outcome, Some(Outcome::Listed));
    // Before each of the three chunks, then once after the last.
    assert_eq!(rig.hub.polls(), 4);
}

#[tokio::test]
async fn a_hub_that_has_given_up_on_the_upload_ends_the_run() {
    let rig = Rig::new("hub-failed", 1 << 20).with_hub(|hub| hub.polling(&["failed"]));

    let (state, _) = rig.run().await;

    assert_eq!(stopped(&state), (Source::Hub, "failed".into()));
}

#[tokio::test]
async fn a_hub_that_has_forgotten_the_upload_ends_the_run() {
    let rig = Rig::new("hub-404", 1 << 20).with_hub(|hub| hub.poll_status(404));

    let (state, _) = rig.run().await;

    assert_eq!(stopped(&state), (Source::Hub, "not_found".into()));
}

// ---------------------------------------------------------- hub refusals

#[tokio::test]
async fn every_refusal_the_hub_gives_comes_back_as_its_own_code() {
    let duplicate = json!({
        "error": "The hub already has this archive.",
        "reason": "duplicate",
        "duplicate": {
            "check": "sha256",
            "filename": "persepolis.sd7",
            "kind": "map",
            "state": "listed",
            "url": "https://hub.coilbox.org/maps/persepolis",
        },
    });
    let cases: Vec<(u16, Value, &str)> = vec![
        (
            400,
            json!({ "error": "size must be at least 1.", "reason": "bad_request" }),
            "bad_request",
        ),
        (401, json!({ "error": "Unauthenticated." }), "unauthorised"),
        (
            403,
            json!({ "error": "You do not own the game.", "reason": "not_owner" }),
            "not_owner",
        ),
        (409, duplicate, "duplicate"),
        (
            422,
            json!({ "error": "No such game.", "reason": "unknown_game" }),
            "unknown_game",
        ),
        (
            503,
            json!({ "error": "No mirror.", "reason": "no_mirror" }),
            "no_mirror",
        ),
        (
            503,
            json!({ "error": "Not set up.", "reason": "not_configured" }),
            "not_configured",
        ),
        (
            503,
            json!({ "error": "Not just now.", "reason": "unavailable" }),
            "unavailable",
        ),
    ];
    for (status, body, code) in cases {
        let rig = Rig::new("hub-refusal", 4).with_hub(|hub| hub.refusing(status, body.clone()));

        let (state, _) = rig.run().await;

        let Some(Outcome::Stopped {
            source,
            code: got,
            status: got_status,
            said,
            duplicate,
        }) = &state.outcome
        else {
            panic!("{code}: {:?}", state.outcome);
        };
        assert_eq!(
            (*source, got.as_str(), *got_status),
            (Source::Hub, code, Some(status))
        );
        assert!(!said.is_empty(), "{code}");
        if code == "duplicate" {
            let duplicate = duplicate.as_ref().expect("the duplicate object");
            assert_eq!(duplicate.check.as_deref(), Some("sha256"));
            assert_eq!(duplicate.state.as_deref(), Some("listed"));
            assert_eq!(
                duplicate.url.as_deref(),
                Some("https://hub.coilbox.org/maps/persepolis")
            );
        } else {
            assert!(duplicate.is_none(), "{code}");
        }
        // Refused before any mirror was asked.
        assert!(rig.mirror.posts().is_empty(), "{code}");
        assert_eq!(rig.hub.reservations().len(), 1, "{code}");
    }
}

#[tokio::test]
async fn the_hubs_own_words_are_kept_for_a_refusal() {
    let rig = Rig::new("hub-words", 4).with_hub(|hub| {
        hub.refusing(
            403,
            json!({ "error": "You do not own the game \"bar\".", "reason": "not_owner" }),
        )
    });

    let (state, _) = rig.run().await;

    let Some(Outcome::Stopped { said, .. }) = &state.outcome else {
        panic!("{:?}", state.outcome);
    };
    assert_eq!(said, "You do not own the game \"bar\".");
}

#[tokio::test]
async fn a_sign_in_that_cannot_be_used_stops_before_the_hub_is_asked() {
    let rig = Rig::new("no-sign-in", 4);
    let token = || -> TokenFuture {
        Box::pin(async {
            Err(Stop::local(
                "unauthorised",
                "You are not signed in to the hub.",
            ))
        })
    };
    let report = |_: &UploadState| {};
    let env = Env {
        hub_url: &rig.hub.base,
        token: &token,
        pacing: rig.pacing,
        cancel: &rig.cancel,
        report: &report,
    };

    let state = run(
        &env,
        state_for(&rig.facts, &rig.hub.base),
        &rig.path,
        &Sending::Archive(&rig.facts),
    )
    .await;

    assert_eq!(stopped(&state), (Source::Local, "unauthorised".into()));
    assert!(rig.hub.reservations().is_empty());
}

#[tokio::test]
async fn an_archive_that_changed_since_its_details_were_read_is_not_sent() {
    let mut rig = Rig::new("changed", 4);
    rig.facts.size += 1;

    let (state, _) = rig.run().await;

    assert_eq!(stopped(&state), (Source::Local, "file_changed".into()));
    assert!(rig.hub.reservations().is_empty());
}

// ------------------------------------------------------- mirror refusals

#[tokio::test]
async fn a_name_the_mirror_already_has_is_its_own_result() {
    // jj holds a hand-placed file called persepolis, so this is the answer a
    // real upload of that name gets.
    let rig = Rig::new("exists", 1 << 20);
    rig.mirror.with_state(|m| m.finish = Finish::Exists);

    let (state, _) = rig.run().await;

    let Some(Outcome::Stopped {
        source,
        code,
        status,
        said,
        ..
    }) = &state.outcome
    else {
        panic!("{:?}", state.outcome);
    };
    assert_eq!(
        (*source, code.as_str(), *status),
        (Source::Mirror, "exists", Some(409))
    );
    assert!(said.contains("already has a file with this name"), "{said}");
    assert_eq!(rig.mirror.posts().len(), 1, "final, so not sent again");
}

#[tokio::test]
async fn a_hash_the_mirror_does_not_recognise_is_final() {
    let rig = Rig::new("hash", 1 << 20);
    rig.mirror.with_state(|m| m.finish = Finish::HashMismatch);

    let (state, _) = rig.run().await;

    assert_eq!(stopped(&state), (Source::Mirror, "hash_mismatch".into()));
    assert_eq!(rig.mirror.posts().len(), 1);
}

#[tokio::test]
async fn the_other_final_mirror_answers_each_end_the_run_at_once() {
    let cases = [
        (410, "removed"),
        (403, "bad_token"),
        (403, "wrong_mirror"),
        (413, "too_large"),
        (405, "method_not_allowed"),
    ];
    for (status, code) in cases {
        let rig = Rig::new("mirror-final", 4);
        rig.mirror
            .with_state(|m| m.canned_post = Some((status, json!({ "error": code }))));

        let (state, _) = rig.run().await;

        assert_eq!(stopped(&state), (Source::Mirror, code.into()), "{code}");
        assert_eq!(rig.mirror.posts().len(), 1, "{code} is final");
    }
}

#[tokio::test]
async fn a_mirror_that_keeps_failing_is_tried_a_few_times_then_reported() {
    let rig = Rig::new("mirror-5xx", 4);
    rig.mirror.with_state(|m| {
        m.canned_post = Some((500, json!({ "error": "write_failed" })));
    });

    let (state, _) = rig.run().await;

    assert_eq!(stopped(&state), (Source::Mirror, "write_failed".into()));
    assert_eq!(rig.mirror.posts().len() as u32, UPLOAD_ATTEMPTS);
}

#[tokio::test]
async fn a_mirror_with_uploads_turned_off_is_reported_before_anything_is_sent() {
    let rig = Rig::new("disabled", 4);
    rig.mirror
        .with_state(|m| m.limits = Some((503, json!({ "error": "uploads_disabled" }))));

    let (state, _) = rig.run().await;

    assert_eq!(stopped(&state), (Source::Mirror, "uploads_disabled".into()));
    assert!(rig.mirror.posts().is_empty());
}

// ---------------------------------------------------- what a page is given

#[test]
fn the_state_a_page_reads_has_the_documented_shape() {
    let mut state = state_for(&facts_for(&"b".repeat(64), 10), "https://hub.example");
    state.phase = Phase::Done;
    state.upload_id = Some(UPLOAD_ID.into());
    state.outcome = Some(Outcome::Listed);

    let listed = serde_json::to_value(&state).unwrap();

    assert_eq!(listed["opId"], "op");
    assert_eq!(listed["phase"], "done");
    assert_eq!(listed["kind"], "map");
    assert_eq!(listed["uploadId"], UPLOAD_ID);
    assert_eq!(listed["outcome"], json!({ "kind": "listed" }));

    state.outcome = Some(Outcome::Stopped {
        source: Source::Hub,
        code: "duplicate".into(),
        status: Some(409),
        said: "The hub already has this archive.".into(),
        duplicate: Some(Duplicate {
            check: Some("sha256".into()),
            filename: None,
            kind: None,
            state: Some("listed".into()),
            url: None,
        }),
    });
    let stopped = serde_json::to_value(&state).unwrap();
    assert_eq!(
        stopped["outcome"],
        json!({
            "kind": "stopped",
            "source": "hub",
            "code": "duplicate",
            "status": 409,
            "said": "The hub already has this archive.",
            "duplicate": {
                "check": "sha256",
                "filename": null,
                "kind": null,
                "state": "listed",
                "url": null,
            },
        })
    );
}

#[test]
fn the_facts_unitsync_answers_with_are_read_as_they_come() {
    let facts: ArchiveFacts = serde_json::from_value(json!({
        "sha256": "c".repeat(64),
        "size": 12,
        "filename": "game.sdz",
        "kind": "game",
        "internal_name": "Game 1",
        "version": "",
        "shortname": "game",
        "author": null,
        "description": null,
    }))
    .unwrap();

    assert_eq!(facts.kind, ArchiveKind::Game);
    assert_eq!(facts.shortname.as_deref(), Some("game"));
}

// -------------------------------------------------------------- the registry

fn claimable(sha256: &str, hub: &str, op_id: &str) -> UploadState {
    let mut state = state_for(&facts_for(sha256, 10), hub);
    state.op_id = op_id.into();
    state
}

#[test]
fn starting_an_archive_that_is_already_on_its_way_answers_the_running_upload() {
    let sha = "d".repeat(64);
    let first = claimable(&sha, "https://hub.example", "first");
    assert!(claim(&first, &Arc::new(AtomicBool::new(false))).is_none());

    let again = claimable(&sha, "https://hub.example", "second");
    let running = claim(&again, &Arc::new(AtomicBool::new(false))).expect("the first one");

    assert_eq!(running.op_id, "first");
    assert!(list().iter().all(|s| s.op_id != "second"));
}

#[test]
fn a_finished_upload_is_replaced_by_the_next_send_of_the_same_archive() {
    let sha = "e".repeat(64);
    let first = claimable(&sha, "https://hub.example", "old");
    assert!(claim(&first, &Arc::new(AtomicBool::new(false))).is_none());
    let mut done = first.clone();
    done.phase = Phase::Done;
    done.outcome = Some(Outcome::Cancelled);
    update("old", &done);

    let next = claimable(&sha, "https://hub.example", "new");
    assert!(claim(&next, &Arc::new(AtomicBool::new(false))).is_none());

    let mine: Vec<String> = list()
        .into_iter()
        .filter(|s| s.sha256 == sha)
        .map(|s| s.op_id)
        .collect();
    assert_eq!(mine, vec!["new"]);
}

#[test]
fn cancel_raises_the_flag_of_the_upload_it_is_given_and_no_other() {
    let sha = "f".repeat(64);
    let other = "9".repeat(64);
    let flag = Arc::new(AtomicBool::new(false));
    let untouched = Arc::new(AtomicBool::new(false));
    assert!(claim(&claimable(&sha, "https://hub.example", "mine"), &flag).is_none());
    assert!(claim(
        &claimable(&other, "https://hub.example", "theirs"),
        &untouched
    )
    .is_none());

    cancel("mine");
    cancel("nobody");

    assert!(flag.load(Ordering::Relaxed));
    assert!(!untouched.load(Ordering::Relaxed));
}

// ------------------------------------------------------------------- replays

const GAME_ID: &str = "9f2c4b1ad07e5386c1f4a92b6e8d0375";

fn replay_request(size: u64) -> ReplayRequest {
    ReplayRequest {
        game_id: GAME_ID.into(),
        sha256: "c".repeat(64),
        size,
        name: "Alice".into(),
        summary: json!({ "v": 1, "players": [{ "name": "Alice" }] }),
    }
}

fn listed(url: &str) -> Option<(u16, Value)> {
    Some((
        200,
        json!({ "replay": { "game_id": GAME_ID, "state": "listed", "url": url } }),
    ))
}

fn checking() -> Option<(u16, Value)> {
    Some((
        200,
        json!({ "replay": { "game_id": GAME_ID, "state": "checking", "url": null } }),
    ))
}

impl Rig {
    async fn run_replay(&self) -> (UploadState, Vec<UploadState>) {
        let reports = Mutex::new(Vec::new());
        let report = |state: &UploadState| reports.lock().unwrap().push(state.clone());
        let token = || -> TokenFuture { Box::pin(async { Ok("hub-bearer".to_owned()) }) };
        let env = Env {
            hub_url: &self.hub.base,
            token: &token,
            pacing: self.pacing,
            cancel: &self.cancel,
            report: &report,
        };
        let request = replay_request(ARCHIVE.len() as u64);
        let mut state = state_for(&self.facts, &self.hub.base);
        state.kind = ArchiveKind::Replay;
        let state = run(&env, state, &self.path, &Sending::Replay(&request)).await;
        (state, reports.into_inner().unwrap())
    }
}

#[tokio::test]
async fn a_replay_goes_to_the_replay_route_then_waits_for_the_check_to_list_it() {
    let rig = Rig::new("replay-sent", 1 << 20).with_hub(|hub| {
        hub.replaying(vec![
            None,
            checking(),
            checking(),
            listed("https://hub.example/replays/x"),
        ])
    });

    let (state, reports) = rig.run_replay().await;

    assert_eq!(state.outcome, Some(Outcome::Listed));
    assert_eq!(rig.mirror.held(), ARCHIVE);
    assert_eq!(
        state.page_url.as_deref(),
        Some("https://hub.example/replays/x")
    );
    assert!(!state.held_already);
    assert!(rig.hub.reservations().is_empty());
    assert_eq!(rig.hub.polls(), 0, "a replay has no upload status route");
    let requests = rig.hub.replay_requests();
    assert_eq!(requests.len(), 4);
    assert_eq!(requests[0].0.as_deref(), Some("Bearer hub-bearer"));
    let sent: Value = serde_json::from_str(&requests[0].1).unwrap();
    assert_eq!(sent["game_id"], GAME_ID);
    assert_eq!(sent["size"], ARCHIVE.len());
    assert_eq!(sent["name"], "Alice");
    assert_eq!(sent["summary"]["v"], 1);
    assert!(reports.iter().any(|r| r.phase == Phase::Waiting));
}

#[tokio::test]
async fn a_replay_the_hub_lists_already_uploads_nothing_and_links_its_page() {
    let rig = Rig::new("replay-held", 1 << 20)
        .with_hub(|hub| hub.replaying(vec![listed("https://hub.example/replays/x")]));

    let (state, _) = rig.run_replay().await;

    assert_eq!(state.outcome, Some(Outcome::Listed));
    assert!(state.held_already);
    assert_eq!(
        state.page_url.as_deref(),
        Some("https://hub.example/replays/x")
    );
    assert!(rig.mirror.posts().is_empty());
    assert_eq!(rig.hub.replay_requests().len(), 1);
}

#[tokio::test]
async fn a_replay_the_hub_is_still_checking_is_waited_for_without_uploading() {
    let rig = Rig::new("replay-checking", 1 << 20)
        .with_hub(|hub| hub.replaying(vec![checking(), listed("https://hub.example/replays/x")]));

    let (state, _) = rig.run_replay().await;

    assert_eq!(state.outcome, Some(Outcome::Listed));
    assert!(state.held_already);
    assert!(rig.mirror.posts().is_empty());
}

#[tokio::test]
async fn a_replay_the_hub_reserves_afresh_after_the_upload_was_not_kept() {
    let fresh = Some((
        201,
        json!({ "upload": {
            "id": "another", "upload_url": "x", "limits_url": "y", "token": "t",
        }}),
    ));
    let rig = Rig::new("replay-refused", 1 << 20)
        .with_hub(|hub| hub.replaying(vec![None, checking(), fresh]));

    let (state, _) = rig.run_replay().await;

    assert_eq!(stopped(&state), (Source::Hub, "not_kept".to_owned()));
    assert!(
        !rig.hub.status_requests().is_empty(),
        "the status route is tried before the old way"
    );
}

/// A `200` from the status route.
fn status(state: &str, url: Option<&str>, refusal: Value) -> (u16, Value) {
    (
        200,
        json!({ "replay": {
            "game_id": GAME_ID,
            "state": state,
            "url": url,
            "reserved_until": null,
            "refusal": refusal,
        }}),
    )
}

#[tokio::test]
async fn a_replay_s_check_is_followed_on_the_status_route_without_asking_again() {
    let rig = Rig::new("replay-status-listed", 1 << 20).with_hub(|hub| {
        hub.replaying(vec![None]).replay_status(vec![
            status("uploading", None, Value::Null),
            status("checking", None, Value::Null),
            status("listed", Some("https://hub.example/replays/x"), Value::Null),
        ])
    });

    let (state, _) = rig.run_replay().await;

    assert_eq!(state.outcome, Some(Outcome::Listed));
    assert_eq!(
        state.page_url.as_deref(),
        Some("https://hub.example/replays/x")
    );
    assert_eq!(rig.hub.replay_requests().len(), 1);
    let asked = rig.hub.status_requests();
    assert_eq!(asked.len(), 3);
    assert_eq!(asked[0].as_deref(), Some("Bearer hub-bearer"));
}

#[tokio::test]
async fn a_replay_the_check_refuses_ends_with_the_hub_s_reason() {
    let rig = Rig::new("replay-status-refused", 1 << 20).with_hub(|hub| {
        hub.replaying(vec![None]).replay_status(vec![status(
            "refused",
            None,
            json!({
                "reason": "summary_mismatch",
                "message": "What was sent does not agree with the file.",
                "refused_at": 1,
            }),
        )])
    });

    let (state, _) = rig.run_replay().await;

    assert_eq!(
        stopped(&state),
        (Source::Hub, "refused_summary_mismatch".to_owned())
    );
    let Some(Outcome::Stopped { said, .. }) = &state.outcome else {
        unreachable!()
    };
    assert_eq!(said, "What was sent does not agree with the file.");
    assert_eq!(rig.hub.replay_requests().len(), 1);
}

#[tokio::test]
async fn a_replay_the_hub_was_already_checking_can_end_refused() {
    let rig = Rig::new("replay-status-held", 1 << 20).with_hub(|hub| {
        hub.replaying(vec![checking()]).replay_status(vec![status(
            "refused",
            None,
            json!({ "reason": "a_newer_reason", "message": "Why.", "refused_at": 1 }),
        )])
    });

    let (state, _) = rig.run_replay().await;

    assert_eq!(
        stopped(&state),
        (Source::Hub, "refused_a_newer_reason".to_owned())
    );
    assert!(rig.mirror.posts().is_empty());
    assert_eq!(rig.hub.replay_requests().len(), 1);
}

#[tokio::test]
async fn each_other_end_the_status_route_reports_has_its_own_code() {
    let not_sent = (404, json!({ "error": "No record.", "reason": "not_sent" }));
    for (tag, answer, code) in [
        ("lapsed", status("lapsed", None, Value::Null), "lapsed"),
        (
            "removed",
            status("removed", None, Value::Null),
            "replay_removed",
        ),
        (
            "unknown",
            status("a_newer_state", None, Value::Null),
            "not_kept",
        ),
        ("not-sent", not_sent, "not_sent"),
        ("signed-out", (401, json!({})), "unauthorised"),
    ] {
        let rig = Rig::new(&format!("replay-status-{tag}"), 1 << 20)
            .with_hub(|hub| hub.replaying(vec![None]).replay_status(vec![answer]));

        let (state, _) = rig.run_replay().await;

        assert_eq!(stopped(&state), (Source::Hub, code.to_owned()), "{tag}");
        assert_eq!(rig.hub.replay_requests().len(), 1, "{tag}");
    }
}

#[tokio::test]
async fn a_hub_in_trouble_is_asked_for_the_status_again() {
    let rig = Rig::new("replay-status-503", 1 << 20).with_hub(|hub| {
        hub.replaying(vec![None]).replay_status(vec![
            (503, json!({})),
            (429, json!({})),
            status("listed", None, Value::Null),
        ])
    });

    let (state, _) = rig.run_replay().await;

    assert_eq!(state.outcome, Some(Outcome::Listed));
    assert_eq!(rig.hub.replay_requests().len(), 1);
}

#[tokio::test]
async fn a_status_answer_that_cannot_be_read_falls_back_to_asking_again() {
    let rig = Rig::new("replay-status-unread", 1 << 20).with_hub(|hub| {
        hub.replaying(vec![None, listed("https://hub.example/replays/x")])
            .replay_status(vec![(200, json!({ "something": "else" }))])
    });

    let (state, _) = rig.run_replay().await;

    assert_eq!(state.outcome, Some(Outcome::Listed));
    assert_eq!(rig.hub.replay_requests().len(), 2);
}

#[tokio::test]
async fn a_replay_refused_at_the_start_carries_the_hub_s_reason() {
    let rig = Rig::new("replay-not-in", 1 << 20).with_hub(|hub| {
        hub.replaying(vec![Some((
            422,
            json!({ "error": "Nobody called \"Bob\" played or watched this match.", "reason": "not_in_replay" }),
        ))])
    });

    let (state, _) = rig.run_replay().await;

    assert_eq!(stopped(&state), (Source::Hub, "not_in_replay".to_owned()));
    let Some(Outcome::Stopped { said, status, .. }) = &state.outcome else {
        unreachable!()
    };
    assert_eq!(said, "Nobody called \"Bob\" played or watched this match.");
    assert_eq!(*status, Some(422));
    assert!(rig.mirror.posts().is_empty());
}

#[tokio::test]
async fn a_replay_someone_else_is_sending_stops_with_uploading() {
    let rig = Rig::new("replay-busy", 1 << 20).with_hub(|hub| {
        hub.replaying(vec![Some((
            409,
            json!({ "error": "Someone else is sending this match just now. Try again later.", "reason": "uploading", "reserved_until": 3 }),
        ))])
    });

    let (state, _) = rig.run_replay().await;

    assert_eq!(stopped(&state), (Source::Hub, "uploading".to_owned()));
}

#[test]
fn a_replay_file_is_hashed_whole() {
    let path = archive_dir("replay-hash").join("x.sdfz");
    std::fs::write(&path, b"abc").unwrap();
    let (sha, size) = hash_file(&path).unwrap();
    assert_eq!(
        sha,
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
    assert_eq!(size, 3);
}

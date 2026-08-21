//! Coilbox hub account (Rust half).
//!
//! Ten commands: three about who is signed in to the hub, one that publishes as
//! them, three about sending pictures made from local archives, two about
//! sending what coilbox read out of a map ([`maps`], issue #1736) and one about
//! sending what it read out of a game ([`games`], issue #1875). None of them
//! hands a token out. Registered as `"coilbox-hub"`, so the frontend invokes
//! `plugin:coilbox-hub|<cmd>`. The flow they sit on is [`auth`], and the request
//! that uses its token is [`publish`].
//!
//! [`have`] is the first call the upload path makes, and it has two callers. The
//! upload asks for itself, before it sends anything, and the webview asks through
//! `hub_assets_have` before it *makes* anything, which is the only way a render's
//! check can come first (issue #1636).
//!
//! [`consent`] is what stands in front of it. Sending pictures made from local game
//! files to a public gallery is off until the user turns it on, and that check reads
//! the setting off disk here rather than trusting an argument. Anything that uploads
//! takes the proof it hands back.
//!
//! Every command takes the hub address rather than knowing one. It is a user
//! setting layered over a distribution profile's own (`src/hub/config.ts`), so the
//! frontend is the only place that can resolve it.

pub mod auth;
pub mod consent;
mod endpoint;
pub mod games;
pub mod have;
pub mod maps;
pub mod publish;
#[cfg(test)]
mod testing;
pub mod upload;

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};

use picoframe_core::CliResult;
use serde_json::{json, Value};
use tauri::{
    ipc::Channel,
    plugin::{Builder, TauriPlugin},
    AppHandle, Runtime,
};

use upload::{AssetUpload, AssetUploadProgress};

/// `hub_sign_in`: sign in to a hub with Discord, through the system browser.
///
/// Resolves only once the user has finished there, which can take a minute, and
/// fails if they never do. What comes back is who signed in. The refresh token goes
/// to the OS keychain and the access token stays in memory on the Rust side, so no
/// token crosses this boundary.
///
/// `problem` beside the account is a sign-in that worked but was not kept, most
/// often a keychain that did not answer inside its deadline (issue #1469). It is
/// not an error, because the session is signed in either way, and it is not
/// nothing, because the next run may not be.
#[tauri::command]
async fn hub_sign_in(hub_url: String) -> CliResult {
    let open =
        |url: &str| tauri_plugin_opener::open_url(url, None::<&str>).map_err(|e| e.to_string());
    match auth::sign_in(&hub_url, open).await {
        Ok(signed_in) => CliResult::ok(json!({
            "account": signed_in.identity,
            "problem": signed_in.problem,
        })),
        Err(e) => CliResult::err(auth::explain(&e, &hub_url)),
    }
}

/// `hub_sign_out`: forget this machine's sign-in to a hub.
///
/// This machine is as far as it goes. Coilbox holds a publishable key, which cannot
/// revoke anything, so the token stops being usable here and stays alive in the
/// hub's project. Say that rather than promise more.
///
/// It always answers. The keychain delete has a deadline (issue #1469), so a
/// permission prompt nobody clicks ends the sign-out with words rather than
/// leaving the button spinning for the rest of the session.
#[tauri::command]
async fn hub_sign_out(hub_url: String) -> CliResult {
    match auth::sign_out(&hub_url).await {
        Ok(()) => CliResult::ok(json!({})),
        Err(e) => CliResult::err(auth::explain(&e, &hub_url)),
    }
}

/// `hub_account`: who is signed in to a hub, if anybody.
///
/// `signedIn` and `problem` are separate answers because the two ways this goes
/// wrong need different words. A refresh token the project has thrown away means
/// signed out, and the user has to go through the browser again. A hub nobody can
/// reach means nothing at all about the sign-in, and telling somebody on a flaky
/// connection that they have been signed out would be a lie.
///
/// The first call after a restart costs one refresh, because the name arrives
/// beside the token and there is nothing on disk that remembers it.
///
/// It always answers. The keychain read it starts with has a deadline (issue
/// #1456), so a prompt nobody has clicked ends as an error the reader can act on
/// rather than a command that stays pending for the rest of the session.
#[tauri::command]
async fn hub_account(hub_url: String) -> CliResult {
    let answer = |signed_in: bool, account: Value, problem: Value| {
        CliResult::ok(json!({
            "signedIn": signed_in,
            "account": account,
            "problem": problem,
        }))
    };
    match auth::signed_in(&hub_url).await {
        Err(e) => return CliResult::err(auth::explain(&e, &hub_url)),
        Ok(false) => return answer(false, Value::Null, Value::Null),
        Ok(true) => {}
    }
    if let Some(identity) = auth::cached_identity(&hub_url) {
        return answer(true, json!(identity), Value::Null);
    }
    // Nothing known yet, so the stored token is spent on finding out. The token
    // itself is dropped here: this is the one command that never needs it.
    match auth::access_token(&hub_url).await {
        Ok(_) => match auth::cached_identity(&hub_url) {
            Some(identity) => answer(true, json!(identity), Value::Null),
            None => answer(true, Value::Null, Value::Null),
        },
        Err(e) if e.needs_sign_in() => {
            answer(false, Value::Null, json!(auth::explain(&e, &hub_url)))
        }
        Err(e) => answer(true, Value::Null, json!(auth::explain(&e, &hub_url))),
    }
}

/// `hub_publish`: publish a share code to a hub, as whoever is signed in.
///
/// The request is made here because the access token is here. What comes back is
/// the hub's own answer, `status` and `body`, rather than a verdict: which status
/// means what is the hub's API talking, and `src/hub/publish.ts` already owns that
/// vocabulary for the read side. An error is only for what the frontend cannot see
/// for itself - no usable sign-in, or the hub never answering.
#[tauri::command]
async fn hub_publish(
    hub_url: String,
    code: String,
    title: String,
    description: String,
    tags: Vec<String>,
) -> CliResult {
    let publication = publish::Publication {
        code,
        title,
        description,
        tags,
    };
    match publish::publish(&hub_url, &publication).await {
        Ok(answer) => CliResult::ok(json!({
            "status": answer.status,
            "body": answer.body.unwrap_or(Value::Null),
        })),
        Err(said) => CliResult::err(said),
    }
}

/// `hub_assets_have`: ask the hub which of these pictures it still wants.
///
/// The same check [`upload::upload_all`] makes for itself, exposed because the
/// webview has to be able to ask *before* it makes a picture (issue #1636). A
/// render is drawn in the webview and its `source_hash` is over the model rather
/// than the pixels, so `unitsync_unit_render_keys` can name one without drawing
/// it. Asking here is what turns that into a saved render, and rendering to find
/// out the hub already had it is the cost the whole design exists to avoid.
///
/// The consent check runs here for the same reason it runs on the upload: this
/// spends the hub's request allowance as the signed-in account, so it is not
/// something a webview gets to start without the user having agreed to it.
///
/// Keys the hub cannot answer are refused before anything is sent, so a typo
/// costs nothing. Answers come back in the order the keys were given.
#[tauri::command]
async fn hub_assets_have<R: Runtime>(
    app: AppHandle<R>,
    hub_url: String,
    keys: Vec<have::AssetKey>,
) -> CliResult {
    let consent = match consent::AssetUploadConsent::check(&app) {
        Ok(consent) => consent,
        Err(refused) => return CliResult::err(refused),
    };
    match have::have(&hub_url, &keys, &consent).await {
        Ok(results) => CliResult::ok(json!({ "results": results })),
        Err(said) => CliResult::err(said),
    }
}

/// Maps a caller-supplied op id to the flag its run polls, so `hub_upload_cancel`
/// can stop an upload somebody else started. The same shape as the downloads
/// plugin's registry, minus its child process slot: there is no child here.
fn cancel_registry() -> &'static Mutex<HashMap<String, Arc<AtomicBool>>> {
    static REG: OnceLock<Mutex<HashMap<String, Arc<AtomicBool>>>> = OnceLock::new();
    REG.get_or_init(|| Mutex::new(HashMap::new()))
}

/// The flag for a run. Registered when the caller supplied an `op_id`, so
/// `hub_upload_cancel` can find it, and standalone otherwise.
fn cancel_slot(op_id: &Option<String>) -> Arc<AtomicBool> {
    let flag = Arc::new(AtomicBool::new(false));
    if let Some(id) = op_id {
        cancel_registry()
            .lock()
            .unwrap()
            .insert(id.clone(), flag.clone());
    }
    flag
}

/// `hub_upload_assets`: send pictures made from local archives to a hub, as
/// whoever is signed in.
///
/// The consent check runs here and nowhere else (issue #1635). It reads the user's
/// setting and the distribution profile off disk rather than trusting an argument,
/// so nothing the webview passes can turn an upload on, and the proof it hands back
/// is what [`upload::upload_all`] requires to be called at all.
///
/// The have check runs before anything is sent, so an asset the hub already holds
/// costs one key in a batch rather than a transfer. What comes back is one outcome
/// per asset in the order they were given, carrying the hub's own status and words
/// for a refusal plus an [`upload::Verdict`] saying whether another request would
/// answer any differently. `src/hub/uploadOutcomes.ts` is what turns a run's worth
/// of those into something a person is told (issue #1634).
///
/// `out_of_date` comes back true only when the run had a terminal refusal and the
/// hub names an asset vocabulary this build does not hold (issue #1708). It turns
/// "the hub would not take 40 pictures" into "update coilbox", which is the one
/// thing the reader can act on.
///
/// `op_id` makes the run cancellable by `hub_upload_cancel`. `on_progress` takes a
/// sample per asset.
#[tauri::command]
async fn hub_upload_assets<R: Runtime>(
    app: AppHandle<R>,
    hub_url: String,
    assets: Vec<AssetUpload>,
    op_id: Option<String>,
    on_progress: Channel<AssetUploadProgress>,
) -> CliResult {
    let consent = match consent::AssetUploadConsent::check(&app) {
        Ok(consent) => consent,
        Err(refused) => return CliResult::err(refused),
    };
    let cancel = cancel_slot(&op_id);
    let report = move |sample: AssetUploadProgress| {
        let _ = on_progress.send(sample);
    };
    let sent = upload::upload_all(&hub_url, &assets, &consent, &report, &cancel).await;
    if let Some(id) = &op_id {
        cancel_registry().lock().unwrap().remove(id);
    }
    match sent {
        Ok(outcomes) => {
            // Only on the failing path, and only after the run, so a healthy
            // backfill spends nothing finding out it was fine (issue #1708).
            let out_of_date = upload::has_terminal_refusal(&outcomes)
                && auth::is_behind_hub_vocabulary(&hub_url).await;
            CliResult::ok(json!({ "outcomes": outcomes, "outOfDate": out_of_date }))
        }
        Err(said) => CliResult::err(said),
    }
}

/// `hub_maps_have`: ask the hub which maps' facts it still wants.
///
/// The first call the catalog path makes, and the reason a library of three
/// thousand maps costs six requests rather than three thousand writes. Answers
/// come back in the order the keys were given, and a batch the hub does not
/// answer in that order is refused rather than lined up wrongly.
///
/// Behind the same consent gate the pictures use. This spends the hub's request
/// allowance as the signed-in account, and what it is asking about is what
/// coilbox read off local archives, which is the thing the switch is about.
#[tauri::command]
async fn hub_maps_have<R: Runtime>(
    app: AppHandle<R>,
    hub_url: String,
    keys: Vec<maps::MapHaveKey>,
) -> CliResult {
    let consent = match consent::AssetUploadConsent::check(&app) {
        Ok(consent) => consent,
        Err(refused) => return CliResult::err(refused),
    };
    match maps::have_maps(&hub_url, &keys, &consent).await {
        Ok(results) => CliResult::ok(json!({ "results": results })),
        Err(said) => CliResult::err(said),
    }
}

/// `hub_publish_maps`: send what coilbox read out of these maps to the hub.
///
/// One outcome per entry, in the order they were given. The outcomes are inside
/// a 200 rather than in the status, because a batch carries fifty maps and one
/// the hub will not take says nothing about the other forty nine, so a caller
/// reads every result rather than the status code.
///
/// Only `conflict` and `refused` are worth surfacing, and only as a count. A
/// conflict is the interesting one: it means an archive on this machine differs
/// from the one everybody else has under that name.
#[tauri::command]
async fn hub_publish_maps<R: Runtime>(
    app: AppHandle<R>,
    hub_url: String,
    entries: Vec<coilbox_map_catalog::MapCatalogEntry>,
) -> CliResult {
    let consent = match consent::AssetUploadConsent::check(&app) {
        Ok(consent) => consent,
        Err(refused) => return CliResult::err(refused),
    };
    match maps::publish_maps(&hub_url, &entries, &consent).await {
        Ok(results) => CliResult::ok(json!({ "results": results })),
        Err(said) => CliResult::err(said),
    }
}

/// `hub_publish_game_facts`: send what a game says about its units to the hub.
///
/// One request is one whole game (issue #1875). The submission declares itself
/// complete, so the hub retires every unit it did not name, and half a game
/// would retire the other half.
///
/// One outcome per unit inside a 200. `accepted` and `recorded` are the hub
/// writing something down, `unchanged` is the ordinary answer for a game that
/// has not moved since the last run, and `refused` carries the hub's own words
/// for the one unit it objected to. A body the hub will not parse at all is an
/// error rather than a list of refusals, because nothing in that answer is about
/// any particular unit.
#[tauri::command]
async fn hub_publish_game_facts<R: Runtime>(
    app: AppHandle<R>,
    hub_url: String,
    game: games::GameFacts,
) -> CliResult {
    let consent = match consent::AssetUploadConsent::check(&app) {
        Ok(consent) => consent,
        Err(refused) => return CliResult::err(refused),
    };
    match games::publish_game_facts(&hub_url, &game, &consent).await {
        Ok(results) => CliResult::ok(json!({ "results": results })),
        Err(said) => CliResult::err(said),
    }
}

/// `hub_upload_cancel`: stop a running upload by its `op_id`. The run drops the
/// request it has in flight and leaves the rest untried. A no-op for an unknown or
/// finished id.
#[tauri::command]
fn hub_upload_cancel(op_id: String) -> CliResult {
    if let Some(flag) = cancel_registry().lock().unwrap().get(&op_id) {
        flag.store(true, Ordering::Relaxed);
    }
    CliResult::ok(json!({}))
}

/// Build the plugin. Registered as `"coilbox-hub"`.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("coilbox-hub")
        .invoke_handler(tauri::generate_handler![
            hub_sign_in,
            hub_sign_out,
            hub_account,
            hub_publish,
            hub_assets_have,
            hub_upload_assets,
            hub_upload_cancel,
            hub_maps_have,
            hub_publish_maps,
            hub_publish_game_facts
        ])
        .build()
}

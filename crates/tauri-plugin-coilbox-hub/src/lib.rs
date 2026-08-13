//! Coilbox hub account (Rust half).
//!
//! Four commands: three about who is signed in to the hub, and one that publishes
//! as them. None of them hands a token out. Registered as `"coilbox-hub"`, so the
//! frontend invokes `plugin:coilbox-hub|<cmd>`. The flow they sit on is [`auth`],
//! and the request that uses its token is [`publish`].
//!
//! Every command takes the hub address rather than knowing one. It is a user
//! setting layered over a distribution profile's own (`src/hub/config.ts`), so the
//! frontend is the only place that can resolve it.

pub mod auth;
pub mod publish;

use picoframe_core::CliResult;
use serde_json::{json, Value};
use tauri::{
    plugin::{Builder, TauriPlugin},
    Runtime,
};

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

/// Build the plugin. Registered as `"coilbox-hub"`.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("coilbox-hub")
        .invoke_handler(tauri::generate_handler![
            hub_sign_in,
            hub_sign_out,
            hub_account,
            hub_publish
        ])
        .build()
}

//! `--unit-render-keys` mode: what a batch of units' renders will be called,
//! worked out without drawing any of them (issues #1672 and #1666).
//!
//! The have check at #1632 asks the hub with a `source_hash`, so a caller holds
//! one before it decides whether to make the picture. Every other class can:
//! a build pic or a map layer hashes archive bytes the caller is already reading.
//! A render could not, because the only route to its `source_hash` ran through
//! `--unit-render`, which takes pixels that have already been drawn. Asking "do
//! you already have this render?" meant doing the render first, which is the
//! expensive thing the question exists to avoid.
//!
//! The archive read is unavoidable: the digest is over the model and its
//! textures and nothing else can produce it. The render and the encode are not,
//! and this mode does neither.
//!
//! It takes a list rather than one unit, which is the other half of the same
//! change (#1666). A blueprint names ten or twenty buildings, and one
//! `AddAllArchives` per unit is a second or more each on a game like Beyond All
//! Reason. Here the mount, the member listing and the digest of a shared model
//! are all paid once for the whole list, in the shape `buildpic::resolve` and
//! `dataset::resolve` already use.
//!
//! What it deliberately does not do is decide which units to ask about. That is
//! the caller's, because the allowance the hub's answers spend is shared across
//! everybody using it (#1636).

use std::collections::BTreeMap;
use std::path::Path;

use crate::ffi::Unitsync;
use crate::model::{RenderSkip, UnitRenderKey, UnitRenderKeyRequest, UnitRenderKeysOutput};

/// Work out every angle's render key for each of `requests` against
/// `game_archive`.
///
/// `angles` are render angles without the `render:` prefix, each checked against
/// the vocabulary rather than accepted, so a typo cannot mint keys the hub has no
/// reader for. `renderer_version` is the webview's `RENDER_VERSION`, since the
/// side that draws is the side that knows what drew it.
///
/// All the angles are answered from one mount (issue #1951). What the archive is
/// read for is the model digest, and every angle of one unit shares it, so the
/// angles cost arithmetic rather than another `AddAllArchives`.
pub fn render(
    lib: &str,
    game_archive: &str,
    requests: &[UnitRenderKeyRequest],
    angles: &[String],
    renderer_version: u32,
) -> UnitRenderKeysOutput {
    let variants = match variants_for(angles) {
        Ok(v) => v,
        Err(unknown) => {
            return UnitRenderKeysOutput {
                errors: vec![format!(
                    "{unknown:?} is not a render angle the hub keeps, so there is no key to give \
                     for it"
                )],
                ..Default::default()
            }
        }
    };

    let us = match unsafe { Unitsync::load(Path::new(lib)) } {
        Ok(u) => u,
        Err(e) => {
            return UnitRenderKeysOutput {
                errors: vec![e],
                ..Default::default()
            }
        }
    };
    us.init(false, 0);
    let out = resolve(&us, game_archive, requests, &variants, renderer_version);
    us.uninit();
    out
}

/// Each angle paired with its full variant, or the first one the vocabulary does
/// not list. The same check `unitrender` makes, so a key and a render agree about
/// what an angle is.
///
/// One unknown angle refuses the whole batch rather than dropping itself. A
/// caller asking for four angles and silently getting three would offer the hub
/// three quarters of a unit and read as though it had offered all of it.
fn variants_for(angles: &[String]) -> Result<Vec<(String, String)>, String> {
    let known = &coilbox_assets::vocabulary().unit.render_angles;
    angles
        .iter()
        .map(|angle| {
            known
                .iter()
                .any(|a| a == angle)
                .then(|| (angle.clone(), coilbox_assets::render_variant(angle)))
                .ok_or_else(|| angle.clone())
        })
        .collect()
}

/// Read the digests in a session the caller has already initialised, mounting the
/// game's archive set once for the whole batch and unmounting before it returns.
///
/// Split out the way the other batch modes are, so a walk over several games can
/// cover them all in one `Init`.
pub(crate) fn resolve(
    us: &Unitsync,
    game_archive: &str,
    requests: &[UnitRenderKeyRequest],
    variants: &[(String, String)],
    renderer_version: u32,
) -> UnitRenderKeysOutput {
    let mut errors = us.drain_errors();
    if requests.is_empty() {
        return UnitRenderKeysOutput {
            errors,
            ..Default::default()
        };
    }

    if !us.add_all_archives(game_archive) {
        errors.push("this engine's libunitsync can't load game archives".into());
        return UnitRenderKeysOutput {
            errors,
            ..Default::default()
        };
    }
    errors.extend(us.drain_errors());

    let handle = crate::archive::resolve_open_path(us, game_archive)
        .as_deref()
        .and_then(|p| us.open_archive(p));
    let Some(handle) = handle else {
        us.remove_all_archives();
        errors.push(format!("could not open archive {game_archive}"));
        return UnitRenderKeysOutput {
            errors,
            ..Default::default()
        };
    };

    let list: Vec<(String, String)> = us
        .list_archive_files(handle)
        .into_iter()
        .map(|(path, _)| (path.to_lowercase(), path))
        .collect();

    let digest = crate::unitmodel::digest_reader(us, handle, &list);
    // Read inside the session, since the archive list goes with unitsync. One per
    // batch because a batch is one game, and it is here so `--unit-render` can be
    // handed the whole of what it would otherwise mount for (issue #1720).
    let source_archive = crate::archive::archive_name_for_game(us, game_archive);
    let batch = build_keys(requests, variants, renderer_version, digest, source_archive);

    us.close_archive(handle);
    errors.extend(us.drain_errors());
    us.remove_all_archives();

    UnitRenderKeysOutput { errors, ..batch }
}

/// Turn each request into a key, asking `digest` for the model's half of it, and
/// answer with `source_archive` as the batch's own.
///
/// Split from the mount so the batching is testable, and so the two costs are
/// visible: one digest per distinct model rather than one per unit. Units sharing
/// a model is the normal case rather than an odd one, since a game's hats, wrecks
/// and re-skins all name the same `.s3o`, and re-reading a shared 64 MiB texture
/// atlas per unit would be the whole cost of the batch.
///
/// The archive name is an argument for the same reason `digest` is: reading it
/// takes a session, and carrying it does not (issue #1755). Both halves of what
/// the session reported are assembled into the answer here, where a test can run
/// them, rather than in `resolve`, where nothing but a live engine can.
fn build_keys(
    requests: &[UnitRenderKeyRequest],
    variants: &[(String, String)],
    renderer_version: u32,
    digest: impl Fn(&str) -> Result<(String, String), String>,
    source_archive: String,
) -> UnitRenderKeysOutput {
    let mut keys: BTreeMap<String, BTreeMap<String, UnitRenderKey>> = BTreeMap::new();
    let mut skipped = BTreeMap::new();
    let mut seen: BTreeMap<String, Option<(String, String)>> = BTreeMap::new();

    for request in requests {
        let object = request.object.trim().to_lowercase();
        let read = seen
            .entry(object)
            .or_insert_with(|| digest(&request.object).ok());
        let Some((model_digest, source_member)) = read.clone() else {
            skipped.insert(request.unit.clone(), RenderSkip::NoModel);
            continue;
        };
        // Every angle off the one digest. A unit with no model is skipped whole
        // rather than per angle, because what it is missing is the model.
        let angles = variants
            .iter()
            .map(|(angle, variant)| {
                (
                    variant.clone(),
                    key_for(
                        request,
                        angle,
                        variant,
                        renderer_version,
                        model_digest.clone(),
                        source_member.clone(),
                    ),
                )
            })
            .collect();
        keys.insert(request.unit.clone(), angles);
    }
    UnitRenderKeysOutput {
        keys,
        source_archive,
        skipped,
        errors: Vec::new(),
    }
}

/// One key, framed the way `--unit-render` frames the pixels for that angle.
///
/// The frame is recomputed from the angle and the footprint here rather than
/// taken from the caller for the same reason `unitrender` recomputes it: the
/// pixel size is part of the identity, and two footprints can frame to one size.
fn key_for(
    request: &UnitRenderKeyRequest,
    angle: &str,
    variant: &str,
    renderer_version: u32,
    model_digest: String,
    source_member: String,
) -> UnitRenderKey {
    let (width_px, height_px) =
        coilbox_assets::render_pixels(angle, request.footprint_x, request.footprint_z);
    let source_hash = crate::assetencode::render_source_hash(
        variant,
        renderer_version,
        request.footprint_x,
        request.footprint_z,
        width_px,
        height_px,
        &model_digest,
    );
    UnitRenderKey {
        object_name: request.object.clone(),
        source_member,
        model_digest,
        variant: variant.to_string(),
        renderer_version,
        footprint_x: request.footprint_x,
        footprint_z: request.footprint_z,
        width_px,
        height_px,
        source_hash,
    }
}

/// Print a render-keys error envelope to stdout (used on the panic path in main).
pub fn emit_error(msg: String) {
    let out = UnitRenderKeysOutput {
        errors: vec![msg],
        ..Default::default()
    };
    println!("{}", serde_json::to_string(&out).unwrap_or_default());
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    fn request(
        unit: &str,
        object: &str,
        footprint_x: u32,
        footprint_z: u32,
    ) -> UnitRenderKeyRequest {
        UnitRenderKeyRequest {
            unit: unit.into(),
            object: object.into(),
            footprint_x,
            footprint_z,
        }
    }

    /// The angles to key, as `build_keys` takes them.
    fn angles(named: &[&str]) -> Vec<(String, String)> {
        variants_for(&named.iter().map(|a| (*a).to_string()).collect::<Vec<_>>())
            .expect("every angle here is one the vocabulary lists")
    }

    /// Just the plan, which is what most of these assert about.
    fn plan() -> Vec<(String, String)> {
        angles(&["top"])
    }

    /// The identity the whole design rests on: the key a caller can compute
    /// without drawing is the one `--unit-render` will produce for those pixels.
    /// Both go through `render_source_hash` over the same frame, and this asserts
    /// the composition rather than trusting that.
    #[test]
    fn the_key_is_the_hash_the_render_path_would_produce() {
        let frame = coilbox_assets::render_frame(3, 2);
        let key = key_for(
            &request("armsolar", "armsolar", 3, 2),
            "top",
            "render:top",
            1,
            "a-model-digest".into(),
            "objects3d/armsolar.s3o".into(),
        );
        assert_eq!(
            key.source_hash,
            crate::assetencode::render_source_hash(
                "render:top",
                1,
                3,
                2,
                frame.width_px,
                frame.height_px,
                "a-model-digest",
            )
        );
        assert_eq!((key.width_px, key.height_px), (255, 204));
        assert_eq!(key.variant, "render:top");
    }

    /// The framing rule, at the one place a key records it: the plan takes the
    /// footprint's aspect and the three pictures are square (issue #1951). A key
    /// that named the wrong size would have the encode refuse the pixels as
    /// mis-framed, which is the failure this is the early half of.
    #[test]
    fn a_picture_angle_is_keyed_square_and_only_the_plan_is_not() {
        let keyed = |angle: &str| {
            let key = key_for(
                &request("armsolar", "armsolar", 3, 2),
                angle,
                &coilbox_assets::render_variant(angle),
                1,
                "digest".into(),
                "objects3d/armsolar.s3o".into(),
            );
            (key.width_px, key.height_px)
        };
        assert_eq!(keyed("top"), (255, 204));
        for angle in ["front", "side", "angled"] {
            assert_eq!(keyed(angle), (256, 256), "{angle}");
        }
    }

    /// Four angles of one unit are four pictures, so they are four identities.
    /// Sharing one would have the have check answer for a picture nobody drew.
    #[test]
    fn every_angle_of_one_unit_is_its_own_identity() {
        let out = build_keys(
            &[request("armsolar", "armsolar", 3, 2)],
            &angles(&["top", "front", "side", "angled"]),
            1,
            |_| Ok(("digest".into(), "objects3d/armsolar.s3o".into())),
            "Balanced Annihilation V15.9.8".into(),
        );
        let keyed = &out.keys["armsolar"];
        assert_eq!(keyed.len(), 4);

        let hashes: std::collections::BTreeSet<&str> =
            keyed.values().map(|k| k.source_hash.as_str()).collect();
        assert_eq!(hashes.len(), 4, "{keyed:?}");
        // Named by the variant they are of, since that is what the upload and
        // the have check address a picture by.
        for angle in ["top", "front", "side", "angled"] {
            let variant = coilbox_assets::render_variant(angle);
            assert_eq!(keyed[&variant].variant, variant);
        }
        // And the model was read once for all four.
        for key in keyed.values() {
            assert_eq!(key.model_digest, "digest");
        }
    }

    /// The mount is the cost and the angles are arithmetic, so asking for four
    /// reads no more models than asking for one (issues #1684, #1720 and #1951).
    #[test]
    fn four_angles_read_the_model_no_more_often_than_one_does() {
        let count = |wanted: &[&str]| {
            let asked = RefCell::new(0usize);
            build_keys(
                &[
                    request("armsolar", "armsolar", 3, 2),
                    request("armllt", "armllt", 2, 2),
                ],
                &angles(wanted),
                1,
                |object| {
                    *asked.borrow_mut() += 1;
                    Ok((
                        format!("digest-of-{object}"),
                        format!("objects3d/{object}.s3o"),
                    ))
                },
                "Balanced Annihilation V15.9.8".into(),
            );
            asked.into_inner()
        };
        assert_eq!(count(&["top"]), 2);
        assert_eq!(count(&["top", "front", "side", "angled"]), 2);
    }

    /// Two units with the same model and different footprints are two pictures,
    /// which is why the footprint is in the key and not only in the frame.
    #[test]
    fn one_model_at_two_footprints_is_two_keys() {
        let key = |fx, fz| {
            key_for(
                &request("u", "shared", fx, fz),
                "top",
                "render:top",
                1,
                "digest".into(),
                "objects3d/shared.s3o".into(),
            )
            .source_hash
        };
        assert_ne!(key(3, 2), key(2, 3));
        assert_eq!(key(3, 2), key(3, 2));
    }

    /// The batching, counted: four units on two models read two models.
    #[test]
    fn units_sharing_a_model_are_read_once() {
        let asked = RefCell::new(Vec::<String>::new());
        let requests = [
            request("armwreck_a", "wreck", 2, 2),
            request("armwreck_b", "wreck", 2, 2),
            request("armsolar", "armsolar", 4, 4),
            request("armwreck_c", "WRECK", 3, 3),
        ];
        let out = build_keys(
            &requests,
            &plan(),
            1,
            |object| {
                asked.borrow_mut().push(object.to_string());
                Ok((
                    format!("digest-of-{}", object.to_lowercase()),
                    format!("objects3d/{}.s3o", object.to_lowercase()),
                ))
            },
            "Beyond All Reason test-30922-8064a43".into(),
        );
        let (keys, skipped) = (out.keys, out.skipped);
        let top = |unit: &str| keys[unit]["render:top"].clone();

        assert_eq!(asked.borrow().len(), 2, "{:?}", asked.borrow());
        assert_eq!(keys.len(), 4);
        assert!(skipped.is_empty());
        // Same model, so the same digest, and the one asked for in a different
        // case is the same model too.
        assert_eq!(top("armwreck_a").model_digest, "digest-of-wreck");
        assert_eq!(top("armwreck_c").model_digest, "digest-of-wreck");
        // And a different footprint is still a different picture.
        assert_ne!(top("armwreck_a").source_hash, top("armwreck_c").source_hash);
    }

    /// A unit whose model the archive does not hold gets no key rather than a key
    /// over nothing, and says which of the two it is.
    #[test]
    fn a_unit_with_no_model_is_skipped_and_not_keyed() {
        let requests = [
            request("armsolar", "armsolar", 4, 4),
            request("hat", "hats/missing", 1, 1),
        ];
        let out = build_keys(
            &requests,
            &plan(),
            1,
            |object| {
                if object.contains("missing") {
                    Err("no model".into())
                } else {
                    Ok(("digest".into(), "objects3d/armsolar.s3o".into()))
                }
            },
            "Beyond All Reason test-30922-8064a43".into(),
        );
        assert_eq!(out.keys.len(), 1);
        assert_eq!(out.skipped.get("hat"), Some(&RenderSkip::NoModel));
        assert!(!out.keys.contains_key("hat"));
    }

    /// The third field `--unit-render` is handed rather than mounting for, over
    /// the half of its journey CI can run: whatever the session reported the
    /// archive is called, the batch answers with, on every batch rather than the
    /// convenient ones (issue #1755).
    ///
    /// A batch that loses it still draws correct pictures, which is why it wants
    /// a test of its own. `blueprintBackfill.ts` takes the three fields together
    /// or not at all, so two thirds of a key is the mounting path, and a
    /// blueprint's twenty renders are twenty mounts again.
    #[test]
    fn the_batch_names_the_archive_the_session_reported() {
        let reported = "Beyond All Reason test-30922-8064a43";
        let keyed = |requests: &[UnitRenderKeyRequest]| {
            build_keys(
                requests,
                &plan(),
                1,
                |object| {
                    if object.contains("missing") {
                        Err("no model".into())
                    } else {
                        Ok((
                            format!("digest-of-{object}"),
                            format!("objects3d/{object}.s3o"),
                        ))
                    }
                },
                reported.into(),
            )
        };

        // One unit, a few, and a few of which one has no model. The archive is
        // the batch's own, so none of that is allowed to change what it is called.
        for requests in [
            vec![request("armsolar", "armsolar", 4, 4)],
            vec![
                request("armsolar", "armsolar", 4, 4),
                request("armllt", "armllt", 2, 2),
                request("armwin", "armwin", 3, 3),
            ],
            vec![
                request("armsolar", "armsolar", 4, 4),
                request("hat", "hats/missing", 1, 1),
            ],
        ] {
            let out = keyed(&requests);
            assert!(
                !out.keys.is_empty(),
                "{} units keyed nothing",
                requests.len()
            );
            assert_eq!(
                out.source_archive,
                reported,
                "{} units, {} keys, {} skipped",
                requests.len(),
                out.keys.len(),
                out.skipped.len()
            );
            // And each key carries the other two, so every unit the batch keyed
            // is one the encode can take without mounting for it.
            for (unit, keyed) in &out.keys {
                for key in keyed.values() {
                    assert!(!key.model_digest.is_empty(), "{unit}");
                    assert!(!key.source_member.is_empty(), "{unit}");
                }
            }
        }
    }

    /// An angle nobody agreed on would key a row the hub has no reader for, so
    /// nothing is mounted and nothing is answered.
    ///
    /// One bad angle refuses the batch rather than dropping itself. A caller that
    /// asked for four and quietly got three would send three quarters of a unit
    /// and have no way to tell that from the whole of it.
    #[test]
    fn an_angle_the_vocabulary_does_not_list_is_refused() {
        assert_eq!(
            variants_for(&["top".into()]),
            Ok(vec![("top".into(), "render:top".into())])
        );
        assert_eq!(
            variants_for(&["top".into(), "isometric".into()]),
            Err("isometric".into())
        );
        let out = render("nolib", "Nothing.sdd", &[], &["isometric".into()], 1);
        assert!(out.keys.is_empty());
        assert!(out.errors[0].contains("isometric"), "{:?}", out.errors);
    }

    /// The claim this whole mode rests on, against a real game: the key worked
    /// out without drawing anything is the one `--unit-render` produces for the
    /// same unit, whether the encode mounts the archive to work it out for itself
    /// or is handed the key (issue #1720). If any of the three ever differ, the
    /// have check reports every render as missing and the corpus is uploaded
    /// twice.
    ///
    /// Runs the worker binary rather than calling in, both because that is how a
    /// caller reaches either mode and because unitsync is a global C singleton
    /// that does not survive being loaded and unloaded several times in one
    /// process. That is why the worker is one shot in the first place.
    ///
    /// Needs an engine and a game on the machine, so it cannot run in CI:
    ///
    /// ```text
    /// COILBOX_LIVE_WORKER=target/release/coilbox-unitsync-worker \
    /// COILBOX_LIVE_UNITSYNC=~/.spring/libunitsync.dylib \
    /// COILBOX_LIVE_DATADIR=~/.spring \
    /// COILBOX_LIVE_GAME=ded9b29714a05164e4b4523b09809af2.sdp \
    /// COILBOX_LIVE_UNITS=/tmp/bar-units.json \
    ///   cargo test -p coilbox-unitsync-worker live_keys -- --ignored --nocapture
    /// ```
    ///
    /// `COILBOX_LIVE_UNITS` is a units file in this mode's own shape, which
    /// `--unit-dataset` turns into with `jq`.
    #[test]
    #[ignore = "needs an engine and a game on the machine, so it cannot run in CI"]
    fn live_keys_match_what_the_render_path_produces() {
        let env = |name: &str| {
            std::env::var(name).unwrap_or_else(|_| panic!("{name} names what to run against"))
        };
        let worker = env("COILBOX_LIVE_WORKER");
        let lib = env("COILBOX_LIVE_UNITSYNC");
        let datadir = env("COILBOX_LIVE_DATADIR");
        let game = env("COILBOX_LIVE_GAME");
        let units_file = env("COILBOX_LIVE_UNITS");
        let requests: Vec<UnitRenderKeyRequest> =
            serde_json::from_str(&std::fs::read_to_string(&units_file).unwrap()).unwrap();

        let run = |args: Vec<String>| -> serde_json::Value {
            let out = std::process::Command::new(&worker)
                .args(["--lib", &lib, "--datadir", &datadir])
                .args(&args)
                .output()
                .expect("the worker ran");
            assert!(out.status.success(), "{args:?} exited {}", out.status);
            serde_json::from_slice(&out.stdout).expect("the worker printed one JSON document")
        };

        let started = std::time::Instant::now();
        let batch: UnitRenderKeysOutput = serde_json::from_value(run(vec![
            "--unit-render-keys".into(),
            "--game".into(),
            game.clone(),
            "--units-file".into(),
            units_file,
            "--renderer-version".into(),
            "1".into(),
        ]))
        .unwrap();
        let took = started.elapsed();
        assert!(batch.errors.is_empty(), "{:?}", batch.errors);
        assert!(!batch.keys.is_empty(), "no keys for {game}");
        println!(
            "{} units asked, {} keys, {} skipped, in {took:?} ({:?} a unit)",
            requests.len(),
            batch.keys.len(),
            batch.skipped.len(),
            took / requests.len().max(1) as u32
        );

        assert!(
            !batch.source_archive.is_empty(),
            "the batch has to name the archive, since that is the third field the encode is \
             handed rather than mounting for"
        );

        // The render path, for a few of them, both ways round. Blank pixels,
        // because the identity is over the model rather than over what was drawn.
        let dir = std::env::temp_dir().join(format!("coilbox-live-keys-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let pixel_file = dir.join("pixels.bin");
        let mut checked = 0;
        // Every angle of the first few units, since the framing rule differs by
        // angle and a plan agreeing says nothing about a picture (issue #1951).
        let sampled = batch
            .keys
            .iter()
            .take(3)
            .flat_map(|(unit, keyed)| keyed.values().map(move |key| (unit, key)));
        for (unit, key) in sampled {
            let angle = key
                .variant
                .strip_prefix("render:")
                .expect("a render variant names its angle");
            std::fs::write(
                &pixel_file,
                vec![0u8; (key.width_px * key.height_px * 4) as usize],
            )
            .unwrap();
            let encode = |extra: Vec<String>| {
                let mut args = vec![
                    "--unit-render".into(),
                    "--game".into(),
                    game.clone(),
                    "--object".into(),
                    key.object_name.clone(),
                    "--angle".into(),
                    angle.to_string(),
                    "--footprint-x".into(),
                    key.footprint_x.to_string(),
                    "--footprint-z".into(),
                    key.footprint_z.to_string(),
                    "--renderer-version".into(),
                    key.renderer_version.to_string(),
                    "--pixels".into(),
                    pixel_file.to_string_lossy().into_owned(),
                    "--width".into(),
                    key.width_px.to_string(),
                    "--height".into(),
                    key.height_px.to_string(),
                    "--asset-dir".into(),
                    dir.to_string_lossy().into_owned(),
                ];
                args.extend(extra);
                run(args)
            };

            let mounted = encode(Vec::new());
            let handed = encode(vec![
                "--model-digest".into(),
                key.model_digest.clone(),
                "--source-member".into(),
                key.source_member.clone(),
                "--source-archive".into(),
                batch.source_archive.clone(),
            ]);

            for (how, drawn) in [("mounted", &mounted), ("handed the key", &handed)] {
                let how = &format!("{angle} {how}");
                let asset = drawn
                    .get("asset")
                    .unwrap_or_else(|| panic!("{unit} {how} was not encoded: {drawn}"));
                let field =
                    |name: &str| asset.get(name).and_then(|v| v.as_str()).unwrap_or_default();
                assert_eq!(field("modelDigest"), key.model_digest, "{unit} {how}");
                assert_eq!(field("sourceHash"), key.source_hash, "{unit} {how}");
                assert_eq!(field("sourceMember"), key.source_member, "{unit} {how}");
                assert_eq!(field("sourceArchive"), batch.source_archive, "{unit} {how}");
            }
            // And whole, so a field neither the key nor the loop names cannot
            // move under the fast path either.
            assert_eq!(mounted["asset"], handed["asset"], "{unit} {angle}");
            println!(
                "{unit} {angle}: {} matches both render paths",
                key.source_hash
            );
            checked += 1;
        }
        let per_unit = batch.keys.values().next().map_or(0, BTreeMap::len);
        assert_eq!(checked, batch.keys.len().min(3) * per_unit);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// The shape the caller reads: the field names the binding expects.
    #[test]
    fn the_output_names_its_fields_the_way_the_caller_reads_them() {
        let out = build_keys(
            &[request("armsolar", "armsolar", 4, 4)],
            &plan(),
            1,
            |_| Ok(("digest".into(), "objects3d/armsolar.s3o".into())),
            "Beyond All Reason test-30922-8064a43".into(),
        );
        let json = serde_json::to_string(&out).unwrap();
        assert!(json.contains("\"sourceHash\""), "{json}");
        assert!(json.contains("\"modelDigest\""), "{json}");
        assert!(json.contains("\"sourceMember\""), "{json}");
        assert!(json.contains("\"widthPx\""), "{json}");
        assert!(json.contains("\"objectName\""), "{json}");
        // The third field `--unit-render` would otherwise mount for (issue #1720).
        assert!(json.contains("\"sourceArchive\""), "{json}");
    }
}

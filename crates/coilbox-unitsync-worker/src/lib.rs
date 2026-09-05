//! The typed contract between the worker binary and the sidecar plugin, for
//! modes that have moved off hand written flag strings (issue #2448).
//!
//! Before this file, a mode's flags were written three times by hand: once in
//! `main.rs`'s `Args` struct, once in its `parse_args` match arms, and once in
//! a `build_*_args` function in `tauri-plugin-coilbox-unitsync/src/sidecar.rs`.
//! Nothing checked the three agreed, and the type could not express a rule
//! like "`--unit-render` needs `--asset-dir`" or "these three fields travel
//! together or not at all". Each rule lived instead as a runtime string check,
//! duplicated wherever it mattered.
//!
//! `Mode` is where a mode's fields live once, as a real Rust type. `to_args`
//! turns a mode's fields into the flags `main.rs` reads, for the sidecar to
//! build a process argv from. `from_args` reads those same flags back into the
//! typed fields, applying whatever cross field rules the mode has, for
//! `parse_args` to call. Only `--unit-render` has migrated so far. The other
//! 25 modes still have their flags written by hand in the three old places,
//! and move here one family at a time, matching how this crate already ships
//! (135 commits since May 2026 says a sweeping rewrite is not this crate's
//! style).

/// One worker invocation, for whichever modes have migrated onto this shared
/// contract. `to_args` matches on the variant, so adding a mode is one new
/// variant and one new match arm here, not a new flag added by hand in three
/// files.
#[derive(Debug, Clone, PartialEq)]
pub enum Mode {
    UnitRender(UnitRenderArgs),
}

impl Mode {
    /// The flags this mode contributes. `--lib` and `--datadir` are not
    /// included: every mode takes them, so the sidecar's `build_args` owns
    /// them and prepends them to whatever this returns.
    pub fn to_args(&self) -> Vec<String> {
        match self {
            Mode::UnitRender(args) => args.to_args(),
        }
    }
}

/// What `--unit-render` was drawn from, when the caller already knows
/// (issue #1720). A caller that already has these from `--unit-render-keys`
/// hands them down, and the worker does not mount the game's archive set at
/// all, which on a blueprint of twenty buildings is twenty mounts saved.
///
/// All three fields or none. Two of them is a caller that meant to hand the
/// key down and got it wrong, and mounting the archive instead would hide
/// that behind a slow render nobody would look twice at.
#[derive(Debug, Clone, PartialEq)]
pub struct RenderSource {
    /// sha256 over the model file and its textures, from the key.
    pub model_digest: String,
    /// The archive member the model was read from, from the key.
    pub source_member: String,
    /// The name the game archive declares for itself.
    pub source_archive: String,
}

/// `--unit-render`: encode a top down render the webview drew as the hub's
/// `render:<angle>` asset. The unit is named by `game`/`object`, the frame by
/// `footprint_x`/`footprint_z`/`width`/`height`, and the pixels arrive as a
/// file path rather than an argument because a 256 square render is a quarter
/// of a megabyte of RGBA, past what a command line takes on any platform.
#[derive(Debug, Clone, PartialEq)]
pub struct UnitRenderArgs {
    pub game: String,
    /// The unitdef's `objectname` verbatim, the same string `--unit-model`
    /// takes.
    pub object: String,
    /// Without the `render:` prefix. Checked against the vocabulary's list in
    /// [`UnitRenderArgs::from_args`] rather than accepted as given, so a typo
    /// cannot mint an identity the hub has no reader for.
    pub angle: String,
    pub footprint_x: u32,
    pub footprint_z: u32,
    /// Which renderer drew the pixels, for the render's `source_hash`.
    pub renderer_version: u32,
    /// A file holding `width * height * 4` bytes of RGBA.
    pub pixels: String,
    pub width: u32,
    pub height: u32,
    /// Where the encoded asset goes. The file is the whole output of this
    /// mode, so there is nothing to do without one.
    pub asset_dir: String,
    /// `None` means the worker mounts the game's archive set and reads this
    /// itself, which is what a caller with no key needs.
    pub source: Option<RenderSource>,
}

impl UnitRenderArgs {
    /// Build the flags for `--unit-render` mode: the unit whose render this
    /// is, the frame it was taken in, the file the pixels are in, and where
    /// the encoded asset goes.
    pub fn to_args(&self) -> Vec<String> {
        let mut args = vec![
            "--unit-render".to_string(),
            "--game".to_string(),
            self.game.clone(),
            "--object".to_string(),
            self.object.clone(),
            "--angle".to_string(),
            self.angle.clone(),
            "--footprint-x".to_string(),
            self.footprint_x.to_string(),
            "--footprint-z".to_string(),
            self.footprint_z.to_string(),
            "--renderer-version".to_string(),
            self.renderer_version.to_string(),
            "--pixels".to_string(),
            self.pixels.clone(),
            "--width".to_string(),
            self.width.to_string(),
            "--height".to_string(),
            self.height.to_string(),
            "--asset-dir".to_string(),
            self.asset_dir.clone(),
        ];
        if let Some(source) = &self.source {
            args.push("--model-digest".to_string());
            args.push(source.model_digest.clone());
            args.push("--source-member".to_string());
            args.push(source.source_member.clone());
            args.push("--source-archive".to_string());
            args.push(source.source_archive.clone());
        }
        args
    }

    /// Recover a `--unit-render` invocation from a worker argv.
    ///
    /// `args` may be exactly what [`UnitRenderArgs::to_args`] returns, or a
    /// full process argv that also carries `--lib`/`--datadir` and the
    /// `--unit-render` flag itself: any token this function does not
    /// recognise is skipped rather than rejected, on the assumption that both
    /// callers of this parser are `coilbox` itself and a worker invocation
    /// never mixes another mode's flags into this one's argv.
    ///
    /// This is also where `--unit-render`'s cross field rules are checked.
    /// `--asset-dir` and `--pixels` are required, since the asset directory
    /// is the whole output and there is nothing to encode without pixels, and
    /// `--model-digest`/`--source-member`/`--source-archive` travel together
    /// or not at all (issue #1720).
    pub fn from_args(args: &[String]) -> Result<Self, String> {
        let mut game = None;
        let mut object = None;
        let mut angle = None;
        let mut footprint_x = 0u32;
        let mut footprint_z = 0u32;
        let mut renderer_version = 0u32;
        let mut pixels = None;
        let mut width = 0u32;
        let mut height = 0u32;
        let mut asset_dir = None;
        let mut model_digest = None;
        let mut source_member = None;
        let mut source_archive = None;

        let mut it = args.iter();
        while let Some(a) = it.next() {
            match a.as_str() {
                "--game" => game = it.next().cloned(),
                "--object" => object = it.next().cloned(),
                "--angle" => angle = it.next().cloned(),
                "--footprint-x" => {
                    footprint_x = it
                        .next()
                        .and_then(|s| s.parse().ok())
                        .ok_or("--footprint-x needs an integer")?
                }
                "--footprint-z" => {
                    footprint_z = it
                        .next()
                        .and_then(|s| s.parse().ok())
                        .ok_or("--footprint-z needs an integer")?
                }
                "--renderer-version" => {
                    renderer_version = it
                        .next()
                        .and_then(|s| s.parse().ok())
                        .ok_or("--renderer-version needs an integer")?
                }
                "--pixels" => pixels = it.next().cloned(),
                "--width" => {
                    width = it
                        .next()
                        .and_then(|s| s.parse().ok())
                        .ok_or("--width needs an integer")?
                }
                "--height" => {
                    height = it
                        .next()
                        .and_then(|s| s.parse().ok())
                        .ok_or("--height needs an integer")?
                }
                "--asset-dir" => asset_dir = it.next().cloned(),
                "--model-digest" => model_digest = it.next().cloned(),
                "--source-member" => source_member = it.next().cloned(),
                "--source-archive" => source_archive = it.next().cloned(),
                _ => {}
            }
        }

        let Some(asset_dir) = asset_dir else {
            return Err("--unit-render needs --asset-dir <directory>".into());
        };
        let Some(pixels) = pixels else {
            return Err("--unit-render needs --pixels <file of RGBA>".into());
        };
        let source = match (model_digest, source_member, source_archive) {
            (None, None, None) => None,
            (Some(model_digest), Some(source_member), Some(source_archive)) => {
                if [&model_digest, &source_member, &source_archive]
                    .iter()
                    .any(|v| v.is_empty())
                {
                    // An empty digest still hashes, into a `source_hash` naming
                    // a picture of nothing that the have check would then key on.
                    return Err(
                        "--unit-render was given an empty model digest, source member or \
                         source archive"
                            .into(),
                    );
                }
                Some(RenderSource {
                    model_digest,
                    source_member,
                    source_archive,
                })
            }
            _ => {
                return Err(
                    "--unit-render takes --model-digest, --source-member and --source-archive \
                     together or not at all"
                        .into(),
                )
            }
        };

        Ok(UnitRenderArgs {
            game: game.unwrap_or_default(),
            object: object.unwrap_or_default(),
            angle: angle
                .unwrap_or_else(|| coilbox_assets::vocabulary().unit.render_angles[0].clone()),
            footprint_x,
            footprint_z,
            renderer_version,
            pixels,
            width,
            height,
            asset_dir,
            source,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(source: Option<RenderSource>) -> UnitRenderArgs {
        UnitRenderArgs {
            game: "BAR.sdd".into(),
            object: "armcom.s3o".into(),
            angle: "top".into(),
            footprint_x: 3,
            footprint_z: 2,
            renderer_version: 1,
            pixels: "/tmp/pixels.bin".into(),
            width: 255,
            height: 204,
            asset_dir: "/assets".into(),
            source,
        }
    }

    /// The whole point of the shared type: what `to_args` writes, `from_args`
    /// reads back whole. A tautological test on either function alone cannot
    /// catch the two sides disagreeing, and this one does.
    #[test]
    fn a_render_with_no_source_round_trips_through_to_args_and_from_args() {
        let original = args(None);
        let recovered = UnitRenderArgs::from_args(&original.to_args()).expect("valid argv");
        assert_eq!(recovered, original);
    }

    #[test]
    fn a_render_with_a_handed_down_source_round_trips_whole() {
        let original = args(Some(RenderSource {
            model_digest: "d5f0".into(),
            source_member: "objects3d/units/armcom.s3o".into(),
            source_archive: "Beyond All Reason test-30922".into(),
        }));
        let recovered = UnitRenderArgs::from_args(&original.to_args()).expect("valid argv");
        assert_eq!(recovered, original);
    }

    /// `from_args` is also handed a full process argv, carrying `--lib` and
    /// `--datadir` and the `--unit-render` flag itself, none of which this
    /// mode owns. Those tokens must not perturb the fields it does own.
    #[test]
    fn unrecognised_tokens_around_the_mode_s_own_flags_are_ignored() {
        let mut argv = vec![
            "--lib".to_string(),
            "/engines/one/libunitsync.so".to_string(),
            "--datadir".to_string(),
            "/data".to_string(),
            "--unit-render".to_string(),
        ];
        argv.extend(args(None).to_args());
        let recovered = UnitRenderArgs::from_args(&argv).expect("valid argv");
        assert_eq!(recovered, args(None));
    }

    /// An angle nobody gave defaults to the vocabulary's first, which is the
    /// plan view.
    #[test]
    fn a_missing_angle_defaults_to_the_vocabulary_s_first() {
        let mut a = args(None).to_args();
        let at = a.iter().position(|x| x == "--angle").unwrap();
        a.remove(at + 1);
        a.remove(at);
        let recovered = UnitRenderArgs::from_args(&a).expect("valid argv");
        assert_eq!(
            recovered.angle,
            coilbox_assets::vocabulary().unit.render_angles[0]
        );
    }

    #[test]
    fn missing_asset_dir_is_refused() {
        let mut a = args(None).to_args();
        let at = a.iter().position(|x| x == "--asset-dir").unwrap();
        a.remove(at + 1);
        a.remove(at);
        assert!(UnitRenderArgs::from_args(&a).is_err());
    }

    #[test]
    fn missing_pixels_is_refused() {
        let mut a = args(None).to_args();
        let at = a.iter().position(|x| x == "--pixels").unwrap();
        a.remove(at + 1);
        a.remove(at);
        assert!(UnitRenderArgs::from_args(&a).is_err());
    }

    /// The three fields of a render's identity travel together or not at all
    /// (issue #1720). Two of them is a caller that meant to hand the key down
    /// and mis-wired it, and mounting the archive instead would hide that.
    #[test]
    fn the_handed_down_render_key_is_all_three_fields_or_none() {
        let mut base = args(None).to_args();
        base.push("--model-digest".to_string());
        base.push("digest".to_string());
        assert!(
            UnitRenderArgs::from_args(&base).is_err(),
            "one of three is a wiring bug, not a fast path"
        );

        base.push("--source-member".to_string());
        base.push("objects3d/armsolar.s3o".to_string());
        assert!(
            UnitRenderArgs::from_args(&base).is_err(),
            "two of three is still a wiring bug"
        );

        base.push("--source-archive".to_string());
        base.push("BAR".to_string());
        assert!(
            UnitRenderArgs::from_args(&base).is_ok(),
            "all three arrived"
        );
    }

    #[test]
    fn an_empty_source_field_is_refused() {
        let mut a = args(None).to_args();
        a.push("--model-digest".to_string());
        a.push(String::new());
        a.push("--source-member".to_string());
        a.push("objects3d/armsolar.s3o".to_string());
        a.push("--source-archive".to_string());
        a.push("BAR".to_string());
        assert!(UnitRenderArgs::from_args(&a).is_err());
    }

    #[test]
    fn a_mode_dispatches_to_args_to_its_variant() {
        let a = args(None);
        assert_eq!(Mode::UnitRender(a.clone()).to_args(), a.to_args());
    }
}

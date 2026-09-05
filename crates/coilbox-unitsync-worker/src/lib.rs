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
//! `parse_args` to call. `--unit-render`, `--unit-models`,
//! `--unit-render-keys`, `--config`, `--config-set`, `--map-meta`,
//! `--map-info`, `--map-skybox`, `--map-catalog`, `--map-minimaps`,
//! `--heightmap`, `--height-field`, `--metalmap`, `--unit-buildpics`,
//! `--faction-logos`, `--unit-dataset`, `--unit-model`, `--unit-script`,
//! `--skirmish-ais`, `--game-headers`, `--thumbnails`, `--lua`, `--archive`
//! and the two flagless defaults (a bare `--game` and a bare `--map`) have
//! migrated. `--typemap` stays a hand written CLI flag with no builder, per
//! issue #2517. A bare `--game` (game detail) was never tracked in this
//! module's own list across earlier seams, even though the comments in
//! `main.rs`'s `parse_args` already called it out as unmigrated. It moved
//! here alongside the tracked five once that came to light (issue #2448).
//! These moved one family at a time, matching how this crate already ships
//! (135 commits since May 2026 says a sweeping rewrite is not this crate's
//! style).

/// One worker invocation, for whichever modes have migrated onto this shared
/// contract. `to_args` matches on the variant, so adding a mode is one new
/// variant and one new match arm here, not a new flag added by hand in three
/// files.
#[derive(Debug, Clone, PartialEq)]
pub enum Mode {
    UnitRender(UnitRenderArgs),
    UnitModels(UnitModelsArgs),
    UnitRenderKeys(UnitRenderKeysArgs),
    /// `--config`: read the curated set of engine settings. No fields of its
    /// own beyond the flag, so this is a unit variant rather than an empty
    /// payload struct.
    Config,
    ConfigSet(ConfigSetArgs),
    MapMeta(MapMetaArgs),
    MapInfo(MapInfoArgs),
    MapSkybox(MapSkyboxArgs),
    MapCatalog(MapCatalogArgs),
    MapMinimaps(MapMinimapsArgs),
    Heightmap(HeightmapArgs),
    HeightField(HeightFieldArgs),
    Metalmap(MetalmapArgs),
    UnitBuildpics(UnitBuildpicsArgs),
    FactionLogos(FactionLogosArgs),
    UnitDataset(UnitDatasetArgs),
    UnitModel(UnitModelArgs),
    UnitScript(UnitScriptArgs),
    SkirmishAis(SkirmishAisArgs),
    GameHeaders(GameHeadersArgs),
    Thumbnails(ThumbnailsArgs),
    Lua(LuaArgs),
    Archive(ArchiveArgs),
    /// A bare `--game` with no other mode flag: game detail. Named `Game`
    /// rather than `GameDetail` to match the CLI flag it comes from, the
    /// same convention every other variant here follows.
    Game(GameArgs),
    /// A bare `--map` with no other mode flag: the single minimap render.
    Minimap(MinimapArgs),
}

impl Mode {
    /// The flags this mode contributes. `--lib` and `--datadir` are not
    /// included: every mode takes them, so the sidecar's `build_args` owns
    /// them and prepends them to whatever this returns.
    pub fn to_args(&self) -> Vec<String> {
        match self {
            Mode::UnitRender(args) => args.to_args(),
            Mode::UnitModels(args) => args.to_args(),
            Mode::UnitRenderKeys(args) => args.to_args(),
            Mode::Config => vec!["--config".to_string()],
            Mode::ConfigSet(args) => args.to_args(),
            Mode::MapMeta(args) => args.to_args(),
            Mode::MapInfo(args) => args.to_args(),
            Mode::MapSkybox(args) => args.to_args(),
            Mode::MapCatalog(args) => args.to_args(),
            Mode::MapMinimaps(args) => args.to_args(),
            Mode::Heightmap(args) => args.to_args(),
            Mode::HeightField(args) => args.to_args(),
            Mode::Metalmap(args) => args.to_args(),
            Mode::UnitBuildpics(args) => args.to_args(),
            Mode::FactionLogos(args) => args.to_args(),
            Mode::UnitDataset(args) => args.to_args(),
            Mode::UnitModel(args) => args.to_args(),
            Mode::UnitScript(args) => args.to_args(),
            Mode::SkirmishAis(args) => args.to_args(),
            Mode::GameHeaders(args) => args.to_args(),
            Mode::Thumbnails(args) => args.to_args(),
            Mode::Lua(args) => args.to_args(),
            Mode::Archive(args) => args.to_args(),
            Mode::Game(args) => args.to_args(),
            Mode::Minimap(args) => args.to_args(),
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

/// `--unit-models`: read a batch of units' models out of one game archive in
/// one mount (issue #1684), rather than the one mount per unit `--unit-model`
/// pays. The cache directory is the whole output, so it is required rather
/// than optional, the rule that used to live as a runtime string check in
/// `main.rs` alone and could drift from what `sidecar.rs` actually sent.
#[derive(Debug, Clone, PartialEq)]
pub struct UnitModelsArgs {
    pub game: String,
    /// A JSON file of `objectname` strings, one per unit to read. A file
    /// rather than an argument because a whole game's roster is past what
    /// Windows takes on a command line.
    pub units_file: String,
    /// Where each flattened model and its textures are written. Required:
    /// the files are this mode's whole output, and there is nothing to report
    /// without somewhere to put them.
    pub cache_dir: String,
}

impl UnitModelsArgs {
    /// Build the flags for `--unit-models` mode: the game the units come out
    /// of, the file naming them, and the cache directory they are written
    /// into.
    pub fn to_args(&self) -> Vec<String> {
        vec![
            "--unit-models".to_string(),
            "--game".to_string(),
            self.game.clone(),
            "--units-file".to_string(),
            self.units_file.clone(),
            "--cache-dir".to_string(),
            self.cache_dir.clone(),
        ]
    }

    /// Recover a `--unit-models` invocation from a worker argv. As with
    /// [`UnitRenderArgs::from_args`], `args` may be exactly what
    /// [`UnitModelsArgs::to_args`] returns or a full process argv carrying
    /// unrelated flags, which are skipped rather than rejected.
    ///
    /// `--units-file` and `--cache-dir` are both required: the mode has
    /// nothing to read without the first and nowhere to write without the
    /// second, so a missing one is refused rather than treated as a quiet
    /// no-op.
    pub fn from_args(args: &[String]) -> Result<Self, String> {
        let mut game = None;
        let mut units_file = None;
        let mut cache_dir = None;

        let mut it = args.iter();
        while let Some(a) = it.next() {
            match a.as_str() {
                "--game" => game = it.next().cloned(),
                "--units-file" => units_file = it.next().cloned(),
                "--cache-dir" => cache_dir = it.next().cloned(),
                _ => {}
            }
        }

        let Some(units_file) = units_file else {
            return Err("--unit-models needs --units-file <json>".into());
        };
        let Some(cache_dir) = cache_dir else {
            return Err("--unit-models needs --cache-dir <directory>".into());
        };

        Ok(UnitModelsArgs {
            game: game.unwrap_or_default(),
            units_file,
            cache_dir,
        })
    }
}

/// `--unit-render-keys`: what a batch of units' renders would be called,
/// without drawing any of them (issues #1666, #1672, #1951). Keys the units by
/// the digest of their models, which the render itself would also need, but
/// does none of the drawing or encoding, so a have check can ask before
/// paying for either.
#[derive(Debug, Clone, PartialEq)]
pub struct UnitRenderKeysArgs {
    pub game: String,
    /// A JSON file of `{ unit, object, footprintX, footprintZ }`, one per unit
    /// to key. A file rather than an argument for the same reason
    /// `--unit-models` takes one: a blueprint's roster is past what Windows
    /// takes on a command line. Required: there is nothing to key without it.
    pub units_file: String,
    /// Render angles without the `render:` prefix. Empty means every angle
    /// the vocabulary lists, since the mount is a cost every angle shares
    /// (issue #1951). An empty list is also what an absent `--angles`
    /// recovers as, so the flag is left off the argv entirely rather than
    /// sent empty.
    pub angles: Vec<String>,
    /// Which renderer would draw the pixels, for the render's `source_hash`.
    pub renderer_version: u32,
}

impl UnitRenderKeysArgs {
    /// Build the flags for `--unit-render-keys` mode: the game the units come
    /// out of, the file naming them, the angles to key (when narrowed), and
    /// the renderer they would be drawn by.
    pub fn to_args(&self) -> Vec<String> {
        let mut args = vec![
            "--unit-render-keys".to_string(),
            "--game".to_string(),
            self.game.clone(),
            "--units-file".to_string(),
            self.units_file.clone(),
            "--renderer-version".to_string(),
            self.renderer_version.to_string(),
        ];
        if !self.angles.is_empty() {
            args.push("--angles".to_string());
            args.push(self.angles.join(","));
        }
        args
    }

    /// Recover a `--unit-render-keys` invocation from a worker argv. As with
    /// [`UnitModelsArgs::from_args`], `args` may be exactly what
    /// [`UnitRenderKeysArgs::to_args`] returns or a full process argv carrying
    /// unrelated flags, which are skipped rather than rejected.
    ///
    /// `--units-file` is required: there is nothing to key without it. A
    /// missing `--angles` recovers as an empty list, which `main.rs` reads as
    /// every angle the vocabulary lists (issue #1951). That defaulting stays
    /// in `main.rs` rather than here, since it needs the shared vocabulary
    /// this crate's `from_args` functions otherwise have no reason to reach
    /// for.
    pub fn from_args(args: &[String]) -> Result<Self, String> {
        let mut game = None;
        let mut units_file = None;
        let mut angles: Vec<String> = Vec::new();
        let mut renderer_version = 0u32;

        let mut it = args.iter();
        while let Some(a) = it.next() {
            match a.as_str() {
                "--game" => game = it.next().cloned(),
                "--units-file" => units_file = it.next().cloned(),
                "--angles" => {
                    angles = it
                        .next()
                        .map(|list| {
                            list.split(',')
                                .map(str::trim)
                                .filter(|a| !a.is_empty())
                                .map(str::to_owned)
                                .collect()
                        })
                        .unwrap_or_default()
                }
                "--renderer-version" => {
                    renderer_version = it
                        .next()
                        .and_then(|s| s.parse().ok())
                        .ok_or("--renderer-version needs an integer")?
                }
                _ => {}
            }
        }

        let Some(units_file) = units_file else {
            return Err("--unit-render-keys needs --units-file <json>".into());
        };

        Ok(UnitRenderKeysArgs {
            game: game.unwrap_or_default(),
            units_file,
            angles,
            renderer_version,
        })
    }
}

/// `--config-set`: write one curated engine setting back to
/// `springsettings.cfg` via unitsync's `SetSpringConfig*`. `key` is required:
/// there is nothing in the curated catalog to look up without it, the rule
/// that used to live in `main.rs`'s `run()` alone. `value` defaults to an
/// empty string when `--config-value` is absent, the same default `run()`
/// applied before this moved here, since clearing a string or boolean key is
/// a legitimate write, not a missing argument.
#[derive(Debug, Clone, PartialEq)]
pub struct ConfigSetArgs {
    pub key: String,
    pub value: String,
}

impl ConfigSetArgs {
    /// Build the flags for `--config-set` mode: the key to write and the
    /// value to write it as.
    pub fn to_args(&self) -> Vec<String> {
        vec![
            "--config-set".to_string(),
            "--config-key".to_string(),
            self.key.clone(),
            "--config-value".to_string(),
            self.value.clone(),
        ]
    }

    /// Recover a `--config-set` invocation from a worker argv. As with the
    /// other modes' `from_args` functions, `args` may be exactly what
    /// [`ConfigSetArgs::to_args`] returns or a full process argv carrying
    /// unrelated flags, which are skipped rather than rejected.
    pub fn from_args(args: &[String]) -> Result<Self, String> {
        let mut key = None;
        let mut value = None;

        let mut it = args.iter();
        while let Some(a) = it.next() {
            match a.as_str() {
                "--config-key" => key = it.next().cloned(),
                "--config-value" => value = it.next().cloned(),
                _ => {}
            }
        }

        let Some(key) = key else {
            return Err("--config-set needs --config-key".into());
        };

        Ok(ConfigSetArgs {
            key,
            value: value.unwrap_or_default(),
        })
    }
}

/// `--map-meta`: batch-read every installed map's mapinfo metadata in one
/// Init, disk-cached per map. Takes no `--map` of its own: it is always a
/// whole-library pass, which is why `run()` checks it ahead of every mode
/// that takes one.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct MapMetaArgs {
    pub cache_dir: Option<String>,
}

impl MapMetaArgs {
    /// Build the flags for `--map-meta` mode: the flag itself and the
    /// optional on-disk info-blob cache directory.
    pub fn to_args(&self) -> Vec<String> {
        let mut args = vec!["--map-meta".to_string()];
        if let Some(dir) = &self.cache_dir {
            args.push("--cache-dir".to_string());
            args.push(dir.clone());
        }
        args
    }

    /// Recover a `--map-meta` invocation from a worker argv. As with the
    /// other modes' `from_args` functions, `args` may be exactly what
    /// [`MapMetaArgs::to_args`] returns or a full process argv carrying
    /// unrelated flags, which are skipped rather than rejected.
    pub fn from_args(args: &[String]) -> Result<Self, String> {
        let mut cache_dir = None;
        let mut it = args.iter();
        while let Some(a) = it.next() {
            if a == "--cache-dir" {
                cache_dir = it.next().cloned();
            }
        }
        Ok(MapMetaArgs { cache_dir })
    }
}

/// `--map-info`: lazily read one map's options and attributed warnings
/// (mounts the map). `map` is required: there is nothing to read without one,
/// the rule that used to live in `run()` alone (issue #2448).
#[derive(Debug, Clone, PartialEq)]
pub struct MapInfoArgs {
    pub map: String,
    pub cache_dir: Option<String>,
}

impl MapInfoArgs {
    /// Build the flags for `--map-info` mode: the map to read, the flag
    /// itself, and the optional on-disk info-blob cache directory.
    pub fn to_args(&self) -> Vec<String> {
        let mut args = vec![
            "--map-info".to_string(),
            "--map".to_string(),
            self.map.clone(),
        ];
        if let Some(dir) = &self.cache_dir {
            args.push("--cache-dir".to_string());
            args.push(dir.clone());
        }
        args
    }

    /// Recover a `--map-info` invocation from a worker argv. As with the
    /// other modes' `from_args` functions, `args` may be exactly what
    /// [`MapInfoArgs::to_args`] returns or a full process argv carrying
    /// unrelated flags, which are skipped rather than rejected.
    ///
    /// `--map` is required: there is nothing to read without one.
    pub fn from_args(args: &[String]) -> Result<Self, String> {
        let mut map = None;
        let mut cache_dir = None;
        let mut it = args.iter();
        while let Some(a) = it.next() {
            match a.as_str() {
                "--map" => map = it.next().cloned(),
                "--cache-dir" => cache_dir = it.next().cloned(),
                _ => {}
            }
        }
        let Some(map) = map else {
            return Err("--map-info needs --map <name>".into());
        };
        Ok(MapInfoArgs { map, cache_dir })
    }
}

/// `--map-skybox`: read one map's `atmosphere.skyBox` DDS cube map as raw
/// bytes (combined with `--map`). `map` is required: there is nothing to
/// read without one, the rule that used to live in `run()` alone (issue
/// #2448).
#[derive(Debug, Clone, PartialEq)]
pub struct MapSkyboxArgs {
    pub map: String,
}

impl MapSkyboxArgs {
    /// Build the flags for `--map-skybox` mode: the map to read and the flag
    /// itself.
    pub fn to_args(&self) -> Vec<String> {
        vec![
            "--map-skybox".to_string(),
            "--map".to_string(),
            self.map.clone(),
        ]
    }

    /// Recover a `--map-skybox` invocation from a worker argv. As with the
    /// other modes' `from_args` functions, `args` may be exactly what
    /// [`MapSkyboxArgs::to_args`] returns or a full process argv carrying
    /// unrelated flags, which are skipped rather than rejected.
    ///
    /// `--map` is required: there is nothing to read without one.
    pub fn from_args(args: &[String]) -> Result<Self, String> {
        let mut map = None;
        let mut it = args.iter();
        while let Some(a) = it.next() {
            if a == "--map" {
                map = it.next().cloned();
            }
        }
        let Some(map) = map else {
            return Err("--map-skybox needs --map <name>".into());
        };
        Ok(MapSkyboxArgs { map })
    }
}

/// `--map-catalog`: a map's facts in the shape the hub takes. With `map`, one
/// map. Without one, the whole installed library in one Init, narrowed to
/// `maps_file`'s names and stopped at the archive hash alone when
/// `keys_only` is set, which is what a have check compares on (issue
/// #1737). No builder sends `map` today (every caller wants either one map's
/// facts by another route or the whole-library walk), but `run()` still
/// honours it, so it stays part of the contract rather than being narrowed
/// out from under a caller nobody has audited.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct MapCatalogArgs {
    pub map: Option<String>,
    pub maps_file: Option<String>,
    pub keys_only: bool,
    pub cache_dir: Option<String>,
}

impl MapCatalogArgs {
    /// Build the flags for `--map-catalog` mode: the flag itself, the single
    /// map when given, `--keys-only` when set, the maps file narrowing a
    /// library walk, and the optional on-disk info-blob cache directory.
    pub fn to_args(&self) -> Vec<String> {
        let mut args = vec!["--map-catalog".to_string()];
        if let Some(map) = &self.map {
            args.push("--map".to_string());
            args.push(map.clone());
        }
        if self.keys_only {
            args.push("--keys-only".to_string());
        }
        if let Some(path) = &self.maps_file {
            args.push("--maps-file".to_string());
            args.push(path.clone());
        }
        if let Some(dir) = &self.cache_dir {
            args.push("--cache-dir".to_string());
            args.push(dir.clone());
        }
        args
    }

    /// Recover a `--map-catalog` invocation from a worker argv. As with the
    /// other modes' `from_args` functions, `args` may be exactly what
    /// [`MapCatalogArgs::to_args`] returns or a full process argv carrying
    /// unrelated flags, which are skipped rather than rejected.
    pub fn from_args(args: &[String]) -> Result<Self, String> {
        let mut map = None;
        let mut maps_file = None;
        let mut keys_only = false;
        let mut cache_dir = None;
        let mut it = args.iter();
        while let Some(a) = it.next() {
            match a.as_str() {
                "--map" => map = it.next().cloned(),
                "--maps-file" => maps_file = it.next().cloned(),
                "--keys-only" => keys_only = true,
                "--cache-dir" => cache_dir = it.next().cloned(),
                _ => {}
            }
        }
        Ok(MapCatalogArgs {
            map,
            maps_file,
            keys_only,
            cache_dir,
        })
    }
}

/// `--map-minimaps`: name every installed map's minimap, and with
/// `asset_dir` encode it as the hub's `minimap` asset too (issue #2379).
/// `maps_file` narrows the walk to the maps the hub asked for, the same
/// shape `--map-catalog` takes and for the same reason: a library's worth of
/// names is past what Windows takes on a command line.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct MapMinimapsArgs {
    pub maps_file: Option<String>,
    pub cache_dir: Option<String>,
    pub asset_dir: Option<String>,
}

impl MapMinimapsArgs {
    /// Build the flags for `--map-minimaps` mode: the flag itself, the maps
    /// file narrowing the walk, the optional on-disk info-blob cache
    /// directory, and the asset directory that tells the two passes apart
    /// (absent stops at the identity, present also encodes the asset).
    pub fn to_args(&self) -> Vec<String> {
        let mut args = vec!["--map-minimaps".to_string()];
        if let Some(path) = &self.maps_file {
            args.push("--maps-file".to_string());
            args.push(path.clone());
        }
        if let Some(dir) = &self.cache_dir {
            args.push("--cache-dir".to_string());
            args.push(dir.clone());
        }
        if let Some(dir) = &self.asset_dir {
            args.push("--asset-dir".to_string());
            args.push(dir.clone());
        }
        args
    }

    /// Recover a `--map-minimaps` invocation from a worker argv. As with the
    /// other modes' `from_args` functions, `args` may be exactly what
    /// [`MapMinimapsArgs::to_args`] returns or a full process argv carrying
    /// unrelated flags, which are skipped rather than rejected.
    pub fn from_args(args: &[String]) -> Result<Self, String> {
        let mut maps_file = None;
        let mut cache_dir = None;
        let mut asset_dir = None;
        let mut it = args.iter();
        while let Some(a) = it.next() {
            match a.as_str() {
                "--maps-file" => maps_file = it.next().cloned(),
                "--cache-dir" => cache_dir = it.next().cloned(),
                "--asset-dir" => asset_dir = it.next().cloned(),
                _ => {}
            }
        }
        Ok(MapMinimapsArgs {
            maps_file,
            cache_dir,
            asset_dir,
        })
    }
}

/// `--heightmap`: render one map's height infomap as a downscaled grey WebP
/// preview, with the world heights that turn it back into terrain. With
/// `asset_dir` also stores the same picture as the hub's `overlay:height`
/// asset, capped at the shared vocabulary's edge so the preview and the
/// asset are the same bytes (issue #1730). `map` is required: there is
/// nothing to render without one, the rule that used to live in `run()`
/// alone (issue #2448).
#[derive(Debug, Clone, PartialEq)]
pub struct HeightmapArgs {
    pub map: String,
    pub cache_dir: Option<String>,
    /// No builder sends this today (the plugin never asks for the asset,
    /// only the preview), but `run()` still honours it, so it stays part of
    /// the contract rather than being narrowed out from under a caller
    /// nobody has audited.
    pub asset_dir: Option<String>,
}

impl HeightmapArgs {
    /// Build the flags for `--heightmap` mode: the flag itself, the map to
    /// render, and the optional on-disk picture cache and asset directories.
    pub fn to_args(&self) -> Vec<String> {
        let mut args = vec![
            "--heightmap".to_string(),
            "--map".to_string(),
            self.map.clone(),
        ];
        if let Some(dir) = &self.cache_dir {
            args.push("--cache-dir".to_string());
            args.push(dir.clone());
        }
        if let Some(dir) = &self.asset_dir {
            args.push("--asset-dir".to_string());
            args.push(dir.clone());
        }
        args
    }

    /// Recover a `--heightmap` invocation from a worker argv. As with the
    /// other modes' `from_args` functions, `args` may be exactly what
    /// [`HeightmapArgs::to_args`] returns or a full process argv carrying
    /// unrelated flags, which are skipped rather than rejected.
    ///
    /// `--map` is required: there is nothing to render without one.
    pub fn from_args(args: &[String]) -> Result<Self, String> {
        let mut map = None;
        let mut cache_dir = None;
        let mut asset_dir = None;
        let mut it = args.iter();
        while let Some(a) = it.next() {
            match a.as_str() {
                "--map" => map = it.next().cloned(),
                "--cache-dir" => cache_dir = it.next().cloned(),
                "--asset-dir" => asset_dir = it.next().cloned(),
                _ => {}
            }
        }
        let Some(map) = map else {
            return Err("--heightmap needs --map <name>".into());
        };
        Ok(HeightmapArgs {
            map,
            cache_dir,
            asset_dir,
        })
    }
}

/// `--height-field`: write one map's raw 16 bit heights to the cache, for
/// the terrain check to read without a PNG in the way (issue #1490). `map`
/// is required: there is nothing to read without one, the rule that used to
/// live in `run()` alone (issue #2448). No `asset_dir`: this mode has never
/// encoded a hub asset, only the cache file the terrain check reads.
#[derive(Debug, Clone, PartialEq)]
pub struct HeightFieldArgs {
    pub map: String,
    pub cache_dir: Option<String>,
}

impl HeightFieldArgs {
    /// Build the flags for `--height-field` mode: the flag itself, the map
    /// to read, and the optional on-disk cache directory.
    pub fn to_args(&self) -> Vec<String> {
        let mut args = vec![
            "--height-field".to_string(),
            "--map".to_string(),
            self.map.clone(),
        ];
        if let Some(dir) = &self.cache_dir {
            args.push("--cache-dir".to_string());
            args.push(dir.clone());
        }
        args
    }

    /// Recover a `--height-field` invocation from a worker argv. As with the
    /// other modes' `from_args` functions, `args` may be exactly what
    /// [`HeightFieldArgs::to_args`] returns or a full process argv carrying
    /// unrelated flags, which are skipped rather than rejected.
    ///
    /// `--map` is required: there is nothing to read without one.
    pub fn from_args(args: &[String]) -> Result<Self, String> {
        let mut map = None;
        let mut cache_dir = None;
        let mut it = args.iter();
        while let Some(a) = it.next() {
            match a.as_str() {
                "--map" => map = it.next().cloned(),
                "--cache-dir" => cache_dir = it.next().cloned(),
                _ => {}
            }
        }
        let Some(map) = map else {
            return Err("--height-field needs --map <name>".into());
        };
        Ok(HeightFieldArgs { map, cache_dir })
    }
}

/// `--metalmap`: render one map's metal infomap as a downscaled green-on-
/// transparent RGBA PNG, capped at `max_side`'s longest side. With
/// `asset_dir` also stores the raw density as the hub's `overlay:metal`
/// asset. `map` is required: there is nothing to render without one, the
/// rule that used to live in `run()` alone (issue #2448). `max_side`
/// defaults to 512 when absent, the same default `run()` applied before
/// this moved here, since the plugin always fills one in itself and no
/// caller has ever relied on the bare default.
#[derive(Debug, Clone, PartialEq)]
pub struct MetalmapArgs {
    pub map: String,
    pub max_side: u32,
    pub cache_dir: Option<String>,
    pub asset_dir: Option<String>,
}

impl MetalmapArgs {
    /// Build the flags for `--metalmap` mode: the flag itself, the map to
    /// render, the longest-side pixel cap, and the optional on-disk cache
    /// and asset directories.
    pub fn to_args(&self) -> Vec<String> {
        let mut args = vec![
            "--metalmap".to_string(),
            "--map".to_string(),
            self.map.clone(),
            "--max-side".to_string(),
            self.max_side.to_string(),
        ];
        if let Some(dir) = &self.cache_dir {
            args.push("--cache-dir".to_string());
            args.push(dir.clone());
        }
        if let Some(dir) = &self.asset_dir {
            args.push("--asset-dir".to_string());
            args.push(dir.clone());
        }
        args
    }

    /// Recover a `--metalmap` invocation from a worker argv. As with the
    /// other modes' `from_args` functions, `args` may be exactly what
    /// [`MetalmapArgs::to_args`] returns or a full process argv carrying
    /// unrelated flags, which are skipped rather than rejected.
    ///
    /// `--map` is required: there is nothing to render without one. A
    /// missing `--max-side` recovers as 512, the same default `run()` read
    /// from an absent flag before this moved here.
    pub fn from_args(args: &[String]) -> Result<Self, String> {
        let mut map = None;
        let mut max_side = 512u32;
        let mut cache_dir = None;
        let mut asset_dir = None;
        let mut it = args.iter();
        while let Some(a) = it.next() {
            match a.as_str() {
                "--map" => map = it.next().cloned(),
                "--max-side" => {
                    max_side = it
                        .next()
                        .and_then(|s| s.parse().ok())
                        .ok_or("--max-side needs an integer")?
                }
                "--cache-dir" => cache_dir = it.next().cloned(),
                "--asset-dir" => asset_dir = it.next().cloned(),
                _ => {}
            }
        }
        let Some(map) = map else {
            return Err("--metalmap needs --map <name>".into());
        };
        Ok(MetalmapArgs {
            map,
            max_side,
            cache_dir,
            asset_dir,
        })
    }
}

/// `--unit-buildpics`: resolve start-unit build icons for `game`'s roster,
/// named by `units`, disk-cached under `cache_dir` like the rest of the game
/// info family. With `asset_dir` also encodes each icon as the hub's
/// `buildpic` asset (issue #1636). Every caller that only wants the `data:`
/// icon leaves it unset, since encoding a WebP nobody will look at is work
/// for nothing.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct UnitBuildpicsArgs {
    pub game: String,
    pub units: Vec<String>,
    pub cache_dir: Option<String>,
    pub asset_dir: Option<String>,
}

impl UnitBuildpicsArgs {
    /// Build the flags for `--unit-buildpics` mode: the flag itself, the game
    /// whose roster this is, the comma-joined unit names, and the optional
    /// on-disk cache and asset directories.
    pub fn to_args(&self) -> Vec<String> {
        let mut args = vec![
            "--unit-buildpics".to_string(),
            "--game".to_string(),
            self.game.clone(),
            "--units".to_string(),
            self.units.join(","),
        ];
        if let Some(dir) = &self.cache_dir {
            args.push("--cache-dir".to_string());
            args.push(dir.clone());
        }
        if let Some(dir) = &self.asset_dir {
            args.push("--asset-dir".to_string());
            args.push(dir.clone());
        }
        args
    }

    /// Recover a `--unit-buildpics` invocation from a worker argv. As with
    /// the other modes' `from_args` functions, `args` may be exactly what
    /// [`UnitBuildpicsArgs::to_args`] returns or a full process argv carrying
    /// unrelated flags, which are skipped rather than rejected.
    ///
    /// Neither `game` nor `units` was ever required by `run()`, so a missing
    /// one recovers as empty rather than an error, the same treatment the
    /// old code gave them.
    pub fn from_args(args: &[String]) -> Result<Self, String> {
        let mut game = None;
        let mut units: Vec<String> = Vec::new();
        let mut cache_dir = None;
        let mut asset_dir = None;
        let mut it = args.iter();
        while let Some(a) = it.next() {
            match a.as_str() {
                "--game" => game = it.next().cloned(),
                "--units" => {
                    units = it
                        .next()
                        .map(|list| {
                            list.split(',')
                                .map(str::trim)
                                .filter(|u| !u.is_empty())
                                .map(str::to_owned)
                                .collect()
                        })
                        .unwrap_or_default()
                }
                "--cache-dir" => cache_dir = it.next().cloned(),
                "--asset-dir" => asset_dir = it.next().cloned(),
                _ => {}
            }
        }
        Ok(UnitBuildpicsArgs {
            game: game.unwrap_or_default(),
            units,
            cache_dir,
            asset_dir,
        })
    }
}

/// `--faction-logos`: resolve `Sidepics/<side>` emblems for `game`, named by
/// `sides`, disk-cached under `cache_dir` like `--unit-buildpics`. Unlike
/// that mode, `run()` has never given this one an `--asset-dir`, since
/// `factionlogo::render` has no asset-encoding path, so there is no such
/// field here.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct FactionLogosArgs {
    pub game: String,
    pub sides: Vec<String>,
    pub cache_dir: Option<String>,
}

impl FactionLogosArgs {
    /// Build the flags for `--faction-logos` mode: the flag itself, the game
    /// whose sides these are, the comma-joined side names, and the optional
    /// on-disk cache directory.
    pub fn to_args(&self) -> Vec<String> {
        let mut args = vec![
            "--faction-logos".to_string(),
            "--game".to_string(),
            self.game.clone(),
            "--sides".to_string(),
            self.sides.join(","),
        ];
        if let Some(dir) = &self.cache_dir {
            args.push("--cache-dir".to_string());
            args.push(dir.clone());
        }
        args
    }

    /// Recover a `--faction-logos` invocation from a worker argv. As with
    /// the other modes' `from_args` functions, `args` may be exactly what
    /// [`FactionLogosArgs::to_args`] returns or a full process argv carrying
    /// unrelated flags, which are skipped rather than rejected.
    pub fn from_args(args: &[String]) -> Result<Self, String> {
        let mut game = None;
        let mut sides: Vec<String> = Vec::new();
        let mut cache_dir = None;
        let mut it = args.iter();
        while let Some(a) = it.next() {
            match a.as_str() {
                "--game" => game = it.next().cloned(),
                "--sides" => {
                    sides = it
                        .next()
                        .map(|list| {
                            list.split(',')
                                .map(str::trim)
                                .filter(|s| !s.is_empty())
                                .map(str::to_owned)
                                .collect()
                        })
                        .unwrap_or_default()
                }
                "--cache-dir" => cache_dir = it.next().cloned(),
                _ => {}
            }
        }
        Ok(FactionLogosArgs {
            game: game.unwrap_or_default(),
            sides,
            cache_dir,
        })
    }
}

/// `--unit-dataset`: read `game`'s reusable unit graph (units + their
/// `buildoptions` edges), disk-cached under `cache_dir` like the rest of the
/// game info family.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct UnitDatasetArgs {
    pub game: String,
    pub cache_dir: Option<String>,
}

impl UnitDatasetArgs {
    /// Build the flags for `--unit-dataset` mode: the flag itself, the game
    /// whose unit graph this is, and the optional on-disk cache directory.
    pub fn to_args(&self) -> Vec<String> {
        let mut args = vec![
            "--unit-dataset".to_string(),
            "--game".to_string(),
            self.game.clone(),
        ];
        if let Some(dir) = &self.cache_dir {
            args.push("--cache-dir".to_string());
            args.push(dir.clone());
        }
        args
    }

    /// Recover a `--unit-dataset` invocation from a worker argv. As with the
    /// other modes' `from_args` functions, `args` may be exactly what
    /// [`UnitDatasetArgs::to_args`] returns or a full process argv carrying
    /// unrelated flags, which are skipped rather than rejected.
    pub fn from_args(args: &[String]) -> Result<Self, String> {
        let mut game = None;
        let mut cache_dir = None;
        let mut it = args.iter();
        while let Some(a) = it.next() {
            match a.as_str() {
                "--game" => game = it.next().cloned(),
                "--cache-dir" => cache_dir = it.next().cloned(),
                _ => {}
            }
        }
        Ok(UnitDatasetArgs {
            game: game.unwrap_or_default(),
            cache_dir,
        })
    }
}

/// `--unit-model`: read one unit's model out of `game`, named by the
/// unitdef's `objectname` in `object`, disk-cached under `cache_dir`.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct UnitModelArgs {
    pub game: String,
    pub object: String,
    pub cache_dir: Option<String>,
}

impl UnitModelArgs {
    /// Build the flags for `--unit-model` mode: the flag itself, the game
    /// whose archive holds the model, the `objectname` naming it, and the
    /// optional on-disk cache directory.
    pub fn to_args(&self) -> Vec<String> {
        let mut args = vec![
            "--unit-model".to_string(),
            "--game".to_string(),
            self.game.clone(),
            "--object".to_string(),
            self.object.clone(),
        ];
        if let Some(dir) = &self.cache_dir {
            args.push("--cache-dir".to_string());
            args.push(dir.clone());
        }
        args
    }

    /// Recover a `--unit-model` invocation from a worker argv. As with the
    /// other modes' `from_args` functions, `args` may be exactly what
    /// [`UnitModelArgs::to_args`] returns or a full process argv carrying
    /// unrelated flags, which are skipped rather than rejected.
    pub fn from_args(args: &[String]) -> Result<Self, String> {
        let mut game = None;
        let mut object = None;
        let mut cache_dir = None;
        let mut it = args.iter();
        while let Some(a) = it.next() {
            match a.as_str() {
                "--game" => game = it.next().cloned(),
                "--object" => object = it.next().cloned(),
                "--cache-dir" => cache_dir = it.next().cloned(),
                _ => {}
            }
        }
        Ok(UnitModelArgs {
            game: game.unwrap_or_default(),
            object: object.unwrap_or_default(),
            cache_dir,
        })
    }
}

/// `--unit-script`: find and read `unit`'s animation script inside `game`.
/// `unit` is the unit definition's own key, not the `objectname`
/// `--unit-model` takes. A script is named by the definition and a model by
/// a field inside it, and games regularly use different words for the two.
/// Takes no `cache_dir`, since `unitscriptfile::render` has never cached.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct UnitScriptArgs {
    pub game: String,
    pub unit: String,
}

impl UnitScriptArgs {
    /// Build the flags for `--unit-script` mode: the flag itself, the game,
    /// and the unit definition's key.
    pub fn to_args(&self) -> Vec<String> {
        vec![
            "--unit-script".to_string(),
            "--game".to_string(),
            self.game.clone(),
            "--unit".to_string(),
            self.unit.clone(),
        ]
    }

    /// Recover a `--unit-script` invocation from a worker argv. As with the
    /// other modes' `from_args` functions, `args` may be exactly what
    /// [`UnitScriptArgs::to_args`] returns or a full process argv carrying
    /// unrelated flags, which are skipped rather than rejected.
    pub fn from_args(args: &[String]) -> Result<Self, String> {
        let mut game = None;
        let mut unit = None;
        let mut it = args.iter();
        while let Some(a) = it.next() {
            match a.as_str() {
                "--game" => game = it.next().cloned(),
                "--unit" => unit = it.next().cloned(),
                _ => {}
            }
        }
        Ok(UnitScriptArgs {
            game: game.unwrap_or_default(),
            unit: unit.unwrap_or_default(),
        })
    }
}

/// `--skirmish-ais`: list native skirmish AIs, plus `game`'s Lua AIs when a
/// game is given. `game` is optional, the bare flag lists native AIs alone.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct SkirmishAisArgs {
    pub game: Option<String>,
}

impl SkirmishAisArgs {
    /// Build the flags for `--skirmish-ais` mode: the flag itself, and the
    /// game when one is given and not empty. No caller sends an empty game
    /// today, but the old `build_skirmish_ai_args` filtered one out rather
    /// than emit a meaningless `--game`, so this keeps that filter rather
    /// than changing what argv a caller gets.
    pub fn to_args(&self) -> Vec<String> {
        let mut args = vec!["--skirmish-ais".to_string()];
        if let Some(game) = self.game.as_deref().filter(|g| !g.is_empty()) {
            args.push("--game".to_string());
            args.push(game.to_string());
        }
        args
    }

    /// Recover a `--skirmish-ais` invocation from a worker argv. As with the
    /// other modes' `from_args` functions, `args` may be exactly what
    /// [`SkirmishAisArgs::to_args`] returns or a full process argv carrying
    /// unrelated flags, which are skipped rather than rejected.
    pub fn from_args(args: &[String]) -> Result<Self, String> {
        let mut game = None;
        let mut it = args.iter();
        while let Some(a) = it.next() {
            if a == "--game" {
                game = it.next().cloned();
            }
        }
        Ok(SkirmishAisArgs { game })
    }
}

/// `--game-headers`: batch-resolve every game's loadpicture art in one Init,
/// disk-cached under `cache_dir`. Takes no `--game` of its own, since it is
/// always a whole-library pass, the same shape `--map-meta` takes.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct GameHeadersArgs {
    pub cache_dir: Option<String>,
}

impl GameHeadersArgs {
    /// Build the flags for `--game-headers` mode: the flag itself and the
    /// optional on-disk cache directory.
    pub fn to_args(&self) -> Vec<String> {
        let mut args = vec!["--game-headers".to_string()];
        if let Some(dir) = &self.cache_dir {
            args.push("--cache-dir".to_string());
            args.push(dir.clone());
        }
        args
    }

    /// Recover a `--game-headers` invocation from a worker argv. As with the
    /// other modes' `from_args` functions, `args` may be exactly what
    /// [`GameHeadersArgs::to_args`] returns or a full process argv carrying
    /// unrelated flags, which are skipped rather than rejected.
    pub fn from_args(args: &[String]) -> Result<Self, String> {
        let mut cache_dir = None;
        let mut it = args.iter();
        while let Some(a) = it.next() {
            if a == "--cache-dir" {
                cache_dir = it.next().cloned();
            }
        }
        Ok(GameHeadersArgs { cache_dir })
    }
}

/// `--thumbnails`: render a small minimap for every installed map in one
/// Init, disk-cached under `cache_dir`. `mip` defaults to 1 (512 square)
/// when absent, the same default `parse_args`'s shared `mip` local applied
/// before this moved here, since the default is shared with the unmigrated
/// single-minimap mode.
#[derive(Debug, Clone, PartialEq)]
pub struct ThumbnailsArgs {
    pub mip: i32,
    pub cache_dir: Option<String>,
}

impl Default for ThumbnailsArgs {
    fn default() -> Self {
        ThumbnailsArgs {
            mip: 1,
            cache_dir: None,
        }
    }
}

impl ThumbnailsArgs {
    /// Build the flags for `--thumbnails` mode: the flag itself, the mip
    /// level, and the optional on-disk cache directory.
    pub fn to_args(&self) -> Vec<String> {
        let mut args = vec![
            "--thumbnails".to_string(),
            "--mip".to_string(),
            self.mip.to_string(),
        ];
        if let Some(dir) = &self.cache_dir {
            args.push("--cache-dir".to_string());
            args.push(dir.clone());
        }
        args
    }

    /// Recover a `--thumbnails` invocation from a worker argv. As with the
    /// other modes' `from_args` functions, `args` may be exactly what
    /// [`ThumbnailsArgs::to_args`] returns or a full process argv carrying
    /// unrelated flags, which are skipped rather than rejected.
    ///
    /// A missing `--mip` recovers as 1, the same default the shared `mip`
    /// local in `parse_args` used before this moved here.
    pub fn from_args(args: &[String]) -> Result<Self, String> {
        let mut mip = 1;
        let mut cache_dir = None;
        let mut it = args.iter();
        while let Some(a) = it.next() {
            match a.as_str() {
                "--mip" => {
                    mip = it
                        .next()
                        .and_then(|s| s.parse().ok())
                        .ok_or("--mip needs an integer")?
                }
                "--cache-dir" => cache_dir = it.next().cloned(),
                _ => {}
            }
        }
        Ok(ThumbnailsArgs { mip, cache_dir })
    }
}

/// `--lua`: run a Lua snippet through the archive-mounted parser, or replay a
/// JSON array of REPL chunks when `chunks_file` is given. `chunks_file`
/// present switches `run()` to replay mode ahead of a plain `source_file`,
/// the same priority `run()` gave the two before this moved here. Neither
/// `archive` nor `source_file` was ever required by `run()` (an absent
/// source reads as an empty snippet), so a missing one recovers as
/// empty/`None` rather than an error, the same treatment the old code gave
/// them.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct LuaArgs {
    pub archive: String,
    pub source_file: Option<String>,
    pub chunks_file: Option<String>,
}

impl LuaArgs {
    /// Build the flags for `--lua` mode: the flag itself, the archive to
    /// mount, and whichever of the source file or the chunks file is given.
    pub fn to_args(&self) -> Vec<String> {
        let mut args = vec![
            "--lua".to_string(),
            "--archive".to_string(),
            self.archive.clone(),
        ];
        if let Some(p) = &self.source_file {
            args.push("--source-file".to_string());
            args.push(p.clone());
        }
        if let Some(p) = &self.chunks_file {
            args.push("--chunks-file".to_string());
            args.push(p.clone());
        }
        args
    }

    /// Recover a `--lua` invocation from a worker argv. As with the other
    /// modes' `from_args` functions, `args` may be exactly what
    /// [`LuaArgs::to_args`] returns or a full process argv carrying
    /// unrelated flags, which are skipped rather than rejected.
    pub fn from_args(args: &[String]) -> Result<Self, String> {
        let mut archive = None;
        let mut source_file = None;
        let mut chunks_file = None;
        let mut it = args.iter();
        while let Some(a) = it.next() {
            match a.as_str() {
                "--archive" => archive = it.next().cloned(),
                "--source-file" => source_file = it.next().cloned(),
                "--chunks-file" => chunks_file = it.next().cloned(),
                _ => {}
            }
        }
        Ok(LuaArgs {
            archive: archive.unwrap_or_default(),
            source_file,
            chunks_file,
        })
    }
}

/// `--archive`: browse one archive's member tree, preview one member's
/// bytes, or extract one member to a destination path (download). `file` and
/// `extract` layer: neither given is a tree listing, `file` alone is a
/// preview, and both together is an extract. `extract` given without `file`
/// is silently ignored by `run()`, the same treatment the old code gave the
/// combination, since there is no member named to extract.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct ArchiveArgs {
    pub archive: String,
    pub file: Option<String>,
    pub extract: Option<String>,
}

impl ArchiveArgs {
    /// Build the flags for `--archive` mode: the archive to browse, and the
    /// member and destination path when this is a preview or an extract.
    pub fn to_args(&self) -> Vec<String> {
        let mut args = vec!["--archive".to_string(), self.archive.clone()];
        if let Some(f) = &self.file {
            args.push("--file".to_string());
            args.push(f.clone());
        }
        if let Some(e) = &self.extract {
            args.push("--extract".to_string());
            args.push(e.clone());
        }
        args
    }

    /// Recover an `--archive` invocation from a worker argv. As with the
    /// other modes' `from_args` functions, `args` may be exactly what
    /// [`ArchiveArgs::to_args`] returns or a full process argv carrying
    /// unrelated flags, which are skipped rather than rejected.
    pub fn from_args(args: &[String]) -> Result<Self, String> {
        let mut archive = None;
        let mut file = None;
        let mut extract = None;
        let mut it = args.iter();
        while let Some(a) = it.next() {
            match a.as_str() {
                "--archive" => archive = it.next().cloned(),
                "--file" => file = it.next().cloned(),
                "--extract" => extract = it.next().cloned(),
                _ => {}
            }
        }
        Ok(ArchiveArgs {
            archive: archive.unwrap_or_default(),
            file,
            extract,
        })
    }
}

/// A bare `--game` with no other mode flag: game detail, loading one game's
/// archives to read its sides and unit count. `--unit-model` and its
/// siblings key off `--game` too, but each needs its own explicit mode flag
/// alongside it. A bare `--game` on its own is what selects this mode
/// instead, which is why `run()` checks it only after every mode with an
/// explicit flag of its own. Neither field was ever required by `run()`, so
/// a missing one recovers as empty/`None` rather than an error, the same
/// treatment the old code gave it.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct GameArgs {
    pub game: String,
    pub cache_dir: Option<String>,
}

impl GameArgs {
    /// Build the flags for the bare `--game` mode: the game to read, and the
    /// optional on-disk info-blob cache directory.
    pub fn to_args(&self) -> Vec<String> {
        let mut args = vec!["--game".to_string(), self.game.clone()];
        if let Some(dir) = &self.cache_dir {
            args.push("--cache-dir".to_string());
            args.push(dir.clone());
        }
        args
    }

    /// Recover a bare `--game` invocation from a worker argv. As with the
    /// other modes' `from_args` functions, `args` may be exactly what
    /// [`GameArgs::to_args`] returns or a full process argv carrying
    /// unrelated flags, which are skipped rather than rejected.
    pub fn from_args(args: &[String]) -> Result<Self, String> {
        let mut game = None;
        let mut cache_dir = None;
        let mut it = args.iter();
        while let Some(a) = it.next() {
            match a.as_str() {
                "--game" => game = it.next().cloned(),
                "--cache-dir" => cache_dir = it.next().cloned(),
                _ => {}
            }
        }
        Ok(GameArgs {
            game: game.unwrap_or_default(),
            cache_dir,
        })
    }
}

/// A bare `--map` with no other mode flag: render one map's minimap.
/// `--map-minimaps`, `--map-info` and their siblings key off `--map` too,
/// but each needs its own explicit mode flag alongside it. A bare `--map` on
/// its own is what selects this mode instead, which is why `run()` checks it
/// last of every `--map` combination. `mip` defaults to 1 (512 square), the
/// same default the shared `mip` local in `parse_args` applied before this
/// moved here.
#[derive(Debug, Clone, PartialEq)]
pub struct MinimapArgs {
    pub map: String,
    pub mip: i32,
    pub cache_dir: Option<String>,
    pub asset_dir: Option<String>,
}

impl Default for MinimapArgs {
    fn default() -> Self {
        MinimapArgs {
            map: String::new(),
            mip: 1,
            cache_dir: None,
            asset_dir: None,
        }
    }
}

impl MinimapArgs {
    /// Build the flags for the bare `--map` mode: the map to render, the mip
    /// level, and the optional on-disk cache and asset directories.
    pub fn to_args(&self) -> Vec<String> {
        let mut args = vec![
            "--map".to_string(),
            self.map.clone(),
            "--mip".to_string(),
            self.mip.to_string(),
        ];
        if let Some(dir) = &self.cache_dir {
            args.push("--cache-dir".to_string());
            args.push(dir.clone());
        }
        if let Some(dir) = &self.asset_dir {
            args.push("--asset-dir".to_string());
            args.push(dir.clone());
        }
        args
    }

    /// Recover a bare `--map` invocation from a worker argv. As with the
    /// other modes' `from_args` functions, `args` may be exactly what
    /// [`MinimapArgs::to_args`] returns or a full process argv carrying
    /// unrelated flags, which are skipped rather than rejected.
    ///
    /// A missing `--mip` recovers as 1, the same default the shared `mip`
    /// local in `parse_args` used before this moved here.
    pub fn from_args(args: &[String]) -> Result<Self, String> {
        let mut map = None;
        let mut mip = 1;
        let mut cache_dir = None;
        let mut asset_dir = None;
        let mut it = args.iter();
        while let Some(a) = it.next() {
            match a.as_str() {
                "--map" => map = it.next().cloned(),
                "--mip" => {
                    mip = it
                        .next()
                        .and_then(|s| s.parse().ok())
                        .ok_or("--mip needs an integer")?
                }
                "--cache-dir" => cache_dir = it.next().cloned(),
                "--asset-dir" => asset_dir = it.next().cloned(),
                _ => {}
            }
        }
        Ok(MinimapArgs {
            map: map.unwrap_or_default(),
            mip,
            cache_dir,
            asset_dir,
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

    fn unit_models_args() -> UnitModelsArgs {
        UnitModelsArgs {
            game: "BAR.sdd".into(),
            units_file: "/tmp/objects.json".into(),
            cache_dir: "/cache/models".into(),
        }
    }

    /// What `to_args` writes, `from_args` reads back whole. A test on either
    /// function alone cannot catch the sidecar and the worker disagreeing
    /// about this mode's fields.
    #[test]
    fn unit_models_round_trips_through_to_args_and_from_args() {
        let original = unit_models_args();
        let recovered = UnitModelsArgs::from_args(&original.to_args()).expect("valid argv");
        assert_eq!(recovered, original);
    }

    /// `from_args` is also handed a full process argv, carrying `--lib` and
    /// `--datadir` and the `--unit-models` flag itself, none of which this
    /// mode owns.
    #[test]
    fn unit_models_ignores_unrecognised_tokens_around_its_own_flags() {
        let mut argv = vec![
            "--lib".to_string(),
            "/engines/one/libunitsync.so".to_string(),
            "--datadir".to_string(),
            "/data".to_string(),
        ];
        argv.extend(unit_models_args().to_args());
        let recovered = UnitModelsArgs::from_args(&argv).expect("valid argv");
        assert_eq!(recovered, unit_models_args());
    }

    /// The cache directory is this mode's whole output, so a missing one is
    /// refused rather than treated as a quiet no-op.
    #[test]
    fn unit_models_missing_cache_dir_is_refused() {
        let mut a = unit_models_args().to_args();
        let at = a.iter().position(|x| x == "--cache-dir").unwrap();
        a.remove(at + 1);
        a.remove(at);
        assert!(UnitModelsArgs::from_args(&a).is_err());
    }

    /// There is nothing to read without a units file, so a missing one is
    /// refused the same way.
    #[test]
    fn unit_models_missing_units_file_is_refused() {
        let mut a = unit_models_args().to_args();
        let at = a.iter().position(|x| x == "--units-file").unwrap();
        a.remove(at + 1);
        a.remove(at);
        assert!(UnitModelsArgs::from_args(&a).is_err());
    }

    #[test]
    fn unit_models_dispatches_to_args_to_its_variant() {
        let a = unit_models_args();
        assert_eq!(Mode::UnitModels(a.clone()).to_args(), a.to_args());
    }

    fn unit_render_keys_args() -> UnitRenderKeysArgs {
        UnitRenderKeysArgs {
            game: "BAR.sdd".into(),
            units_file: "/tmp/units.json".into(),
            angles: vec!["top".into(), "angled".into()],
            renderer_version: 1,
        }
    }

    /// What `to_args` writes, `from_args` reads back whole. A test on either
    /// function alone cannot catch the sidecar and the worker disagreeing
    /// about this mode's fields.
    #[test]
    fn unit_render_keys_round_trips_through_to_args_and_from_args() {
        let original = unit_render_keys_args();
        let recovered = UnitRenderKeysArgs::from_args(&original.to_args()).expect("valid argv");
        assert_eq!(recovered, original);
    }

    /// No angles named is how a caller says every angle, so the flag has to
    /// be absent rather than empty, and that has to round trip as an empty
    /// list rather than as a missing value (issue #1951).
    #[test]
    fn unit_render_keys_with_no_angles_named_omits_the_flag_and_round_trips_empty() {
        let original = UnitRenderKeysArgs {
            angles: Vec::new(),
            ..unit_render_keys_args()
        };
        let a = original.to_args();
        assert!(!a.contains(&"--angles".to_string()));
        let recovered = UnitRenderKeysArgs::from_args(&a).expect("valid argv");
        assert_eq!(recovered, original);
    }

    /// `from_args` is also handed a full process argv, carrying `--lib` and
    /// `--datadir`, neither of which this mode owns.
    #[test]
    fn unit_render_keys_ignores_unrecognised_tokens_around_its_own_flags() {
        let mut argv = vec![
            "--lib".to_string(),
            "/engines/one/libunitsync.so".to_string(),
            "--datadir".to_string(),
            "/data".to_string(),
        ];
        argv.extend(unit_render_keys_args().to_args());
        let recovered = UnitRenderKeysArgs::from_args(&argv).expect("valid argv");
        assert_eq!(recovered, unit_render_keys_args());
    }

    /// There is nothing to key without a units file, so a missing one is
    /// refused rather than treated as a quiet no-op.
    #[test]
    fn unit_render_keys_missing_units_file_is_refused() {
        let mut a = unit_render_keys_args().to_args();
        let at = a.iter().position(|x| x == "--units-file").unwrap();
        a.remove(at + 1);
        a.remove(at);
        assert!(UnitRenderKeysArgs::from_args(&a).is_err());
    }

    #[test]
    fn unit_render_keys_dispatches_to_args_to_its_variant() {
        let a = unit_render_keys_args();
        assert_eq!(Mode::UnitRenderKeys(a.clone()).to_args(), a.to_args());
    }

    #[test]
    fn config_dispatches_to_args_to_its_flag() {
        assert_eq!(Mode::Config.to_args(), vec!["--config".to_string()]);
    }

    fn config_set_args() -> ConfigSetArgs {
        ConfigSetArgs {
            key: "Fullscreen".into(),
            value: "1".into(),
        }
    }

    /// What `to_args` writes, `from_args` reads back whole. A test on either
    /// function alone cannot catch the sidecar and the worker disagreeing
    /// about this mode's fields.
    #[test]
    fn config_set_round_trips_through_to_args_and_from_args() {
        let original = config_set_args();
        let recovered = ConfigSetArgs::from_args(&original.to_args()).expect("valid argv");
        assert_eq!(recovered, original);
    }

    /// `from_args` is also handed a full process argv, carrying `--lib` and
    /// `--datadir`, neither of which this mode owns.
    #[test]
    fn config_set_ignores_unrecognised_tokens_around_its_own_flags() {
        let mut argv = vec![
            "--lib".to_string(),
            "/engines/one/libunitsync.so".to_string(),
            "--datadir".to_string(),
            "/data".to_string(),
        ];
        argv.extend(config_set_args().to_args());
        let recovered = ConfigSetArgs::from_args(&argv).expect("valid argv");
        assert_eq!(recovered, config_set_args());
    }

    /// There is nothing in the curated catalog to look up without a key, so a
    /// missing one is refused rather than treated as a quiet no-op.
    #[test]
    fn config_set_missing_key_is_refused() {
        let mut a = config_set_args().to_args();
        let at = a.iter().position(|x| x == "--config-key").unwrap();
        a.remove(at + 1);
        a.remove(at);
        assert!(ConfigSetArgs::from_args(&a).is_err());
    }

    /// A caller that omits `--config-value` entirely (rather than sending an
    /// explicit empty string) still gets a value to write, since clearing a
    /// string or boolean key is a legitimate write, not a missing argument.
    #[test]
    fn config_set_missing_value_defaults_to_empty_string() {
        let mut a = config_set_args().to_args();
        let at = a.iter().position(|x| x == "--config-value").unwrap();
        a.remove(at + 1);
        a.remove(at);
        let recovered = ConfigSetArgs::from_args(&a).expect("valid argv");
        assert_eq!(recovered.value, "");
    }

    #[test]
    fn config_set_dispatches_to_args_to_its_variant() {
        let a = config_set_args();
        assert_eq!(Mode::ConfigSet(a.clone()).to_args(), a.to_args());
    }

    /// What `to_args` writes, `from_args` reads back whole. A test on either
    /// function alone cannot catch the sidecar and the worker disagreeing
    /// about this mode's field.
    #[test]
    fn map_meta_round_trips_through_to_args_and_from_args() {
        let original = MapMetaArgs {
            cache_dir: Some("/cache/mapmeta".into()),
        };
        let recovered = MapMetaArgs::from_args(&original.to_args()).expect("valid argv");
        assert_eq!(recovered, original);
    }

    /// A caller with no PNG cache directory omits `--cache-dir` entirely, and
    /// that has to round trip as `None` rather than as an empty string.
    #[test]
    fn map_meta_with_no_cache_dir_omits_the_flag_and_round_trips_none() {
        let original = MapMetaArgs { cache_dir: None };
        let a = original.to_args();
        assert!(!a.contains(&"--cache-dir".to_string()));
        let recovered = MapMetaArgs::from_args(&a).expect("valid argv");
        assert_eq!(recovered, original);
    }

    #[test]
    fn map_meta_dispatches_to_args_to_its_variant() {
        let a = MapMetaArgs {
            cache_dir: Some("/cache".into()),
        };
        assert_eq!(Mode::MapMeta(a.clone()).to_args(), a.to_args());
    }

    fn map_info_args() -> MapInfoArgs {
        MapInfoArgs {
            map: "Map v1".into(),
            cache_dir: Some("/cache/mapinfo".into()),
        }
    }

    /// What `to_args` writes, `from_args` reads back whole. A test on either
    /// function alone cannot catch the sidecar and the worker disagreeing
    /// about this mode's fields.
    #[test]
    fn map_info_round_trips_through_to_args_and_from_args() {
        let original = map_info_args();
        let recovered = MapInfoArgs::from_args(&original.to_args()).expect("valid argv");
        assert_eq!(recovered, original);
    }

    /// There is nothing to read without a map, so a missing one is refused
    /// rather than treated as a quiet no-op.
    #[test]
    fn map_info_missing_map_is_refused() {
        let mut a = map_info_args().to_args();
        let at = a.iter().position(|x| x == "--map").unwrap();
        a.remove(at + 1);
        a.remove(at);
        assert!(MapInfoArgs::from_args(&a).is_err());
    }

    #[test]
    fn map_info_dispatches_to_args_to_its_variant() {
        let a = map_info_args();
        assert_eq!(Mode::MapInfo(a.clone()).to_args(), a.to_args());
    }

    fn map_skybox_args() -> MapSkyboxArgs {
        MapSkyboxArgs {
            map: "Map v1".into(),
        }
    }

    /// What `to_args` writes, `from_args` reads back whole. A test on either
    /// function alone cannot catch the sidecar and the worker disagreeing
    /// about this mode's field.
    #[test]
    fn map_skybox_round_trips_through_to_args_and_from_args() {
        let original = map_skybox_args();
        let recovered = MapSkyboxArgs::from_args(&original.to_args()).expect("valid argv");
        assert_eq!(recovered, original);
    }

    /// There is nothing to read without a map, so a missing one is refused
    /// rather than treated as a quiet no-op.
    #[test]
    fn map_skybox_missing_map_is_refused() {
        let mut a = map_skybox_args().to_args();
        let at = a.iter().position(|x| x == "--map").unwrap();
        a.remove(at + 1);
        a.remove(at);
        assert!(MapSkyboxArgs::from_args(&a).is_err());
    }

    #[test]
    fn map_skybox_dispatches_to_args_to_its_variant() {
        let a = map_skybox_args();
        assert_eq!(Mode::MapSkybox(a.clone()).to_args(), a.to_args());
    }

    fn map_catalog_walk_args() -> MapCatalogArgs {
        MapCatalogArgs {
            map: None,
            maps_file: Some("/tmp/maps.json".into()),
            keys_only: true,
            cache_dir: Some("/cache/mapcatalog".into()),
        }
    }

    /// What `to_args` writes, `from_args` reads back whole. A test on either
    /// function alone cannot catch the sidecar and the worker disagreeing
    /// about this mode's fields.
    #[test]
    fn map_catalog_walk_round_trips_through_to_args_and_from_args() {
        let original = map_catalog_walk_args();
        let recovered = MapCatalogArgs::from_args(&original.to_args()).expect("valid argv");
        assert_eq!(recovered, original);
    }

    /// No builder sends `map` today, but `run()` still honours a single map
    /// alongside the flag, so the shape has to round trip too.
    #[test]
    fn map_catalog_single_map_round_trips_through_to_args_and_from_args() {
        let original = MapCatalogArgs {
            map: Some("Map v1".into()),
            maps_file: None,
            keys_only: false,
            cache_dir: None,
        };
        let recovered = MapCatalogArgs::from_args(&original.to_args()).expect("valid argv");
        assert_eq!(recovered, original);
    }

    /// A walk with none of the optional fields given omits every flag beyond
    /// `--map-catalog` itself, and that has to round trip to all-default
    /// rather than error.
    #[test]
    fn map_catalog_with_nothing_narrowed_round_trips_to_defaults() {
        let original = MapCatalogArgs::default();
        let a = original.to_args();
        assert_eq!(a, vec!["--map-catalog".to_string()]);
        let recovered = MapCatalogArgs::from_args(&a).expect("valid argv");
        assert_eq!(recovered, original);
    }

    #[test]
    fn map_catalog_dispatches_to_args_to_its_variant() {
        let a = map_catalog_walk_args();
        assert_eq!(Mode::MapCatalog(a.clone()).to_args(), a.to_args());
    }

    fn map_minimaps_args() -> MapMinimapsArgs {
        MapMinimapsArgs {
            maps_file: Some("/tmp/maps.json".into()),
            cache_dir: Some("/cache/minimaps".into()),
            asset_dir: Some("/assets".into()),
        }
    }

    /// What `to_args` writes, `from_args` reads back whole. A test on either
    /// function alone cannot catch the sidecar and the worker disagreeing
    /// about this mode's fields.
    #[test]
    fn map_minimaps_round_trips_through_to_args_and_from_args() {
        let original = map_minimaps_args();
        let recovered = MapMinimapsArgs::from_args(&original.to_args()).expect("valid argv");
        assert_eq!(recovered, original);
    }

    /// The first pass of the sweep (issue #2379) gives no asset directory and
    /// stops at the identity, so that has to round trip to `None` too.
    #[test]
    fn map_minimaps_with_no_asset_dir_round_trips_none() {
        let original = MapMinimapsArgs {
            asset_dir: None,
            ..map_minimaps_args()
        };
        let a = original.to_args();
        assert!(!a.contains(&"--asset-dir".to_string()));
        let recovered = MapMinimapsArgs::from_args(&a).expect("valid argv");
        assert_eq!(recovered, original);
    }

    #[test]
    fn map_minimaps_dispatches_to_args_to_its_variant() {
        let a = map_minimaps_args();
        assert_eq!(Mode::MapMinimaps(a.clone()).to_args(), a.to_args());
    }

    fn heightmap_args() -> HeightmapArgs {
        HeightmapArgs {
            map: "Map v1".into(),
            cache_dir: Some("/cache/heightmap".into()),
            asset_dir: Some("/assets".into()),
        }
    }

    /// What `to_args` writes, `from_args` reads back whole. A test on either
    /// function alone cannot catch the sidecar and the worker disagreeing
    /// about this mode's fields.
    #[test]
    fn heightmap_round_trips_through_to_args_and_from_args() {
        let original = heightmap_args();
        let recovered = HeightmapArgs::from_args(&original.to_args()).expect("valid argv");
        assert_eq!(recovered, original);
    }

    /// No builder sends `--asset-dir` for this mode today, but `run()` still
    /// honours it (issue #1730), so a caller with neither optional directory
    /// has to round trip to `None` for both rather than error.
    #[test]
    fn heightmap_with_nothing_optional_round_trips_to_none() {
        let original = HeightmapArgs {
            cache_dir: None,
            asset_dir: None,
            ..heightmap_args()
        };
        let a = original.to_args();
        assert!(!a.contains(&"--cache-dir".to_string()));
        assert!(!a.contains(&"--asset-dir".to_string()));
        let recovered = HeightmapArgs::from_args(&a).expect("valid argv");
        assert_eq!(recovered, original);
    }

    /// There is nothing to render without a map, so a missing one is
    /// refused rather than treated as a quiet no-op.
    #[test]
    fn heightmap_missing_map_is_refused() {
        let mut a = heightmap_args().to_args();
        let at = a.iter().position(|x| x == "--map").unwrap();
        a.remove(at + 1);
        a.remove(at);
        assert!(HeightmapArgs::from_args(&a).is_err());
    }

    #[test]
    fn heightmap_dispatches_to_args_to_its_variant() {
        let a = heightmap_args();
        assert_eq!(Mode::Heightmap(a.clone()).to_args(), a.to_args());
    }

    fn height_field_args() -> HeightFieldArgs {
        HeightFieldArgs {
            map: "Map v1".into(),
            cache_dir: Some("/cache/heightfield".into()),
        }
    }

    /// What `to_args` writes, `from_args` reads back whole. A test on either
    /// function alone cannot catch the sidecar and the worker disagreeing
    /// about this mode's fields.
    #[test]
    fn height_field_round_trips_through_to_args_and_from_args() {
        let original = height_field_args();
        let recovered = HeightFieldArgs::from_args(&original.to_args()).expect("valid argv");
        assert_eq!(recovered, original);
    }

    /// A caller with no cache directory omits `--cache-dir` entirely, and
    /// that has to round trip as `None` rather than as an empty string.
    #[test]
    fn height_field_with_no_cache_dir_round_trips_none() {
        let original = HeightFieldArgs {
            cache_dir: None,
            ..height_field_args()
        };
        let a = original.to_args();
        assert!(!a.contains(&"--cache-dir".to_string()));
        let recovered = HeightFieldArgs::from_args(&a).expect("valid argv");
        assert_eq!(recovered, original);
    }

    /// There is nothing to read without a map, so a missing one is refused
    /// rather than treated as a quiet no-op.
    #[test]
    fn height_field_missing_map_is_refused() {
        let mut a = height_field_args().to_args();
        let at = a.iter().position(|x| x == "--map").unwrap();
        a.remove(at + 1);
        a.remove(at);
        assert!(HeightFieldArgs::from_args(&a).is_err());
    }

    #[test]
    fn height_field_dispatches_to_args_to_its_variant() {
        let a = height_field_args();
        assert_eq!(Mode::HeightField(a.clone()).to_args(), a.to_args());
    }

    fn metalmap_args() -> MetalmapArgs {
        MetalmapArgs {
            map: "Map v1".into(),
            max_side: 512,
            cache_dir: Some("/cache/metalmap".into()),
            asset_dir: Some("/assets".into()),
        }
    }

    /// What `to_args` writes, `from_args` reads back whole. A test on either
    /// function alone cannot catch the sidecar and the worker disagreeing
    /// about this mode's fields.
    #[test]
    fn metalmap_round_trips_through_to_args_and_from_args() {
        let original = metalmap_args();
        let recovered = MetalmapArgs::from_args(&original.to_args()).expect("valid argv");
        assert_eq!(recovered, original);
    }

    /// A missing `--max-side` recovers as 512, the same default `run()` read
    /// from an absent flag before this moved here.
    #[test]
    fn metalmap_missing_max_side_defaults_to_512() {
        let mut a = metalmap_args().to_args();
        let at = a.iter().position(|x| x == "--max-side").unwrap();
        a.remove(at + 1);
        a.remove(at);
        let recovered = MetalmapArgs::from_args(&a).expect("valid argv");
        assert_eq!(recovered.max_side, 512);
    }

    /// There is nothing to render without a map, so a missing one is
    /// refused rather than treated as a quiet no-op.
    #[test]
    fn metalmap_missing_map_is_refused() {
        let mut a = metalmap_args().to_args();
        let at = a.iter().position(|x| x == "--map").unwrap();
        a.remove(at + 1);
        a.remove(at);
        assert!(MetalmapArgs::from_args(&a).is_err());
    }

    #[test]
    fn metalmap_dispatches_to_args_to_its_variant() {
        let a = metalmap_args();
        assert_eq!(Mode::Metalmap(a.clone()).to_args(), a.to_args());
    }

    fn unit_buildpics_args() -> UnitBuildpicsArgs {
        UnitBuildpicsArgs {
            game: "BAR.sdd".into(),
            units: vec!["armcom".into(), "corcom".into()],
            cache_dir: Some("/cache/buildpics".into()),
            asset_dir: Some("/assets".into()),
        }
    }

    /// What `to_args` writes, `from_args` reads back whole. A test on either
    /// function alone cannot catch the sidecar and the worker disagreeing
    /// about this mode's fields.
    #[test]
    fn unit_buildpics_round_trips_through_to_args_and_from_args() {
        let original = unit_buildpics_args();
        let recovered = UnitBuildpicsArgs::from_args(&original.to_args()).expect("valid argv");
        assert_eq!(recovered, original);
    }

    /// The blueprint backfill is the only caller that asks for the hub asset
    /// (issue #1636), so no asset dir has to round trip to `None` too.
    #[test]
    fn unit_buildpics_with_no_asset_dir_round_trips_none() {
        let original = UnitBuildpicsArgs {
            asset_dir: None,
            ..unit_buildpics_args()
        };
        let a = original.to_args();
        assert!(!a.contains(&"--asset-dir".to_string()));
        let recovered = UnitBuildpicsArgs::from_args(&a).expect("valid argv");
        assert_eq!(recovered, original);
    }

    #[test]
    fn unit_buildpics_dispatches_to_args_to_its_variant() {
        let a = unit_buildpics_args();
        assert_eq!(Mode::UnitBuildpics(a.clone()).to_args(), a.to_args());
    }

    fn faction_logos_args() -> FactionLogosArgs {
        FactionLogosArgs {
            game: "BAR.sdd".into(),
            sides: vec!["Armada".into(), "Cortex".into()],
            cache_dir: Some("/cache/logos".into()),
        }
    }

    /// What `to_args` writes, `from_args` reads back whole. A test on either
    /// function alone cannot catch the sidecar and the worker disagreeing
    /// about this mode's fields.
    #[test]
    fn faction_logos_round_trips_through_to_args_and_from_args() {
        let original = faction_logos_args();
        let recovered = FactionLogosArgs::from_args(&original.to_args()).expect("valid argv");
        assert_eq!(recovered, original);
    }

    #[test]
    fn faction_logos_dispatches_to_args_to_its_variant() {
        let a = faction_logos_args();
        assert_eq!(Mode::FactionLogos(a.clone()).to_args(), a.to_args());
    }

    fn unit_dataset_args() -> UnitDatasetArgs {
        UnitDatasetArgs {
            game: "BAR.sdd".into(),
            cache_dir: Some("/cache/dataset".into()),
        }
    }

    /// What `to_args` writes, `from_args` reads back whole. A test on either
    /// function alone cannot catch the sidecar and the worker disagreeing
    /// about this mode's fields.
    #[test]
    fn unit_dataset_round_trips_through_to_args_and_from_args() {
        let original = unit_dataset_args();
        let recovered = UnitDatasetArgs::from_args(&original.to_args()).expect("valid argv");
        assert_eq!(recovered, original);
    }

    #[test]
    fn unit_dataset_dispatches_to_args_to_its_variant() {
        let a = unit_dataset_args();
        assert_eq!(Mode::UnitDataset(a.clone()).to_args(), a.to_args());
    }

    fn unit_model_args() -> UnitModelArgs {
        UnitModelArgs {
            game: "BA.sdz".into(),
            object: "ARMCOM".into(),
            cache_dir: Some("/cache/models".into()),
        }
    }

    /// What `to_args` writes, `from_args` reads back whole. A test on either
    /// function alone cannot catch the sidecar and the worker disagreeing
    /// about this mode's fields.
    #[test]
    fn unit_model_round_trips_through_to_args_and_from_args() {
        let original = unit_model_args();
        let recovered = UnitModelArgs::from_args(&original.to_args()).expect("valid argv");
        assert_eq!(recovered, original);
    }

    #[test]
    fn unit_model_dispatches_to_args_to_its_variant() {
        let a = unit_model_args();
        assert_eq!(Mode::UnitModel(a.clone()).to_args(), a.to_args());
    }

    fn unit_script_args() -> UnitScriptArgs {
        UnitScriptArgs {
            game: "BAR.sdd".into(),
            unit: "armcom".into(),
        }
    }

    /// What `to_args` writes, `from_args` reads back whole. A test on either
    /// function alone cannot catch the sidecar and the worker disagreeing
    /// about this mode's fields.
    #[test]
    fn unit_script_round_trips_through_to_args_and_from_args() {
        let original = unit_script_args();
        let recovered = UnitScriptArgs::from_args(&original.to_args()).expect("valid argv");
        assert_eq!(recovered, original);
    }

    #[test]
    fn unit_script_dispatches_to_args_to_its_variant() {
        let a = unit_script_args();
        assert_eq!(Mode::UnitScript(a.clone()).to_args(), a.to_args());
    }

    /// What `to_args` writes, `from_args` reads back whole, for the common
    /// case of a game given.
    #[test]
    fn skirmish_ais_with_a_game_round_trips_through_to_args_and_from_args() {
        let original = SkirmishAisArgs {
            game: Some("BAR.sdd".into()),
        };
        let recovered = SkirmishAisArgs::from_args(&original.to_args()).expect("valid argv");
        assert_eq!(recovered, original);
    }

    /// No game named is how a caller asks for native AIs alone, and that has
    /// to round trip as `None` rather than as an empty string.
    #[test]
    fn skirmish_ais_with_no_game_omits_the_flag_and_round_trips_none() {
        let original = SkirmishAisArgs { game: None };
        let a = original.to_args();
        assert!(!a.contains(&"--game".to_string()));
        let recovered = SkirmishAisArgs::from_args(&a).expect("valid argv");
        assert_eq!(recovered, original);
    }

    /// An empty game string is never sent by the real caller (the old
    /// `build_skirmish_ai_args` filtered it out before this moved here), so
    /// `to_args` still filters it rather than emitting a meaningless
    /// `--game`.
    #[test]
    fn skirmish_ais_with_an_empty_game_omits_the_flag() {
        let a = SkirmishAisArgs {
            game: Some(String::new()),
        }
        .to_args();
        assert!(!a.contains(&"--game".to_string()));
    }

    #[test]
    fn skirmish_ais_dispatches_to_args_to_its_variant() {
        let a = SkirmishAisArgs {
            game: Some("BAR.sdd".into()),
        };
        assert_eq!(Mode::SkirmishAis(a.clone()).to_args(), a.to_args());
    }

    /// What `to_args` writes, `from_args` reads back whole. A test on either
    /// function alone cannot catch the sidecar and the worker disagreeing
    /// about this mode's field.
    #[test]
    fn game_headers_round_trips_through_to_args_and_from_args() {
        let original = GameHeadersArgs {
            cache_dir: Some("/cache/headers".into()),
        };
        let recovered = GameHeadersArgs::from_args(&original.to_args()).expect("valid argv");
        assert_eq!(recovered, original);
    }

    /// A caller with no cache directory omits `--cache-dir` entirely, and
    /// that has to round trip as `None` rather than as an empty string.
    #[test]
    fn game_headers_with_no_cache_dir_round_trips_none() {
        let original = GameHeadersArgs { cache_dir: None };
        let a = original.to_args();
        assert!(!a.contains(&"--cache-dir".to_string()));
        let recovered = GameHeadersArgs::from_args(&a).expect("valid argv");
        assert_eq!(recovered, original);
    }

    #[test]
    fn game_headers_dispatches_to_args_to_its_variant() {
        let a = GameHeadersArgs {
            cache_dir: Some("/cache/headers".into()),
        };
        assert_eq!(Mode::GameHeaders(a.clone()).to_args(), a.to_args());
    }

    fn thumbnails_args() -> ThumbnailsArgs {
        ThumbnailsArgs {
            mip: 2,
            cache_dir: Some("/cache/thumbs".into()),
        }
    }

    /// What `to_args` writes, `from_args` reads back whole. A test on either
    /// function alone cannot catch the sidecar and the worker disagreeing
    /// about this mode's fields.
    #[test]
    fn thumbnails_round_trips_through_to_args_and_from_args() {
        let original = thumbnails_args();
        let recovered = ThumbnailsArgs::from_args(&original.to_args()).expect("valid argv");
        assert_eq!(recovered, original);
    }

    /// A missing `--mip` recovers as 1, the same default `parse_args`'s
    /// shared local read from an absent flag before this moved here.
    #[test]
    fn thumbnails_missing_mip_defaults_to_1() {
        let mut a = thumbnails_args().to_args();
        let at = a.iter().position(|x| x == "--mip").unwrap();
        a.remove(at + 1);
        a.remove(at);
        let recovered = ThumbnailsArgs::from_args(&a).expect("valid argv");
        assert_eq!(recovered.mip, 1);
    }

    #[test]
    fn thumbnails_dispatches_to_args_to_its_variant() {
        let a = thumbnails_args();
        assert_eq!(Mode::Thumbnails(a.clone()).to_args(), a.to_args());
    }

    fn lua_args() -> LuaArgs {
        LuaArgs {
            archive: "BAR.sdd".into(),
            source_file: Some("/tmp/x.lua".into()),
            chunks_file: None,
        }
    }

    /// What `to_args` writes, `from_args` reads back whole. A test on either
    /// function alone cannot catch the sidecar and the worker disagreeing
    /// about this mode's fields.
    #[test]
    fn lua_with_a_source_file_round_trips_through_to_args_and_from_args() {
        let original = lua_args();
        let recovered = LuaArgs::from_args(&original.to_args()).expect("valid argv");
        assert_eq!(recovered, original);
    }

    /// The REPL replay shape carries `chunks_file` instead of `source_file`,
    /// and that has to round trip too.
    #[test]
    fn lua_with_a_chunks_file_round_trips_through_to_args_and_from_args() {
        let original = LuaArgs {
            source_file: None,
            chunks_file: Some("/tmp/c.json".into()),
            ..lua_args()
        };
        let recovered = LuaArgs::from_args(&original.to_args()).expect("valid argv");
        assert_eq!(recovered, original);
    }

    /// `from_args` is also handed a full process argv, carrying `--lib` and
    /// `--datadir`, neither of which this mode owns.
    #[test]
    fn lua_ignores_unrecognised_tokens_around_its_own_flags() {
        let mut argv = vec![
            "--lib".to_string(),
            "/engines/one/libunitsync.so".to_string(),
            "--datadir".to_string(),
            "/data".to_string(),
        ];
        argv.extend(lua_args().to_args());
        let recovered = LuaArgs::from_args(&argv).expect("valid argv");
        assert_eq!(recovered, lua_args());
    }

    #[test]
    fn lua_dispatches_to_args_to_its_variant() {
        let a = lua_args();
        assert_eq!(Mode::Lua(a.clone()).to_args(), a.to_args());
    }

    fn archive_extract_args() -> ArchiveArgs {
        ArchiveArgs {
            archive: "Map.sd7".into(),
            file: Some("maps/x.smd".into()),
            extract: Some("/out/x.smd".into()),
        }
    }

    /// What `to_args` writes, `from_args` reads back whole, for the extract
    /// shape (archive, member and destination all given).
    #[test]
    fn archive_extract_round_trips_through_to_args_and_from_args() {
        let original = archive_extract_args();
        let recovered = ArchiveArgs::from_args(&original.to_args()).expect("valid argv");
        assert_eq!(recovered, original);
    }

    /// A file preview (no extract destination) has to round trip too.
    #[test]
    fn archive_file_preview_round_trips_through_to_args_and_from_args() {
        let original = ArchiveArgs {
            extract: None,
            ..archive_extract_args()
        };
        let a = original.to_args();
        assert!(!a.contains(&"--extract".to_string()));
        let recovered = ArchiveArgs::from_args(&a).expect("valid argv");
        assert_eq!(recovered, original);
    }

    /// A bare tree listing (neither file nor extract) has to round trip too.
    #[test]
    fn archive_tree_listing_round_trips_through_to_args_and_from_args() {
        let original = ArchiveArgs {
            file: None,
            extract: None,
            ..archive_extract_args()
        };
        let a = original.to_args();
        assert!(!a.contains(&"--file".to_string()));
        assert!(!a.contains(&"--extract".to_string()));
        let recovered = ArchiveArgs::from_args(&a).expect("valid argv");
        assert_eq!(recovered, original);
    }

    #[test]
    fn archive_dispatches_to_args_to_its_variant() {
        let a = archive_extract_args();
        assert_eq!(Mode::Archive(a.clone()).to_args(), a.to_args());
    }

    fn game_args() -> GameArgs {
        GameArgs {
            game: "BAR.sdd".into(),
            cache_dir: Some("/cache/game".into()),
        }
    }

    /// What `to_args` writes, `from_args` reads back whole. A test on either
    /// function alone cannot catch the sidecar and the worker disagreeing
    /// about this mode's fields.
    #[test]
    fn game_round_trips_through_to_args_and_from_args() {
        let original = game_args();
        let recovered = GameArgs::from_args(&original.to_args()).expect("valid argv");
        assert_eq!(recovered, original);
    }

    #[test]
    fn game_dispatches_to_args_to_its_variant() {
        let a = game_args();
        assert_eq!(Mode::Game(a.clone()).to_args(), a.to_args());
    }

    fn minimap_args() -> MinimapArgs {
        MinimapArgs {
            map: "Map v1".into(),
            mip: 2,
            cache_dir: Some("/cache/thumbs".into()),
            asset_dir: Some("/assets".into()),
        }
    }

    /// What `to_args` writes, `from_args` reads back whole. A test on either
    /// function alone cannot catch the sidecar and the worker disagreeing
    /// about this mode's fields.
    #[test]
    fn minimap_round_trips_through_to_args_and_from_args() {
        let original = minimap_args();
        let recovered = MinimapArgs::from_args(&original.to_args()).expect("valid argv");
        assert_eq!(recovered, original);
    }

    /// A missing `--mip` recovers as 1, the same default the shared `mip`
    /// local in `parse_args` used before this moved here.
    #[test]
    fn minimap_missing_mip_defaults_to_1() {
        let mut a = minimap_args().to_args();
        let at = a.iter().position(|x| x == "--mip").unwrap();
        a.remove(at + 1);
        a.remove(at);
        let recovered = MinimapArgs::from_args(&a).expect("valid argv");
        assert_eq!(recovered.mip, 1);
    }

    #[test]
    fn minimap_dispatches_to_args_to_its_variant() {
        let a = minimap_args();
        assert_eq!(Mode::Minimap(a.clone()).to_args(), a.to_args());
    }
}

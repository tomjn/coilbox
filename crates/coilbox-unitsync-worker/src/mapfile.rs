//! A map's `.smf` and `mapinfo.lua`, read straight out of its `.sd7`.
//!
//! ## Why not through unitsync
//!
//! unitsync opens every file through the engine's `CSevenZipArchive`, and for a
//! solid archive that decodes the archive's whole block before it hands back
//! any file (`SevenZipArchive.cpp` says so). Volgograd 7 Vetrov v0.19 is one
//! 600 MB block, so each of `GetMapMinHeight`, `GetInfoMapSize` and `GetInfoMap`
//! cost about 20 seconds, and the height picture, which makes two of them, took
//! 42. The page's reads stop at 30, so the map showed no heights, no metal and
//! no 3D view.
//!
//! `sevenz-rust2` can decode just the blocks holding the two files, and stop
//! partway through a block. A map's `.smf` and `mapinfo.lua` are small and
//! usually ahead of the `.smt` that makes up most of a solid block, so reading
//! only as far as both took 3 to 5 seconds a read on Volgograd, where unitsync
//! took 20 to 46. In the worst case, both at the end of a solid block, it costs
//! the one decode a single unitsync call already costs.
//!
//! ## What it answers
//!
//! The height and metal grids and their sizes, which are fixed fields of the
//! `.smf`, and the world height bounds. Those come off the header unless
//! `mapinfo.lua` sets `smf.minheight` or `smf.maxheight`, which is the rule
//! `GetMapMinHeight` applies.
//!
//! Anything it cannot answer is `None`, and the caller asks unitsync as it did
//! before: a map in a `.sdz`, a folder or a rapid package, whose files unitsync
//! already reads one at a time, and a `mapinfo.lua` that does not run on its own.

use crate::ffi::{MapinfoValues, Unitsync};
use crate::smf::{self, SmfHeader};
use std::io::{Read, Seek};
use std::path::Path;

/// A map's `.smf`, and its height bounds where they could be worked out.
pub(crate) struct MapFile {
    smf: Vec<u8>,
    header: SmfHeader,
    /// What `mapinfo.lua` set: the default for a map without one, and `None`
    /// for one that did not run on its own.
    mapinfo: Option<MapinfoValues>,
}

impl MapFile {
    /// Read `map_name`'s `.smf` and `mapinfo.lua` out of its `.sd7`, or `None`
    /// when it is not in one or the read fails.
    pub(crate) fn read(us: &Unitsync, map_name: &str) -> Option<Self> {
        let index = crate::minimap::map_index(us, map_name)?;
        let smf_name = us.map_file_name(index)?;
        let archive = crate::archive::map_archive_file(us, index, map_name)?;
        if !archive.to_lowercase().ends_with(".sd7") {
            return None;
        }
        let file = std::fs::File::open(Path::new(&archive)).ok()?;
        let mut found = members(file, &[&smf_name, "mapinfo.lua"]).ok()?;
        let mapinfo = found.pop().flatten();
        let smf = found.pop().flatten()?;
        let header = smf::header(&smf).ok()?;
        let mapinfo = match mapinfo {
            None => Some(MapinfoValues::default()),
            Some(source) => us.mapinfo_values(&String::from_utf8_lossy(&source)),
        };
        Some(Self {
            smf,
            header,
            mapinfo,
        })
    }

    /// The height grid's size.
    pub(crate) fn height_size(&self) -> (u32, u32) {
        self.header.height_size()
    }

    /// The height grid, or `None` for a file whose header points past its end.
    pub(crate) fn heights(&self) -> Option<Vec<u16>> {
        smf::heights(&self.smf, &self.header).ok()
    }

    /// The metal grid's size.
    pub(crate) fn metal_size(&self) -> (u32, u32) {
        self.header.metal_size()
    }

    /// The metal grid, or `None` for a file whose header points past its end.
    pub(crate) fn metal(&self) -> Option<Vec<u8>> {
        smf::metal(&self.smf, &self.header).ok()
    }

    /// The world heights a height word of 0 and 65535 stand for, or `None` when
    /// `mapinfo.lua` did not run on its own.
    pub(crate) fn bounds(&self) -> Option<(f32, f32)> {
        self.mapinfo
            .map(|set| bounds_with(&self.header, (set.min_height, set.max_height)))
    }

    /// The extractor radius `mapinfo.lua` declares, or `None` when it declares
    /// none or did not run on its own. Not declaring one is left to unitsync,
    /// which may fill in a default this file cannot see.
    pub(crate) fn extractor_radius(&self) -> Option<f32> {
        self.mapinfo.and_then(|set| set.extractor_radius)
    }
}

/// The header's bounds with whichever of the two `mapinfo.lua` set in their
/// place, each on its own, as `GetMapMinHeight` and `GetMapMaxHeight` do.
fn bounds_with(header: &SmfHeader, (min, max): (Option<f32>, Option<f32>)) -> (f32, f32) {
    (
        min.unwrap_or(header.min_height),
        max.unwrap_or(header.max_height),
    )
}

/// The bytes of each of `wanted` in a 7z archive, in the order asked. A name is
/// matched the way the engine's VFS matches one, ignoring case and the slash
/// direction, and one the archive does not hold is `None`.
///
/// Only the blocks holding a wanted file are decoded, and each only as far as
/// the last wanted file in it. A map packed one file to a block costs a decode
/// of those two files, as unitsync's own read does, and a solid map costs the
/// part of its one block up to them.
fn members(mut source: impl Read + Seek, wanted: &[&str]) -> Result<Vec<Option<Vec<u8>>>, String> {
    let wanted: Vec<String> = wanted.iter().map(|name| normalise(name)).collect();
    let mut found: Vec<Option<Vec<u8>>> = vec![None; wanted.len()];
    let password = sevenz_rust2::Password::empty();
    let archive = sevenz_rust2::Archive::read(&mut source, &password).map_err(|e| e.to_string())?;

    let mut blocks: Vec<usize> = archive
        .files
        .iter()
        .enumerate()
        .filter(|(_, file)| wanted.contains(&normalise(file.name())))
        .filter_map(|(at, _)| archive.stream_map.file_block_index[at])
        .collect();
    blocks.sort_unstable();
    blocks.dedup();

    for block in blocks {
        sevenz_rust2::BlockDecoder::new(1, block, &archive, &password, &mut source)
            .for_each_entries(&mut |entry, data| {
                let name = normalise(entry.name());
                match wanted.iter().position(|one| *one == name) {
                    Some(at) if found[at].is_none() => {
                        let mut bytes = Vec::new();
                        data.read_to_end(&mut bytes)?;
                        found[at] = Some(bytes);
                    }
                    // Read through rather than skipped, because the next entry
                    // starts where this one's bytes end in the decoded stream.
                    _ => {
                        std::io::copy(data, &mut std::io::sink())?;
                    }
                }
                // Stop once nothing this block holds is still wanted.
                Ok(found.iter().any(Option::is_none))
            })
            .map_err(|e| e.to_string())?;
    }
    // A wanted file with no stream is an empty file, which no block holds.
    for (at, name) in wanted.iter().enumerate() {
        if found[at].is_none()
            && archive
                .files
                .iter()
                .any(|file| !file.has_stream && normalise(file.name()) == *name)
        {
            found[at] = Some(Vec::new());
        }
    }
    Ok(found)
}

fn normalise(name: &str) -> String {
    name.replace('\\', "/").to_lowercase()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    /// A solid `.sd7` holding `entries` in order.
    fn sd7(entries: &[(&str, &[u8])]) -> Vec<u8> {
        let mut out = Cursor::new(Vec::new());
        {
            let mut writer = sevenz_rust2::ArchiveWriter::new(&mut out).unwrap();
            let files: Vec<_> = entries
                .iter()
                .map(|(name, _)| sevenz_rust2::ArchiveEntry::new_file(name))
                .collect();
            let readers: Vec<sevenz_rust2::SourceReader<Cursor<Vec<u8>>>> = entries
                .iter()
                .map(|(_, body)| Cursor::new(body.to_vec()).into())
                .collect();
            writer.push_archive_entries(files, readers).unwrap();
            writer.finish().unwrap();
        }
        out.into_inner()
    }

    #[test]
    fn reads_the_members_asked_for_in_the_order_asked() {
        let archive = sd7(&[
            ("mapinfo.lua", b"return {}"),
            ("maps/Thing.smf", b"smf bytes"),
            ("maps/thing.smt", b"tiles"),
        ]);
        let found = members(Cursor::new(archive), &["maps/thing.smf", "MAPINFO.LUA"]).unwrap();
        assert_eq!(found[0].as_deref(), Some(&b"smf bytes"[..]));
        assert_eq!(found[1].as_deref(), Some(&b"return {}"[..]));
    }

    #[test]
    fn a_member_the_archive_does_not_hold_is_none() {
        let archive = sd7(&[("maps/thing.smf", b"smf bytes")]);
        let found = members(Cursor::new(archive), &["maps/thing.smf", "mapinfo.lua"]).unwrap();
        assert_eq!(found[0].as_deref(), Some(&b"smf bytes"[..]));
        assert_eq!(found[1], None);
    }

    #[test]
    fn mapinfo_overrides_each_bound_on_its_own() {
        let header = header_with(-40.0, 300.0);
        assert_eq!(bounds_with(&header, (None, None)), (-40.0, 300.0));
        assert_eq!(bounds_with(&header, (Some(0.0), None)), (0.0, 300.0));
        assert_eq!(bounds_with(&header, (None, Some(992.0))), (-40.0, 992.0));
    }

    fn header_with(min: f32, max: f32) -> SmfHeader {
        let mut bytes = vec![0u8; 80];
        bytes[..15].copy_from_slice(b"spring map file");
        bytes[24..28].copy_from_slice(&4i32.to_le_bytes());
        bytes[28..32].copy_from_slice(&4i32.to_le_bytes());
        bytes[44..48].copy_from_slice(&min.to_le_bytes());
        bytes[48..52].copy_from_slice(&max.to_le_bytes());
        smf::header(&bytes).unwrap()
    }
}

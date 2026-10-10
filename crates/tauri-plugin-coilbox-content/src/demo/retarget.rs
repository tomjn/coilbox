//! Pointing a replay at a different game: the code the remix
//! ([`super::rewrite_demo`]) and the replay analysis copy ([`write_retargeted`],
//! issues #1183, #1155 and #3861) share.
//!
//! The remix writes a sibling file into the replay library, stamps a
//! `[coilbox]` marker and refuses a file that already carries one. The analysis
//! copy goes to a scratch path the caller names, carries no marker, is never
//! listed, and is deleted after the run.
//!
//! A replay names its game in
//! two places: the start script after the header, and the first packet of the
//! demo stream, `NETMSG_GAMEDATA`, which carries the same script again,
//! compressed. The engine has loaded the game from the packet, not the header,
//! since its commit `89d5bbc159` of December 2016
//! (`CPreGame::ReadDataFromDemo` builds its `GameData` from `scanner.GetData`).
//! A copy with only the header script rewritten plays the original game: on
//! engine `2026.07.01-102-g6e5c5a0` its log says `using game "SplinterFaction
//! $VERSION"` for a header that says otherwise. So both are rewritten here, and
//! the stream size in the header moves with the packet.
//!
//! The packet also holds the game archive's checksum as the recording host saw
//! it. That is left alone. The engine compares it, warns that the archive
//! differs from the host's copy, and carries on.

use std::io::{Read, Write};
use std::path::Path;

use super::{
    atomic_write, find_game, i32_at, open_maybe_gzip, parse_tdf, put_i32_at, read_all_maybe_gzip,
    read_at_least, replace_gametype, same_path, MAGIC, MIN_HEADER, OFF_DEMO_STREAM_SIZE,
    OFF_HEADER_SIZE, OFF_SCRIPT_SIZE,
};

/// `NETMSG_GAMEDATA` in `rts/Net/Protocol/NetMessageTypes.h`.
const NETMSG_GAMEDATA: u8 = 52;

/// `DemoStreamChunkHeader`: `f32 modGameTime`, `u32 length`.
const CHUNK_HEADER_SIZE: usize = 8;

/// The packet's own header: `u8 id`, `u16 size`, `u16 compressedSize`
/// (`GameData::Pack` in `rts/Game/GameData.cpp`).
const GAMEDATA_HEADER_SIZE: usize = 5;

fn u16_at(buf: &[u8], off: usize) -> Option<usize> {
    buf.get(off..off + 2)
        .map(|b| u16::from_le_bytes([b[0], b[1]]) as usize)
}

fn inflate(bytes: &[u8]) -> Result<Vec<u8>, String> {
    let mut out = Vec::new();
    flate2::read::ZlibDecoder::new(bytes)
        .read_to_end(&mut out)
        .map_err(|e| format!("the replay's game data packet does not decompress: {e}"))?;
    Ok(out)
}

fn deflate(bytes: &[u8]) -> Result<Vec<u8>, String> {
    let mut enc = flate2::write::ZlibEncoder::new(Vec::new(), flate2::Compression::default());
    enc.write_all(bytes)
        .map_err(|e| format!("compress game data: {e}"))?;
    enc.finish().map_err(|e| format!("compress game data: {e}"))
}

/// A start script's bytes with its `gametype` replaced.
///
/// Lossy on purpose, the way the remix is: a start script is ASCII apart from
/// player names, and a name that is not UTF-8 changes how it reads in a lobby
/// and nothing the simulation uses.
fn swap_gametype(script: &[u8], gametype: &str) -> Result<Vec<u8>, String> {
    replace_gametype(&String::from_utf8_lossy(script), gametype).map(String::into_bytes)
}

/// Rewrite the decompressed bytes of a replay so it plays `gametype`.
///
/// Everything after the first stream packet is copied as it is, trailer
/// included, so the result still decodes to the same winners and totals.
pub(super) fn retarget(bytes: &[u8], gametype: &str) -> Result<Vec<u8>, String> {
    retarget_with(bytes, gametype, Ok)
}

/// [`retarget`], with `stamp` applied to the header's start script after its
/// `gametype` is replaced. The remix stamps its marker there. The packet's own
/// script gets only the new `gametype`.
pub(super) fn retarget_with(
    bytes: &[u8],
    gametype: &str,
    stamp: impl FnOnce(String) -> Result<String, String>,
) -> Result<Vec<u8>, String> {
    if bytes.len() < MIN_HEADER || &bytes[..MAGIC.len()] != MAGIC {
        return Err("not a Spring demo file (bad magic)".into());
    }
    let header_size = i32_at(bytes, OFF_HEADER_SIZE)?.max(0) as usize;
    let script_size = i32_at(bytes, OFF_SCRIPT_SIZE)?.max(0) as usize;
    let stream_size = i32_at(bytes, OFF_DEMO_STREAM_SIZE)?.max(0) as usize;
    if header_size < MIN_HEADER {
        return Err("demo header is too small".into());
    }
    let script_end = header_size
        .checked_add(script_size)
        .filter(|&end| end <= bytes.len())
        .ok_or("demo header reports an invalid script size")?;
    let new_script = stamp(replace_gametype(
        &String::from_utf8_lossy(&bytes[header_size..script_end]),
        gametype,
    )?)?
    .into_bytes();

    // The first chunk of the stream, which has to be the game data packet.
    let length = bytes
        .get(script_end + 4..script_end + CHUNK_HEADER_SIZE)
        .map(|b| u32::from_le_bytes([b[0], b[1], b[2], b[3]]) as usize)
        .ok_or("the replay has no demo stream")?;
    let payload_start = script_end + CHUNK_HEADER_SIZE;
    let payload = payload_start
        .checked_add(length)
        .and_then(|end| bytes.get(payload_start..end))
        .ok_or("the replay's first packet runs past the end of the file")?;
    if payload.first() != Some(&NETMSG_GAMEDATA) {
        return Err(format!(
            "the replay's first packet is message {}, not the game data the engine loads its game from",
            payload.first().copied().unwrap_or(0)
        ));
    }
    let compressed_size = u16_at(payload, 3).ok_or("the game data packet is too short")?;
    let compressed = payload
        .get(GAMEDATA_HEADER_SIZE..GAMEDATA_HEADER_SIZE + compressed_size)
        .ok_or("the game data packet is shorter than its own size field")?;
    // The two checksums and the random seed, copied as they are.
    let tail = &payload[GAMEDATA_HEADER_SIZE + compressed_size..];

    let new_compressed = deflate(&swap_gametype(&inflate(compressed)?, gametype)?)?;
    let new_length = GAMEDATA_HEADER_SIZE + new_compressed.len() + tail.len();
    // Both of the packet's size fields are 16 bit.
    let packet_size = u16::try_from(new_length)
        .map_err(|_| "the rewritten game data packet is too large for its size field")?;
    let new_compressed_size = u16::try_from(new_compressed.len())
        .map_err(|_| "the rewritten game data packet is too large for its size field")?;

    let mut out = Vec::with_capacity(bytes.len() + new_script.len() + new_length);
    out.extend_from_slice(&bytes[..header_size]);
    out.extend_from_slice(&new_script);
    out.extend_from_slice(&bytes[script_end..script_end + 4]);
    out.extend_from_slice(&(new_length as u32).to_le_bytes());
    out.push(NETMSG_GAMEDATA);
    out.extend_from_slice(&packet_size.to_le_bytes());
    out.extend_from_slice(&new_compressed_size.to_le_bytes());
    out.extend_from_slice(&new_compressed);
    out.extend_from_slice(tail);
    out.extend_from_slice(&bytes[payload_start + length..]);

    let new_script_size =
        i32::try_from(new_script.len()).map_err(|_| "rewritten start-script too large")?;
    put_i32_at(&mut out, OFF_SCRIPT_SIZE, new_script_size);
    // Zero means the recording never wrote one, and the engine then reads to the
    // end of the file. Anything else has to move with the packet, or the engine
    // looks for the trailer in the wrong place.
    if stream_size > 0 {
        let moved = stream_size + new_length - length;
        let moved = i32::try_from(moved).map_err(|_| "rewritten demo stream too large")?;
        put_i32_at(&mut out, OFF_DEMO_STREAM_SIZE, moved);
    }
    Ok(out)
}

/// The `gametype` in the replay's first packet, which is the game the engine
/// plays it on. `None` when the file has no readable game data packet.
///
/// Reads only the file's prefix: the header, the script and the one packet.
pub(super) fn packet_game_of(demo: &Path) -> Option<String> {
    let mut rdr = open_maybe_gzip(demo).ok()?;
    let mut buf = Vec::new();
    read_at_least(&mut rdr, &mut buf, MIN_HEADER).ok()?;
    let script_end = i32_at(&buf, OFF_HEADER_SIZE)
        .ok()?
        .max(0)
        .checked_add(i32_at(&buf, OFF_SCRIPT_SIZE).ok()?.max(0))? as usize;
    read_at_least(
        &mut rdr,
        &mut buf,
        script_end + CHUNK_HEADER_SIZE + GAMEDATA_HEADER_SIZE,
    )
    .ok()?;
    let length = u32::from_le_bytes(buf[script_end + 4..script_end + 8].try_into().ok()?) as usize;
    let start = script_end + CHUNK_HEADER_SIZE;
    read_at_least(&mut rdr, &mut buf, start + length).ok()?;
    let script = packet_script(&buf[start..start + length])?;
    find_game(&parse_tdf(&script))
        .get("gametype")
        .map(str::to_string)
}

/// The start script inside a `NETMSG_GAMEDATA` payload.
fn packet_script(payload: &[u8]) -> Option<String> {
    if payload.first() != Some(&NETMSG_GAMEDATA) {
        return None;
    }
    let compressed =
        payload.get(GAMEDATA_HEADER_SIZE..GAMEDATA_HEADER_SIZE + u16_at(payload, 3)?)?;
    inflate(compressed)
        .ok()
        .map(|b| String::from_utf8_lossy(&b).into_owned())
}

/// Write a copy of the replay at `src` to `dst` that plays `gametype`.
///
/// `dst` is a scratch path the caller owns and deletes. The source is read and
/// never written.
pub fn write_retargeted(src: &Path, dst: &Path, gametype: &str) -> Result<(), String> {
    if same_path(src, dst) {
        return Err("refusing to write over the source demo".into());
    }
    let (bytes, _) = read_all_maybe_gzip(src)?;
    let out = retarget(&bytes, gametype)?;
    // Always gzip, whatever the source was: the engine picks a replay out by
    // its extension, and `.sdfz` is the one every engine accepts.
    let mut enc = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::fast());
    enc.write_all(&out).map_err(|e| format!("gzip demo: {e}"))?;
    let payload = enc.finish().map_err(|e| format!("gzip demo: {e}"))?;
    if let Some(parent) = dst.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("could not create {}: {e}", parent.display()))?;
    }
    atomic_write(dst, &payload)
}

#[cfg(test)]
pub(super) mod tests {
    use super::super::{decode_trailer, find_game, parse_tdf, read_trailer, tests::*};
    use super::*;
    use crate::model::TeamStatSample;

    /// A game data packet the way `GameData::Pack` writes one, framed as the
    /// first chunk of a demo stream, followed by `rest`.
    pub(in super::super) fn stream_with_game_data(script: &str, rest: &[u8]) -> Vec<u8> {
        let compressed = deflate(script.as_bytes()).unwrap();
        // 64 bytes of map checksum, 64 of game checksum, a 4 byte random seed.
        let tail: Vec<u8> = (0..132u8).collect();
        let length = GAMEDATA_HEADER_SIZE + compressed.len() + tail.len();
        let mut stream = Vec::new();
        stream.extend_from_slice(&0f32.to_le_bytes());
        stream.extend_from_slice(&(length as u32).to_le_bytes());
        stream.push(NETMSG_GAMEDATA);
        stream.extend_from_slice(&(length as u16).to_le_bytes());
        stream.extend_from_slice(&(compressed.len() as u16).to_le_bytes());
        stream.extend_from_slice(&compressed);
        stream.extend_from_slice(&tail);
        stream.extend_from_slice(rest);
        stream
    }

    const SCRIPT: &str = "[game]\n{\n[modoptions]\n{\ndeathmode=com;\n}\n\
        [player0]\n{\nteam=0;\nname=You;\n}\n\
        [team0]\n{\nallyteam=0;\nteamleader=0;\n}\n\
        [team1]\n{\nallyteam=1;\nteamleader=0;\n}\n\
        [allyteam0]\n{\nnumallies=0;\n}\n[allyteam1]\n{\nnumallies=0;\n}\n\
        gametype=Some Game 1.0;\nmapname=Some Map;\n}\n";

    /// Stands in for every later packet, which a rewrite has to leave alone.
    const LATER_PACKETS: &[u8] = b"\x00\x00\x80\x3f\x05\x00\x00\x00\x02later";

    fn fixture() -> DemoFixture {
        DemoFixture {
            script: SCRIPT.into(),
            stream: stream_with_game_data(SCRIPT, LATER_PACKETS),
            winning_ally_teams: vec![1],
            team_samples: vec![
                vec![TeamStatSample {
                    frame: 450,
                    metal_used: 12.5,
                    units_died: 3,
                    ..Default::default()
                }],
                vec![TeamStatSample {
                    frame: 450,
                    damage_dealt: 99.25,
                    ..Default::default()
                }],
            ],
            ..Default::default()
        }
    }

    fn header_gametype(bytes: &[u8]) -> String {
        let header = i32_at(bytes, OFF_HEADER_SIZE).unwrap() as usize;
        let script = i32_at(bytes, OFF_SCRIPT_SIZE).unwrap() as usize;
        let text = String::from_utf8_lossy(&bytes[header..header + script]).into_owned();
        find_game(&parse_tdf(&text))
            .get("gametype")
            .unwrap()
            .to_string()
    }

    /// The gametype inside the first stream packet, which is the one the engine
    /// loads the game from.
    fn packet_gametype(bytes: &[u8]) -> String {
        let header = i32_at(bytes, OFF_HEADER_SIZE).unwrap() as usize;
        let script = i32_at(bytes, OFF_SCRIPT_SIZE).unwrap() as usize;
        let payload = &bytes[header + script + CHUNK_HEADER_SIZE..];
        assert_eq!(payload[0], NETMSG_GAMEDATA);
        let compressed = u16_at(payload, 3).unwrap();
        let text = inflate(&payload[GAMEDATA_HEADER_SIZE..GAMEDATA_HEADER_SIZE + compressed])
            .map(|b| String::from_utf8_lossy(&b).into_owned())
            .unwrap();
        find_game(&parse_tdf(&text))
            .get("gametype")
            .unwrap()
            .to_string()
    }

    #[test]
    fn both_places_a_replay_names_its_game_are_rewritten() {
        let out = retarget(&fixture().bytes(), "Coilbox replay analysis 1").unwrap();

        assert_eq!(header_gametype(&out), "Coilbox replay analysis 1");
        assert_eq!(packet_gametype(&out), "Coilbox replay analysis 1");
    }

    /// The trailer is found from the header's sizes, so a stream size that did
    /// not move with the packet would decode some other bytes as the winner.
    #[test]
    fn the_trailer_still_decodes_to_the_same_match() {
        let original = fixture().bytes();
        let out = retarget(
            &original,
            "A much longer game name than the one it replaces 1",
        )
        .unwrap();

        assert_eq!(
            decode_trailer(&out).unwrap(),
            decode_trailer(&original).unwrap()
        );
    }

    #[test]
    fn everything_after_the_first_packet_is_copied_as_it_is() {
        let original = fixture().bytes();
        let out = retarget(&original, "Coilbox replay analysis 1").unwrap();

        let at = |bytes: &[u8]| {
            bytes
                .windows(LATER_PACKETS.len())
                .position(|w| w == LATER_PACKETS)
                .expect("the later packets are there")
        };
        assert_eq!(&out[at(&out)..], &original[at(&original)..]);
    }

    /// The checksums and the random seed behind the script decide nothing here
    /// and the seed decides the whole match, so they have to survive.
    #[test]
    fn the_packets_checksums_and_seed_are_kept() {
        let out = retarget(&fixture().bytes(), "Coilbox replay analysis 1").unwrap();

        let header = i32_at(&out, OFF_HEADER_SIZE).unwrap() as usize;
        let script = i32_at(&out, OFF_SCRIPT_SIZE).unwrap() as usize;
        let chunk = &out[header + script..];
        let length = u32::from_le_bytes(chunk[4..8].try_into().unwrap()) as usize;
        let payload = &chunk[CHUNK_HEADER_SIZE..CHUNK_HEADER_SIZE + length];
        assert_eq!(u16_at(payload, 1).unwrap(), length);
        let tail: Vec<u8> = (0..132u8).collect();
        assert_eq!(&payload[payload.len() - 132..], &tail[..]);
    }

    /// The remix stamps a marker and refuses a file that has one. This path does
    /// neither, so the copy is not a remix and a remix can be analysed.
    #[test]
    fn no_remix_marker_is_stamped() {
        let out = retarget(&fixture().bytes(), "Coilbox replay analysis 1").unwrap();
        let text = String::from_utf8_lossy(&out).into_owned();

        assert!(!text.contains("[coilbox]"));
        assert!(!text.contains("remix=1"));
    }

    #[test]
    fn a_replay_whose_stream_does_not_open_with_game_data_is_refused() {
        let f = DemoFixture {
            script: SCRIPT.into(),
            stream: LATER_PACKETS.to_vec(),
            ..Default::default()
        };

        let err = retarget(&f.bytes(), "x").unwrap_err();
        assert!(err.contains("first packet"), "{err}");
    }

    #[test]
    fn a_replay_with_no_stream_at_all_is_refused() {
        let f = DemoFixture {
            script: SCRIPT.into(),
            ..Default::default()
        };

        assert!(retarget(&f.bytes(), "x").is_err());
    }

    #[test]
    fn a_file_that_is_not_a_replay_is_refused() {
        assert!(retarget(&[b'x'; 400], "x").is_err());
    }

    /// A hash of a file's bytes. Not a cryptographic claim, only "these bytes
    /// did not change".
    pub(in super::super) fn hash_of(path: &Path) -> u64 {
        use std::hash::{Hash, Hasher};
        let mut hasher = std::collections::hash_map::DefaultHasher::new();
        std::fs::read(path).unwrap().hash(&mut hasher);
        hasher.finish()
    }

    /// The original is the player's own file. Its bytes and its modified time
    /// are the same after a rewrite as before it.
    #[test]
    fn the_original_replay_is_not_touched() {
        let dir = tempfile::tempdir().unwrap();
        let src = dir.path().join("library").join("match.sdfz");
        std::fs::create_dir_all(src.parent().unwrap()).unwrap();
        std::fs::write(&src, fixture().gzipped()).unwrap();
        let before = hash_of(&src);
        let modified = std::fs::metadata(&src).unwrap().modified().unwrap();
        let dst = dir.path().join("scratch").join("replay.sdfz");

        write_retargeted(&src, &dst, "Coilbox replay analysis 1").unwrap();

        assert_eq!(hash_of(&src), before);
        assert_eq!(
            std::fs::metadata(&src).unwrap().modified().unwrap(),
            modified
        );
        // Nothing appeared beside it either: the copy went to scratch.
        let siblings: Vec<_> = std::fs::read_dir(src.parent().unwrap())
            .unwrap()
            .flatten()
            .map(|e| e.file_name())
            .collect();
        assert_eq!(siblings.len(), 1);
        assert_eq!(
            read_trailer(&dst).unwrap(),
            decode_trailer(&fixture().bytes()).unwrap()
        );
    }

    #[test]
    fn an_uncompressed_replay_is_read_and_the_copy_is_still_gzip() {
        let dir = tempfile::tempdir().unwrap();
        let src = dir.path().join("match.sdf");
        std::fs::write(&src, fixture().bytes()).unwrap();
        let dst = dir.path().join("out").join("replay.sdfz");

        write_retargeted(&src, &dst, "Coilbox replay analysis 1").unwrap();

        let (bytes, gzip) = read_all_maybe_gzip(&dst).unwrap();
        assert!(gzip);
        assert_eq!(packet_gametype(&bytes), "Coilbox replay analysis 1");
    }

    #[test]
    fn writing_over_the_source_is_refused() {
        let dir = tempfile::tempdir().unwrap();
        let src = dir.path().join("match.sdfz");
        std::fs::write(&src, fixture().gzipped()).unwrap();

        assert!(write_retargeted(&src, &src, "x").is_err());
    }
}

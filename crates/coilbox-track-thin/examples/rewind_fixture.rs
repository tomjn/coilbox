//! Thins a dump into a track, reads the track back, and prints what it finds
//! as `name value` lines, for `scripts/rewind-headless.sh` to compare with the
//! values it knows.
//!
//! ```sh
//! cargo run -p coilbox-track-thin --example rewind_fixture -- <dump> <track> [frame ...]
//! ```
//!
//! Everything printed is read from the finished track file, not taken from the
//! thinning's own report, except `samples_checked` and `worst_error`, which
//! are the check the thinning made of every sample of the dump against that
//! file. For each frame named, one `unit` line gives every unit in the track at
//! that frame. The thinning fails, and so does this, when a sample is further
//! from the track than the tolerance.

use coilbox_track::TrackReader;
use coilbox_track_thin::{thin_dump, ThinOptions};
use std::collections::BTreeSet;
use std::fs::File;
use std::io::BufReader;
use std::path::PathBuf;
use std::process::ExitCode;

fn run() -> Result<(), String> {
    let mut args = std::env::args().skip(1);
    let (Some(dump), Some(track)) = (
        args.next().map(PathBuf::from),
        args.next().map(PathBuf::from),
    ) else {
        return Err("usage: rewind_fixture <dump> <track> [frame ...]".into());
    };
    let frames: Vec<u32> = args
        .map(|a| {
            a.parse()
                .map_err(|_| format!("{a:?} is not a frame number"))
        })
        .collect::<Result<_, _>>()?;

    let options = ThinOptions::default();
    let report = thin_dump(&dump, &track, &options).map_err(|e| e.to_string())?;
    println!("tolerance {}", options.tolerance);
    println!("samples_checked {}", report.samples.units);
    println!("worst_error {}", report.worst_error());
    println!("track_bytes {}", report.bytes);

    let mut reader = TrackReader::open(BufReader::new(
        File::open(&track).map_err(|e| e.to_string())?,
    ))
    .map_err(|e| e.to_string())?;
    let header = reader.header().clone();
    println!("first_frame {}", header.first_frame);
    println!("last_frame {}", header.last_frame);

    let mut serials = BTreeSet::new();
    for k in 0..header.window_count as usize {
        let window = reader.window(k).map_err(|e| e.to_string())?;
        serials.extend(window.units.iter().map(|u| u.unit.serial));
    }
    println!("units {}", serials.len());
    println!(
        "features {}",
        reader.features().map_err(|e| e.to_string())?.len()
    );

    let names = reader.info().map_err(|e| e.to_string())?.unit_defs;
    for frame in frames {
        let state = reader.sample(frame).map_err(|e| e.to_string())?;
        for u in state.units {
            let name = names.get(u.unit_def as usize).map_or("?", String::as_str);
            let [x, y, z] = u.position;
            println!("unit {frame} {} {name} {x:.3} {y:.3} {z:.3}", u.team);
        }
    }
    Ok(())
}

fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("{e}");
            ExitCode::FAILURE
        }
    }
}

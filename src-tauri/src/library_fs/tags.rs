/*!
Writing tags into the files themselves.

The matcher and the repair panel both wrote to the locker database, which meant a corrected title
was correct in this app and nowhere else: another player showed the old value, and a re-import into
this app read the old value straight back off the disk. The database was a note about the file
rather than a change to it.

lofty handles ID3v2, Vorbis comments and MP4 atoms behind one API, so a FLAC, an MP3 and an M4B are
the same call here instead of three formats' worth of special cases.

This modifies files in place, so it goes through the same plan-then-apply path as every other write:
confinement first, a preview of every field that would change, and nothing written until that has
been handed back. A tag write is not undoable from the recycle bin the way a delete is -- the file
is still there, its metadata is simply different -- so the previous values are recorded before the
write and can be put back.
*/

use lofty::config::WriteOptions;
use lofty::file::TaggedFileExt;
use lofty::prelude::{Accessor, ItemKey, TagExt};
use lofty::probe::Probe;
use lofty::tag::{Tag, TagType};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

use super::roots::confine_existing;

/// The fields worth writing. Deliberately the ones the matcher produces, not everything a tag holds.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TagPatch {
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub album_artist: Option<String>,
    pub year: Option<String>,
    pub track_number: Option<u32>,
    pub disc_number: Option<u32>,
    pub genre: Option<String>,
}

impl TagPatch {
    pub fn is_empty(&self) -> bool {
        self.title.is_none()
            && self.artist.is_none()
            && self.album.is_none()
            && self.album_artist.is_none()
            && self.year.is_none()
            && self.track_number.is_none()
            && self.disc_number.is_none()
            && self.genre.is_none()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TagFieldChange {
    pub field: String,
    pub before: Option<String>,
    pub after: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TagWriteRequest {
    pub path: PathBuf,
    pub patch: TagPatch,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TagPlanRow {
    pub path: PathBuf,
    pub changes: Vec<TagFieldChange>,
    /// Absent when the row can proceed. A sentence when it cannot.
    pub blocked: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TagWriteResult {
    pub path: PathBuf,
    pub ok: bool,
    pub error: Option<String>,
    /// What the fields held before, so the write can be put back.
    pub previous: TagPatch,
}

/// Read the tag this file already has, as a patch-shaped value.
pub fn read_tags(path: &Path) -> Result<TagPatch, String> {
    let tagged = Probe::open(path)
        .map_err(|e| e.to_string())?
        .read()
        .map_err(|e| e.to_string())?;

    let Some(tag) = tagged.primary_tag().or_else(|| tagged.first_tag()) else {
        // No tag at all is a legitimate state, not a failure: an untagged file is exactly what the
        // matcher exists to fix.
        return Ok(TagPatch::default());
    };

    Ok(TagPatch {
        title: tag.title().map(|v| v.to_string()),
        artist: tag.artist().map(|v| v.to_string()),
        album: tag.album().map(|v| v.to_string()),
        album_artist: tag.get_string(&ItemKey::AlbumArtist).map(|v| v.to_string()),
        year: tag.year().map(|v| v.to_string()),
        track_number: tag.track(),
        disc_number: tag.disk(),
        genre: tag.genre().map(|v| v.to_string()),
    })
}

fn field_rows(before: &TagPatch, patch: &TagPatch) -> Vec<TagFieldChange> {
    let mut rows = Vec::new();

    let mut text = |field: &str, old: &Option<String>, new: &Option<String>| {
        if let Some(value) = new {
            // Only a real difference is a change. Rewriting a field with what it already holds
            // rewrites the file for nothing, and on a large library that is thousands of writes.
            if old.as_deref() != Some(value.as_str()) {
                rows.push(TagFieldChange {
                    field: field.to_string(),
                    before: old.clone(),
                    after: value.clone(),
                });
            }
        }
    };

    text("title", &before.title, &patch.title);
    text("artist", &before.artist, &patch.artist);
    text("album", &before.album, &patch.album);
    text("albumArtist", &before.album_artist, &patch.album_artist);
    text("year", &before.year, &patch.year);
    text("genre", &before.genre, &patch.genre);

    let mut number = |field: &str, old: Option<u32>, new: Option<u32>| {
        if let Some(value) = new {
            if old != Some(value) {
                rows.push(TagFieldChange {
                    field: field.to_string(),
                    before: old.map(|v| v.to_string()),
                    after: value.to_string(),
                });
            }
        }
    };
    number("trackNumber", before.track_number, patch.track_number);
    number("discNumber", before.disc_number, patch.disc_number);

    rows
}

/// What writing these patches would change, touching nothing.
pub fn plan_tag_writes(requests: &[TagWriteRequest], roots: &[PathBuf]) -> Vec<TagPlanRow> {
    requests
        .iter()
        .map(|request| {
            let resolved = match confine_existing(&request.path, roots) {
                Ok(path) => path,
                Err(e) => {
                    return TagPlanRow {
                        path: request.path.clone(),
                        changes: Vec::new(),
                        blocked: Some(e.message().to_string()),
                    }
                }
            };
            match read_tags(&resolved) {
                Ok(before) => TagPlanRow {
                    path: resolved,
                    changes: field_rows(&before, &request.patch),
                    blocked: None,
                },
                Err(err) => TagPlanRow {
                    path: resolved,
                    changes: Vec::new(),
                    // A file whose tag cannot be read is not a file whose tag should be replaced:
                    // writing would discard whatever is there unread.
                    blocked: Some(format!("Could not read the existing tag: {err}")),
                },
            }
        })
        .collect()
}

/// Write one patch into one file, returning what it replaced.
pub fn write_tags(path: &Path, patch: &TagPatch, roots: &[PathBuf]) -> TagWriteResult {
    let resolved = match confine_existing(path, roots) {
        Ok(p) => p,
        Err(e) => {
            return TagWriteResult {
                path: path.to_path_buf(),
                ok: false,
                error: Some(e.message().to_string()),
                previous: TagPatch::default(),
            }
        }
    };

    let previous = read_tags(&resolved).unwrap_or_default();

    let result = (|| -> Result<(), String> {
        let mut tagged = Probe::open(&resolved)
            .map_err(|e| e.to_string())?
            .read()
            .map_err(|e| e.to_string())?;

        /*
         * Edit the tag that is already there, or create the kind this format expects.
         *
         * Adding an ID3v2 tag to a FLAC is legal and useless: players read Vorbis comments there,
         * so the file would gain a tag nothing looks at while still appearing untagged.
         */
        let tag_type = tagged
            .primary_tag()
            .map(|t| t.tag_type())
            .unwrap_or_else(|| tagged.file_type().primary_tag_type());

        if tagged.tag(tag_type).is_none() {
            tagged.insert_tag(Tag::new(tag_type));
        }
        let tag = tagged
            .tag_mut(tag_type)
            .ok_or("Could not open a tag to write")?;

        apply_patch(tag, patch);

        tag.save_to_path(&resolved, WriteOptions::default())
            .map_err(|e| e.to_string())
    })();

    match result {
        Ok(()) => TagWriteResult {
            path: resolved,
            ok: true,
            error: None,
            previous,
        },
        Err(err) => TagWriteResult {
            path: resolved,
            ok: false,
            error: Some(err),
            previous,
        },
    }
}

fn apply_patch(tag: &mut Tag, patch: &TagPatch) {
    if let Some(v) = &patch.title {
        tag.set_title(v.clone());
    }
    if let Some(v) = &patch.artist {
        tag.set_artist(v.clone());
    }
    if let Some(v) = &patch.album {
        tag.set_album(v.clone());
    }
    if let Some(v) = &patch.album_artist {
        tag.insert_text(ItemKey::AlbumArtist, v.clone());
    }
    if let Some(v) = &patch.genre {
        tag.set_genre(v.clone());
    }
    if let Some(v) = &patch.year {
        if let Ok(year) = v.trim().parse::<u32>() {
            tag.set_year(year);
        }
    }
    if let Some(v) = patch.track_number {
        tag.set_track(v);
    }
    if let Some(v) = patch.disc_number {
        tag.set_disk(v);
    }
}

/// Is this a file whose tags can be written at all? Used to keep unsupported rows out of a plan.
pub fn is_taggable(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_ascii_lowercase()
            .as_str(),
        "mp3" | "flac" | "m4a" | "m4b" | "mp4" | "ogg" | "opus" | "wav" | "aiff" | "wv" | "ape"
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    struct Temp(PathBuf);
    impl Temp {
        fn new(tag: &str) -> Self {
            let base = std::env::temp_dir().join(format!(
                "sandbox-tags-{tag}-{}",
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ));
            fs::create_dir_all(&base).unwrap();
            Temp(base)
        }
    }
    impl Drop for Temp {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    /*
     * A real, playable WAV.
     *
     * lofty will not write into a file it cannot fully parse, so a fixture has to be structurally
     * valid rather than merely start with the right magic. A hand-built FLAC with only a
     * STREAMINFO block gets read fine and panics the writer; a WAV is forty-four bytes of header
     * and some samples, and there is nothing left to get wrong.
     */
    fn write_audio_fixture(path: &Path) {
        let sample_rate: u32 = 8000;
        let samples: Vec<i16> = (0..1600)
            .map(|i| ((i as f32 * 0.05).sin() * 8000.0) as i16)
            .collect();
        let data_len = (samples.len() * 2) as u32;

        let mut bytes: Vec<u8> = Vec::new();
        bytes.extend_from_slice(b"RIFF");
        bytes.extend_from_slice(&(36 + data_len).to_le_bytes());
        bytes.extend_from_slice(b"WAVEfmt ");
        bytes.extend_from_slice(&16u32.to_le_bytes()); // PCM chunk size
        bytes.extend_from_slice(&1u16.to_le_bytes()); // PCM
        bytes.extend_from_slice(&1u16.to_le_bytes()); // mono
        bytes.extend_from_slice(&sample_rate.to_le_bytes());
        bytes.extend_from_slice(&(sample_rate * 2).to_le_bytes()); // byte rate
        bytes.extend_from_slice(&2u16.to_le_bytes()); // block align
        bytes.extend_from_slice(&16u16.to_le_bytes()); // bits per sample
        bytes.extend_from_slice(b"data");
        bytes.extend_from_slice(&data_len.to_le_bytes());
        for sample in samples {
            bytes.extend_from_slice(&sample.to_le_bytes());
        }
        fs::write(path, bytes).unwrap();
    }

    #[test]
    fn reads_an_untagged_file_as_empty_rather_than_failing() {
        // An untagged file is exactly what the matcher exists to fix; it is not an error.
        let t = Temp::new("untagged");
        let file = t.0.join("bare.wav");
        write_audio_fixture(&file);
        let tags = read_tags(&file).expect("read");
        assert!(tags.title.is_none());
    }

    #[test]
    fn writes_a_tag_and_reads_it_back() {
        let t = Temp::new("roundtrip");
        let file = t.0.join("track.wav");
        write_audio_fixture(&file);

        let roots = vec![t.0.clone()];
        let patch = TagPatch {
            title: Some("Paranoid Android".into()),
            artist: Some("Radiohead".into()),
            album: Some("OK Computer".into()),
            track_number: Some(2),
            ..Default::default()
        };

        let result = write_tags(&file, &patch, &roots);
        assert!(result.ok, "{:?}", result.error);

        let after = read_tags(&file).expect("read back");
        assert_eq!(after.title.as_deref(), Some("Paranoid Android"));
        assert_eq!(after.artist.as_deref(), Some("Radiohead"));
        assert_eq!(after.album.as_deref(), Some("OK Computer"));
        assert_eq!(after.track_number, Some(2));
    }

    #[test]
    fn records_what_it_replaced_so_the_write_can_be_put_back() {
        let t = Temp::new("previous");
        let file = t.0.join("track.wav");
        write_audio_fixture(&file);
        let roots = vec![t.0.clone()];

        write_tags(
            &file,
            &TagPatch { title: Some("First".into()), ..Default::default() },
            &roots,
        );
        let second = write_tags(
            &file,
            &TagPatch { title: Some("Second".into()), ..Default::default() },
            &roots,
        );

        assert_eq!(second.previous.title.as_deref(), Some("First"));
    }

    #[test]
    fn leaves_fields_the_patch_does_not_mention_alone() {
        // A patch is a change, not a replacement. Clearing an artist because the matcher had
        // nothing to say about it would lose data the file already had.
        let t = Temp::new("partial");
        let file = t.0.join("track.wav");
        write_audio_fixture(&file);
        let roots = vec![t.0.clone()];

        write_tags(
            &file,
            &TagPatch {
                title: Some("Title".into()),
                artist: Some("Artist".into()),
                ..Default::default()
            },
            &roots,
        );
        write_tags(
            &file,
            &TagPatch { album: Some("Album".into()), ..Default::default() },
            &roots,
        );

        let after = read_tags(&file).expect("read");
        assert_eq!(after.artist.as_deref(), Some("Artist"));
        assert_eq!(after.album.as_deref(), Some("Album"));
    }

    #[test]
    fn refuses_a_file_outside_the_library() {
        let t = Temp::new("outside");
        let root = t.0.join("library");
        let outside = t.0.join("elsewhere");
        fs::create_dir_all(&root).unwrap();
        fs::create_dir_all(&outside).unwrap();
        let stranger = outside.join("track.wav");
        write_audio_fixture(&stranger);

        let result = write_tags(
            &stranger,
            &TagPatch { title: Some("Nope".into()), ..Default::default() },
            &[root],
        );
        assert!(!result.ok);
        assert!(read_tags(&stranger).unwrap().title.is_none());
    }

    #[test]
    fn a_plan_reports_only_fields_that_would_actually_change() {
        /*
         * Rewriting a field with what it already holds rewrites the file for nothing, and across a
         * large library that is thousands of pointless writes.
         */
        let t = Temp::new("plan");
        let file = t.0.join("track.wav");
        write_audio_fixture(&file);
        let roots = vec![t.0.clone()];
        write_tags(
            &file,
            &TagPatch { title: Some("Same".into()), ..Default::default() },
            &roots,
        );

        let rows = plan_tag_writes(
            &[TagWriteRequest {
                path: file.clone(),
                patch: TagPatch {
                    title: Some("Same".into()),
                    artist: Some("New".into()),
                    ..Default::default()
                },
            }],
            &roots,
        );

        assert_eq!(rows.len(), 1);
        let fields: Vec<&str> = rows[0].changes.iter().map(|c| c.field.as_str()).collect();
        assert_eq!(fields, vec!["artist"]);
    }

    #[test]
    fn a_plan_writes_nothing() {
        let t = Temp::new("planonly");
        let file = t.0.join("track.wav");
        write_audio_fixture(&file);
        let roots = vec![t.0.clone()];

        plan_tag_writes(
            &[TagWriteRequest {
                path: file.clone(),
                patch: TagPatch { title: Some("Planned".into()), ..Default::default() },
            }],
            &roots,
        );

        assert!(read_tags(&file).unwrap().title.is_none());
    }

    #[test]
    fn a_plan_reports_a_file_outside_the_roots_rather_than_dropping_it() {
        let t = Temp::new("planoutside");
        let root = t.0.join("library");
        fs::create_dir_all(&root).unwrap();

        let rows = plan_tag_writes(
            &[TagWriteRequest {
                path: t.0.join("elsewhere.wav"),
                patch: TagPatch { title: Some("x".into()), ..Default::default() },
            }],
            &[root],
        );
        assert_eq!(rows.len(), 1);
        assert!(rows[0].blocked.is_some());
    }

    #[test]
    fn knows_which_files_can_hold_tags() {
        assert!(is_taggable(Path::new("a.flac")));
        assert!(is_taggable(Path::new("a.M4B")));
        assert!(!is_taggable(Path::new("cover.jpg")));
        assert!(!is_taggable(Path::new("notes.txt")));
    }
}

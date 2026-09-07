//! The desktop shell.
//!
//! Its whole job is to give the app a real folder of songs. On the web the
//! songs are baked into the bundle and saving is a download; here they are
//! files you can open in a text editor, and the app notices when you do. That
//! is the difference between a browser toy and something two people can work in
//! at once — which is the point of the format.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::mpsc::channel;
use std::time::{Duration, Instant};

use notify::{RecursiveMode, Watcher};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

const SUFFIX: &str = ".song.json";

#[derive(Serialize, Clone)]
pub struct SongFile {
    name: String,
    source: String,
}

/// Where songs live: `<Documents>/Notewright/songs`, or a folder beside the
/// executable when there is no Documents directory to speak of.
fn songs_dir(app: &AppHandle) -> PathBuf {
    let base = app
        .path()
        .document_dir()
        .or_else(|_| app.path().home_dir())
        .unwrap_or_else(|_| PathBuf::from("."));
    base.join("Notewright").join("songs")
}

/// A song name has to be a bare file name. Anything else is a way out of the
/// folder, so it is rejected rather than sanitised — quietly rewriting a path
/// would write somewhere the caller did not ask for.
fn valid_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 96
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn read_dir_songs(dir: &Path) -> Vec<SongFile> {
    let mut songs = Vec::new();
    let Ok(entries) = fs::read_dir(dir) else {
        return songs;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let Some(file_name) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        if !file_name.ends_with(SUFFIX) || file_name.starts_with('.') {
            continue;
        }
        if let Ok(source) = fs::read_to_string(&path) {
            songs.push(SongFile {
                name: file_name[..file_name.len() - SUFFIX.len()].to_string(),
                source,
            });
        }
    }
    songs.sort_by(|a, b| a.name.cmp(&b.name));
    songs
}

/// Copies the songs shipped with the app into the user's folder, once.
///
/// Only ever adds: a demo the user has edited is theirs now, and replacing it
/// on every launch would throw their work away.
fn seed_songs(app: &AppHandle, dir: &Path) {
    let Ok(bundled) = app
        .path()
        .resolve("songs", tauri::path::BaseDirectory::Resource)
    else {
        return;
    };
    for song in read_dir_songs(&bundled) {
        let target = dir.join(format!("{}{}", song.name, SUFFIX));
        if !target.exists() {
            let _ = fs::write(&target, song.source);
        }
    }
}

#[tauri::command]
fn songs_folder(app: AppHandle) -> String {
    songs_dir(&app).to_string_lossy().to_string()
}

#[tauri::command]
fn list_songs(app: AppHandle) -> Vec<SongFile> {
    let dir = songs_dir(&app);
    let _ = fs::create_dir_all(&dir);
    read_dir_songs(&dir)
}

#[tauri::command]
fn write_song(app: AppHandle, name: String, source: String) -> Result<(), String> {
    if !valid_name(&name) {
        return Err(format!(
            "\"{name}\" is not a usable file name. Letters, digits, dashes and underscores only."
        ));
    }
    // Refusing to write JSON that will not load back is cheaper than debugging
    // a corrupt file later.
    serde_json::from_str::<serde_json::Value>(&source)
        .map_err(|error| format!("That is not valid JSON, so it was not written: {error}"))?;

    let dir = songs_dir(&app);
    fs::create_dir_all(&dir).map_err(|error| format!("Could not create {dir:?}: {error}"))?;
    let path = dir.join(format!("{name}{SUFFIX}"));
    let body = if source.ends_with('\n') {
        source
    } else {
        format!("{source}\n")
    };
    fs::write(&path, body).map_err(|error| format!("Could not write {path:?}: {error}"))
}

/// Opens the songs folder in Finder or Explorer.
#[tauri::command]
fn reveal_songs_folder(app: AppHandle) -> Result<(), String> {
    let dir = songs_dir(&app);
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    let opener = if cfg!(target_os = "macos") {
        "open"
    } else if cfg!(target_os = "windows") {
        "explorer"
    } else {
        "xdg-open"
    };
    std::process::Command::new(opener)
        .arg(&dir)
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("Could not open {dir:?}: {error}"))
}

/// Watches the songs folder and tells the window when anything in it changes.
///
/// Debounced, because a text editor writing a file produces a burst of events
/// and reloading the song four times would fight whoever is typing.
fn watch_songs(app: AppHandle) {
    std::thread::spawn(move || {
        let dir = songs_dir(&app);
        if fs::create_dir_all(&dir).is_err() {
            return;
        }
        let (sender, receiver) = channel();
        let Ok(mut watcher) = notify::recommended_watcher(move |event| {
            let _ = sender.send(event);
        }) else {
            return;
        };
        if watcher.watch(&dir, RecursiveMode::NonRecursive).is_err() {
            return;
        }

        let mut pending: Option<Instant> = None;
        loop {
            match receiver.recv_timeout(Duration::from_millis(120)) {
                Ok(Ok(_)) => pending = Some(Instant::now()),
                Ok(Err(_)) => {}
                Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {}
                Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
            }
            if let Some(at) = pending {
                if at.elapsed() >= Duration::from_millis(180) {
                    pending = None;
                    let _ = app.emit("songs-changed", read_dir_songs(&dir));
                }
            }
        }
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            songs_folder,
            list_songs,
            write_song,
            reveal_songs_folder
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            let dir = songs_dir(&handle);
            let _ = fs::create_dir_all(&dir);
            seed_songs(&handle, &dir);
            watch_songs(handle);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Notewright failed to start");
}

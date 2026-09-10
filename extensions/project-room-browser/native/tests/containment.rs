mod common;

use common::{symlink_dir, symlink_file, NativeProcess};
use serde_json::json;
use std::fs;
use std::path::Path;

fn fixture() -> tempfile::TempDir {
    let base = tempfile::tempdir().expect("temporary fixture");
    fs::create_dir(base.path().join("room")).unwrap();
    fs::create_dir(base.path().join("outside")).unwrap();
    fs::write(base.path().join("room/inside.txt"), b"synthetic-inside").unwrap();
    fs::write(base.path().join("outside/inside.txt"), b"synthetic-outside").unwrap();
    base
}

#[test]
fn reads_regular_files_and_returns_stable_handle_identity() {
    let base = fixture();
    let root = base.path().join("room");
    fs::hard_link(root.join("inside.txt"), root.join("alias.txt")).unwrap();
    fs::write(root.join("other.txt"), b"synthetic-inside").unwrap();
    let mut reader = NativeProcess::spawn(&root);
    let first = reader.open("inside.txt");
    let second = reader.open("inside.txt");
    assert_eq!(first.header["ok"], true);
    assert_eq!(first.header["stat"]["type"], "file");
    assert_eq!(first.header["stat"]["size"], 16);
    assert!(!first.header["stat"]["identity"]
        .as_str()
        .unwrap()
        .is_empty());
    assert_eq!(
        first.header["stat"]["identity"],
        second.header["stat"]["identity"]
    );
    assert_ne!(first.header["handle"], second.header["handle"]);
    let alias = reader.open("alias.txt");
    let other = reader.open("other.txt");
    assert_eq!(alias.header["ok"], true);
    assert_eq!(other.header["ok"], true);
    assert_eq!(first.header["stat"]["identity"], alias.header["stat"]["identity"]);
    assert_ne!(first.header["stat"]["identity"], other.header["stat"]["identity"]);
    assert_eq!(reader.read("inside.txt").bytes, b"synthetic-inside");
    reader.shutdown();
}

#[test]
fn refuses_leaf_and_ancestor_swaps_without_returning_outside_bytes() {
    let base = fixture();
    let root = base.path().join("room");
    fs::create_dir(root.join("nested")).unwrap();
    fs::write(root.join("nested/inside.txt"), b"synthetic-inside").unwrap();
    let mut reader = NativeProcess::spawn(&root);
    fs::remove_file(root.join("inside.txt")).unwrap();
    symlink_file(
        &base.path().join("outside/inside.txt"),
        &root.join("inside.txt"),
    );
    fs::rename(root.join("nested"), root.join("old-nested")).unwrap();
    symlink_dir(&base.path().join("outside"), &root.join("nested"));
    for rel in ["inside.txt", "nested/inside.txt", "nested/missing.txt"] {
        let reply = reader.read(rel);
        assert_eq!(reply.header["ok"], false, "accepted {rel}");
        assert_ne!(
            reply.header["error"]["code"], "ENOENT",
            "escape became absence"
        );
        assert!(reply.bytes.is_empty());
    }
    reader.shutdown();
}

#[test]
fn retains_the_selected_directory_when_its_path_is_replaced() {
    let base = fixture();
    let root = base.path().join("room");
    let moved = base.path().join("moved-room");
    let mut reader = NativeProcess::spawn(&root);
    match fs::rename(&root, &moved) {
        Ok(()) => symlink_dir(&base.path().join("outside"), &root),
        Err(error) => {
            #[cfg(windows)]
            {
                assert!(matches!(error.raw_os_error(), Some(5 | 32)));
                assert_eq!(reader.read("inside.txt").bytes, b"synthetic-inside");
                reader.shutdown();
                fs::rename(&root, &moved).expect("closing the grant releases its rename lock");
                return;
            }
            #[cfg(not(windows))]
            panic!("replace root fixture: {error}");
        }
    }
    assert_eq!(reader.read("inside.txt").bytes, b"synthetic-inside");
    reader.shutdown();
}

#[test]
fn permits_internal_links_but_distinguishes_dangling_links_from_optional_absence() {
    let base = fixture();
    let root = base.path().join("room");
    symlink_file(Path::new("inside.txt"), &root.join("relative.txt"));
    symlink_file(&root.join("inside.txt"), &root.join("absolute.txt"));
    fs::create_dir(root.join("subdir")).unwrap();
    symlink_dir(Path::new("subdir"), &root.join("directory"));
    symlink_file(Path::new("missing.txt"), &root.join("dangling.txt"));
    symlink_file(Path::new("cycle-b"), &root.join("cycle-a"));
    symlink_file(Path::new("cycle-a"), &root.join("cycle-b"));
    let mut reader = NativeProcess::spawn(&root);
    for rel in ["relative.txt", "absolute.txt"] {
        assert_eq!(reader.read(rel).bytes, b"synthetic-inside");
    }
    for rel in ["missing.txt", "directory/missing.txt"] {
        let reply = reader.read(rel);
        assert_eq!(reply.header["ok"], false);
        assert_eq!(reply.header["error"]["code"], "ENOENT");
    }
    for rel in ["dangling.txt", "cycle-a"] {
        let reply = reader.read(rel);
        assert_eq!(reply.header["ok"], false);
        assert_ne!(reply.header["error"]["code"], "ENOENT");
    }
    reader.shutdown();
}

#[test]
fn absolute_and_parent_requests_cannot_grant_another_root() {
    let base = fixture();
    let mut reader = NativeProcess::spawn(&base.path().join("room"));
    let absolute = base.path().join("outside/inside.txt");
    for rel in ["../outside/inside.txt", absolute.to_str().unwrap()] {
        let result = reader.read(rel);
        assert_eq!(result.header["ok"], false);
        assert!(result.bytes.is_empty());
    }
    reader.shutdown();
}

#[test]
fn filesystem_root_grants_read_only_the_named_fixture_in_this_test() {
    let base = fixture();
    let file = base.path().join("room/inside.txt");
    let root = file.ancestors().last().unwrap();
    let relative = file.strip_prefix(root).unwrap().to_str().unwrap();
    let mut reader = NativeProcess::spawn(root);
    assert_eq!(reader.read(relative).bytes, b"synthetic-inside");
    reader.shutdown();
}

#[test]
fn a_file_handle_is_not_redirected_after_its_name_changes() {
    let base = fixture();
    let root = base.path().join("room");
    let mut reader = NativeProcess::spawn(&root);
    let opened = reader.open("inside.txt");
    assert_eq!(opened.header["ok"], true);
    match fs::rename(root.join("inside.txt"), root.join("old.txt")) {
        Ok(()) => symlink_file(
            &base.path().join("outside/inside.txt"),
            &root.join("inside.txt"),
        ),
        Err(error) => {
            #[cfg(windows)]
            assert!(matches!(error.raw_os_error(), Some(5 | 32)));
            #[cfg(not(windows))]
            panic!("replace fixture file: {error}");
        }
    }
    let reply = reader.request(json!({
        "op": "read_prefix", "handle": opened.header["handle"], "limit": 4096,
    }));
    assert_eq!(reply.bytes, b"synthetic-inside");
    reader.shutdown();
}

#[test]
fn external_aliases_are_not_looked_up_even_when_they_return_inside() {
    let base = fixture();
    let root = base.path().join("room");
    symlink_dir(&root, &base.path().join("outside/return"));
    symlink_file(
        &base.path().join("outside/return/inside.txt"),
        &root.join("alias"),
    );
    let mut reader = NativeProcess::spawn(&root);
    assert_eq!(reader.read("alias").header["ok"], false);
    reader.shutdown();
}

// APFS refuses these names at creation; Linux can exercise the protocol refusal.
#[cfg(target_os = "linux")]
#[test]
fn invalid_utf8_directory_names_are_refused_not_lossily_renamed() {
    use std::ffi::OsString;
    use std::os::unix::ffi::OsStringExt;

    let base = fixture();
    let root = base.path().join("room");
    fs::write(root.join(OsString::from_vec(b"invalid-\xff".to_vec())), b"").unwrap();
    let mut reader = NativeProcess::spawn(&root);
    let opened = reader.request(json!({ "op": "open_directory", "rel": "." }));
    assert_eq!(opened.header["ok"], true);
    let reply =
        reader.request(json!({ "op": "read_directory", "handle": opened.header["handle"] }));
    assert_eq!(reply.header["ok"], false);
    assert_eq!(reply.header["error"]["code"], "ROOM_READER_PATH");
    assert!(reply.bytes.is_empty());
    reader.shutdown();
}

#[test]
fn directory_batches_preserve_all_entries_and_do_not_follow_links() {
    let base = fixture();
    let root = base.path().join("room");
    for index in 0..70 {
        fs::write(root.join(format!("entry-{index}")), b"").unwrap();
    }
    symlink_dir(&base.path().join("outside"), &root.join("outside-link"));
    let mut reader = NativeProcess::spawn(&root);
    let opened = reader.request(json!({ "op": "open_directory", "rel": "." }));
    assert_eq!(opened.header["ok"], true);
    let mut names = Vec::new();
    loop {
        let reply =
            reader.request(json!({ "op": "read_directory", "handle": opened.header["handle"] }));
        assert_eq!(reply.header["ok"], true);
        let entries = reply.header["entries"].as_array().unwrap();
        assert!(entries.len() <= 32);
        for entry in entries {
            if entry["name"] == "outside-link" {
                assert_eq!(entry["type"], "symlink");
            }
            names.push(entry["name"].as_str().unwrap().to_owned());
        }
        if reply.header["done"] == true {
            break;
        }
    }
    names.sort();
    assert_eq!(names.len(), 72);
    names.dedup();
    assert_eq!(names.len(), 72);
    reader.shutdown();
}

#[cfg(unix)]
#[test]
fn special_files_without_a_peer_do_not_block_the_reader() {
    use std::io::{Read, Write};
    use std::process::{Command, Stdio};
    use std::sync::mpsc;
    use std::time::Duration;

    let base = fixture();
    let root = base.path().join("room");
    assert!(Command::new("mkfifo")
        .arg(root.join("pipe"))
        .status()
        .unwrap()
        .success());
    let mut child = Command::new(env!("CARGO_BIN_EXE_room-reader"))
        .arg(&root)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();
    child
        .stdin
        .take()
        .unwrap()
        .write_all(
            concat!(
                "{\"id\":1,\"op\":\"open_file\",\"rel\":\"pipe\"}\n",
                "{\"id\":2,\"op\":\"read_prefix\",\"handle\":1,\"limit\":16}\n",
                "{\"id\":3,\"op\":\"shutdown\"}\n",
            )
            .as_bytes(),
        )
        .unwrap();
    let mut output = child.stdout.take().unwrap();
    let (sender, receiver) = mpsc::channel();
    let reading = std::thread::spawn(move || {
        let mut bytes = Vec::new();
        output.read_to_end(&mut bytes).unwrap();
        sender.send(bytes).unwrap();
    });
    let result = receiver.recv_timeout(Duration::from_secs(3));
    if result.is_err() {
        child.kill().expect("stop only the blocked fixture helper");
        child.wait().unwrap();
        reading.join().unwrap();
        panic!("special-file inspection must not wait for a FIFO peer");
    }
    assert!(child.wait().unwrap().success());
    reading.join().unwrap();
    let bytes = result.unwrap();
    let replies: Vec<serde_json::Value> = std::str::from_utf8(&bytes)
        .unwrap()
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect();
    assert_eq!(replies.len(), 4);
    assert_eq!(replies[2]["ok"], false);
    assert_eq!(replies[2]["payloadLength"], 0);
    assert_eq!(replies[3]["ok"], true);
}

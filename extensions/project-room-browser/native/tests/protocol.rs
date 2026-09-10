mod common;

use common::NativeProcess;
use serde_json::json;
use std::fs;
use std::io::Write;
use std::process::{Command, Stdio};

#[test]
fn directory_metadata_is_available_but_directory_bytes_are_refused() {
    let root = tempfile::tempdir().unwrap();
    fs::create_dir(root.path().join("not-a-file")).unwrap();
    let mut reader = NativeProcess::spawn(root.path());
    let opened = reader.open("not-a-file");
    assert_eq!(opened.header["ok"], true);
    assert_eq!(opened.header["stat"]["type"], "directory");
    let reply = reader.request(json!({
        "op": "read_prefix", "handle": opened.header["handle"], "limit": 4096,
    }));
    assert_eq!(reply.header["ok"], false);
    assert_eq!(reply.header["error"]["code"], "ROOM_READER_TYPE");
    assert!(reply.bytes.is_empty());
    reader.shutdown();
}

#[test]
fn prefixes_and_handle_limits_are_enforced_by_the_production_helper() {
    let root = tempfile::tempdir().unwrap();
    fs::write(root.path().join("data"), b"abcdef").unwrap();
    let mut reader = NativeProcess::spawn(root.path());
    let mut handles = Vec::new();
    for _ in 0..32 {
        let opened = reader.open("data");
        assert_eq!(opened.header["ok"], true);
        handles.push(opened.header["handle"].clone());
    }
    assert_eq!(reader.open("data").header["ok"], false);
    let prefix = reader.request(json!({ "op": "read_prefix", "handle": handles[0], "limit": 3 }));
    assert_eq!(prefix.bytes, b"abc");
    let empty = reader.request(json!({ "op": "read_prefix", "handle": handles[0], "limit": 0 }));
    assert_eq!(empty.header["ok"], true);
    assert!(empty.bytes.is_empty());
    let again = reader.request(json!({ "op": "read_prefix", "handle": handles[0], "limit": 6 }));
    assert_eq!(again.bytes, b"abcdef");
    let large = reader.request(
        json!({ "op": "read_prefix", "handle": handles[0], "limit": 25 * 1024 * 1024 + 2 }),
    );
    assert_eq!(large.header["ok"], false);
    assert!(large.bytes.is_empty());
    assert_eq!(
        reader
            .request(json!({ "op": "close_handle", "handle": handles[0] }))
            .header["ok"],
        true
    );
    assert_eq!(
        reader
            .request(json!({ "op": "close_handle", "handle": handles[0] }))
            .header["ok"],
        false
    );
    assert_eq!(reader.open("data").header["ok"], true);
    reader.shutdown();
}

#[test]
fn binary_payloads_stop_at_the_exact_native_limit() {
    let root = tempfile::tempdir().unwrap();
    let limit = 25 * 1024 * 1024 + 1;
    fs::File::create(root.path().join("sparse"))
        .unwrap()
        .set_len(limit + 1)
        .unwrap();
    let mut reader = NativeProcess::spawn(root.path());
    let opened = reader.open("sparse");
    assert_eq!(opened.header["ok"], true);
    let reply = reader.request(json!({
        "op": "read_prefix", "handle": opened.header["handle"], "limit": limit,
    }));
    assert_eq!(reply.header["ok"], true);
    assert_eq!(reply.header["payloadLength"], limit);
    assert_eq!(reply.bytes.len() as u64, limit);
    assert!(reply.bytes.iter().all(|byte| *byte == 0));
    reader.shutdown();
}

#[test]
fn an_exactly_full_valid_header_is_accepted() {
    let root = tempfile::tempdir().unwrap();
    let mut input = br#"{"id":1,"op":"shutdown"}"#.to_vec();
    input.resize(256 * 1024 - 1, b' ');
    input.push(b'\n');
    let mut child = Command::new(env!("CARGO_BIN_EXE_room-reader"))
        .arg(root.path())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();
    child.stdin.take().unwrap().write_all(&input).unwrap();
    let output = child.wait_with_output().unwrap();
    assert!(output.status.success());
    let replies: Vec<serde_json::Value> = std::str::from_utf8(&output.stdout)
        .unwrap()
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect();
    assert_eq!(replies.len(), 2);
    assert_eq!(replies[1]["ok"], true);
    assert_eq!(replies[1]["id"], 1);
}

#[test]
fn malformed_oversized_and_unterminated_requests_exit_unsuccessfully() {
    let root = tempfile::tempdir().unwrap();
    for request in [
        b"not-json\n".to_vec(),
        br#"{"id":1,"op":"grant_root","root":"/"}
"#
        .to_vec(),
        br#"{"id":1,"op":"shutdown","unexpected":true}
"#
        .to_vec(),
        br#"{"id":1,"op":"shutdown"}"#.to_vec(),
        [vec![b' '; 256 * 1024], b"\n".to_vec()].concat(),
    ] {
        let mut child = Command::new(env!("CARGO_BIN_EXE_room-reader"))
            .arg(root.path())
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap();
        child.stdin.take().unwrap().write_all(&request).unwrap();
        let output = child.wait_with_output().unwrap();
        assert!(
            !output.status.success(),
            "invalid protocol must not exit successfully"
        );
        assert!(output.stdout.len() <= 2 * 256 * 1024);
        assert!(output.stderr.len() <= 8192);
    }
}

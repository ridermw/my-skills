#![allow(dead_code)]

use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Read, Write};
use std::path::Path;
use std::process::{Child, ChildStdout, Command, Stdio};

pub struct Reply {
    pub header: Value,
    pub bytes: Vec<u8>,
}

pub struct NativeProcess {
    child: Child,
    output: BufReader<ChildStdout>,
    next_id: u64,
}

impl NativeProcess {
    pub fn spawn(root: &Path) -> Self {
        let mut child = Command::new(env!("CARGO_BIN_EXE_room-reader"))
            .arg(root)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()
            .expect("start production helper");
        let output = BufReader::new(child.stdout.take().expect("helper stdout"));
        let mut process = Self {
            child,
            output,
            next_id: 1,
        };
        let hello = process.reply();
        assert_eq!(hello.header["protocol"], 1);
        assert_eq!(hello.header["id"], 0);
        assert_eq!(hello.header["ok"], true, "root startup: {}", hello.header);
        assert!(hello.bytes.is_empty());
        process
    }

    fn reply(&mut self) -> Reply {
        let mut line = String::new();
        let count = self
            .output
            .read_line(&mut line)
            .expect("read response header");
        assert!(
            count > 0,
            "the production helper must emit a framed response"
        );
        assert!(count <= 256 * 1024, "response header exceeded its limit");
        let header: Value = serde_json::from_str(&line).expect("JSON response");
        let size = header["payloadLength"].as_u64().expect("payload length") as usize;
        assert!(size <= 25 * 1024 * 1024 + 1);
        let mut bytes = vec![0; size];
        self.output
            .read_exact(&mut bytes)
            .expect("complete binary payload");
        Reply { header, bytes }
    }

    pub fn request(&mut self, mut request: Value) -> Reply {
        let id = self.next_id;
        self.next_id += 1;
        request["id"] = json!(id);
        let input = self.child.stdin.as_mut().expect("helper stdin");
        serde_json::to_writer(&mut *input, &request).expect("write request");
        input.write_all(b"\n").expect("terminate request");
        input.flush().expect("flush request");
        let reply = self.reply();
        assert_eq!(reply.header["id"], id);
        reply
    }

    pub fn open(&mut self, rel: &str) -> Reply {
        self.request(json!({ "op": "open_file", "rel": rel }))
    }

    pub fn read(&mut self, rel: &str) -> Reply {
        let opened = self.open(rel);
        if opened.header["ok"] != true {
            return opened;
        }
        let handle = &opened.header["handle"];
        let result = self.request(json!({ "op": "read_prefix", "handle": handle, "limit": 4096 }));
        let closed = self.request(json!({ "op": "close_handle", "handle": handle }));
        assert_eq!(closed.header["ok"], true);
        result
    }

    pub fn shutdown(mut self) {
        let reply = self.request(json!({ "op": "shutdown" }));
        assert_eq!(reply.header["ok"], true);
        self.child.stdin.take();
        assert!(self.child.wait().expect("wait for helper").success());
    }
}

impl Drop for NativeProcess {
    fn drop(&mut self) {
        self.child.stdin.take();
        match self.child.try_wait() {
            Ok(Some(_)) => {}
            Ok(None) => {
                self.child.kill().expect("terminate owned test helper");
                self.child.wait().expect("reap owned test helper");
            }
            Err(error) => panic!("inspect owned test helper: {error}"),
        }
    }
}

pub fn symlink_file(target: &Path, link: &Path) {
    #[cfg(unix)]
    std::os::unix::fs::symlink(target, link).expect("create test symlink");
    #[cfg(windows)]
    std::os::windows::fs::symlink_file(target, link).expect("create test symlink");
}

pub fn symlink_dir(target: &Path, link: &Path) {
    #[cfg(unix)]
    std::os::unix::fs::symlink(target, link).expect("create test directory symlink");
    #[cfg(windows)]
    std::os::windows::fs::symlink_dir(target, link).expect("create test directory symlink");
}

use crate::protocol::{
    DirectoryEntry, FileStat, ReaderError, Request, Response, Result, MAX_BATCH, MAX_HANDLES,
    MAX_HEADER, MAX_PAYLOAD, MAX_SAFE_INTEGER,
};
use cap_std::fs::{Dir, File, FileType, Metadata, ReadDir};
use std::collections::BTreeMap;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Component, Path, PathBuf};
use std::time::UNIX_EPOCH;

struct Directory {
    entries: ReadDir,
    pending: Option<DirectoryEntry>,
    done: bool,
}

enum Handle {
    File(File),
    Directory(Directory),
}

pub struct Access {
    root: Dir,
    entered_root: PathBuf,
    canonical_root: PathBuf,
    handles: BTreeMap<u32, Handle>,
    next_handle: u32,
}

fn file_type(kind: FileType) -> &'static str {
    if kind.is_file() {
        "file"
    } else if kind.is_dir() {
        "directory"
    } else if kind.is_symlink() {
        "symlink"
    } else {
        "other"
    }
}

fn metadata(metadata: &Metadata) -> Result<FileStat> {
    if metadata.len() > MAX_SAFE_INTEGER {
        return Err(ReaderError::new(
            "ROOM_READER_METADATA",
            "File size exceeds the safe integer range",
        ));
    }
    let modified = metadata.modified()?.into_std();
    let millis = match modified.duration_since(UNIX_EPOCH) {
        Ok(duration) => duration.as_millis() as i128,
        Err(error) => -(error.duration().as_millis() as i128),
    };
    if !(-8_640_000_000_000_000..=8_640_000_000_000_000).contains(&millis) {
        return Err(ReaderError::new(
            "ROOM_READER_METADATA",
            "Modified time is outside the supported date range",
        ));
    }
    #[cfg(unix)]
    let identity = {
        use cap_std::fs::MetadataExt;
        format!("{}:{}", metadata.dev(), metadata.ino())
    };
    #[cfg(windows)]
    let identity = {
        use cap_fs_ext::MetadataExt;
        let volume = MetadataExt::volume_serial_number(metadata).ok_or_else(|| {
            ReaderError::new("ROOM_READER_METADATA", "Volume identity is unavailable")
        })?;
        let index = MetadataExt::file_index(metadata).ok_or_else(|| {
            ReaderError::new("ROOM_READER_METADATA", "File identity is unavailable")
        })?;
        format!("{volume}:{index}")
    };
    #[cfg(not(any(unix, windows)))]
    return Err(ReaderError::new(
        "ROOM_READER_UNSUPPORTED",
        "This platform has no verified file identity implementation",
    ));

    Ok(FileStat {
        r#type: file_type(metadata.file_type()),
        size: metadata.len(),
        modified_ms: millis as i64,
        identity,
    })
}

impl Access {
    pub fn open(root: PathBuf) -> Result<Self> {
        if !root.is_absolute() {
            return Err(ReaderError::new(
                "ROOM_READER_ROOT",
                "The selected room root must be absolute",
            ));
        }
        // Ambient authority is used only to establish the explicitly selected root.
        let canonical_root = std::fs::canonicalize(&root)?;
        let directory = Dir::open_ambient_dir(&canonical_root, cap_std::ambient_authority())?;
        Ok(Self {
            root: directory,
            entered_root: root,
            canonical_root,
            handles: BTreeMap::new(),
            next_handle: 1,
        })
    }

    fn checked_relative<'a>(&self, rel: &'a str) -> Result<&'a Path> {
        let path = Path::new(rel);
        if rel.contains('\0')
            || path.is_absolute()
            || path
                .components()
                .any(|component| matches!(component, Component::Prefix(_) | Component::RootDir))
        {
            return Err(ReaderError::escape());
        }
        Ok(path)
    }

    fn resolve(&self, rel: &str) -> Result<PathBuf> {
        let path = self.checked_relative(rel)?;
        // Canonicalization can open a FIFO without O_NONBLOCK on macOS.
        // Inspect links without opening the final file, then use bounded handles.
        self.resolve_links(path, &mut 0).map(|resolved| {
            if resolved.as_os_str().is_empty() {
                PathBuf::from(".")
            } else {
                resolved
            }
        })
    }

    fn resolve_links(&self, path: &Path, links: &mut usize) -> Result<PathBuf> {
        let mut resolved = PathBuf::new();
        for component in path.components() {
            match component {
                Component::RootDir | Component::Prefix(_) => return Err(ReaderError::escape()),
                Component::CurDir => {}
                Component::ParentDir => {
                    if !resolved.pop() {
                        return Err(ReaderError::escape());
                    }
                }
                Component::Normal(name) => {
                    let candidate = resolved.join(name);
                    if self.root.symlink_metadata(&candidate)?.is_symlink() {
                        *links += 1;
                        if *links > 40 {
                            return Err(ReaderError::new(
                                "ROOM_READER_SYMLINK",
                                "Refused: symlink loop or excessive link depth",
                            ));
                        }
                        let target = self.root.read_link_contents(&candidate)?;
                        let target = if target.is_absolute() {
                            target
                                .strip_prefix(&self.canonical_root)
                                .or_else(|_| target.strip_prefix(&self.entered_root))
                                .map(Path::to_path_buf)
                                .map_err(|_| ReaderError::escape())?
                        } else {
                            resolved.join(target)
                        };
                        resolved = self.resolve_links(&target, links).map_err(|error| {
                            if error.code == "ENOENT" {
                                ReaderError::new(
                                    "ROOM_READER_SYMLINK",
                                    "Refused: dangling symlink cannot be treated as absence",
                                )
                            } else {
                                error
                            }
                        })?;
                    } else {
                        resolved = candidate;
                    }
                }
            }
        }
        Ok(resolved)
    }

    fn available_handle(&self) -> Result<u32> {
        if self.handles.len() >= MAX_HANDLES || self.next_handle == u32::MAX {
            return Err(ReaderError::new(
                "ROOM_READER_LIMIT",
                "Refused: native handle limit reached",
            ));
        }
        Ok(self.next_handle)
    }

    fn register(&mut self, id: u32, handle: Handle) {
        self.handles.insert(id, handle);
        self.next_handle += 1;
    }

    pub fn execute(&mut self, request: Request) -> Result<(Response, Vec<u8>)> {
        let mut response = Response::success(request.id());
        let mut bytes = Vec::new();
        match request {
            Request::OpenFile { rel, .. } => {
                let id = self.available_handle()?;
                let resolved = self.resolve(&rel)?;
                let mut options = cap_std::fs::OpenOptions::new();
                options.read(true);
                #[cfg(unix)]
                {
                    use cap_std::fs::OpenOptionsExt;
                    options.custom_flags(libc::O_NONBLOCK);
                }
                let file = self.root.open_with(&resolved, &options)?;
                response.stat = Some(metadata(&file.metadata()?)?);
                response.resolved_rel = Some(
                    resolved
                        .to_str()
                        .ok_or_else(|| {
                            ReaderError::new("ROOM_READER_PATH", "Refused: path is not valid UTF-8")
                        })?
                        .to_owned(),
                );
                response.handle = Some(id);
                self.register(id, Handle::File(file));
            }
            Request::ReadPrefix { handle, limit, .. } => {
                if limit > MAX_PAYLOAD {
                    return Err(ReaderError::new(
                        "ROOM_READER_LIMIT",
                        "Refused: prefix exceeds the byte limit",
                    ));
                }
                let Some(Handle::File(file)) = self.handles.get_mut(&handle) else {
                    return Err(ReaderError::new(
                        "ROOM_READER_HANDLE",
                        "Unknown file handle",
                    ));
                };
                if !file.metadata()?.is_file() {
                    return Err(ReaderError::new("ROOM_READER_TYPE", "Not a regular file"));
                }
                file.seek(SeekFrom::Start(0))?;
                file.take(limit).read_to_end(&mut bytes)?;
            }
            Request::OpenDirectory { rel, .. } => {
                let id = self.available_handle()?;
                let resolved = self.resolve(&rel)?;
                let entries = self.root.read_dir(&resolved)?;
                self.register(
                    id,
                    Handle::Directory(Directory {
                        entries,
                        pending: None,
                        done: false,
                    }),
                );
                response.handle = Some(id);
            }
            Request::ReadDirectory { handle, .. } => {
                let Some(Handle::Directory(directory)) = self.handles.get_mut(&handle) else {
                    return Err(ReaderError::new(
                        "ROOM_READER_HANDLE",
                        "Unknown directory handle",
                    ));
                };
                let mut entries = Vec::new();
                // Reserve header space independently of caller-controlled filenames.
                let mut header_bytes = 1024;
                while entries.len() < MAX_BATCH && !directory.done {
                    let entry = if let Some(pending) = directory.pending.take() {
                        pending
                    } else if let Some(entry) = directory.entries.next() {
                        let entry = entry?;
                        DirectoryEntry {
                            name: entry.file_name().into_string().map_err(|_| {
                                ReaderError::new(
                                    "ROOM_READER_PATH",
                                    "Refused: directory entry is not valid UTF-8",
                                )
                            })?,
                            r#type: file_type(entry.file_type()?),
                        }
                    } else {
                        directory.done = true;
                        break;
                    };
                    let size = serde_json::to_vec(&entry)
                        .map_err(|error| ReaderError::protocol(error.to_string()))?
                        .len()
                        + 1;
                    if header_bytes + size > MAX_HEADER {
                        if entries.is_empty() {
                            return Err(ReaderError::new(
                                "ROOM_READER_LIMIT",
                                "Refused: directory entry exceeds the frame limit",
                            ));
                        }
                        directory.pending = Some(entry);
                        break;
                    }
                    header_bytes += size;
                    entries.push(entry);
                }
                response.entries = Some(entries);
                response.done = Some(directory.done);
            }
            Request::CloseHandle { handle, .. } => {
                if self.handles.remove(&handle).is_none() {
                    return Err(ReaderError::new(
                        "ROOM_READER_HANDLE",
                        "Unknown or already closed handle",
                    ));
                }
            }
            Request::Shutdown { .. } => self.handles.clear(),
        }
        Ok((response, bytes))
    }
}

use crate::protocol::{
    DirectoryEntry, FileStat, ReaderError, Request, Response, Result, MAX_BATCH, MAX_HANDLES,
    MAX_HEADER, MAX_PAYLOAD, MAX_SAFE_INTEGER,
};
use cap_fs_ext::DirExt;
use cap_std::fs::{Dir, File, FileType, Metadata, ReadDir};
use std::collections::{BTreeMap, VecDeque};
use std::ffi::OsString;
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
    aliases: Vec<PathBuf>,
    handles: BTreeMap<u32, Handle>,
    next_handle: u32,
}

struct Resolved {
    parent: Dir,
    leaf: OsString,
    relative: PathBuf,
}

enum Piece {
    Name(OsString, bool),
    Parent(bool),
}

fn pieces(path: &Path, required: bool) -> Result<VecDeque<Piece>> {
    let mut result = VecDeque::new();
    for component in path.components() {
        match component {
            Component::Normal(name) => result.push_back(Piece::Name(name.to_owned(), required)),
            Component::ParentDir => result.push_back(Piece::Parent(required)),
            Component::CurDir => {}
            Component::RootDir | Component::Prefix(_) => return Err(ReaderError::escape()),
        }
    }
    Ok(result)
}

fn root_aliases(entered: &Path, canonical: &Path) -> Result<Vec<PathBuf>> {
    let mut aliases = vec![entered.to_path_buf(), canonical.to_path_buf()];
    let mut current = entered.to_path_buf();
    for _ in 0..40 {
        let mut prefix = PathBuf::new();
        let mut components = current.components();
        let mut replacement = None;
        while let Some(component) = components.next() {
            prefix.push(component);
            if !prefix.is_absolute() || !std::fs::symlink_metadata(&prefix)?.is_symlink() {
                continue;
            }
            let target = std::fs::read_link(&prefix)?;
            let mut replaced = if target.is_absolute() {
                target
            } else {
                prefix
                    .parent()
                    .ok_or_else(ReaderError::escape)?
                    .join(target)
            };
            replaced.extend(components);
            replacement = Some(replaced);
            break;
        }
        match replacement {
            Some(replaced) => {
                aliases.push(replaced.clone());
                current = replaced;
            }
            None => {
                aliases.sort_by_key(|alias| std::cmp::Reverse(alias.components().count()));
                aliases.dedup();
                return Ok(aliases);
            }
        }
    }
    Err(ReaderError::new(
        "ROOM_READER_ROOT",
        "Refused: excessive links in selected root",
    ))
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
        format!("{}:{}", metadata.dev(), metadata.ino())
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
        let aliases = root_aliases(&root, &canonical_root)?;
        Ok(Self {
            root: directory,
            aliases,
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

    fn resolve(&self, rel: &str) -> Result<Resolved> {
        let path = self.checked_relative(rel)?;
        // Canonicalization can open a FIFO without O_NONBLOCK on macOS.
        // One-component capabilities also avoid retaining a descriptor per depth.
        let mut pending = pieces(path, false)?;
        let mut current = self.root.try_clone()?;
        let mut resolved = PathBuf::new();
        let mut links = 0;
        while let Some(piece) = pending.pop_front() {
            match piece {
                Piece::Parent(required) => {
                    if !resolved.pop() {
                        return Err(ReaderError::escape());
                    }
                    let mut prefix = pieces(&resolved, required)?;
                    prefix.append(&mut pending);
                    pending = prefix;
                    current = self.root.try_clone()?;
                    resolved.clear();
                }
                Piece::Name(name, required) => {
                    let metadata = current.symlink_metadata(&name).map_err(|error| {
                        if required && error.kind() == std::io::ErrorKind::NotFound {
                            ReaderError::new(
                                "ROOM_READER_SYMLINK",
                                "Refused: dangling symlink cannot be treated as absence",
                            )
                        } else {
                            error.into()
                        }
                    })?;
                    if metadata.is_symlink() {
                        links += 1;
                        if links > 40 {
                            return Err(ReaderError::new(
                                "ROOM_READER_SYMLINK",
                                "Refused: symlink loop or excessive link depth",
                            ));
                        }
                        let target = current.read_link_contents(&name)?;
                        let target = if target.is_absolute() {
                            self.aliases
                                .iter()
                                .find_map(|alias| target.strip_prefix(alias).ok())
                                .map(Path::to_path_buf)
                                .ok_or_else(ReaderError::escape)?
                        } else {
                            resolved.join(target)
                        };
                        let mut target = pieces(&target, true)?;
                        target.append(&mut pending);
                        pending = target;
                        current = self.root.try_clone()?;
                        resolved.clear();
                    } else if pending.is_empty() {
                        return Ok(Resolved {
                            parent: current,
                            relative: resolved.join(&name),
                            leaf: name,
                        });
                    } else {
                        if !metadata.is_dir() {
                            return Err(ReaderError::new(
                                "ENOTDIR",
                                "Not a directory in room path",
                            ));
                        }
                        current = current.open_dir_nofollow(&name)?;
                        resolved.push(name);
                    }
                }
            }
        }
        Ok(Resolved {
            parent: current,
            leaf: OsString::from("."),
            relative: if resolved.as_os_str().is_empty() {
                PathBuf::from(".")
            } else {
                resolved
            },
        })
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
                let file = resolved.parent.open_with(&resolved.leaf, &options)?;
                response.stat = Some(metadata(&file.metadata()?)?);
                response.resolved_rel = Some(
                    resolved
                        .relative
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
                let entries = resolved.parent.read_dir(&resolved.leaf)?;
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

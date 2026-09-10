use serde::{Deserialize, Serialize};
use std::fmt;
use std::io::{self, BufRead, Read, Write};

pub const MAX_HEADER: usize = 256 * 1024;
pub const MAX_PAYLOAD: u64 = 25 * 1024 * 1024 + 1;
pub const MAX_HANDLES: usize = 32;
pub const MAX_BATCH: usize = 32;
pub const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

#[derive(Debug, Serialize)]
pub struct ReaderError {
    pub code: &'static str,
    pub message: String,
}

impl ReaderError {
    pub fn new(code: &'static str, message: impl Into<String>) -> Self {
        let mut message = message.into();
        if message.len() > 4096 {
            let mut end = 4096;
            while !message.is_char_boundary(end) {
                end -= 1;
            }
            message.truncate(end);
            message.push_str(" [truncated]");
        }
        Self { code, message }
    }

    pub fn protocol(message: impl Into<String>) -> Self {
        Self::new("ROOM_READER_PROTOCOL", message)
    }

    pub fn escape() -> Self {
        Self::new("ROOM_READER_CONTAINMENT", "Refused: path escapes the room")
    }
}

impl fmt::Display for ReaderError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{}: {}", self.code, self.message)
    }
}

impl From<io::Error> for ReaderError {
    fn from(error: io::Error) -> Self {
        let code = match error.kind() {
            io::ErrorKind::NotFound => "ENOENT",
            io::ErrorKind::PermissionDenied => "EACCES",
            io::ErrorKind::NotADirectory => "ENOTDIR",
            io::ErrorKind::InvalidInput => "EINVAL",
            _ => "ROOM_READER_IO",
        };
        let message = if error.kind() == io::ErrorKind::PermissionDenied {
            format!("Refused: permission denied or path escapes the room: {error}")
        } else {
            error.to_string()
        };
        Self::new(code, message)
    }
}

pub type Result<T> = std::result::Result<T, ReaderError>;

#[derive(Deserialize)]
#[serde(tag = "op", rename_all = "snake_case", deny_unknown_fields)]
pub enum Request {
    OpenFile { id: u64, rel: String },
    ReadPrefix { id: u64, handle: u32, limit: u64 },
    OpenDirectory { id: u64, rel: String },
    ReadDirectory { id: u64, handle: u32 },
    CloseHandle { id: u64, handle: u32 },
    Shutdown { id: u64 },
}

impl Request {
    pub fn id(&self) -> u64 {
        match *self {
            Self::OpenFile { id, .. }
            | Self::ReadPrefix { id, .. }
            | Self::OpenDirectory { id, .. }
            | Self::ReadDirectory { id, .. }
            | Self::CloseHandle { id, .. }
            | Self::Shutdown { id } => id,
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileStat {
    pub r#type: &'static str,
    pub size: u64,
    pub modified_ms: i64,
    pub identity: String,
}

#[derive(Serialize)]
pub struct DirectoryEntry {
    pub name: String,
    pub r#type: &'static str,
}

#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Response {
    pub id: u64,
    pub ok: bool,
    pub payload_length: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub protocol: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub handle: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resolved_rel: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stat: Option<FileStat>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub entries: Option<Vec<DirectoryEntry>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub done: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<ReaderError>,
}

impl Response {
    pub fn success(id: u64) -> Self {
        Self {
            id,
            ok: true,
            ..Self::default()
        }
    }

    pub fn failure(id: u64, error: ReaderError) -> Self {
        Self {
            id,
            error: Some(error),
            ..Self::default()
        }
    }
}

pub fn read_request(input: &mut impl BufRead) -> Result<Option<Request>> {
    let mut line = Vec::new();
    let count = input
        .take((MAX_HEADER + 1) as u64)
        .read_until(b'\n', &mut line)?;
    if count == 0 {
        return Ok(None);
    }
    if count > MAX_HEADER || line.last() != Some(&b'\n') {
        return Err(ReaderError::protocol(
            "Refused: oversized or unterminated request frame",
        ));
    }
    let request: Request =
        serde_json::from_slice(&line).map_err(|error| ReaderError::protocol(error.to_string()))?;
    if request.id() == 0 || request.id() > MAX_SAFE_INTEGER {
        return Err(ReaderError::protocol(
            "Refused: request ID is not a positive safe integer",
        ));
    }
    Ok(Some(request))
}

pub fn write_response(output: &mut impl Write, mut response: Response, bytes: &[u8]) -> Result<()> {
    if bytes.len() as u64 > MAX_PAYLOAD {
        return Err(ReaderError::protocol(
            "Refused: response payload exceeds its limit",
        ));
    }
    response.payload_length = bytes.len();
    let header =
        serde_json::to_vec(&response).map_err(|error| ReaderError::protocol(error.to_string()))?;
    if header.len() + 1 > MAX_HEADER {
        return Err(ReaderError::protocol(
            "Refused: response header exceeds its limit",
        ));
    }
    output.write_all(&header)?;
    output.write_all(b"\n")?;
    output.write_all(bytes)?;
    output.flush()?;
    Ok(())
}

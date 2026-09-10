mod access;
mod protocol;

use protocol::{read_request, write_response, ReaderError, Request, Response, Result};
use std::io;
use std::path::PathBuf;
use std::process::ExitCode;

fn run() -> Result<()> {
    let mut output = io::stdout().lock();
    let mut args = std::env::args_os().skip(1);
    let opened = match (args.next(), args.next()) {
        (Some(root), None) => access::Access::open(PathBuf::from(root)),
        _ => Err(ReaderError::new(
            "ROOM_READER_ROOT",
            "Usage: room-reader <absolute-room-root>",
        )),
    };
    let mut access = match opened {
        Ok(access) => {
            let mut hello = Response::success(0);
            hello.protocol = Some(1);
            write_response(&mut output, hello, &[])?;
            access
        }
        Err(error) => {
            let message = error.to_string();
            let mut response = Response::failure(0, error);
            response.protocol = Some(1);
            write_response(&mut output, response, &[])?;
            return Err(ReaderError::new("ROOM_READER_ROOT", message));
        }
    };
    let mut input = io::stdin().lock();
    loop {
        let request = match read_request(&mut input) {
            Ok(Some(request)) => request,
            Ok(None) => return Ok(()),
            Err(error) => {
                let message = error.to_string();
                write_response(&mut output, Response::failure(0, error), &[])?;
                return Err(ReaderError::protocol(message));
            }
        };
        let id = request.id();
        let shutdown = matches!(request, Request::Shutdown { .. });
        match access.execute(request) {
            Ok((response, bytes)) => write_response(&mut output, response, &bytes)?,
            Err(error) => write_response(&mut output, Response::failure(id, error), &[])?,
        }
        if shutdown {
            return Ok(());
        }
    }
}

fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("room-reader: {error}");
            ExitCode::FAILURE
        }
    }
}

# Native room reader

A read-only Rust helper for directory-capability-based room access. The
JavaScript canvas integration is not yet complete; adding this executable
alone does not repair the currently documented browser containment race.

From the repository root:

```bash
npm run build:canvas-reader
npm run test:canvas:native
```

These commands require Rust/Cargo, use the lockfile, and explicitly target
the Rust host rather than a configured cross-compilation target. The build
copies the release executable to `../bin/`; generated binaries and Cargo
output are not committed. An unchanged executable is not replaced.

The executable takes one absolute room root argument and retains its
directory capability. Requests may name only relative paths or handles it
issued. File reads, metadata, and directory enumeration use that capability,
not ambient pathname opens. Internal absolute links are rebased only under
the entered or canonical room root. External aliases, dangling links and
cycles are refused.

The protocol is UTF-8 JSON headers terminated by LF, followed by exactly
`payloadLength` binary response bytes. Requests have no binary bodies. The
startup response has `id: 0` and `protocol: 1`; subsequent request IDs are
positive safe integers. Supported operations are `open_file`, `read_prefix`,
`open_directory`, `read_directory`, `close_handle`, and `shutdown`.

Headers are limited to 256 KiB, payloads to 25 MiB plus one overflow byte,
issued handles to 32, and directory batches to 32 entries. File identity and
metadata come from the opened handle. Only actual missing paths report
`ENOENT`; containment, protocol and dangling-link failures are not absence.
Malformed framing terminates the process. EOF and shutdown release handles.

Tests run the production executable against synthetic files, including
leaf/ancestor/root replacement, internal links, identity, bounded protocol,
and special-file nonblocking behavior. Native platform results must be
reported separately; a host test is not evidence for another operating system.

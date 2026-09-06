# Phase 2 Session Service Report

## Supported operations

- `capture.start`, `capture.status`, `capture.stop`
- `behavior.list`, `behavior.get`
- `evidence.get`
- `probe.run`
- `replica.verify`
- `capture.export`

Each read validates the package before returning a checksum snapshot. CLI aliases and a stdio MCP server are available; MCP output contains summaries/provenance and never dumps the raw event stream.

`probe.run` writes its report under a new `revisions/<id>/` directory and emits a derived contract revision containing the probe checksum. The base contract and evidence remain untouched.

## Limitations

The local job store is a single-host JSON store and does not survive a machine-wide concurrent writer race. Viewer routes still use the existing loopback server directly; service-backed viewer routing is the next integration step. MCP is local stdio only by design.

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

The job store is now transactional SQLite and capture jobs run in a local worker process with heartbeat and cross-process cancellation requests. The viewer remains loopback-only and calls the same service core for probe jobs; MCP is local stdio only by design. Probe recipe variations and full multi-process crash reconciliation remain release-gate work.

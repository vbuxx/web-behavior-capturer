# Phase 1 Crash-Injection Report

## Scope

Crash injection menjalankan `capture` sebagai child process dengan output directory temporary. Process dihentikan paksa sebelum finalisasi package, lalu directory yang tersisa langsung diberikan ke `inspectSessionPackage`.

Gate yang diuji adalah fail-closed: output parsial tidak boleh dianggap sebagai Behavior Contract package yang bisa dibuka kembali.

## Result

Run `pnpm benchmark:crash -- --kill-after-ms 15000` (the probe kills as soon as the first partial file appears, with 15,000 ms as the maximum wait):

| Metric | Result |
| --- | ---: |
| Maximum kill wait | 15,000 ms |
| Child exit | `SIGKILL` |
| Exit code | `null` |
| Partial files | >0 (typically 1 or more) |
| Integrity inspection | rejected |
| Rejection | missing `session-index.json` (`ENOENT`) |

Capture belum mencapai tahap package promotion ketika process dihentikan. Pada run ini writer sudah meninggalkan beberapa file evidence parsial, tetapi directory tetap ditolak oleh integrity gate karena `session-index.json` belum ada.

## Test evidence

`test/crash-benchmark.test.ts` mengulang gate ini dan memverifikasi signal termination, tidak adanya exit code normal, serta rejection dari integrity inspection.

## Limitations

- Probe ini menguji interruption sebelum finalisasi, bukan crash tepat di setiap write boundary.
- Belum ada atomic staging/promotion karena current capture API menulis langsung ke output directory.
- Belum ada disk-full, permission failure, process restart/resume, atau recovery dari package yang korup.
- Startup dan resource contention memengaruhi kapan file pertama muncul; probe menunggu file parsial dan memakai 15,000 ms sebagai batas maksimum.

## Scope revision

Sebelum service lifecycle/MCP job API, tambahkan staging directory plus atomic rename untuk promotion package, cleanup policy untuk staging orphan, dan recovery matrix (kill sebelum/selama/sesudah index build). Crash injection tetap menjadi regression gate pada setiap perubahan writer.

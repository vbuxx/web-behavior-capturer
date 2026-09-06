# Phase 1 Failure-Injection Report

## Scope

Failure injection mensimulasikan `ENOSPC` pada dua boundary writer: sebelum `behavior-contract.json` ditulis dan sebelum `session.sqlite` dibangun. Ini berbeda dari crash `SIGKILL`: process gagal secara normal sehingga `finally` dapat membersihkan staging.

## Result

Run `pnpm benchmark:failure`:

| Stage | Exit code | Final files | Staging dirs/files | Integrity |
| --- | ---: | ---: | ---: | --- |
| `before-contract` | 1 | 0 | 0 / 0 | rejected |
| `before-index` | 1 | 0 | 0 / 0 | rejected |

Kedua boundary menghasilkan error `ENOSPC`, output final tidak dipromosikan, dan staging dibersihkan oleh normal error path. Integrity inspection tetap fail-closed karena `session-index.json` tidak tersedia.

## Limitations

- Ini adalah simulated writer failure, bukan filesystem penuh yang benar-benar dialokasikan sampai `ENOSPC`.
- Belum menguji kegagalan setelah sebagian SQLite page ditulis, permission change, atau checksum corruption setelah promotion.
- Output directory existing yang berisi package lama belum memiliki rotation/replace policy otomatis; capture baru fail-safe daripada menimpa package lama.

## Next gate

Tambahkan disk quota/filesystem test yang nyata di temporary volume, checksum corruption recovery, dan explicit package rotation sebelum service lifecycle/MCP job API.

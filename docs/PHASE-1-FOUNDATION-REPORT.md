# Phase 1 Foundation Report — Target Registry Slice

Status: completed intermediate schema 1.1.0 slice. Navigation lifecycle continues in [PHASE-1-LIFECYCLE-REPORT.md](PHASE-1-LIFECYCLE-REPORT.md).

## Outcome

Irisan pertama Fase 1 berhasil memindahkan target coverage dari probe diagnostik ke natural capture. Behavior Contract 1.1.0 terakhir mencatat lima logical target: satu main frame, satu top-level same-origin iframe, satu nested same-origin iframe, satu cross-origin OOPIF, dan satu dedicated worker.

Semua collector berhasil dipasang. Empat frame memiliki `coverageStart: document_start`; dedicated worker memiliki `coverageStart: runtime`, `completeness: partial`, dan gap `worker_start_to_collector_install`. Tidak ada dropped record pada run terakhir. Clock mapping per target memiliki estimated error maksimum 1.0 ms.

Perubahan target registry tidak mengubah semantics lima behavior. Reference verifier dan independent replica verifier tetap lulus 5/5; technical diagnostic probe tetap lulus 10/10.

## Evidence

| Target | Parent | Start | Completeness | Records | Dropped |
|---|---|---|---|---:|---:|
| Main frame | — | document start | full | 179 | 0 |
| Same-origin iframe | Main frame | document start | full | 0 | 0 |
| Cross-origin OOPIF | Main frame | document start | full | 19 | 0 |
| Nested same-origin iframe | Same-origin iframe | document start | full | 14 | 0 |
| Dedicated worker | Main frame | runtime | partial | 1 | 0 |

Capture menghasilkan 265 evidence record dan 15 visual checkpoint. Median p95 frame interval adalah 16.7 ms pada baseline dan 16.7 ms dengan page-world observer, atau degradasi terukur 0% pada run terakhir. Paket lengkap sekitar 280 KB. Angka ini hanya microbenchmark fixture dan belum mencakup seluruh biaya registry host serta worker installation.

## Integrity Tests

- JSON Schema mewajibkan `targetCoverage` pada contract 1.1.0.
- Semantic validation menolak duplicate target ID dan parent target yang hilang.
- Target dengan collector gagal harus memiliki partial coverage dan gap.
- `knownLoss` harus konsisten dengan dropped record per target.
- Ringkasan loss manifest harus sama dengan total seluruh target.
- Buffer-overflow injection tetap menghasilkan contract valid dengan loss eksplisit.
- Checksum tampering tetap menggagalkan verifier.

## Remaining Limitations

- Worker collector dipasang setelah worker event; riwayat sebelum pemasangan tidak dapat direkonstruksi.
- Worker ownership baru dibuktikan untuk worker milik main frame; atribusi worker ke arbitrary child frame belum diterapkan.
- Worker yang dibuat oleh worker lain belum diregistrasi secara rekursif.
- Target registry belum mempertahankan detached target atau beberapa navigation epoch dalam satu sesi.
- Element registry masih main-frame-only dan bergantung pada `data-wbc-id` fixture.
- Benchmark overhead belum memasukkan seluruh host orchestration dan worker collector.
- SQLite/session reopening, redaction, portable asset policy, MCP, dan viewer belum tersedia.

## Next Gate

Gate berikutnya adalah lifecycle target lintas navigasi: registry harus mempertahankan target yang detached, membuat navigation epoch baru, mengaitkan element identity ke frame/navigation yang benar, dan mengekspor attach/detach coverage range. Setelah itu, evidence store dapat dipindahkan ke indeks sesi yang dapat dibuka kembali.

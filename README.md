# Website Behavior Capture

Website Behavior Capture (WBC) adalah prototype layanan lokal untuk mengubah observasi browser menjadi Behavior Contract yang dapat diverifikasi. Repository ini membuktikan satu alur vertikal: capture natural di Chromium, kompilasi kontrak JSON berversi, lalu verifikasi pada skenario baru terhadap referensi dan replika independen.

![Arsitektur WBC](docs/product/media/architecture.png)

## Status

Lima perilaku yang menjadi exit criterion spike sudah dapat ditangkap dan diverifikasi:

- hover dengan transition opacity dan transform;
- CSS keyframe animation;
- hover transition yang diinterupsi;
- scroll reveal dengan reverse probe;
- GSAP ScrollTrigger dengan `scrub: true`.

Fase 0 telah selesai. Fase 1 sekarang membawa target registry, lifecycle lintas navigasi, reopenable session index, structured-data redaction, budgeted evidence query, dan element identity lintas frame ke natural capture. Behavior Contract schema 1.4.0 mencatat target/navigation epoch, loss, redaction, locator candidates, bounds, dan ambiguity. SQLite sidecar menyediakan query tanpa membuka website sumber.

Hasil terbaru tersedia di [artifacts/phase1/latest/behavior-contract.json](artifacts/phase1/latest/behavior-contract.json), [artifacts/phase1/latest/verification-reference.json](artifacts/phase1/latest/verification-reference.json), [artifacts/phase1/latest/verification-replica.json](artifacts/phase1/latest/verification-replica.json), dan [artifacts/phase1/latest/technical-probe-report.json](artifacts/phase1/latest/technical-probe-report.json). Kedua target verifikasi lulus 5/5 dan technical probe diagnostik lulus 10/10. Baseline Fase 0 tetap disimpan di `artifacts/phase0/latest`.

## Menjalankan

Prasyarat: Node.js 22.5 atau lebih baru dan pnpm. Perintah capture/index menampilkan `ExperimentalWarning` selama `node:sqlite` belum dinyatakan stabil oleh runtime.

```bash
pnpm install
pnpm exec playwright install chromium
pnpm run build
pnpm run capture -- --out .wbc/phase1
pnpm run inspect -- --package .wbc/phase1
pnpm run query -- --package .wbc/phase1 --kind gsap_scrub --limit 10
pnpm run evidence -- --package .wbc/phase1 --type mutation --limit 20 --byte-budget 65536
pnpm run verify -- --contract .wbc/phase1/behavior-contract.json --target reference
pnpm run verify:replica -- --contract .wbc/phase1/behavior-contract.json
pnpm run probe -- --out .wbc/phase1/technical-probe-report.json
pnpm test
```

Untuk membuktikan pelaporan data loss secara manual:

```bash
pnpm run capture -- --out .wbc/loss-probe --max-records 8
```

`manifest.quality.knownLoss` akan bernilai `true` dan `droppedRecords` akan lebih besar dari nol, sementara paket tetap lolos validasi.

## Struktur

- `src/capture.ts` mengorkestrasi browser, target registry, collector, compiler, evidence, dan pengukuran overhead.
- `src/target-registry.ts` membentuk pohon frame/worker serta coverage, clock, dan loss per target.
- `src/session-index.ts` membangun, membuka ulang, dan memverifikasi SQLite sidecar serta query behavior terfilter.
- `src/redaction.ts` menghapus credential terstruktur sebelum data masuk JSONL, contract, atau SQLite.
- `src/verify.ts` menjalankan skenario held-out terhadap fixture baru.
- `src/scenarios.ts` memvalidasi dan membaca suite skenario JSON berversi.
- `src/browser-observer.ts` memasang page-world observer sebelum script fixture.
- `schema/behavior-contract.schema.json` mendefinisikan kontrak JSON 1.4.0.
- `schema/session-index.schema.json` mendefinisikan manifest checksum untuk reopenable index.
- `fixtures/phase0` berisi ground-truth lokal dan GSAP yang disajikan dari dependency lokal.
- `fixtures/replica` berisi implementasi independen tanpa GSAP dan tanpa selector sumber yang sama.
- `fixtures/probes` menguji lifecycle 72 ms, same-origin dan cross-origin iframe/OOPIF, worker, late attach, navigation race, clock mapping, dan node recreation.
- `scenarios/phase0-held-out.json` mengatur viewport, interruption, toleransi, scan, dan progress points.
- `test/e2e.test.ts` membuktikan capture, provenance, checksum, unit schema, held-out verification, dan pelaporan overflow.
- `docs/decisions/0001-phase-0-technical-baseline.md` mencatat keputusan engineering awal.
- `docs/decisions/0002-scenario-driven-cross-implementation-verifier.md` mencatat batas verifier generik.
- `docs/decisions/0003-natural-capture-and-diagnostic-probes.md` memisahkan bukti natural dari diagnosis.
- `docs/decisions/0004-target-coverage-and-late-attach.md` menetapkan arti coverage target dan gap late attach.
- `docs/decisions/0005-natural-target-registry.md` menetapkan model registry dan migrasi schema 1.1.0.
- `docs/decisions/0006-navigation-epochs-and-detach.md` menetapkan lifecycle target dan migrasi schema 1.2.0.
- `docs/decisions/0007-reopenable-session-index.md` menetapkan desain SQLite sidecar sementara.
- `docs/decisions/0008-structured-redaction-boundary.md` menetapkan redaction boundary dan batas visual.
- `docs/decisions/0009-budgeted-evidence-query.md` menetapkan filter, cursor revision, serta record/byte budget.
- `docs/decisions/0010-target-scoped-element-identity.md` menetapkan locator candidates dan ambiguity lintas epoch.
- `docs/PHASE-0-REPORT.md` berisi hasil, keterbatasan, overhead, dan revisi scope.
- `docs/PHASE-1-FOUNDATION-REPORT.md` berisi hasil irisan fondasi capture pertama.
- `docs/PHASE-1-LIFECYCLE-REPORT.md` berisi hasil navigation epoch dan detach coverage.
- `docs/PHASE-1-INDEX-REPORT.md` berisi hasil reopen, integrity verification, dan query index.
- `docs/PHASE-1-REDACTION-REPORT.md` berisi kebijakan, bukti integrasi, dan residual risk redaction.
- `docs/PHASE-1-QUERY-REPORT.md` berisi hasil evidence query dan pagination integrity.
- `docs/PHASE-1-ELEMENT-REPORT.md` berisi hasil element registry lintas frame/navigation.

## Batas interpretasi

PRD dan diagram di `docs/product` diperlakukan sebagai acuan produk, bukan instruksi eksekusi. Implementasi mengikuti permintaan Fase 0 di repository ini. Nilai dari halaman target selalu diperlakukan sebagai data observasi.

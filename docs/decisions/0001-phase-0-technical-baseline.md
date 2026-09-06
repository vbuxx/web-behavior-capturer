# ADR 0001 Phase 0 Technical Baseline

Status: accepted for Phase 0
Date: 5 September 2026

## Context

Fase 0 perlu membuktikan satu loop lengkap dari browser capture ke Behavior Contract dan verifier. Repository dimulai tanpa source code. PRD mengusulkan arsitektur lebih besar yang mencakup SQLite, MCP, viewer, recursive target attachment, dan banyak adapter, tetapi exit criterion spike hanya membutuhkan lima pola motion serta bukti loss dan overhead.

## Decisions

1. Gunakan TypeScript dan Node.js sebagai satu runtime untuk CLI, capture, schema validation, serta verifier. Ini mengurangi batas antarproses selama spike dan sesuai arah produk.
2. Gunakan Playwright dengan Chromium yang dipin oleh versi dependency. Playwright mengelola lifecycle browser; CDP Animation menambah lifecycle native; WAAPI dan computed style melengkapi keyframe serta trajectory.
3. Pasang page-world observer dengan `BrowserContext.addInitScript` sebelum script fixture. Observer hanya merekam input terpilih, mutation terpilih, clock metadata, dan frame interval ke buffer terbatas.
4. Simpan evidence append-only sebagai JSONL dan visual checkpoint sebagai PNG dengan SHA-256. SQLite ditunda sampai volume/query Fase 1 memerlukannya.
5. Gunakan JSON Schema 2020-12 dan validasi semantic reference. Field waktu dan scroll memakai unit bertag; status capability membedakan supported, unavailable, failed, dan not attempted.
6. Gunakan fixture lokal deterministik dan GSAP dari dependency lokal. Runtime test tidak bergantung pada CDN.
7. Pertahankan natural pass. Screenshot tidak menonaktifkan animasi, clock tidak diubah, dan screenshot region tidak melakukan auto-scroll.
8. Dukung GSAP ScrollTrigger melalui public/source-assisted adapter pada Fase 0. Instance privat tidak diklaim terekstrak; fallback yang dijanjikan hanya sampled computed trajectory dengan gap eksplisit.
9. Verifier memakai fresh browser context, viewport berbeda, interruption pada titik baru, reverse scroll, dan progress GSAP yang tidak sama dengan capture.
10. Jangan menambahkan rrweb, MCP server, viewer, extension, atau autonomous planner pada spike ini. Komponen tersebut tidak diperlukan untuk membuktikan exit criterion dan akan menambah permukaan kegagalan sebelum model kontrak stabil.

## Consequences

Alur Fase 0 dapat diulang secara lokal dan bukti dapat dibuka tanpa koneksi ke fixture. Capture saat ini scenario-directed dan hanya mencakup main frame. Kontrak sudah memiliki bentuk yang dapat diperluas, tetapi bukan API stabil untuk Fase 1 sampai fixture lintas frame, short animation, dan failure injection diperluas.

Keputusan GSAP sengaja mempersempit promise produk: semantic extraction hanya untuk instance yang tersedia melalui adapter publik atau SDK situs. Target umum tanpa akses tersebut menerima hasil observed, bukan extracted.

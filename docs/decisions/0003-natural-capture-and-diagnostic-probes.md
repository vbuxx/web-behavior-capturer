# ADR 0003 Natural Capture and Diagnostic Probes

Status: accepted for Phase 0.5
Date: 5 September 2026

## Context

Animasi sangat singkat, target attachment, clock mapping, dan instance recreation perlu dibuktikan tanpa mengubah arti hasil natural capture. Probe dapat menggunakan instrumentation tambahan, tetapi hasilnya tidak boleh dipromosikan menjadi trajectory natural tanpa label.

## Decisions

1. Simpan technical probe sebagai report `mode: diagnostic`, terpisah dari Behavior Contract natural capture.
2. Aktifkan CDP Animation sebelum navigasi, lalu query WAAPI saat animasi 72 ms masih aktif. Lulus hanya jika duration 72 ms terlihat di kedua channel.
3. Aktifkan target discovery dan flattened auto-attach sebelum navigasi. Laporkan main frame, same-origin iframe, cross-origin OOPIF, dan dedicated worker satu per satu.
4. Node replacement harus menghasilkan instance browser berbeda meskipun logical `data-wbc-id` tetap sama. Logical identity tidak boleh menyamakan node instance.
5. Clock mapping awal memakai `performance.timeOrigin + performance.now()` terhadap `Date.now()` dengan error yang dilaporkan. Ini tidak dianggap kalibrasi lintas proses.

## Consequences

Animasi 72 ms, same-origin iframe, cross-origin OOPIF, dedicated worker, satu instalasi child-frame collector, DOM recreation, late attach, navigation race, dan page clock mapping lulus pada Chromium yang dipin. Hasil tidak memperluas klaim ke natural capture lintas target, closed shadow root, recursive collector installation, worker/OOPIF clock calibration, atau minimum duration yang dapat ditangkap.

# ADR 0027 Additive Schema 1.6 and Capture Lifecycle State

Status: accepted for Phase 1
Date: 6 September 2026

## Context

Capture package perlu membedakan package lama yang masih dapat dibaca dari package baru yang membawa status operasional. Cancellation juga harus fail-closed dan tidak boleh meninggalkan output yang tampak valid.

## Decision

Schema contract dinaikkan ke `1.6.0` secara additive. Validator menerima `1.5.0` dan `1.6.0`; major version yang tidak dikenal tetap ditolak oleh enum schema. Package baru menulis `manifest.status`, optional `resumedFromSessionId`, streaming quality metadata, dan visual-redaction summary.

API capture menerima `AbortSignal` dan callback state. State yang dilaporkan adalah `running`, `stopping`, `finalizing`, `completed`, `cancelled`, atau `failed`. Cancellation sebelum promotion menghapus staging dan melempar `CaptureCancelledError`; package tidak dipromosikan.

Mode streaming saat ini dinyatakan `buffered` dengan parameter target 50 ms/128 record/10.000 queue. Nilai ini sengaja tidak dilaporkan sebagai `host_batch` sebelum writer streaming benar-benar tersedia.

## Consequence

Reopen terhadap artifact 1.5 tetap bekerja, sementara agent dapat membedakan package completed dari cancellation/failure tanpa membaca raw log. Host streaming dan resume revision penuh tetap menjadi pekerjaan lanjutan; resume tidak memalsukan kontinuitas browser realm lama.

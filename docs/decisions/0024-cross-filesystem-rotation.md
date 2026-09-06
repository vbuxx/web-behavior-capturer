# ADR 0024 Cross-Filesystem Rotation Fallback

Status: accepted for Phase 1
Date: 6 September 2026

## Context

Directory rename atomik gagal dengan `EXDEV` jika archive berada pada filesystem berbeda. Rotation tetap perlu memiliki jalur aman tanpa menghapus source sebelum archive tervalidasi.

## Decision

Pada `EXDEV` (atau explicit test mode), copy package ke `.rotation-staging-*`, jalankan integrity inspection, rename staging ke archive final, inspect ulang, lalu hapus source. Kegagalan di tahap mana pun menghapus staging dan mempertahankan source.

## Consequence

Cross-filesystem rotation menjadi checksum-verifiable tetapi bukan atomik end-to-end. Hard crash saat copy dapat meninggalkan staging orphan; janitor dan recovery marker untuk rotation staging menjadi gate berikutnya.

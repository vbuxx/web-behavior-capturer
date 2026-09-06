# ADR 0019 Corruption Rejection

Status: accepted for Phase 1
Date: 6 September 2026

## Context

Integrity checks sudah diuji dalam e2e untuk beberapa file, tetapi perlu matrix eksplisit agar setiap kelas artefak persisted menolak perubahan setelah promotion.

## Decision

Tambahkan corruption benchmark yang bekerja pada copy temporary untuk contract, SQLite session index, NDJSON event evidence, dan PNG visual evidence. Setiap mutation harus ditolak oleh `inspectSessionPackage`; package sumber harus tetap verified.

## Consequence

Empat kelas artefak memiliki checksum rejection evidence tanpa risiko mengubah release artifact. Ini adalah quarantine behavior, bukan automatic repair.

Disk quota nyata, partial database write, package rotation, dan quarantine UI/service tetap menjadi gate berikutnya.

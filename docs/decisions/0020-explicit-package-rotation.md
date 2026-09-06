# ADR 0020 Explicit Package Rotation

Status: accepted for Phase 1
Date: 6 September 2026

## Context

Atomic promotion menolak overwrite terhadap directory package lama agar hasil capture baru tidak merusak artifact terverifikasi. Service tetap memerlukan cara eksplisit untuk mengganti current package.

## Decision

Tambahkan `rotateSessionPackage`: inspect integrity lebih dulu, lalu rename current package ke archive directory di filesystem yang sama. Rotation menolak source yang invalid dan tidak melakukan copy/delete yang tidak terverifikasi.

## Consequence

Package lama tetap dapat direview dari archive dan package current menjadi path kosong/tidak ada sehingga capture baru dapat dipromosikan atomik. Retention, cross-filesystem fallback, dan recovery marker untuk crash di antara rename masih menjadi pekerjaan berikutnya.

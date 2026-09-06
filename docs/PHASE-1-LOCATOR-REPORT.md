# Phase 1 Locator Report — Independent Contract Resolution

## Outcome

Verifier kini dapat mencocokkan Behavior Contract ke replika yang tidak memiliki selector sumber maupun shared `data-wbc-id`. Lima behavior tetap lulus: hover, CSS animation, interrupted transition, scroll reveal, dan scrub yang pada replika diimplementasikan tanpa GSAP.

Contract 1.5.0 menyimpan structural fingerprint tanpa visible text. Saat verifikasi, resolver memberi score pada kandidat, menerapkan minimum score 0,50 dan minimum winner margin 0,02, lalu menambahkan selector temporer hanya untuk menjalankan probe.

## Evidence

Artifact release pada viewport held-out 1100x740 menghasilkan replica 5/5:

| Scenario | Strategy | Minimum score | Winner margin | Result |
| --- | --- | ---: | ---: | --- |
| hover complete | structural fingerprint | 0.6719 | 0.0221 | passed |
| CSS animation lifecycle | structural fingerprint | 0.9012 | 0.0689 | passed |
| interrupted transition | structural fingerprint | 0.7935 | 0.1960 | passed |
| scroll reveal reverse | structural fingerprint | 0.9712 | 0.2370 | passed |
| scrub held-out reverse | structural fingerprint | 0.9051 | 0.1065 | passed |

Reference self-check juga lulus 5/5. Pada reference, captured identity tersedia dan dilaporkan sebagai strategi berbeda agar bukti structural replica tidak tercampur.

Negative fixture berisi dua button identik dan overlap. Resolver menolak keduanya karena winner margin nol; test tidak mengizinkan fallback ke kandidat pertama.

## Capability and Privacy Boundary

- Structural resolver: supported untuk main-frame fixture lokal.
- Ambiguity rejection: supported dan diuji dengan negative fixture.
- Cross-implementation verification: supported untuk lima behavior prioritas.
- Raw text fingerprint: tidak digunakan; contract tidak menambah payload teks yang dapat bocor.
- Cross-frame replica resolution: belum diimplementasikan walaupun registry capture sudah lintas frame.

## Overhead

Capture release mencatat baseline p95 frame 16,8 ms dan capture p95 16,7 ms pada 264 sample, atau selisih -0,595% yang berada dalam noise timer. Nilai ini mengukur observer page-world, bukan biaya resolver. Resolver berjalan saat verification dan pada fixture replica menilai 38 kandidat per skenario. Belum ada benchmark CPU/memory resolver yang terpisah.

## Limitations and Scope Revision

- Margin hover hanya 0,0221, dekat threshold 0,02. Confidence ini cukup untuk fixture, belum untuk klaim general-purpose.
- Geometry relatif sensitif terhadap responsive reorder dan perubahan konten panjang.
- Shadow DOM, pseudo-element, canvas/WebGL, frame projection, dan virtualized DOM belum tercakup.
- Role tidak menyertakan accessible name; raw text tetap dilarang oleh boundary redaction saat ini.
- Threshold hanya dikalibrasi pada satu positive replica dan satu negative ambiguity fixture.

Scope Fase 1 direvisi: independent main-frame resolver dinyatakan selesai sebagai spike, bukan universal element matching. Sebelum website eksternal, perlu corpus multi-layout untuk precision/recall dan calibration. Gate implementasi berikutnya adalah service/API session lokal serta viewer review minimal; cross-frame resolver dan text-safe semantic fingerprint tetap backlog terpisah.

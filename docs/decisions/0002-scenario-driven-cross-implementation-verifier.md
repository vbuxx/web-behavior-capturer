# ADR 0002 Scenario Driven Cross Implementation Verifier

Status: accepted for Phase 0.5
Date: 5 September 2026

## Context

Verifier Fase 0 pertama memakai selector dan adapter runtime milik fixture referensi. Hasil 5/5 hanya membuktikan bahwa fixture dapat menjalankan ulang dirinya sendiri. Itu belum membuktikan bahwa Behavior Contract berguna untuk implementasi dengan DOM, CSS, atau library berbeda.

## Decisions

1. Skenario held-out disimpan sebagai JSON berversi dan divalidasi oleh JSON Schema. Viewport, titik interruption, toleransi, scan window, dan progress points tidak lagi ditanam di source verifier.
2. Behavior menyimpan `trigger.targetRef` secara terpisah dari `targetRef`. Ini diperlukan ketika click pada satu elemen memulai animasi elemen lain.
3. Verifier menyelesaikan elemen melalui `dataWbcId` pada element index. Selector asli tetap menjadi evidence capture, tetapi tidak digunakan untuk mencari elemen replika.
4. Setiap skenario menggunakan fresh page. State hover, scroll, class, dan animation dari satu pemeriksaan tidak boleh bocor ke pemeriksaan berikutnya.
5. Scroll reveal diverifikasi dari perubahan visual dan pemulihan state, bukan nama class atau akses IntersectionObserver.
6. Scroll scrub diverifikasi dari computed transform. Start dan end dipindai lalu diperhalus dari output motion; verifier tidak membaca GSAP atau adapter replika.
7. Tambahkan replika dengan markup berbeda. CSS animation referensi diganti WAAPI, IntersectionObserver diganti scroll listener, dan GSAP ScrollTrigger diganti fungsi progress manual.

## Consequences

Kontrak yang sama kini lulus 5/5 pada referensi dan replika independen. Nilai start/end scroll berbeda karena layout replika berbeda, tetapi progress-to-motion mapping tetap sesuai. Perbedaan ini dianggap benar: verifier membandingkan perilaku yang dirasakan pengguna, bukan nilai layout absolut lintas implementasi.

Identity mapping masih source-assisted melalui atribut stabil `data-wbc-id`. Resolver lintas website yang memakai locator candidates, text, role, geometry, dan ambiguity score belum dibangun. Scenario runner juga masih memiliki evaluator per behavior kind; ini adalah dispatch berdasarkan semantics kontrak, bukan kode fixture-specific.

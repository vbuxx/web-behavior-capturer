# ADR 0011 Independent Structural Locator

Status: accepted for Phase 1
Date: 6 September 2026

## Context

Verifier sebelumnya mengabaikan selector CSS sumber, tetapi masih mengharuskan `data-wbc-id` yang sama pada replika. Itu membuktikan behavior equivalence hanya setelah identity mapping diberikan secara manual, belum membuktikan bahwa contract dapat menemukan implementasi yang berbeda.

Raw visible text dan accessible name sengaja belum disimpan karena kebijakan redaction saat ini hanya melindungi data terstruktur. Resolver juga harus mengungkap ambiguity, bukan memilih kandidat pertama secara diam-diam.

## Decisions

1. Naikkan Behavior Contract ke schema 1.5.0 dan produk prototype ke 0.5.0.
2. Simpan fingerprint non-text: tag, inferred role, depth, child count, DOM order, posisi relatif terhadap tinggi dokumen, rasio lebar, tinggi, serta keberadaan dan durasi maksimum transition.
3. Pada target verifikasi, nilai semua visible body elements. Identity capture yang benar-benar tersedia boleh menjadi evidence kuat untuk reference self-check; replika harus lulus hanya dengan structural fingerprint.
4. Resolver menambahkan selector temporer setelah kandidat menang. Selector ini hanya hidup di halaman verifier dan tidak menjadi bagian dari contract atau source fixture.
5. Tolak kandidat structural bila score di bawah 0,50 atau margin terhadap runner-up di bawah 0,02. Jangan fallback ke source selector atau shared ID.
6. Simpan score, margin, jumlah kandidat, dan strategi resolution di setiap verification check.
7. Hapus seluruh `data-wbc-id` dari fixture replika dan buktikan melalui test bahwa markup serta JavaScript tidak memuat token tersebut.
8. Tambahkan negative test dengan dua kandidat identik yang overlap. Expected result adalah explicit ambiguity rejection.

## Consequences

Replica dengan struktur, class, JavaScript, dan animation runtime berbeda dapat diverifikasi 5/5 tanpa identity annotation bersama. Nilai hover paling dekat dengan ambiguity boundary, sehingga threshold saat ini merupakan hasil spike dan belum layak disebut calibrated confidence untuk website umum. Perubahan layout besar, responsive reorder, shadow DOM, pseudo-elements, atau kandidat visual identik perlu evidence tambahan sebelum scope diperluas.

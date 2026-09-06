# ADR 0008 Structured Redaction Boundary

Status: accepted for Phase 1
Date: 6 September 2026

## Context

Natural capture dapat menerima URL, header, error, atau adapter payload yang mengandung credential. Melakukan redaction setelah JSONL atau SQLite ditulis sudah terlambat. Namun OCR dan blur screenshot memerlukan pipeline berbeda dan belum dapat diklaim hanya dengan sanitasi JSON.

## Decisions

1. Terapkan redaction sebelum record ditambahkan ke host recorder dan sebelum target coverage dimasukkan ke contract.
2. Policy 1.0.0 meredaksi password, secret, token, API key, authorization, cookie, session identifier, dan email ketika field terstruktur dapat dikenali.
3. Dukung bentuk header `{name, value}`, bearer credential dalam string, serta credential query parameter pada absolute dan relative URL.
4. Jangan mengubah input object. Redactor menghasilkan struktur baru dan menghitung jumlah replacement serta kategori yang ditemukan.
5. Tambahkan `manifest.redaction` pada Behavior Contract 1.3.0. Nilai nol berarti policy berjalan tetapi fixture tidak mengandung nilai yang cocok; bukan berarti halaman bebas data sensitif.
6. Gunakan credential palsu `fixture-secret` pada URL OOPIF natural fixture. Test wajib memastikan nilai itu tidak muncul di contract, JSONL, atau bytes SQLite.
7. Laporkan visual redaction sebagai `not_attempted`. Screenshot, Canvas, gambar, dan arbitrary visible text belum dipindai atau diburamkan.

## Consequences

Structured evidence memiliki data boundary deterministik sebelum persistence dan hasilnya dapat diaudit melalui manifest. False negative masih mungkin untuk secret tanpa nama field yang bermakna, encoding khusus, binary payload, atau teks visual. Policy perlu fixture adversarial dan aturan allow/deny yang dapat dikonfigurasi sebelum target autentik digunakan.

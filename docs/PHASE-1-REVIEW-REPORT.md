# Phase 1 Review Report — Local Read-only Session UI

## Outcome

WBC sekarang memiliki service dan viewer lokal untuk membuka artifact session yang sudah selesai. Server hanya bind ke `127.0.0.1` dan tidak mulai listen sampai contract, SQLite index, evidence checksums, row counts, metadata, dan schema selesai diverifikasi.

Viewer menampilkan integrity status, jumlah target/element/record, lima behavior contract, lifecycle target, 20 evidence record pertama melalui query ber-budget, dan thumbnail visual evidence dari evidence ID terdaftar.

## API Surface

- `GET /api/session`: metadata, counts, behavior summary, dan target coverage.
- `GET /api/behaviors`: filter `kind`, `limit`, dan `offset`.
- `GET /api/evidence`: filter target/type/time, record dan byte budget, serta revision-bound cursor.
- `GET /api/visuals`: daftar visual evidence PNG dari contract evidence index.
- `GET /api/visual/:evidenceId`: bytes PNG setelah path confinement dan checksum revalidation.
- `GET /`: viewer statis dengan CSP self-only.

Tidak ada endpoint write, arbitrary file route, upload, atau network bind publik.

## Verification

Automated test membuktikan:

- URL menggunakan loopback IPv4;
- session melaporkan integrity `verified` dan lima behavior;
- filter `gsap_scrub` mengembalikan tepat satu behavior;
- evidence mutation query menghormati limit dua dan budget 32 KiB;
- invalid kind mendapat 400 dan POST mendapat 405;
- response HTML membawa CSP;
- Chromium merender empat metric, lima behavior card, dan seluruh visual thumbnail tanpa UI error;
- visual ID tidak terdaftar dan encoded path traversal mendapat 404;
- visual asset dikirim sebagai `image/png` setelah checksum cocok.

Perintah penggunaan:

```bash
pnpm run review -- --package artifacts/phase1/latest
```

## Limitations and Next Scope

- Integrity scan membaca dan meng-hash seluruh file saat startup; query helper juga memvalidasi ulang sehingga latency akan meningkat pada package besar.
- Belum ada timeline scrubber, provenance graph, atau reference-vs-replica diff.
- Tidak ada authentication karena server sengaja loopback-only. Jika bind jaringan ditambahkan kelak, auth dan CSRF menjadi gate wajib.
- SQLite runtime masih experimental pada Node.js yang dipakai.
- MCP server belum tersedia.

Gate berikutnya: ukur startup/query latency pada package yang lebih besar. MCP sebaiknya memakai service/query core yang sama setelah authorization model ditetapkan.

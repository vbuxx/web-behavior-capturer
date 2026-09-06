# Fase 2 — Implementation Status

Dokumen ini mencatat bukti engineering yang sudah ada; status fixture tidak dinaikkan tanpa contract, graph, dan held-out verifier yang lulus.

## Sudah diimplementasikan

- Task specification tervalidasi (`schema/evaluation-task.schema.json`, `fixtures/evaluation/task-spec.json`) dengan tepat 12 task, safe-path check, starter/reference/ground-truth reference, capture recipe, scenario, dan evidence allowlist.
- Contract 1.6 additive: `ScrollTimeline.containerRef`, scroll offset/progress, track composition, dan open-shadow locator scope. Pembaca 1.5 tetap diterima oleh schema validator.
- Evaluator report 1.2: starting commit, bundle checksum, evidence byte budget, allowlist, symlink escape check, raw stream/credential/canary preflight, isolated starter workspace, randomized condition order, dan adapter model/reasoning propagation.
- Default adapter memakai `codex exec --ephemeral --skip-git-repo-check --sandbox workspace-write`, dengan stdout/stderr capture bounded dan hanya byte/token metrics yang dilaporkan.
- Probe request tervalidasi melalui recipe registry, base revision, control/timing/direction/viewport/max-runs/timeout plan. Revision probe immutable dan membuat node/edge per behavior yang ditargetkan.
- Annotation sidecar append-only dengan bounded edge correction (class/limitation); evidence refs, target, navigation scope, dan raw evidence tidak diubah.
- Viewer loopback menampilkan mode timeline time/scroll, revision selector, probe recipe/status, dan koreksi edge; semua API tetap cookie-authenticated dan integrity-checked.
- Browser observer merekam normalized container scroll progress; open-shadow resolver hanya menembus shadow root yang `open`.

## Tetap partial atau unavailable

- Held-out verifier task-specific masih tersedia untuk hover, CSS/WAAPI, dan GSAP reverse. Nested scroller, boolean/numeric GSAP full matrix, overlap composition, navigation/cancellation semantic contract, open-shadow semantic compilation, worker lifecycle, dan network-delayed state belum boleh disebut `supported` hanya karena evidence runtime tersedia.
- Worker-of-worker, closed shadow DOM, Windows, non-Chromium, OCR, Lottie, Canvas/WebGL semantic reconstruction, dan website nyata tetap Fase 3.
- Probe plan saat ini sudah divalidasi dan direkam, tetapi diagnostic runner masih menjalankan canonical fixture run; variasi yang belum dieksekusi tetap limitation, bukan evidence eksperimen.
- Smoke harness 9 run sudah lulus pada 7 September 2026 dengan adapter proses sintetis: 3 P0 task × 3 condition, seluruh bundle berada di bawah 65.536 byte dan seluruh held-out verifier yang tersedia lulus. Ini membuktikan harness/isolation, bukan agent success model.
- Matriks penuh 108 run belum dijalankan; tujuh task partial tetap unsupported pada denominator utama sampai verifier-nya tersedia.

## Gate berikutnya

1. Tambahkan reference/starter dan verifier held-out per task partial secara berurutan: nested scroll, GSAP modes, overlap, navigation, open shadow, worker, network.
2. Tambahkan verifier khusus OOPIF, masking, dan ambiguous locator ke task specification.
3. Jalankan harness tests tanpa agent, lalu smoke 3 P0 × 3 condition × 1 repetition.
4. Jika isolasi bundle, timeout cleanup, dan verifier execution lulus, jalankan 12 × 3 × 3 dengan `startingRef=191a86f` atau commit implementasi final yang sudah dikunci.
5. Re-run push/PR dan extended release gate. Status Fase 2 hanya hijau bila WBC ≥80% dan unggul ≥20 poin persentase dari trace pada denominator 36 run.

# PRD — Website Behavior Capture

## Spesifikasi perilaku website untuk agent yang membangun dan memverifikasi replika

*Versi 1.0 • 5 September 2026 • Status: usulan produk untuk validasi teknis*

*Audiens: founder, product engineer, browser engineer, dan pengembang coding agent.*

# 01 — Keputusan produk

Bangun **Website Behavior Capture (WBC)**: layanan lokal yang mengamati website melalui browser, mengekstrak perilaku yang dapat dibaca, menjalankan eksplorasi terarah, dan menghasilkan **Behavior Contract** yang dapat dipakai coding agent. Behavior Contract adalah spesifikasi tentang pemicu, target, kondisi, perubahan visual, parameter gerak, hubungan antarperilaku, serta bukti dan ketidakpastiannya.

Bentuk awal: **capture engine berbasis Chromium + CLI + server MCP + viewer lokal**. MCP menjadi antarmuka terstruktur agar agent dapat meminta perilaku tertentu, mengambil bukti, dan memverifikasi implementasi. Extension dan aplikasi desktop dapat menjadi antarmuka tambahan setelah engine terbukti.

Produk tidak cukup hanya merekam sesi. Nilai utamanya terletak pada tiga kemampuan: mengubah rekaman menjadi spesifikasi implementasi; menutup informasi yang belum diketahui melalui percobaan; dan menguji apakah replika merespons input baru dengan benar.

## Problem yang diselesaikan

Screenshot tidak menyimpan parameter dan kondisi yang menghasilkan tampilan. Video menambahkan lintasan visual, tetapi satu lintasan belum menjelaskan apa yang terjadi ketika hover dibatalkan, scroll dibalik, ukuran viewport berubah, atau klik terjadi di tengah transisi. Akibatnya, agent menghasilkan tampilan yang mirip pada checkpoint tertentu tetapi perilakunya berbeda.

Ada koreksi terhadap premis awal: browser automation tidak harus terbatas pada screenshot. Playwright sudah dapat merekam aksi, DOM snapshot, filmstrip, dan network. WBC memanfaatkan kemampuan observasi tersebut dan menambahkan model perilaku serta pengujian generalisasi. [Playwright Trace Viewer](https://playwright.dev/docs/trace-viewer).

## Hasil yang diharapkan

- Agent memperoleh parameter langsung ketika tersedia, sehingga tidak perlu menebak seluruh motion dari gambar.

- Perilaku yang tidak dapat diekstrak tetap memiliki bukti visual dan daftar informasi yang belum diketahui.

- Setiap hasil dapat ditelusuri ke sesi, elemen, aksi, dan sumber observasinya.

- Replika dinilai berdasarkan interaksi dan lintasan perubahan, bukan hanya tampilan akhir.

**Batas komitmen:** tidak ada jaminan menangkap seluruh event, menemukan semua state, memulihkan source asli, atau memahami semua program Canvas/WebGL. Seluruh target numerik dan estimasi jadwal dalam PRD ini merupakan usulan acceptance gate, bukan hasil benchmark. Riset ini meninjau dokumentasi; belum menjalankan prototipe.

# 02 — Temuan riset dan pilihan komponen

## Yang dapat diekstrak langsung

CDP Animation menyediakan lifecycle, target, timing, easing, dan tipe animasi native. Payload keyframe-nya tidak mencakup seluruh property-value; collector harus melengkapinya melalui remote Animation object, Web Animations API, atau CSS rules. [CDP Animation](https://chromedevtools.github.io/devtools-protocol/tot/Animation/).

Web Animations menyediakan keyframe values, specified/computed timing, dan composition. Snapshot DOM dan matched CSS memberi konteks struktur, layout, inheritance, serta pseudo-element. Ini menyediakan dasar observasi, bukan pemulihan komponen aplikasi asli. [Web Animations](https://www.w3.org/TR/web-animations-1/), [CDP DOMSnapshot](https://chromedevtools.github.io/devtools-protocol/tot/DOMSnapshot/), [CDP CSS](https://chromedevtools.github.io/devtools-protocol/tot/CSS/).

## Komponen yang sudah ada

| **Pilihan**             | **Kemampuan terdokumentasi**                  | **Peran dalam WBC**                 |
|-------------------------|-----------------------------------------------|-------------------------------------|
| Playwright Trace Viewer | Aksi, DOM snapshot, filmstrip, network        | Runner dan bukti debugging          |
| Chrome Recorder         | Rekam/replay user flow; ekspor JSON/Puppeteer | Masukan skenario atau pembanding    |
| rrweb                   | Snapshot, mutation, interaction, replay       | Kandidat engine rekaman DOM         |
| Spector.js              | WebGL commands, state, shaders; MCP           | Adapter diagnosis grafis terarah    |
| GSAP / Lottie APIs      | Timeline atau player yang terjangkau          | Ekstraksi parameter spesifik engine |

Sumber tabel: [Playwright](https://playwright.dev/docs/trace-viewer), [Chrome Recorder](https://developer.chrome.com/docs/devtools/recorder/overview), [rrweb](https://github.com/rrweb-io/rrweb), [Spector.js](https://github.com/BabylonJS/Spector.js/), [GSAP Timeline](https://gsap.com/docs/v3/GSAP/Timeline/), [lottie-web](https://github.com/airbnb/lottie-web).

rrweb juga memiliki opsi Canvas dan mencantumkan format replay AI hemat token sebagai pekerjaan yang sedang berlangsung. Spector.js sudah mendokumentasikan integrasi MCP. Karena itu, “rekaman JSON untuk agent” atau “tersedia lewat MCP” saja tidak cukup menjadi pembeda produk. [rrweb README](https://github.com/rrweb-io/rrweb), [Canvas recipe](https://github.com/rrweb-io/rrweb/blob/main/docs/recipes/canvas.md), [Spector.js](https://github.com/BabylonJS/Spector.js/).

**Keputusan build/reuse:** gunakan runner, protocol client, codec, dan komponen replay yang sudah ada setelah kompatibilitas diuji. Bangun sendiri normalisasi Behavior Contract, pelacakan provenance, eksplorasi untuk menutup gap, dan evaluator replika. Jangan menjalankan dua recorder DOM penuh secara default bila satu sudah mencukupi.

Ini adalah pemetaan kemampuan berdasarkan sumber primer, bukan uji komparatif produk atau klaim bahwa belum ada produk serupa. Fitur pada README branch utama harus diperiksa terhadap versi distribusi yang benar-benar dipakai.

# 03 — Pengguna, tujuan, dan bentuk produk

## Pengguna utama dan pekerjaan mereka

**Pengembang coding agent:** membutuhkan observasi terstruktur dan query kecil agar agent dapat membangun ulang suatu interaksi tanpa membaca ribuan frame. Keberhasilan berarti agent dapat menyebut sumber parameter dan meminta probe tambahan saat bukti belum cukup.

**Frontend engineer atau agency:** ingin memindahkan pengalaman visual ke stack baru. Keberhasilan berarti motion, navigasi, dan respons input tetap sesuai pada viewport serta skenario yang ditentukan.

**QA atau reviewer:** ingin mengetahui bagian replika yang berbeda, penyebab yang diduga, dan bukti pembanding. Keberhasilan berarti laporan menunjuk target, kondisi, waktu/progress, dan selisih yang dapat ditindaklanjuti.

## Perbandingan bentuk distribusi

| **Bentuk**                     | **Kelebihan untuk kebutuhan ini**                                        | **Keputusan**                           |
|--------------------------------|--------------------------------------------------------------------------|-----------------------------------------|
| Service lokal + CLI/MCP        | Mudah dipanggil agent; mengontrol lifecycle browser                      | Produk awal                             |
| Extension                      | Nyaman merekam browsing manual                                           | Antarmuka lanjutan                      |
| Desktop wrapper                | Installer, viewer, pengelolaan sesi terpadu                              | Setelah engine stabil                   |
| SDK pada website               | Akses instance dan state yang eksplisit                                  | Mode opsional untuk situs milik sendiri |
| Browser fork / proxy rewriting | Kontrol tambahan, tetapi biaya pemeliharaan dan perubahan eksekusi besar | Di luar MVP                             |
| Capture cloud                  | Mudah diskalakan; perlu pengelolaan sesi dan data remote                 | Setelah kebutuhan tervalidasi           |

Penilaian tabel adalah keputusan desain. Extension tetap layak, tetapi content script pada isolated world tidak otomatis memiliki akses ke variabel aplikasi; mekanisme page-world dan akses target harus dirancang secara eksplisit. [Chrome content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts).

## Tujuan dan hal di luar cakupan

Tujuan utama adalah meningkatkan behavioral equivalence: replika memberi respons yang sesuai terhadap input yang ditentukan, termasuk input baru di luar rekaman. Kesamaan source code bukan ukuran keberhasilan.

MVP tidak membangun backend asli, menyalin sistem pembayaran, menebak database, melakukan eksplorasi tak terbatas, atau menjamin seluruh browser. Pemulihan intent shader, source aplikasi, dan source map yang tidak tersedia berada di luar cakupan.

Istilah inti: **collector** merekam satu jenis bukti; **adapter** memahami API engine tertentu; **probe** adalah percobaan input terkontrol; **coverage** menyatakan wilayah dan skenario yang benar-benar diamati; **provenance** menunjukkan asal suatu nilai atau kesimpulan.

# 04 — Alur penggunaan dan eksplorasi

## Alur utama

1.  Pengguna atau agent menentukan URL, route yang dicakup, viewport, input mode, batas waktu, dan skenario penting. Untuk halaman login, pengguna menyediakan sesi melalui alur browser yang diizinkan.

2.  WBC membuka browser terkelola dan memasang collector sebelum script aplikasi. Bila menempel pada tab yang sudah berjalan, sesi diberi status late attach dan menawarkan rekaman ulang bila dapat dilakukan.

3.  WBC mengambil baseline struktur, style, asset references, lingkungan, dan kemampuan collector. Rekaman natural dilakukan tanpa pause, seek, atau perubahan clock.

4.  Pengguna melakukan interaksi, atau planner menjalankan skenario terarah. Semua collector mengamati sesi yang sama dengan identitas dan clock metadata yang dapat dikorelasikan.

5.  Compiler menyusun daftar perilaku, state yang terlihat, parameter, dependensi, dan gap. Agent dapat meminta bukti hanya untuk perilaku tertentu.

6.  Probe runner mengulang percobaan dari keadaan awal yang sebanding untuk menguji trigger atau parameter yang belum jelas.

7.  Agent membuat implementasi menggunakan kontrak dan bukti. WBC menjalankan skenario pembanding pada replika, lalu menghasilkan selisih untuk iterasi berikutnya.

## Strategi eksplorasi

Candidate ditemukan dari elemen interaktif, aturan hover/focus, listener yang teramati, scroll container, animasi aktif, perubahan state, dan region visual yang bergerak. Candidate tidak sama dengan perilaku yang sudah terbukti.

Prioritaskan navigasi, CTA, menu, elemen di atas lipatan halaman, serta motion yang berubah besar atau buktinya lemah. Kandidat identik dapat dikelompokkan menurut pola DOM/style, tetapi setidaknya satu sampel tambahan diuji untuk menghindari generalisasi keliru.

Probe minimal mencakup hover masuk/keluar, focus/blur, klik ulang, Escape, scroll turun/naik, berhenti di tengah motion, dan perubahan viewport. Nested scroller, scroll snap, sticky boundary, serta refresh layout harus diuji pada container yang tepat. Form submission atau aksi yang mengubah data memerlukan skenario khusus yang memang diizinkan pengguna.

**Collector berjalan bersamaan; aksi eksplorasi dalam satu sesi diurutkan.** Menjalankan hover, klik, dan scroll tanpa kontrol secara bersamaan akan mengaburkan atribusi. Skenario independen boleh dijalankan pada context terpisah, dengan catatan akun dan state server masih dapat saling memengaruhi.

Batas awal yang diusulkan: 10 menit atau 100 aksi per route. Planner berhenti ketika anggaran habis atau dua putaran tidak menemukan perilaku baru yang signifikan. Hasil menyebut route, viewport, dan aksi yang belum diuji; tidak menampilkan persentase “seluruh website telah dipahami”.

# 05 — Arsitektur yang direkomendasikan

![Arsitektur WBC: browser diamati tiga collector paralel; evidence store menormalisasi clock dan identitas; compiler menghasilkan perilaku untuk viewer dan agent; probe dan verifier menghasilkan bukti tambahan.](media/architecture.png)

Arsitektur usulan. Satu sesi memiliki beberapa channel bukti; probe dan verifikasi memperkaya kontrak.

## Pembagian tanggung jawab

**Session orchestrator** mengelola browser, route, reset, skenario, dan anggaran. **Collector** mengirim record append-only ke evidence store. **Behavior compiler** menormalisasi bukti menjadi kontrak. **Verifier** membandingkan perilaku referensi dengan replika memakai skenario yang sama dan skenario validasi baru.

Pilihan implementasi awal: TypeScript untuk runner, collector, schema, dan MCP; Playwright untuk orchestration; CDP untuk observasi Chromium; SQLite untuk indeks sesi dan query; file terkompresi serta content hash untuk blob. Viewer lokal dapat dibangun sebagai aplikasi web ringan. Pilihan stack ini adalah usulan yang dapat diganti selama kontrak terpenuhi.

WBC harus memisahkan channel observasi browser, page-world hooks, serta transport ke host. addInitScript dapat dipasang sebelum script halaman berjalan dan juga pada child frame; ini mendukung capture sejak awal navigasi. [Playwright BrowserContext](https://playwright.dev/docs/api/class-browsercontext#browser-context-add-init-script).

Registry target menangani navigasi, iframe, dan worker yang dapat di-attach. CDP auto-attach untuk related targets perlu diterapkan secara rekursif; kegagalan attach harus masuk coverage report. [CDP Target](https://chromedevtools.github.io/devtools-protocol/tot/Target/).

LLM membantu memberi nama perilaku, memilih percobaan, dan menyusun rekomendasi implementasi. Pencatatan, normalisasi unit, validasi schema, penghitungan metrik, serta penetapan status data-loss harus deterministik. Klaim LLM yang tidak memiliki bukti tidak boleh dipromosikan menjadi hasil ekstraksi.

# 06 — Requirement perekaman

Prioritas: **P0** wajib untuk MVP; **P1** sesudah fondasi lolos; **P2** eksplorasi lanjutan. Setiap requirement memiliki hasil yang dapat ditinjau.

## FR-01 • Session dan capability manifest — P0

Rekam versi browser/protocol/adapter, OS, viewport, DPR, zoom, input capabilities, locale, timezone, reduced-motion, visibility, URL, navigation ID, capture mode, dan konfigurasi sampling. Capability harus membedakan supported, unavailable, failed, dan not attempted.

**Acceptance:** ekspor tetap valid bila salah satu collector gagal; reason code dan rentang waktu yang terdampak tercantum. Sesi late attach tidak dilabeli complete sejak page load.

## FR-02 • Input dan perubahan state — P0

Rekam pointer, keyboard, focus, scroll, resize, navigation, serta perubahan atribut/class dan state visual yang relevan. Bedakan timestamp aksi diminta, input dikirim, event teramati, dan hasil terlihat. Simpan event target serta jalur propagasi yang tersedia; hindari menganggap target input selalu target animasi.

**Acceptance:** click pada ikon anak yang menggerakkan panel lain tetap menautkan kedua elemen melalui bukti. Mousemove dapat dicoalesce, tetapi batas aksi dan perubahan state tidak boleh dibuang diam-diam.

## FR-03 • Struktur, style, dan identitas — P0

Ambil baseline DOM/layout, lalu delta dan snapshot pada checkpoint. Pantau style terpilih pada target aktif, termasuk pseudo-element dan inheritance yang dapat dibaca. MutationObserver tidak dijadikan satu-satunya indikator motion: perubahan kompositor dan pseudo-state memerlukan sumber lain.

**Acceptance:** node removal/recreation menghasilkan instance ID baru; resolver lintas sesi menggunakan beberapa locator dan melaporkan ambiguity. Frame, shadow boundary, pseudo selector, serta navigation epoch menjadi bagian identitas.

## FR-04 • Animasi native — P0

Gabungkan lifecycle CDP, WAAPI, CSS rules, dan computed styles. Simpan property tracks, keyframes, timing domain, delay, iterations, direction, fill, playback rate, composite, cancellation, interruption, dan reverse bila tersedia. Query saat lifecycle dimulai agar animasi pendek tidak hanya dicari setelah idle.

**Acceptance:** CSS transition terinterupsi dicatat sebagai lintasan aktual beserta parameter yang terbaca; nilai yang terlewat menjadi unknown. Tidak ada fallback “duration 300 ms” tanpa bukti.

## FR-05 • Visual dan asset evidence — P0

Ambil checkpoint sebelum/selama/setelah perubahan dan klip singkat pada region yang tidak terjelaskan. Catat waktu capture sebenarnya, area crop, resolusi, serta keterlambatan terhadap checkpoint yang diminta. Index URL, hash, tipe, dan keterkaitan asset; simpan bytes hanya bila tersedia dan diizinkan.

**Acceptance:** setiap bukti visual dapat dirujuk dari kontrak; assets yang belum tersedia tidak ditampilkan sebagai tersimpan. Full-page screenshot diperlakukan sebagai bukti layout, bukan bukti motion simultan seluruh halaman.

# 07 — Dukungan jenis perilaku

Tabel ini mendefinisikan strategi dan batas dukungan produk yang diusulkan. “P0” tetap bergantung pada capability check untuk sesi dan versi browser tersebut.

| **Jenis**                       | **Cara mendapatkan spesifikasi**                  | **Target dan fallback**                           |
|---------------------------------|---------------------------------------------------|---------------------------------------------------|
| CSS animation / transition      | Lifecycle + keyframes + timing + matched CSS      | P0; tracks tak terbaca diberi gap                 |
| Hover, focus, micro-interaction | Input, pseudo-state, style delta, pengulangan     | P0; pisahkan masuk/keluar                         |
| Menu / animated navigation      | State terbuka/tertutup, focus, URL, interruption  | P0; state internal tidak wajib terpulihkan        |
| Scroll-triggered                | Ambang pemicu + animasi berbasis waktu            | P0; uji turun dan naik                            |
| Native scroll-driven            | Container, axis, range, progress, tracks          | P0 bila API tersedia                              |
| Sticky / parallax               | Posisi terhadap viewport dan container; style     | P0 observasi; rule diuji di beberapa posisi       |
| GSAP timeline                   | Adapter untuk instance yang terjangkau            | P0 subset tervalidasi; sampled tracks bila privat |
| GSAP ScrollTrigger              | start/end, scroller, scrub, pin, snap, timeline   | P0 subset; uji reverse dan resize                 |
| Lottie                          | Asset JSON, player config, segment dan invocation | P1; klip terarah pada MVP                         |
| Canvas 2D                       | Visual region; command capture terpilih           | P0 visual; P1 command mode                        |
| WebGL / Three.js                | Visual; GL frame diagnostic; scene/mixer adapter  | P0 visual; P1/P2 semantic subset                  |
| OffscreenCanvas / worker        | Target dan worker adapter bila tersedia           | P0 laporkan coverage; P1 capture terarah          |
| Arbitrary state transition      | Observable state + action graph                   | P0 observed graph; state tersembunyi unknown      |

ScrollTrigger menyediakan hubungan scroll dengan progress; pada scrub: true, durasi child tween berfungsi sebagai proporsi jarak scroll. Numeric scrub menambahkan waktu penyesuaian. Karena itu kontrak menyimpan konfigurasi dan nilai resolved, bukan mengubah semuanya menjadi durasi milidetik. [GSAP ScrollTrigger](https://gsap.com/docs/v3/Plugins/ScrollTrigger/).

Lottie dapat memakai data JSON atau path dan memiliki kontrol playback/segment. Adapter harus menautkan pemanggilan player dengan input aplikasi; asset animasi saja belum menjelaskan pemicunya. [lottie-web](https://github.com/airbnb/lottie-web).

Three.js memberi struktur Object3D dan AnimationMixer, tetapi animasi juga dapat berasal dari perubahan manual pada render loop. Scene snapshot tidak dengan sendirinya menghasilkan program penggeraknya. [Object3D](https://threejs.org/docs/pages/Object3D.html), [AnimationMixer](https://threejs.org/docs/pages/AnimationMixer.html).

# 08 — Atribusi trigger dan dependency

## FR-06 • Evidence graph — P0

Model menyimpan node untuk input, observable state, mutation, animation, network completion yang relevan, dan visual checkpoint. Edge menjelaskan hubungan yang didukung bukti. UI dan ekspor menggunakan kelas yang sama:

| **Kelas edge**       | **Arti**                                               | **Contoh**                                  |
|----------------------|--------------------------------------------------------|---------------------------------------------|
| direct               | Relasi lokal tercatat lewat instrumentasi atau adapter | Handler teramati memanggil animate          |
| experiment_supported | Relasi didukung pengulangan dengan kontrol             | Hover menghasilkan efek; no-hover tidak     |
| correlated           | Berdekatan pada waktu/state/target                     | Mutation lalu motion tanpa trace panggilan  |
| unknown              | Belum cukup bukti                                      | Motion dimulai saat beberapa input berimpit |

Satu edge direct tidak membuktikan seluruh rantai sebab-akibat. Handler dapat menjadwalkan tugas asynchronous, menunggu network, atau bergantung pada state lain. Listener yang terdaftar juga belum membuktikan handler itu dieksekusi.

## FR-07 • Probe atribusi — P0

Untuk candidate trigger, reset kondisi yang relevan, jalankan input, amati hasil, lalu bandingkan dengan kondisi kontrol tanpa input. Ulangi dengan variasi waktu atau urutan saat hasil ambigu. Simpan precondition fingerprint, hasil setiap run, faktor yang tidak terkontrol, dan cakupan kesimpulan.

Contoh: menu tampak setelah hover pada saat timer banner selesai. Jalankan hover lebih awal, lebih lambat, dan kontrol tanpa hover. Jika menu selalu mengikuti hover sedangkan banner tetap mengikuti timer, relasi dapat diperkuat. Jika reset state tidak dapat dipastikan, edge tetap correlated atau diberi keterbatasan eksperimen.

Instrumentasi callback/timer dipakai secara selektif pada deep mode. Jangan menjanjikan propagasi causal ID universal melalui Promise, framework scheduler, worker, dan kompositor. Mode diagnosis yang memakai breakpoint, forced pseudo-state, atau seek harus menghasilkan pass terpisah dari natural capture.

## FR-08 • Parameter dan lintasan — P0

Untuk nilai langsung, simpan data asli dan nilai normalisasi. Untuk inferensi, simpan sampel, metode fitting, residual error, domain validitas, dan alternatif yang masih mungkin. Sampel yang sesuai cubic-bezier tidak membuktikan source menggunakan fungsi itu; spring atau logika lain bisa menghasilkan lintasan serupa.

Pisahkan declared timing dari observed timing. Simpan composited output di samping individual tracks bila beberapa animasi menulis property sama. Dependency graph mempertahankan stagger, overlap, sequence, cancellation, reverse, repeat, dan yoyo yang teramati; tidak memaksa seluruh perilaku menjadi urutan linear.

**Acceptance:** dua efek yang kebetulan dimulai bersama tidak otomatis mendapat parent trigger yang sama. Semua edge memiliki evidence references dan tidak memakai angka confidence sebagai probabilitas sebelum kalibrasi empiris tersedia.

# 09 — Kontrak data dan waktu

## FR-09 • Schema versioned — P0

Behavior Contract menggunakan JSON tervalidasi dan schema version yang eksplisit. Field yang hilang bukan bernilai nol. Setiap parameter diberi status extracted, observed, inferred, atau unknown; status ini terpisah dari kelas edge sebab-akibat.

| **Entitas**        | **Isi minimum**                                                            |
|--------------------|----------------------------------------------------------------------------|
| CaptureManifest    | Versi, scope, environment, mode, capabilities, quality, gap                |
| ElementRef         | Capture ID, navigation, frame/realm, node ID, locator candidates, bounds   |
| RawEvent           | ID, source, source sequence, source time, receive time, payload ref        |
| ObservableState    | URL, elemen relevan, atribut, visibility, focus, scroll, fingerprint       |
| Behavior           | Trigger candidates, guards, target, tracks, timeline, interruption         |
| EvidenceEdge       | from/to, relation, evidence class, evidence refs, limitation               |
| Scenario           | Preconditions, reset recipe, ordered actions, checkpoints, expected states |
| VerificationResult | Coverage, compared domain, metrics, mismatch, evidence refs                |

## Clock dan unit tidak boleh disamakan

Simpan source clock, raw timestamp, normalized session time, dan estimasi error pemetaan. Timestamp pesan tiba di host bukan pengganti waktu kejadian. Translasi performance.now() dengan timeOrigin membantu menghubungkan context, tetapi precision dapat dibatasi dan perbandingan lintas sesi browser tidak otomatis valid. [High Resolution Time](https://www.w3.org/TR/hr-time-3/).

CDP membedakan timing berbasis waktu dan persentase untuk scroll-driven animation. Kontrak menggunakan tagged unit: ms, s, percent, px, frame, atau normalized progress. Rekam source container, axis, subject, layout checkpoint, dan range yang menjadi basisnya. [CDP Animation](https://chromedevtools.github.io/devtools-protocol/tot/Animation/).

Sequence number menjaga urutan dalam satu source. Hubungan lintas source memakai clock mapping dan evidence edge. Jika interval error bertumpang tindih, urutan total tidak boleh diklaim pasti. Pertahankan raw record agar normalisasi dapat dihitung ulang saat metode kalibrasi membaik.

## Bentuk paket ekspor

Satu paket portabel memuat manifest, behavior JSON, element index, scenario JSON, event chunks, screenshot/clip references, asset manifest, dan verification report bila tersedia. Blob memakai hash untuk deduplikasi. Raw stream tidak dimasukkan seluruhnya ke prompt agent.

**Acceptance:** schema menolak unit yang tidak cocok dengan domain, reference yang rusak, serta status extracted tanpa evidence. Migrasi minor menjaga backward compatibility; major version yang tidak didukung ditolak secara jelas.

# 10 — Contoh Behavior Contract

Contoh berikut bersifat ilustratif, bukan hasil capture website nyata. Ia menunjukkan hover pada kartu yang memulai transisi dua property. Angka hanya contoh schema.

{

"schemaVersion": "1.0",

"behaviorId": "card-hover-01",

"targetRef": "nav1:frame1:element42",

"preconditions": {"stateRef": "card-idle"},

"trigger": {

"type": "pointerenter",

"targetRef": "nav1:frame1:element42",

"edgeClass": "experiment_supported",

"evidenceRefs": \["probe-01", "control-01"\]

},

"timeline": {

"domain": "time",

"duration": {"value": 240, "unit": "ms"},

"easing": "cubic-bezier(0.2, 0.8, 0.2, 1)",

"provenance": "extracted",

"evidenceRefs": \["waapi-17"\]

},

"tracks": \[

{"property": "opacity", "from": 0.7, "to": 1},

{"property": "transform",

"from": "translateY(0px)",

"to": "translateY(-8px)"}

\],

"trackProvenance": {

"status": "extracted", "evidenceRefs": \["waapi-17"\]

},

"interruption": {

"onPointerLeave": "transition-to-idle",

"status": "observed", "evidenceRefs": \["run-03"\]

},

"visualEvidenceRefs": \["frame-before", "frame-mid", "frame-end"\],

"unknowns": \["touch-equivalent behavior belum diuji"\]

}

Untuk scroll-driven motion, timeline memakai domain scroll dengan container, axis, range, progress tracks, dan aturan scrub. Untuk GSAP scrub numerik, catch-up time disimpan terpisah. Untuk Lottie, track dapat merujuk segment/frame dan asset hash. Untuk grafis opaque, kontrak memuat region dan observasi dengan parameter semantik unknown.

Ringkasan yang diterima agent: “Kartu naik 8 px dan opacity menjadi 1 ketika pointer masuk; timing terbaca dari runtime. Pointer keluar di tengah transisi mengembalikan kartu ke idle. Perilaku touch belum diuji.” Agent dapat meminta bukti rinci tanpa membaca event log penuh.

# 11 — Antarmuka agent dan viewer

## FR-10 • Query untuk coding agent — P0

CLI dan MCP memakai service serta schema yang sama. Operasi lama mengembalikan job ID; query hasil mendukung pagination, filter, cancellation, serta batas jumlah record atau bytes. Endpoint berikut adalah kontrak API usulan, bukan tool yang sudah tersedia.

| **Operasi**    | **Input penting**                 | **Hasil**                           |
|----------------|-----------------------------------|-------------------------------------|
| capture.start  | URL, scope, environment, budget   | Session/job ID, capabilities        |
| capture.stop   | Session ID                        | Paket, quality summary              |
| behavior.list  | Session, region, jenis, cursor    | Ringkasan perilaku dan gap          |
| behavior.get   | Behavior ID, detail level         | Parameter, state, evidence refs     |
| evidence.get   | Refs, time/progress range, budget | Record/asset yang diminta           |
| probe.run      | Scenario, reset recipe, budget    | Hasil percobaan dan revisi evidence |
| replica.verify | Reference, replica URL, scenarios | Selisih perilaku dan coverage       |
| capture.export | Session, format/schema version    | Paket portabel                      |

Operasi read mengembalikan snapshot revision agar query berurutan konsisten. Parameter hasil probe tidak menimpa bukti lama; compiler membuat revision baru. Reference evidence tetap dapat diakses selama sesi belum dihapus.

## FR-11 • Viewer untuk pemeriksaan manusia — P0

Viewer menampilkan preview halaman, daftar elemen/perilaku, timeline atau scroll-progress axis, dan inspector bukti. Pengguna dapat memilih perilaku, melihat trigger candidates, membandingkan before/mid/after, serta menandai area yang perlu diamati lagi.

Tampilkan coverage dan unknown dekat perilakunya: “worker tidak terinstrumentasi” lebih berguna daripada skor kelengkapan global. Peninjau dapat mengoreksi label atau menambahkan catatan, tetapi bukti asli tidak diedit. Catatan manusia memiliki provenance sendiri.

## FR-12 • Loop implementasi — P0

Agent membaca ringkasan, mengambil detail untuk elemen yang sedang dibangun, meminta probe bila perlu, lalu menjalankan verifier. Report memprioritaskan selisih trigger, target, state, dan timing yang memengaruhi pengguna; perbedaan nama class atau library implementasi tidak otomatis dianggap gagal.

Kontrak harus cukup mandiri untuk menghasilkan implementasi yang sesuai pada stack berbeda. Rekomendasi seperti “gunakan CSS transition” atau “gunakan GSAP timeline” merupakan saran implementasi, bukan klaim library asli kecuali terdeteksi dengan bukti.

**Acceptance:** alur capture → query satu perilaku → build oleh agent → verify dapat dijalankan tanpa pengguna harus membaca raw log. Viewer dan MCP menunjukkan provenance serta gap yang konsisten.

# 12 — Performa, integritas, dan data

## NFR-01 • Observasi berbujet

Default memakai baseline + delta + target aktif. Hindari computed-style dan geometry read semua node pada setiap frame. Bahkan getAnimations() dapat memproses style changes; zero-impact capture tidak menjadi janji produk. [Web Animations](https://www.w3.org/TR/web-animations-1/).

Sampling awal yang diusulkan: checkpoint sebelum/akhir motion serta beberapa titik tengah; naikkan sampling hanya pada region yang belum terjelaskan. Klip grafis dapat memakai 15–30 FPS selama 1–3 detik, dan 60 FPS hanya untuk kasus terpilih. Nilai ini merupakan konfigurasi awal untuk benchmark, bukan jaminan bahwa semua transien akan tertangkap.

Collector menggunakan buffer terbatas dan batch flush. Urutan penurunan kualitas: kurangi visual tambahan, coalesce pointer/scroll samples, kurangi style sampling, lalu hentikan capture bila critical records tidak bisa dipertahankan. Catat drop count atau rentang kehilangan yang diketahui; gunakan unknown loss bila jumlah pasti tidak tersedia. CDP Tracing menyediakan indikasi data loss yang harus diteruskan. [CDP Tracing](https://chromedevtools.github.io/devtools-protocol/tot/Tracing/).

## NFR-02 • Natural pass dan replay

Capture natural tidak mengubah clock, playback rate, atau state animasi untuk memperoleh screenshot. Playwright page.screenshot mengizinkan animasi secara default, sedangkan screenshot assertion dapat menonaktifkannya; opsi ini harus eksplisit dalam runner motion. Menonaktifkan animasi dapat memajukan finite animation sampai selesai dan memicu transitionend. [Page screenshot](https://playwright.dev/docs/api/class-page#page-screenshot), [PageAssertions](https://playwright.dev/docs/api/class-pageassertions#page-assertions-to-have-screenshot-1).

Replay untuk diagnosis dapat mengontrol clock atau seek bila engine mendukung. Playwright Clock mengendalikan API waktu tertentu, termasuk timers dan requestAnimationFrame; hal ini tidak menjadi jaminan pengendalian network, worker, GPU, atau seluruh kompositor secara serentak. [Playwright Clock](https://playwright.dev/docs/clock).

## NFR-03 • Data dan eksekusi

Pemrosesan lokal menjadi default. Password, token, cookie, Authorization, dan isi input sensitif tidak masuk ekspor; gunakan masking sebelum persist pada record dan visual. Asset manifest membedakan reference-only, bytes tersedia, dan izin reuse yang belum dipastikan. Pengguna mengontrol ekspor dan penghapusan sesi.

Viewer tidak menjalankan script target sebagai bagian UI tepercaya. Replay aktif ditempatkan pada proses/context terisolasi dengan network dibatasi. Ini relevan karena opsi Canvas replay rrweb dapat mengizinkan script dalam iframe. [rrweb Canvas](https://github.com/rrweb-io/rrweb/blob/main/docs/recipes/canvas.md).

Teks halaman diperlakukan sebagai data, bukan instruksi agent. Local service membatasi akses ke loopback dan sesi terautentikasi; tidak mengekspos endpoint debug browser secara publik.

# 13 — Rancangan evaluasi

## Dua pertanyaan yang harus dijawab

Pertama, apakah WBC menangkap fakta perilaku secara akurat dan jujur tentang gap? Kedua, apakah informasi tersebut benar-benar membantu agent menghasilkan replika yang lebih baik dengan biaya yang wajar? Hasil ekstraksi yang lengkap tidak otomatis membuktikan manfaat downstream.

## Dataset evaluasi usulan

Bangun 60 fixture dengan ground truth: 20 CSS/WAAPI, 10 hover/menu/state, 10 scroll/sticky/parallax, 10 GSAP, dan 10 grafis/worker/Lottie. Pisahkan 40 untuk pengembangan dan 20 held-out berdasarkan pola implementasi, bukan hanya mengganti warna atau isi teks. Semua kategori muncul pada kedua bagian; laporkan metrik per kategori.

Tambahkan 8–12 website nyata yang boleh diuji sebagai external validation. Situs ini bukan ground truth lengkap; reviewer memeriksa perilaku pada route dan skenario terpilih. Jangan menggabungkan skornya dengan fixture seolah denominator sama.

## Tiga kondisi pembanding

- **A — Screenshot workflow:** screenshot pada checkpoint dengan akses dasar yang ditentukan secara eksplisit.

- **B — Strong baseline:** Playwright trace/DOM/action evidence dan klip motion terpilih.

- **C — WBC:** Behavior Contract, evidence queries, probe terarah, dan verifier.

Gunakan model agent, versi, task prompt, budget token/waktu, target stack, serta starting repo yang sama. Jalankan sekurangnya tiga pengulangan per tugas dengan urutan kondisi diacak. Biaya capture, query, reasoning, dan verifikasi dihitung bersama. Bila model tidak deterministik, laporkan median, variasi, dan interval ketidakpastian antar-tugas.

## Uji generalisasi perilaku

Skenario validasi tidak diberikan seluruhnya kepada agent. Contoh: rekaman menunjukkan scroll turun; evaluator mencoba reverse scroll dan pause di tengah. Rekaman menunjukkan hover penuh; evaluator keluar setelah seperempat durasi. Validasi juga memakai viewport yang tidak persis sama, selama masih di dalam domain dukungan yang dinyatakan.

Untuk continuous motion, bandingkan posisi/scale/opacity pada grid waktu atau progress yang sama dan laporkan onset lag secara terpisah. Jangan melakukan time warping bebas yang dapat menyembunyikan durasi salah. Untuk stochastic graphics, gunakan beberapa run dan toleransi yang dinyatakan; jangan memaksa kesamaan piksel sebagai satu-satunya ukuran.

## Pencegahan bias evaluasi

Ground truth berasal dari fixture yang diketahui, bukan hasil ekstraksi WBC sendiri. Pisahkan extraction accuracy, replay fidelity, dan behavioral equivalence. Lakukan review buta pada sampel. Sertakan kegagalan dan unsupported sebagai hasil yang terlihat; jangan hanya melaporkan perilaku yang berhasil diekstrak.

# 14 — Metrik dan release gate

**Semua angka berikut adalah target usulan.** Nilainya perlu disetujui atau direvisi setelah spike awal, dengan alasan yang terdokumentasi. Benchmark memakai hardware acuan, browser build, viewport, DPR, dan mode capture yang dipin.

| **Metrik**                | **Definisi dan target awal**                                                                         |
|---------------------------|------------------------------------------------------------------------------------------------------|
| Behavior discovery recall | ≥90% ground-truth behavior yang aktif pada skenario P0; laporkan per kategori                        |
| Trigger precision         | ≥95% edge direct/experiment-supported benar pada fixture; recall ikut dilaporkan                     |
| Parameter extraction      | ≥95% field yang terjangkau dan didukung cocok ground truth setelah normalisasi                       |
| Temporal observation      | p95 onset/end error ≤ satu frame 60 Hz, setelah clock uncertainty dihitung; hanya fixture time-based |
| Scroll mapping            | p95 boundary error ≤8 CSS px dan progress error ≤0,02 pada fixture yang didukung                     |
| Motion track error        | p95 position error ≤2 CSS px, opacity ≤0,03 pada checkpoint fixture DOM                              |
| Agent task success        | ≥80% held-out P0 lulus seluruh critical scenarios dan ≥20 poin persentase di atas baseline B         |
| Total agent effort        | Median token input turun ≥40% dibanding B pada fidelity setara; semua query dihitung                 |
| Observer cost             | Median p95 frame-interval memburuk ≤10% dibanding run tanpa collector; tail per-fixture dilaporkan   |
| Data integrity            | 100% injected collector failures/overflow muncul sebagai gap; tidak ada critical drop tanpa status   |
| Portability               | Semua paket uji lolos schema, checksum, dan evidence reference validation                            |

Parameter yang tidak terjangkau dikecualikan dari metrik akurasi field, tetapi **wajib** masuk metrik field availability dengan denominator seluruh field relevan. Nilai unknown tidak dihitung benar. Trigger precision tinggi tidak cukup bila sistem hanya memberi label pasti pada sedikit perilaku; laporkan coverage kelas edge dan recall bersama.

Usulan profil beban: route 5 menit, sampai 5.000 DOM nodes, dan sampai 50 track aktif. Anggaran awal evidence non-asset 100 MB per sesi, query ringkasan p95 \<2 detik setelah indeks siap, dan finalisasi \<30 detik. Mode video/grafis berat memakai budget terpisah dan terlihat; angka profil harus diverifikasi di hardware acuan sebelum menjadi janji pengguna.

**Gate rilis:** semua requirement P0 dan integritas ekspor lulus; tidak ada crash/secret leak yang diketahui pada suite; hasil accuracy serta observer-cost memenuhi ambang yang disepakati. Bila gate gagal, kecilkan scope atau perbaiki engine. Jangan menaikkan label confidence untuk menutupi gap.

# 15 — Skenario acceptance yang menentukan

## AT-01 • Hover terinterupsi

Given kartu dengan transition opacity dan transform, when pointer masuk lalu keluar di tengah transisi, then kontrak memisahkan dua lintasan, menyimpan state aktual saat interruption, dan replika kembali ke idle sesuai perilaku referensi. Periksa juga keyboard focus; jangan menganggap hover dan focus identik.

## AT-02 • Scroll sebagai pemicu dan pengendali

Given satu elemen reveal saat melewati ambang dan satu elemen scrub sepanjang scroll, when pengguna berhenti lalu membalik arah, then model membedakan animasi berbasis waktu dari progress berbasis scroll. Ulangi pada nested scroller dan viewport berbeda; laporkan perubahan boundary yang resolved.

## AT-03 • GSAP dan konkurensi

Given nested timeline dengan stagger, repeat/yoyo, serta tween lain yang menulis transform target sama, when skenario dijalankan, then adapter mengeluarkan struktur yang terjangkau dan collector mempertahankan composited trajectory. Instance privat harus turun ke fallback yang berlabel, bukan dianggap tidak ada animasi.

## AT-04 • Navigasi dan state

Given menu terbuka melalui click, when Escape ditekan, route berubah, atau click kedua datang saat panel bergerak, then report membandingkan visual state, URL, focus, scroll lock, dan cancellation. Identitas elemen setelah route change tidak menggunakan node ID lama secara keliru.

## AT-05 • Lottie dan grafis opaque

Given Lottie dengan play segment akibat hover, then asset/player metadata dan trigger invocation dibedakan. Given Canvas/WebGL tanpa scene reference, then hasil tetap berisi region, visual evidence, kondisi input, dan unknowns. Capture tersebut tidak dilabeli semantic reconstruction.

## AT-06 • Frame, worker, dan animasi singkat

Given iframe lintas proses, shadow tree, worker canvas, serta animasi yang selesai sebelum idle, then manifest menyatakan coverage setiap target dan rentang attach. Skenario yang tidak bisa diamati tetap muncul sebagai failed/unsupported, bukan silently omitted. Uji juga navigation race, cancellation cepat, dan late attach.

## AT-07 • Loss, noise, dan observer effect

Given event burst, endless animation, background tab, network tertunda, atau collector crash, then sesi berakhir sesuai budget dan mengeluarkan quality report. Bandingkan run natural tanpa collector dengan capture mode; probe yang memakai seek/clock tidak dicampur ke timing baseline.

## AT-08 • Validasi di luar rekaman

Given agent hanya melihat alur tertentu, when evaluator menjalankan held-out interruption/reverse/viewport scenario, then keberhasilan diukur dari perilaku yang benar. Implementasi yang memutar video referensi sebagai pengganti interaksi harus gagal pada skenario input baru.

# 16 — Roadmap dan batas MVP

## Fase 0 • Spike kelayakan — usulan 2–3 minggu

Browser engineer memvalidasi lifecycle animasi pendek, resolveAnimation/keyframe extraction, frame/worker attachment, dan clock mapping. Product engineer membangun 12 fixture awal, format Behavior Contract minimal, dan contoh loop agent. Hasilnya adalah bukti teknik dan revisi scope, bukan UI lengkap.

**Exit:** prototype menangkap hover, CSS animation, interrupted transition, scroll reveal, dan satu GSAP scrub; loss terlihat; observer cost terukur. Jika akses instance privat tidak terselesaikan, shipping promise secara eksplisit memakai fallback.

## Fase 1 • Fondasi capture — usulan 4–5 minggu

Bangun session manager, registry elemen/target, collectors native, visual evidence, indeks, redaction, schema, export, dan quality manifest. Terapkan FR-01 sampai FR-05 serta NFR terkait. Natural pass harus bekerja sebelum deep instrumentation diperluas.

**Exit:** fixture core teramati tanpa silent loss; ekspor dapat dibuka kembali; unknowns konsisten. Paket tidak bergantung pada koneksi ke website untuk membaca bukti yang memang disimpan.

## Fase 2 • Kontrak dan loop agent — usulan 5–6 minggu

Bangun evidence graph, probe/reset runner, subset GSAP/ScrollTrigger tervalidasi, query MCP/CLI, viewer, dan verifier DOM/motion. Selesaikan FR-06 sampai FR-12. Jalankan baseline A/B/C sejak awal agar manfaat agent menjadi dasar prioritas.

**Exit:** agent dapat mereplikasi pola P0 dengan query terarah, dan held-out tests menunjukkan peningkatan dibanding baseline kuat.

## Fase 3 • Pilot dan stabilisasi — usulan 3–4 minggu

Lengkapi 60 fixture, jalankan external validation, ukur overhead dan biaya, perbaiki portability serta failure handling. Pilot awal pada 5–8 engineer/agent builders dengan route nyata yang mereka pilih. Kumpulkan kebutuhan yang tidak terselesaikan, waktu manual yang berkurang, dan alasan berhenti memakai produk.

**Exit:** release gate terpenuhi dan pengguna pilot dapat menyelesaikan alur tanpa bantuan pembuat produk untuk setiap sesi.

## Kapasitas dan tahap berikutnya

Estimasi total 14–18 minggu mengasumsikan dua engineer berpengalaman, dukungan QA paruh waktu, dan scope P0 tetap. Untuk solo builder, rencanakan sekitar 6–9 bulan sebagai estimasi kasar dengan ketidakpastian tinggi; angka ini belum divalidasi terhadap kapasitas tim nyata.

P1: Lottie adapter, Canvas command capture terarah, Spector integration, workflow sesi manual yang lebih nyaman. P2: Three.js semantic adapter lebih luas, extension/desktop packaging, cloud capture, dan browser lain. Sebelum distribusi, pin release dependency dan periksa lisensi sesuai penggunaan aktual; PRD ini tidak mengevaluasi ketentuan komersialnya.

# 17 — Risiko, keputusan terbuka, dan prioritas

## Risiko teknis yang menentukan

**Observasi mengubah perilaku.** Collector yang terlalu agresif dapat mengubah scheduling dan frame pacing. Mitigasi: natural pass, budget, mode diagnosis terpisah, dan overhead gate. Bila deep mode mengubah hasil, turunkan tingkat kepastian parameter timing dari pass tersebut.

**Akses runtime tidak lengkap.** ESM/private closure, navigasi cepat, frame isolation, atau late attach dapat menghilangkan sumber semantik. Mitigasi: lifecycle injection, adapter registrasi opsional pada situs milik sendiri, capability report, dan fallback visual. Jangan menonaktifkan pembatasan browser untuk mengejar label complete.

**Grafis tidak menjelaskan intent.** Spector mendukung OffscreenCanvas termasuk worker melalui setup yang sesuai, tetapi auto-injection memiliki batas pada worker tertentu dan CSP. Command capture tetap merupakan bukti operasi render; interpretasi scene atau logika aplikasi memerlukan lapisan tambahan. [Spector.js](https://github.com/BabylonJS/Spector.js/).

Canvas yang tidak origin-clean dapat menolak ekspor bitmap lewat API halaman. Tandai alasan kegagalan dan gunakan bukti screenshot browser yang tersedia; jangan menyamakan “terlihat di layar” dengan “asset dapat diekspor”. [HTML Canvas Standard](https://html.spec.whatwg.org/multipage/canvas.html).

**Reset dan replay tidak deterministik.** State server, random, timing resource, font, media, dan GPU dapat berubah. Mitigasi: simpan environment fingerprint, reset recipe, fixtures terkontrol, toleransi, dan multiple runs. Replay sesi tidak dianggap substitusi untuk pengujian perilaku baru.

**Perubahan API dan biaya adapter.** CDP Animation berlabel experimental. Pin browser dan protocol schema, lakukan feature detection, dan pertahankan compatibility matrix untuk versi yang diuji. [CDP Animation](https://chromedevtools.github.io/devtools-protocol/tot/Animation/).

## Keputusan yang perlu dibuat setelah spike

- Apakah subset GSAP bisa memenuhi gate dalam P0, atau sebagian harus tetap fallback sampai P1?

- Apakah rrweb menjadi recorder utama atau hanya viewer pendamping? Putuskan dari fidelity, overhead, dan kemampuan redaction yang diuji.

- Seberapa sering agent memerlukan source-assisted SDK untuk memperoleh hasil yang berguna pada target pengguna nyata?

- Berapa budget capture yang memberi manfaat terbaik dibanding trace + klip biasa?

- Packaging mana yang diminta pilot: integrasi CLI pada agent yang ada, atau workflow rekam manual melalui extension?

## Prioritas implementasi pertama

Mulai dari satu flow lengkap: buka halaman → hover/scroll → kontrak dengan bukti → implementasi agent → uji interruption dan reverse. Buktikan loop ini sebelum memperluas jumlah engine. Keputusan lanjut didasarkan pada perbaikan terhadap strong baseline, bukan jumlah event atau frame yang berhasil dikumpulkan.

# 18 — Catatan sumber

Seluruh sumber diakses 5 September 2026. “Tanpa tanggal” berarti halaman tidak menyediakan tanggal publikasi/update yang dapat diandalkan. Dokumentasi live dan README branch utama bukan bukti kompatibilitas setiap versi distribusi. Spesifikasi berstatus Working Draft dirujuk sebagai model teknis yang masih dapat berubah.

**Browser automation dan observasi**

- [Trace Viewer](https://playwright.dev/docs/trace-viewer) — Microsoft / Playwright, tanpa tanggal. Aksi, snapshot, filmstrip, dan network evidence.

- [BrowserContext: addInitScript](https://playwright.dev/docs/api/class-browsercontext#browser-context-add-init-script) — Microsoft / Playwright, tanpa tanggal. Injection sebelum script halaman dan pada child frame.

- [Clock](https://playwright.dev/docs/clock) — Microsoft / Playwright, tanpa tanggal. Cakupan API waktu yang dikendalikan.

- [Page: screenshot](https://playwright.dev/docs/api/class-page#page-screenshot) dan [PageAssertions: screenshots](https://playwright.dev/docs/api/class-pageassertions#page-assertions-to-have-screenshot-1) — Microsoft / Playwright, tanpa tanggal. Perbedaan opsi animasi dan efek disabling.

- [Recorder overview](https://developer.chrome.com/docs/devtools/recorder/overview) — Google Chrome, 15 Juli 2024. Record/replay dan ekspor user flow.

- [Content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts) — Google Chrome, dokumentasi live; tanggal halaman tidak dijadikan versi fitur. Isolated world dan page-world constraints.

**Browser protocol dan spesifikasi**

- [Animation domain](https://chromedevtools.github.io/devtools-protocol/tot/Animation/) — Chrome DevTools Protocol, tip-of-tree, tanpa tanggal; experimental. Lifecycle, unit timing, target, dan batas keyframe payload.

- [DOMSnapshot domain](https://chromedevtools.github.io/devtools-protocol/tot/DOMSnapshot/) — Chrome DevTools Protocol, tip-of-tree, tanpa tanggal. DOM/layout/computed style snapshot.

- [CSS domain](https://chromedevtools.github.io/devtools-protocol/tot/CSS/) — Chrome DevTools Protocol, tip-of-tree, tanpa tanggal. Matched CSS, pseudo styles, keyframe rules.

- [Target domain](https://chromedevtools.github.io/devtools-protocol/tot/Target/) — Chrome DevTools Protocol, tip-of-tree, tanpa tanggal. Target sessions dan recursive auto-attach.

- [Tracing domain](https://chromedevtools.github.io/devtools-protocol/tot/Tracing/) — Chrome DevTools Protocol, tip-of-tree, tanpa tanggal. Buffer dan indikasi data loss.

- [Web Animations](https://www.w3.org/TR/web-animations-1/) — W3C CSS Working Group, Working Draft, 5 Juni 2023. Keyframes, timing, composition, dan style-change processing.

- [High Resolution Time](https://www.w3.org/TR/hr-time-3/) — W3C Web Performance Working Group, Working Draft, 1 September 2026. Monotonic clock, time origins, precision, dan lintas-context timing.

# Catatan sumber — lanjutan

**Framework animasi dan grafis**

- [Timeline](https://gsap.com/docs/v3/GSAP/Timeline/) — GSAP, tanpa tanggal. Struktur timeline, child tweens, konfigurasi, dan lifecycle.

- [ScrollTrigger](https://gsap.com/docs/v3/Plugins/ScrollTrigger/) — GSAP, tanpa tanggal. Trigger/scroller, start/end, progress, scrub, pin, dan hubungan durasi dengan scroll-distance.

- [lottie-web README](https://github.com/airbnb/lottie-web) — Airbnb / lottie-web maintainers, tanpa tanggal. JSON asset, renderer, player configuration, segment dan kontrol playback.

- [Object3D](https://threejs.org/docs/pages/Object3D.html) — Three.js authors, tanpa tanggal. Scene hierarchy, transforms, traversal dan serialisasi.

- [AnimationMixer](https://threejs.org/docs/pages/AnimationMixer.html) — Three.js authors, tanpa tanggal. Clock mixer, clip action, update, dan setTime.

- [HTML Standard: Canvas](https://html.spec.whatwg.org/multipage/canvas.html) — WHATWG, Living Standard; halaman yang ditinjau diperbarui 4 September 2026. Canvas/OffscreenCanvas dan origin-clean restrictions.

**Rekaman dan diagnosis yang dapat digunakan kembali**

- [rrweb README](https://github.com/rrweb-io/rrweb) — rrweb maintainers, tanpa tanggal. Snapshot, mutations, interactions, replay, dan roadmap format AI.

- [rrweb Canvas recipe](https://github.com/rrweb-io/rrweb/blob/main/docs/recipes/canvas.md) — rrweb maintainers, tanpa tanggal. Opsi capture, image sampling, serta implikasi script pada Canvas replay.

- [Spector.js README](https://github.com/BabylonJS/Spector.js/) — BabylonJS contributors, tanpa tanggal. WebGL capture, OffscreenCanvas/worker, batas auto-injection, dan MCP.

## Batas penelitian

Penelusuran memprioritaskan spesifikasi dan dokumentasi first-party. Klaim inti tentang timing, ekstraksi native, scroll-domain, grafis, replay, dan produk terkait telah diperiksa pada sumber tersebut. Tidak dilakukan benchmark empiris, inspeksi target website tertentu, pengujian distribusi dependency, atau penilaian lisensi komersial.

Ketidakpastian yang tersisa terutama membutuhkan implementasi: lifetime animasi sangat singkat, akses instance privat, closed shadow/OOPIF, clock mapping, observer overhead, dan manfaat kontrak terhadap keberhasilan agent. Riset dokumenter dihentikan setelah bukti cukup untuk memilih arsitektur dan menempatkan ketidakpastian tersebut sebagai spike serta release gate.

Rekomendasi arsitektur, prioritas, skema, anggaran, metrik, dan jadwal dalam dokumen ini adalah sintesis desain. Sumber mendukung kemampuan serta keterbatasan komponen; sumber tidak membuktikan bahwa produk usulan sudah mencapai target tersebut.

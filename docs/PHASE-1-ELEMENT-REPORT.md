# Phase 1 Element Report — Cross Target Identity

## Outcome

Element registry sekarang mengikuti target dan navigation epoch. Capture fixture menghasilkan 13 element pada enam frame epochs; dedicated worker tidak memiliki DOM element. Element dari lifecycle epoch A tetap tersedia setelah navigasi, dan element epoch B tetap tersedia setelah detach.

Setiap entry berisi scoped ID, target/navigation ID, local document bounds, instance ordinal, ranked locator candidates, preferred selector, dan ambiguity status. SQLite sidecar mengindeks element sebagai tabel tersendiri dan inspection membandingkan row count dengan contract.

## Ambiguity Fixture

Lifecycle epoch B memuat dua button dengan `data-wbc-id` serta role yang sama dan tanpa DOM ID. Keduanya dilaporkan `ambiguous`, masing-masing memiliki match count dua dan ordinal 1/2. Sistem tidak mengubahnya menjadi unique hanya karena ordinal internal tersedia.

## Verification

- Semua element menunjuk target yang ada.
- Navigation ID element harus sama dengan target epoch.
- Preferred locator harus menjadi kandidat pertama serta konsisten dengan selector dan match count.
- Unique/ambiguous status harus sesuai match count.
- Lifecycle A dan B sama-sama memiliki retained element.
- Dua ambiguous button memiliki ID berbeda tetapi ambiguity tetap terlihat.
- SQLite element count harus sama dengan contract.

## Limitations and Next Gate

- Locator masih membutuhkan source-assisted `data-wbc-id` untuk behavior utama.
- Role belum membawa accessible name karena raw text belum aman untuk persistence.
- Bounds berada pada coordinate space dokumen target, belum diproyeksikan ke top-level viewport melalui frame chain.
- Ordinal ambiguous element dapat berubah ketika DOM direorder.
- Shadow DOM dan pseudo-element identity belum masuk registry.

Gate berikutnya adalah resolver yang menggabungkan candidate uniqueness, ancestry, geometry, dan optional redacted accessible-name fingerprint saat mencocokkan contract ke replika. Setelah resolver tidak lagi bergantung pada shared `data-wbc-id`, Fase 1 dapat ditutup dan service layer dimulai.

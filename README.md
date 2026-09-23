# Onya — Bot WhatsApp

Bot Node.js untuk balasan otomatis, konversi stiker, dan downloader video TikTok/Facebook. Menu, balasan, dan log memakai teks tanpa emoji. WhatsApp memakai Brave yang dideteksi otomatis di lokasi pemasangan standar. `CHROME_PATH` dapat diisi untuk lokasi khusus.

## Memperbarui bot yang sudah berjalan

1. Hentikan bot dengan **Ctrl+C** dan cadangkan kode yang pernah diedit sendiri.
2. Ekstrak paket ke folder terpisah. Salin isi folder `src`, `scripts`, serta file `package.json` ke `D:\Project\bot-whatsapp`, lalu pilih Replace untuk file yang sama. Gabungkan isi folder; jangan menghapus file proyek lain.
3. Pertahankan `.env` milikmu serta folder sesi login. Nama di `.env` sebaiknya `BOT_NAME=Onya`. Jangan menimpa `.env` dengan `.env.example`.
4. Jalankan di PowerShell:

   ```powershell
   cd D:\Project\bot-whatsapp
   node scripts/setup-downloader.js
   npm.cmd run doctor
   npm.cmd start
   ```

5. Tunggu `Onya aktif`, lalu kirim `!downloader` dari nomor WhatsApp lain.

Dependensi npm tetap sama; pembaruan ini tidak memerlukan `npm install` ulang. Pemasang mengambil executable yt-dlp resmi ke folder `tools`, memeriksa SHA-256, dan memilih arsitektur Windows secara otomatis. Python tidak diperlukan untuk executable Windows.

ID sesi internal lama dipertahankan agar login bisa digunakan kembali. Patch kompatibilitas ID pesan dan pengiriman media v2 sudah termasuk.

## Perbaikan startup Brave

Jika sebelumnya muncul `Could not find Chrome`, unduh ulang paket ini. Untuk proyek yang sudah memakai downloader Onya, cukup salin tiga file berikut dari ZIP ke lokasi yang sama dalam proyek:

- `src/browser.js` (baru)
- `src/index.js` (ganti)
- `scripts/doctor.js` (ganti)

Jalankan `npm.cmd start`. Pastikan muncul `[BOT-BROWSER] Menggunakan: ...brave.exe`.
Brave dicari pada Program Files, Program Files (x86), serta LocalAppData di Windows. Konfigurasi eksplisit yang benar tetap diprioritaskan. Jika `CHROME_PATH` salah, perbaiki nilainya atau kosongkan dengan `CHROME_PATH=` untuk memakai deteksi otomatis. Jika lokasi Brave tidak ditemukan, buka `brave://version` dan salin nilai Executable Path ke `.env`.

Tujuh pengujian tambahan untuk deteksi lokasi browser lulus. Pengujian ini tidak membuka Brave pada laptop pengguna.

## Perintah

| Perintah | Hasil |
| --- | --- |
| `halo` atau chat biasa | Balasan berdasarkan kata kunci; belum memakai AI |
| `!menu` / `!help` | Daftar fitur |
| `!ping` | Memeriksa respons bot |
| Foto/video + caption `!sticker` / `!stiker` / `!s` | Stiker; bisa juga membalas media dengan perintah |
| Balas stiker dengan `!toimg` / `!gambar` | PNG; stiker bergerak diambil frame pertama |
| Balas stiker bergerak dengan `!tovideo` | MP4 tanpa suara |
| `!downloader` | Panduan unduh URL |
| `!tiktok <url>` / `!tt <url>` | MP4 dari video TikTok publik |
| `!facebook <url>` / `!fb <url>` | MP4 dari video/Reel Facebook publik |

Ganti `<url>` dengan tautan asli tanpa tanda kurung. Contoh bentuk perintah berikut hanya ilustrasi:

```text
!tt https://www.tiktok.com/@namaakun/video/1234567890
!fb https://www.facebook.com/reel/1234567890/
```

Tautan pendek TikTok `vt.tiktok.com`, `vm.tiktok.com`, dan `www.tiktok.com/t/...` dikenali. Untuk `fb.watch`, `facebook.com/share/v/...`, atau `/share/r/...`, bot mencoba pengalihan resmi ke alamat video. Jika situs meminta login atau tidak mengalihkan alamat, gunakan URL lengkap dari browser. Profil, album foto, dan siaran langsung belum didukung.

Hasil downloader selalu berupa **dokumen MP4** agar cocok dengan alur Brave. Buka/unduh dokumen untuk memutar video. Suara dipertahankan jika tersedia dari sumber. Kualitas dipilih mendekati 720p berdasarkan format tersedia, bukan jaminan resolusi tepat 720p.

## Pemakaian RAM dan penyimpanan

- Maksimal hasil downloader **16 MB**, diperiksa sebelum dibaca ke RAM.
- Satu downloader sekaligus, ikut memakai batas global dua pekerjaan media serta satu pekerjaan per chat. Permintaan saat sibuk diberi pemberitahuan dan tidak diantrekan.
- Batas waktu mengambil video **180 detik**, termasuk pengalihan URL. Waktu pengiriman oleh WhatsApp tidak termasuk batas ini.
- Durasi sumber maksimal **600 detik** jika informasi durasi tersedia.
- File diunduh ke direktori sementara sistem; FFmpeg menggabungkan video+audio bila diperlukan. Ukuran hasil diperiksa lagi karena ukuran tidak selalu diketahui sebelum transfer.
- File sementara dipantau setiap 250 ms, dengan ambang tiga kali batas hasil (bawaan sekitar **48 MB**). Ukuran dapat melewati ambang sebentar sebelum proses dihentikan; ini bukan kuota disk mutlak.
- File sementara dibersihkan setelah berhasil, gagal, timeout, dan penghentian normal. Penutupan paksa atau listrik mati dapat meninggalkan file sementara.
- RAM tetap digunakan Node.js, Brave, yt-dlp, FFmpeg, dan data hasil saat pengiriman.

Tidak memerlukan API key atau cookies browser. Bot mencoba konten yang tersedia tanpa login. Video publik pun bisa gagal karena pembatasan akses/wilayah, permintaan login, atau perubahan situs.

## Pengaturan

Edit `.env`, lalu mulai ulang bot. Pengaturan baru tetap memakai nilai bawaan meskipun belum ditambahkan ke `.env` lama.

| Pengaturan | Bawaan | Fungsi |
| --- | --- | --- |
| `BOT_NAME` | Onya | Nama menu/balasan |
| `STICKER_PACK` | Stiker Onya | Nama paket stiker |
| `STICKER_AUTHOR` | Destian | Nama pembuat stiker |
| `AUTO_REPLY` | true | Balas chat biasa |
| `ALLOW_GROUPS` | false | Aktifkan perintah dalam grup |
| `COOLDOWN_SECONDS` | 2 | Jeda balasan per pengirim |
| `MAX_MEDIA_MB` | 16 | Batas masukan konversi, 1–32 MB |
| `MAX_STICKER_SECONDS` | 6 | Bagian awal video untuk stiker, 1–10 detik |
| `VIDEO_AS_DOCUMENT` | true | Hasil `!tovideo` sebagai dokumen |
| `MAX_DOWNLOAD_MB` | 16 | Batas hasil downloader, 1–32 MB |
| `DOWNLOAD_TIMEOUT_SECONDS` | 180 | Batas waktu unduhan, 30–300 detik |
| `MAX_DOWNLOAD_SECONDS` | 600 | Batas durasi jika diketahui, 10–1800 detik |
| `YTDLP_PATH` | kosong | Executable khusus; bawaan `tools/yt-dlp.exe`, lalu PATH |
| `CHROME_PATH` | kosong | Kosong: deteksi otomatis Brave; isi untuk lokasi khusus |
| `FFMPEG_PATH` | kosong | FFmpeg khusus; bawaan `ffmpeg-static` atau PATH |

Contoh lokasi Brave:

```dotenv
BOT_NAME=Onya
CHROME_PATH=C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe
VIDEO_AS_DOCUMENT=true
```

## Memasang dari awal

Gunakan Node.js 22 atau lebih baru. Ekstrak seluruh paket dan jalankan dari folder proyek:

```powershell
$env:PUPPETEER_SKIP_DOWNLOAD="true"
npm.cmd install
Copy-Item .env.example .env
```

Brave di lokasi standar dideteksi otomatis. Jika memakai lokasi khusus, isi `CHROME_PATH` di `.env`. Lalu ikuti perintah pemasangan downloader dan startup di atas. Pindai QR melalui WhatsApp > Perangkat tertaut. Laptop dan proses bot harus tetap menyala.

## Jika bermasalah

| Masalah | Langkah |
| --- | --- |
| PowerShell memblokir `npm.ps1` | Gunakan `npm.cmd` |
| Downloader belum terpasang | Jalankan `node scripts/setup-downloader.js` |
| Pemasang gagal mengakses GitHub | Ulangi setelah koneksi pulih, atau pasang executable resmi secara manual |
| Link privat/meminta login | Gunakan video publik lain yang dapat dibuka tanpa login |
| Link pendek Facebook tidak terurai | Salin URL `/reel/ID` atau `/watch/?v=ID` dari browser |
| Tidak ada MP4 sesuai batas | Coba video lebih kecil |
| Downloader mendadak gagal | Hentikan bot, jalankan pemasang lagi untuk memperbarui yt-dlp, lalu mulai ulang |
| FFmpeg tidak tersedia | Jalankan `npm.cmd rebuild ffmpeg-static` atau isi `FFMPEG_PATH` |
| Unduh berhasil tetapi kirim gagal | Kirim log terbaru tahap `mengirim hasil downloader ke WhatsApp` |
| Bot tidak merespons | Tunggu status aktif, uji dari nomor lain, beri jeda dua detik |

Manual Windows: unduh `yt-dlp.exe` x64 dari [rilis resmi](https://github.com/yt-dlp/yt-dlp/releases/latest), tempatkan sebagai `D:\Project\bot-whatsapp\tools\yt-dlp.exe`. Windows ARM64 memakai `yt-dlp_arm64.exe` yang diubah namanya menjadi `yt-dlp.exe`. Jika `YTDLP_PATH` diisi, bot memakai file pada path tersebut, sehingga pembaruannya perlu diarahkan ke file yang sama.

Pembaruan executable dilakukan pemilik bot melalui terminal; perintah chat tidak memasang executable.

## Struktur kode dan pengujian

| File | Tanggung jawab |
| --- | --- |
| `src/index.js` | Koneksi, QR, sesi, event, penghentian bot |
| `src/config.js` | Membaca dan memeriksa konfigurasi |
| `src/browser.js` | Memilih path eksplisit atau mendeteksi Brave otomatis |
| `src/handler.js` | Menu, perintah, pembatasan pekerjaan, pengiriman balasan |
| `src/media.js` | Konversi gambar, stiker, video |
| `src/downloader.js` | Validasi URL, yt-dlp, batas sumber daya, pembersihan file |
| `src/whatsapp-compat.js` | Patch ID/pengiriman media untuk whatsapp-web.js 1.34.7 |
| `scripts/setup-downloader.js` | Mengunduh dan memverifikasi yt-dlp resmi |
| `scripts/doctor.js` | Memeriksa dependensi tanpa login atau mengirim pesan |
| `test/` | Pengujian otomatis |

```powershell
npm.cmd test
```

Tes CLI memakai yt-dlp dan FFmpeg asli dengan server lokal, bukan video TikTok/Facebook sungguhan. Tes tersebut dilewati bila executable lokal belum dipasang. Pengujian lain meliputi URL salah, pengalihan domain, ukuran, timeout, pembatalan, pembersihan file, konversi, dan penanganan kegagalan. Pengiriman WhatsApp disimulasikan; login serta penerimaan hasil perlu dicoba pada akun pengguna.

`whatsapp-web.js` adalah library tidak resmi. Perubahan WhatsApp Web atau situs sumber dapat memengaruhi kompatibilitas. Konversi stiker tidak dapat mengembalikan kualitas asli atau suara yang sudah hilang.

## Referensi

- [yt-dlp dan dokumentasinya](https://github.com/yt-dlp/yt-dlp)
- [Situs yang didukung yt-dlp](https://github.com/yt-dlp/yt-dlp/blob/master/supportedsites.md)
- [whatsapp-web.js](https://github.com/wwebjs/whatsapp-web.js)
- [Bug ID internal media](https://github.com/wwebjs/whatsapp-web.js/issues/201922)
- [Sharp](https://sharp.pixelplumbing.com/)
- [FFmpeg](https://ffmpeg.org/)

Pembaruan disiapkan 23 September 2026.
#   B o t - w h a t s a p p - - - O n y a  
 
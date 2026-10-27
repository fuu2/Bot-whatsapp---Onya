# Onya — Bot WhatsApp

Bot Node.js untuk balasan otomatis, pengingat jadwal, konversi stiker, video TikTok/Facebook/YouTube, dan audio MP3 YouTube/TikTok. Menu, balasan, dan log memakai teks tanpa emoji. WhatsApp memakai Brave yang dideteksi otomatis di lokasi pemasangan standar. `CHROME_PATH` dapat diisi untuk lokasi khusus.

## Pembaruan: pengingat pribadi

Onya dapat menyimpan jadwal lalu mengirim pesan ke chat pribadi yang meminta pengingat. Contoh untuk presensi online:

```text
!ingatkan 07:30 presensi online
```

Bot membalas tanggal, jam, zona waktu, dan ID pengingat setelah data berhasil disimpan. Pada waktunya, Onya mengirim pesan pengingat agar kamu membuka dan mengisi presensi.

| Pesan ke Onya | Jadwal |
| --- | --- |
| `!ingatkan 07:30 presensi online` | Sekali pada 07:30 berikutnya |
| `!ingatkan besok 07:30 presensi online` | Sekali besok |
| `!ingatkan 25-09-2026 07:30 presensi online` | Sekali pada tanggal tertentu |
| `!ingatkan setiap hari 07:30 presensi online` | Harian sampai dibatalkan |
| `!ingatkan 5 menit cek presensi` | Sekali, lima menit setelah pesan diproses |
| `ingatkan saya untuk presensi online jam 07:30` | Bentuk kalimat sederhana, sekali |
| `!pengingat` | Daftar pengingat milik chat ini |
| `!hapus-pengingat ID` | Batalkan ID yang ada pada konfirmasi/daftar |
| `!bantuan-pengingat` | Panduan lengkap |

Gunakan format 24 jam: `07:30` pagi, `19:30` malam. Tanpa tanggal, jam yang sudah lewat dijadwalkan besok dan tanggalnya ditampilkan dalam konfirmasi. Tanggal eksplisit yang telah lewat ditolak. Kata `setiap hari` diperlukan untuk membuat pengingat berulang. Pemahaman kalimat memakai pola contoh di atas, bukan AI bahasa bebas.

Waktu bawaan **WIB** meskipun laptop atau VPS memakai zona lain. Pengaturan opsional dalam `.env`:

```dotenv
REMINDER_TIMEZONE=Asia/Jakarta
```

Pilihan lain: `Asia/Makassar` (WITA) atau `Asia/Jayapura` (WIT). Zona per pengingat juga bisa ditulis sesudah jam: `!ingatkan 08:30 WITA presensi online`. Perubahan zona bawaan tidak menggeser jadwal yang sudah disimpan.

Untuk memasang pembaruan, hentikan bot, salin seluruh isi folder `src` dari paket ke `D:\Project\bot-whatsapp\src`, lalu jalankan `npm.cmd start`. Pastikan file baru `reminder-time.js` dan `reminders.js` ikut tersalin dan terminal menampilkan `[BOT-REMINDER v1]`. Tidak memerlukan paket npm baru. Pertahankan `.env`, sesi login, dan folder `data` yang sudah ada. Salin folder `test` untuk menjalankan pengujian terbaru.

### Penyimpanan dan waktu pengiriman

- Jadwal disimpan otomatis dalam `data/reminders.json`, bukan hanya di RAM. Folder/file dibuat saat ada jadwal yang disimpan. Data bertahan setelah restart normal dan tidak dimasukkan ke ZIP pembaruan.
- Onya harus menyala, tidak sleep, dan tersambung ke WhatsApp pada waktu pengiriman. Jam laptop/server harus benar. Penjadwal memeriksa tiap satu detik; antrean, internet, dan WhatsApp dapat menyebabkan keterlambatan.
- Jika bot mati, pengingat sekali yang terlewat dikirim setelah bot aktif lagi dengan keterangan terlambat. Pengingat harian mengirim satu jadwal terlewat paling baru, lalu melanjutkan jadwal berikutnya; tidak mengirim tumpukan pesan untuk semua hari yang terlewat.
- Maksimal 20 jadwal per chat, 1.000 pada satu bot, isi 500 karakter, dan waktu eksplisit maksimal 366 hari ke depan. Pengingat relatif mendukung menit/jam sampai tujuh hari. Pengingat harian terus berulang sampai dibatalkan.
- Pengingat hanya tersedia dalam chat pribadi. Pengguna hanya dapat melihat dan membatalkan jadwal pada chatnya sendiri. Nomor tujuan diambil dari chat peminta.
- Pengiriman gagal dicoba ulang dengan jeda satu menit, maksimal tiga percobaan per kejadian. Pengingat sekali yang tetap gagal dapat dilihat di `!pengingat`; hapus dan buat ulang jika diperlukan. Pengingat harian yang gagal melanjutkan kejadian hari berikutnya.
- Jika proses terputus saat mengirim atau setelah pengiriman sebelum hasil tersimpan, status bisa menjadi `pengiriman terputus`. Periksa pesan yang sudah masuk, kemudian hapus dan buat ulang jadwal jika perlu. Penyimpanan lokal dan WhatsApp bukan satu transaksi, sehingga pengiriman tepat sekali tidak dijamin pada kegagalan jaringan/proses.
- Jalankan satu proses Onya untuk satu folder proyek/data. Ketika pindah server, salin data dengan bot dihentikan dan gunakan penyimpanan permanen.

## Pembaruan: pemutar langsung di WhatsApp

Hasil downloader kini dikirim sebagai pesan video atau audio dengan tombol putar. MP3 dikirim sebagai audio biasa, bukan voice note. Perintah tetap sama: `!tt`, `!fb`, `!ytmp4`, `!ytmp3`, dan `!ttaudio`.

Jika versi downloader sebelumnya sudah berjalan, hentikan bot dengan Ctrl+C, salin **seluruh isi folder `src`** dari ZIP ke `D:\Project\bot-whatsapp\src`, lalu tambahkan atau ubah baris berikut dalam **`.env`**:

```dotenv
DOWNLOAD_AS_DOCUMENT=false
```

Nilai bawaan juga `false` jika baris tersebut belum ada. `VIDEO_AS_DOCUMENT` hanya mengatur konversi stiker `!tovideo`; pengaturan downloader memakai `DOWNLOAD_AS_DOCUMENT`. Mulai ulang dengan `npm.cmd start`, pastikan muncul `[BOT-DOWNLOADER v3] Pengiriman hasil: pemutar video/audio WhatsApp.`. Tidak perlu memasang dependensi atau yt-dlp ulang hanya untuk perubahan tampilan ini. Salin folder `test` juga jika ingin menjalankan tes terbaru.

File yang sudah terkirim sebagai dokumen tidak berubah. Kirim ulang perintah downloader untuk memperoleh pesan video/audio baru. WhatsApp dapat menampilkan tombol unduh terlebih dahulu sesuai pengaturan unduh otomatis pada ponsel.

## Memperbarui bot yang sudah berjalan

1. Hentikan bot dengan **Ctrl+C** dan cadangkan kode yang pernah diedit sendiri.
2. Ekstrak paket ke folder terpisah. Salin isi folder `src`, `scripts`, `test`, serta file `package.json` dan `README.md` ke `D:\Project\bot-whatsapp`, lalu pilih Replace untuk file yang sama. Salin seluruh isi `src`, termasuk file baru `download-url.js`. Gabungkan isi folder; jangan menghapus file proyek lain.
3. Pertahankan `.env` milikmu, folder `data`, serta folder sesi login. Nama di `.env` sebaiknya `BOT_NAME=Onya`. Jangan menimpa `.env` dengan `.env.example`.
4. Jalankan di PowerShell:

   ```powershell
   cd D:\Project\bot-whatsapp
   node scripts/setup-downloader.js
   npm.cmd run doctor
   npm.cmd start
   ```

5. Pastikan terminal menampilkan `[BOT-DOWNLOADER v3]` dan `[BOT-BROWSER] Menggunakan: ...brave.exe`. Tunggu `Onya aktif`, lalu kirim `!downloader` dari nomor WhatsApp lain.

Dependensi npm tetap sama; pembaruan ini tidak memerlukan `npm install` ulang. Pemasang mengambil executable yt-dlp resmi ke folder `tools`, memeriksa SHA-256, dan memilih arsitektur Windows secara otomatis. Python tidak diperlukan untuk executable Windows.

YouTube memerlukan JavaScript runtime. Bot memakai Node.js 22 atau lebih baru yang sudah menjalankan bot; executable yt-dlp resmi menyertakan komponen EJS. Gunakan pemasang di atas agar downloader ikut diperbarui. Jika `YTDLP_PATH` diisi, perbarui executable pada lokasi tersebut atau kosongkan untuk memakai file di folder `tools`.

ID sesi internal lama dipertahankan agar login bisa digunakan kembali. Patch kompatibilitas ID pesan dan pengiriman media v2 sudah termasuk.

## Perbaikan Facebook dan Brave

Resolver Facebook diperbarui untuk:

- menerima link bagikan `/share/ID`, `/share/v/ID`, `/share/r/ID`, `/share/p/ID`, serta tautan postingan video;
- mempertahankan host mobile saat redirect, sehingga bot tidak mengubahnya kembali menjadi `www` dan memicu putaran pengalihan;
- menyimpan cookie pengunjung hanya selama satu resolusi, serta membaca alamat video dari metadata halaman bila server membalas HTML;
- menghentikan putaran pengalihan dan memberi pesan khusus saat halaman meminta login.

Perubahan ini memperbaiki kelemahan pada resolver lama. Keberhasilan pada setiap video Facebook bergantung pada akses sumber. Tautan postingan tetap harus berisi video; foto tidak diubah menjadi video. Jika link tertentu tetap gagal, kirim URL lengkap beserta log terbaru untuk diperiksa.

Jika sebelumnya muncul `Could not find Chrome`, salin seluruh pembaruan sesuai langkah di atas. Jalankan `npm.cmd start` dan pastikan muncul `[BOT-BROWSER] Menggunakan: ...brave.exe`.
Brave dicari pada Program Files, Program Files (x86), serta LocalAppData di Windows. Konfigurasi eksplisit yang benar tetap diprioritaskan. Jika `CHROME_PATH` salah, perbaiki nilainya atau kosongkan dengan `CHROME_PATH=` untuk memakai deteksi otomatis. Jika lokasi Brave tidak ditemukan, buka `brave://version` dan salin nilai Executable Path ke `.env`.

## Perintah

| Perintah | Hasil |
| --- | --- |
| `halo` atau chat biasa | Balasan berdasarkan kata kunci; belum memakai AI |
| `!menu` / `!help` | Daftar fitur |
| `!ping` | Memeriksa respons bot |
| `!ingatkan 07:30 presensi online` | Membuat pengingat pribadi |
| `!pengingat` / `!hapus-pengingat ID` | Melihat atau membatalkan jadwal |
| `!bantuan-pengingat` | Panduan pengingat sekali/harian |
| Foto/video + caption `!sticker` / `!stiker` / `!s` | Stiker; bisa juga membalas media dengan perintah |
| Balas stiker dengan `!toimg` / `!gambar` | PNG; stiker bergerak diambil frame pertama |
| Balas stiker bergerak dengan `!tovideo` | MP4 tanpa suara |
| `!downloader` | Panduan unduh URL |
| `!tiktok <url>` / `!tt <url>` | MP4 dari video TikTok publik |
| `!facebook <url>` / `!fb <url>` | MP4 dari video/Reel Facebook publik |
| `!ytmp4 <url>` / `!yt <url>` / `!youtube <url>` | MP4 dari YouTube atau Shorts |
| `!ytmp3 <url>` / `!ytaudio <url>` | Audio video YouTube menjadi MP3 |
| `!ttaudio <url>` / `!ttmp3 <url>` / `!tiktokaudio <url>` | Audio video TikTok menjadi MP3 |

Ganti `<url>` dengan tautan asli tanpa tanda kurung. Contoh bentuk perintah berikut hanya ilustrasi:

```text
!tt https://www.tiktok.com/@namaakun/video/1234567890
!fb https://www.facebook.com/reel/1234567890/
!ytmp4 https://www.youtube.com/watch?v=ID_VIDEO_11
!ytmp3 https://youtu.be/ID_VIDEO_11
!ttaudio https://www.tiktok.com/@namaakun/video/1234567890
```

Contoh tersebut memakai ID pengganti, bukan tautan unduhan siap pakai. YouTube menerima link `watch?v=...`, `youtu.be/...`, `shorts/...`, dan YouTube Music yang menunjuk satu video. Jika URL video juga menyertakan playlist, hanya video yang ditunjuk yang diambil. URL playlist tanpa ID video ditolak.

Tautan pendek TikTok `vt.tiktok.com`, `vm.tiktok.com`, dan `www.tiktok.com/t/...` dikenali. Untuk `fb.watch` dan link bagikan Facebook, bot mencoba pengalihan resmi ke alamat video. Jika situs meminta login atau tidak memuat alamat video, gunakan URL lengkap dari browser. Profil, album foto, playlist, dan siaran langsung belum didukung. Perintah audio TikTok memakai URL video yang memuat suara, bukan halaman kumpulan sound.

Hasil downloader secara bawaan berupa **video atau audio dengan pemutar WhatsApp**. Video dinormalisasi dengan FFmpeg ke MP4 H.264 Main, yuv420p, 30 fps, dan audio AAC jika sumber memiliki suara. Rasio tampilan dipertahankan dengan sisi panjang maksimal 1280 piksel dan sisi pendek maksimal 720 piksel. Indeks MP4 ditempatkan di depan file (`faststart`). Proses ini dapat menurunkan kualitas sedikit dan memakai CPU tambahan; video tidak sengaja dipotong untuk mengejar batas ukuran. Hasil yang masih terlalu besar ditolak dengan pemberitahuan.

MP3 dikonversi menjadi 128 kbps lalu dikirim sebagai audio biasa. Video tanpa suara ditolak saat konversi MP3. FFmpeg bawaan cukup; ffprobe terpisah tidak diperlukan. Jika pemilik bot mengatur `DOWNLOAD_AS_DOCUMENT=true`, hasil dikirim sebagai dokumen dan penyesuaian codec video dilewati.

Saat bot aktif, `[BOT-CODEC]` mencatat dukungan H.264, AAC, dan MP3 yang dilaporkan browser. Ini pemeriksaan kemampuan browser, bukan jaminan pengiriman atau penerimaan WhatsApp. Brave yang telah dikonfigurasi tetap dipakai. Dokumentasi whatsapp-web.js menyebut Google Chrome untuk pengiriman video; jika Brave melaporkan codec tidak didukung atau tetap gagal mengirim, sertakan log tahap pengiriman dan `[BOT-CODEC]` saat meminta bantuan. Jangan mengganti browser default Windows hanya untuk menjalankan bot; executable bot ditentukan lewat `CHROME_PATH`.

## Pemakaian RAM dan penyimpanan

- Maksimal file sumber dan hasil downloader **16 MB** masing-masing. Hasil diperiksa sebelum dibaca ke RAM; sumber audio juga diperiksa sebelum konversi.
- Satu downloader sekaligus, ikut memakai batas global dua pekerjaan media serta satu pekerjaan per chat. Permintaan saat sibuk diberi pemberitahuan dan tidak diantrekan.
- Batas waktu mengambil media **180 detik**, termasuk pengalihan URL serta konversi MP4/MP3. Waktu pengiriman oleh WhatsApp tidak termasuk batas ini.
- Durasi sumber maksimal **600 detik** jika informasi durasi tersedia.
- File diunduh ke direktori sementara sistem; FFmpeg menggabungkan video+audio, menyesuaikan codec video untuk pemutar, atau mengubah audio menjadi MP3. Ukuran hasil diperiksa lagi karena ukuran tidak selalu diketahui sebelum transfer.
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
| `REMINDER_TIMEZONE` | Asia/Jakarta | Zona bawaan pengingat: WIB; Makassar untuk WITA, Jayapura untuk WIT |
| `MAX_MEDIA_MB` | 16 | Batas masukan konversi, 1–32 MB |
| `MAX_STICKER_SECONDS` | 6 | Bagian awal video untuk stiker, 1–10 detik |
| `VIDEO_AS_DOCUMENT` | true | Hasil `!tovideo` sebagai dokumen |
| `DOWNLOAD_AS_DOCUMENT` | false | false: pemutar video/audio untuk hasil downloader; true: dokumen |
| `MAX_DOWNLOAD_MB` | 16 | Batas file sumber dan hasil downloader, 1–32 MB masing-masing |
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
DOWNLOAD_AS_DOCUMENT=false
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
| Facebook masih mengulang pengalihan | Pastikan semua file `src` diganti, perbarui yt-dlp, lalu kirim URL yang gagal dan log terbaru |
| YouTube meminta verifikasi | Perbarui yt-dlp, cek Node.js 22+, coba video publik lain; bot tidak memasukkan akun/cookies |
| Tidak ada format sesuai batas | Coba video lebih pendek/kecil; batas juga berlaku pada sumber audio |
| Video tidak memiliki suara | Gunakan video lain yang memiliki trek audio |
| Downloader mendadak gagal | Hentikan bot, jalankan pemasang lagi untuk memperbarui yt-dlp, lalu mulai ulang |
| FFmpeg tidak tersedia | Jalankan `npm.cmd rebuild ffmpeg-static` atau isi `FFMPEG_PATH` |
| Unduh berhasil tetapi kirim gagal | Kirim log terbaru tahap `mengirim hasil downloader ke WhatsApp` |
| Downloader masih tampil sebagai dokumen | Pastikan kode v3 terpasang, `DOWNLOAD_AS_DOCUMENT=false` di `.env`, lalu restart dan kirim perintah baru |
| Video gagal disiapkan untuk pemutar | Periksa FFmpeg melalui doctor; log tahap konversi menunjukkan penyebab dan hasil tidak dikirim jika terlalu besar |
| Video/audio gagal terkirim dengan pemutar | Sertakan log pengiriman serta `[BOT-CODEC]`; browser perlu mendukung codec media |
| Bot tidak merespons | Tunggu status aktif, uji dari nomor lain, beri jeda dua detik |
| Pengingat belum masuk | Periksa `!pengingat`, konfirmasi tanggal/zona, koneksi dan jam perangkat; laptop harus tetap menyala |
| Data pengingat tidak bisa dibaca | Simpan salinan `data/reminders.json`, periksa format/izin; bot tidak menimpa file yang rusak dengan daftar kosong |

Manual Windows: unduh `yt-dlp.exe` x64 dari [rilis resmi](https://github.com/yt-dlp/yt-dlp/releases/latest), tempatkan sebagai `D:\Project\bot-whatsapp\tools\yt-dlp.exe`. Windows ARM64 memakai `yt-dlp_arm64.exe` yang diubah namanya menjadi `yt-dlp.exe`. Jika `YTDLP_PATH` diisi, bot memakai file pada path tersebut, sehingga pembaruannya perlu diarahkan ke file yang sama.

Pembaruan executable dilakukan pemilik bot melalui terminal; perintah chat tidak memasang executable.

## Struktur kode dan pengujian

| File | Tanggung jawab |
| --- | --- |
| `src/index.js` | Koneksi, QR, sesi, event, penghentian bot |
| `src/config.js` | Membaca dan memeriksa konfigurasi |
| `src/reminder-time.js` | Membaca perintah waktu, zona Indonesia, dan format tanggal |
| `src/reminders.js` | Menyimpan jadwal, mengirim pengingat, daftar/pembatalan dan pemulihan restart |
| `src/browser.js` | Memilih browser dan memeriksa laporan dukungan codec media |
| `src/handler.js` | Menu, perintah, pembatasan pekerjaan, pengiriman balasan |
| `src/media.js` | Konversi gambar, stiker, video |
| `src/download-url.js` | Validasi URL tiga platform dan resolusi tautan bagikan Facebook |
| `src/downloader.js` | yt-dlp, konversi MP3/MP4 untuk pemutar, batas sumber daya, pembersihan file |
| `src/whatsapp-compat.js` | Patch ID/pengiriman media untuk whatsapp-web.js 1.34.7 |
| `scripts/setup-downloader.js` | Mengunduh dan memverifikasi yt-dlp resmi |
| `scripts/doctor.js` | Memeriksa dependensi tanpa login atau mengirim pesan |
| `test/` | Pengujian otomatis |

```powershell
npm.cmd test
```

86 pengujian lulus saat paket ini disiapkan. Sebanyak 18 pengujian pengingat memeriksa parsing jam/tanggal, WIB/WITA/WIT, jadwal sekali/harian, restart dan keterlambatan, pembatalan oleh pemilik, batas kuota, penulisan bersamaan, kerusakan file, kegagalan kirim, serta alur perintah WhatsApp. Jam dipercepat dalam simulasi agar pengujian tidak menunggu berhari-hari. Pengiriman pesan menggunakan pengganti klien; akun WhatsApp pengguna belum diuji langsung.

Tes CLI memakai yt-dlp dan FFmpeg asli dengan server lokal untuk menggabungkan MP4, membuat MP3, dan menolak konversi MP3 dari video tanpa suara. Video sumber sengaja memakai codec MPEG-4 Part 2 dengan orientasi portrait dan 60 fps; hasil diperiksa menjadi H.264 Main/yuv420p, AAC, 30 fps, dengan rasio tetap dan indeks `moov` sebelum `mdat`. Tes pengiriman memeriksa video/audio biasa, opsi dokumen eksplisit, dan kompatibilitas ID media untuk audio.

Akses situs diganti metadata lokal; tes ini tidak membuktikan akses ke video tertentu di Facebook, YouTube, atau TikTok. Tes CLI dilewati bila executable lokal belum dipasang. Pengujian lain meliputi URL salah, pengalihan domain/mobile, cookie pengunjung, metadata halaman, ukuran, timeout, pembatalan, pembersihan file, konversi, dan penanganan kegagalan. Pengiriman WhatsApp disimulasikan; login, penerimaan hasil, dan tampilan pemutar pada perangkat pengguna perlu dicoba langsung.

`whatsapp-web.js` adalah library tidak resmi. Perubahan WhatsApp Web atau situs sumber dapat memengaruhi kompatibilitas. Konversi stiker tidak dapat mengembalikan kualitas asli atau suara yang sudah hilang.

## Referensi

- [yt-dlp dan dokumentasinya](https://github.com/yt-dlp/yt-dlp)
- [JavaScript runtime dan EJS untuk YouTube](https://github.com/yt-dlp/yt-dlp/wiki/EJS)
- [Situs yang didukung yt-dlp](https://github.com/yt-dlp/yt-dlp/blob/master/supportedsites.md)
- [whatsapp-web.js](https://github.com/wwebjs/whatsapp-web.js)
- [Opsi pengiriman media whatsapp-web.js](https://docs.wwebjs.dev/global.html#MessageSendOptions)
- [Dukungan fitur dan browser untuk video](https://docs.wwebjs.dev/)
- [Bug ID internal media](https://github.com/wwebjs/whatsapp-web.js/issues/201922)
- [Sharp](https://sharp.pixelplumbing.com/)
- [FFmpeg](https://ffmpeg.org/)
- [Timer Node.js dan keterbatasan ketepatan waktu](https://nodejs.org/api/timers.html)

Pembaruan disiapkan 24 September 2026.

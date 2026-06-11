# Sistem Presensi Disiplin Siswa Berbasis QR Code

Aplikasi sederhana untuk presensi siswa menggunakan QR code, deteksi terlambat otomatis, pengiriman notifikasi WhatsApp simulasi, statistik realtime, dan laporan export.

## Fitur utama
- Login admin minimalis
- CRUD data siswa
- Monitoring realtime dan statistik kelas
- Grafik keterlambatan realtime
- Generator QR code per kelas
- Anti double scan harian
- Validasi GPS siswa saat presensi dalam radius 10 meter dari sekolah
- Simulasi WhatsApp otomatis untuk siswa dan orang tua ketika terlambat
- Poin pelanggaran otomatis
- Export laporan Excel dan PDF
- Responsive mobile

## Instalasi

1. Buka terminal di folder `d:\KANCIL`
2. Jalankan `npm install`
3. Jalankan `npm start`
4. Buka `http://localhost:3000`
5. $env:PORT=3001; npm start #untuk menjalankan server

### Mengganti port

- Di Command Prompt / PowerShell (sementara):
  - PowerShell: `$env:PORT=3001; npm start`
  - Command Prompt: `set PORT=3001 && npm start`
- Atau set `PORT` ke angka lain sesuai kebutuhan.

## Akun admin
- Username: `admin`
- Password: `admin123`

## Catatan
- Integrasi WhatsApp otomatis dapat menggunakan `wa.me` sebagai fallback ketika API WhatsApp tidak dikonfigurasi.
- Untuk mengaktifkan WhatsApp API nyata, set environment variable:
  - `WHATSAPP_API_URL` — URL endpoint API WhatsApp
  - `WHATSAPP_API_TOKEN` — token Bearer untuk otentikasi API
- Jika API tidak disediakan, sistem akan menghasilkan tautan `wa.me` pada log server dan tidak mengirim pesan secara otomatis.
- Admin dapat melihat halaman `Status Notifikasi` di sidebar untuk memantau riwayat WhatsApp, provider, dan tautan wa.me.
- QR code kelas dibuat otomatis di halaman kelas.

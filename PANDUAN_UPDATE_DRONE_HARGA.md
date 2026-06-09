# 🚁 Update: Drone + Harga di Laptop & HP

## Apa yang berubah

### ✨ Fitur baru
- **Drone** — tipe inventaris baru, paralel dengan kendaraan, printer, laptop, HP
- **Harga beli + tanggal beli** di **Laptop Inventaris** & **Handphone** (sebelumnya hanya kendaraan & printer yang sudah punya)

### 🔧 Yang konsisten dengan sistem existing
- 1 karyawan = 1 drone aktif (cleanup otomatis pas reassign, sama kayak laptop/HP)
- Riwayat pemakaian drone otomatis ter-log via `logRiwayatChange()`
- Drone ikut ke-snapshot di stock opname bulanan
- Drone & total nilai aset masuk ke dashboard statistik & laporan bulanan
- Format harga "Rp xxx.xxx" + handling NULL ("Belum diinput")

---

## 🚀 Cara apply update (urutan WAJIB diikuti)

### Step 1: Backup database (paranoid mode — recommended)
```bash
mysqldump -u root karyawan_db > backup_sebelum_drone.sql
```

### Step 2: Run migration SQL
File migration ada di: `backend/migration_drone_dan_harga_laptop_hp.sql`

**Pilihan A — phpMyAdmin:**
1. Buka phpMyAdmin
2. Pilih database `karyawan_db`
3. Klik tab **SQL**
4. Copy-paste seluruh isi `migration_drone_dan_harga_laptop_hp.sql`
5. Klik **Go**

**Pilihan B — Command Line:**
```bash
mysql -u root karyawan_db < backend/migration_drone_dan_harga_laptop_hp.sql
```

Migration ini **idempotent** — aman di-run berkali-kali. Kalau kolom/tabel udah ada, akan di-skip.

### Step 3: Verifikasi struktur DB
```sql
DESCRIBE drone;
DESCRIBE inventaris_laptop;        -- harus ada kolom harga_beli & tanggal_beli
DESCRIBE handphone;                -- harus ada kolom harga_beli & tanggal_beli
SHOW COLUMNS FROM riwayat_pemakaian LIKE 'tipe_barang';      -- enum harus include 'drone'
SHOW COLUMNS FROM stock_opname_detail LIKE 'tipe_barang';    -- enum harus include 'drone'
```

### Step 4: Restart backend
```bash
cd backend
# Stop server lama (Ctrl+C kalau lagi jalan)
node server.js
# atau pakai nodemon kalau biasa
```

### Step 5: Hard refresh browser
- **Chrome / Edge:** `Ctrl + Shift + R`
- **Firefox:** `Ctrl + F5`

Penting — kalau gak hard refresh, browser bisa kebawa file JS lama.

---

## 🧪 Testing checklist

### A. Tab Drone (CRUD lengkap)
- [ ] Buka **Inventaris**, klik tab **Drone** → tab muncul, grid kosong "Tidak ada data drone"
- [ ] Klik **Tambah Drone** → modal muncul, form drone lengkap (3 foto, harga beli, dll)
- [ ] Isi minimal: Nomor Inventaris (DRN-001), Merek (DJI), Model, Harga Beli (15.000.000)
- [ ] Submit → notification sukses, drone muncul di grid dengan harga "Rp 15.000.000"
- [ ] Klik drone di grid → modal detail muncul dengan semua info termasuk harga
- [ ] Klik tombol **Edit** → form prefilled dengan data lama (termasuk harga ter-format Rupiah)
- [ ] Ubah harga, submit → harga di card berubah
- [ ] Klik **Hapus** → confirm, drone hilang dari grid

### B. Aturan 1 karyawan = 1 drone
- [ ] Tambah drone-A, assign ke EMP001 (status: Digunakan Karyawan)
- [ ] Tambah drone-B, assign ke EMP001 juga
- [ ] Cek tab Drone → drone-A otomatis jadi "Tersedia" (karyawan_id = NULL), hanya drone-B yang dipegang EMP001

### C. Harga di Laptop & HP
- [ ] Tab Laptop Inventaris → klik edit laptop existing → tambahin Harga Beli
- [ ] Submit → di card muncul "Rp xxx" yang sebelumnya "Belum diinput"
- [ ] Sama untuk Handphone

### D. Riwayat Pemakaian
- [ ] Tab Riwayat Pemakaian → dropdown filter tipe barang → ada opsi "Drone"
- [ ] Setelah assign drone ke karyawan, cek riwayat → entry otomatis muncul dengan tipe "drone"

### E. Stock Opname (kalau lagi periode audit)
- [ ] Mulai audit baru → konfirm dialog mention "drone"
- [ ] Lihat detail audit → drone-drone yang ada ikut ter-snapshot dengan status "pending"
- [ ] Filter tipe barang → ada opsi "Drone"

### F. Search & Export
- [ ] Tab Drone → search "DJI" → filter jalan
- [ ] Klik **Excel** → file ter-download dengan kolom Harga Beli & Tanggal Beli
- [ ] Klik **PDF** → PDF ter-download dengan kolom yang sama

### G. Karyawan portal
- [ ] Login sebagai karyawan yang dipegang drone → dashboard menunjukkan drone-nya (kalau halaman dashboard karyawan udah render `data.drone` — kalau belum, datanya udah ready dari API, tinggal nambahin display)

### H. Delete karyawan
- [ ] Delete karyawan yang sedang pegang drone → drone otomatis jadi "Tersedia" (karyawan_id = NULL)
- [ ] Riwayat ditutup otomatis dengan note "Auto-return karena karyawan dihapus dari sistem"

---

## 🛠️ Troubleshooting

### Error: "Table 'drone' doesn't exist"
→ Migration belum di-run. Run Step 2 lagi.

### Error 500 saat tambah drone
→ Cek console browser → mungkin field required ada yang kosong. Pastikan migration sukses dan tabel drone ada.

### Tab drone gak muncul setelah update
→ Hard refresh browser (`Ctrl+Shift+R`). Kalau masih, cek browser DevTools → Application → Clear storage.

### Harga gak ke-save di laptop/HP
→ Pastikan migration udah jalan (kolom `harga_beli` udah ada di tabel `inventaris_laptop` dan `handphone`). Cek di phpMyAdmin: `DESCRIBE inventaris_laptop;` dan `DESCRIBE handphone;`.

### Statistik drone gak muncul di dashboard
→ Migration belum jalan, atau hard refresh perlu. Backend punya fallback default 0 kalau tabel belum ada, jadi gak akan crash.

---

## 📁 File yang berubah

**Migration baru:**
- `backend/migration_drone_dan_harga_laptop_hp.sql` ← FILE BARU, harus di-run

**Backend:**
- `backend/server.js` — endpoint drone, harga laptop/HP, statistik, stock opname, laporan bulanan

**Frontend:**
- `frontend/inventaris.html` — tab drone, form drone, harga di form laptop/HP, JS lengkap
- `frontend/riwayat-pemakaian.html` — option drone di filter
- `frontend/stock-opname.html` — text snapshot include drone
- `frontend/stock-opname-detail.html` — option drone di filter
- `frontend/laporan-bulanan.html` — total aset include drone

---

## 📋 Catatan tambahan

### Snapshot drone di stock opname pakai silent fallback
Kalau tabel `drone` belum ada saat audit dimulai (misal lo lupa run migration), proses snapshot drone akan di-skip secara silent (gak crash). Snapshot laptop/HP/kendaraan/printer tetep jalan normal.

### Statistik drone di dashboard
Endpoint `/api/statistics/inventaris` udah include `stats.drone` dengan default `{total: 0, tersedia: 0, digunakan: 0, masalah: 0}` kalau tabel belum ada. Dashboard `dashboard.html` masih belum render card drone secara eksplisit — kalau lo mau, lo bisa tambahin sendiri pakai pola yang sama kayak printer/HP (datanya udah ready dari API).

### Field metric drone
Sesuai keputusan: drone gak punya field metric khusus kayak km_terakhir (kendaraan). Cukup status + kondisi + harga.

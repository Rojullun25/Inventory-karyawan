-- ═══════════════════════════════════════════════════════════════════════
-- 🔧 MIGRATION ALL-IN-ONE (NO PROCEDURE VERSION)
-- ═══════════════════════════════════════════════════════════════════════
-- Kompatibel dengan MySQL 8 / MariaDB 10.3+ yang belum di-mysql_upgrade.
-- Gak pakai stored procedure, jadi gak butuh akses `mysql.proc`.
--
-- ⚠️ CARA PAKAI: Jalankan BAGIAN demi BAGIAN.
-- Setiap bagian dipisah dengan komentar "=== BAGIAN X ===".
-- Di phpMyAdmin: highlight satu bagian → klik "Go" / "Kirim"
-- Atau: copy semua, paste, klik Go. Error per-bagian akan di-skip.
-- ═══════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════
-- === BAGIAN 1: CEK STATUS DULU ===
-- ═══════════════════════════════════════════════════════════════════════
-- Jalankan ini DULU buat tau tabel mana yang udah/belum punya kolom harga_beli.

SELECT
    TABLE_NAME AS tabel,
    CASE
        WHEN COUNT(*) > 0 THEN '✅ ADA'
        ELSE '❌ BELUM ADA'
    END AS status_harga_beli
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND COLUMN_NAME = 'harga_beli'
  AND TABLE_NAME IN ('kendaraan', 'printer', 'inventaris_laptop', 'handphone', 'drone')
GROUP BY TABLE_NAME;

-- Cek tabel drone ada apa enggak
SELECT
    CASE WHEN COUNT(*) > 0 THEN '✅ Tabel drone ADA'
         ELSE '❌ Tabel drone BELUM ADA' END AS status_tabel_drone
FROM INFORMATION_SCHEMA.TABLES
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'drone';


-- ═══════════════════════════════════════════════════════════════════════
-- === BAGIAN 2: KENDARAAN — tambah harga_beli & tanggal_beli ===
-- ═══════════════════════════════════════════════════════════════════════
-- ⚠️ Skip bagian ini kalau di Bagian 1 status kendaraan udah "✅ ADA"
-- Kalau error "Duplicate column name", artinya udah ada → aman di-skip.

ALTER TABLE kendaraan
    ADD COLUMN harga_beli DECIMAL(12,2) NULL DEFAULT NULL
    COMMENT 'Harga beli (Rp). NULL = belum diinput' AFTER km_terakhir;

ALTER TABLE kendaraan
    ADD COLUMN tanggal_beli DATE NULL DEFAULT NULL
    COMMENT 'Tanggal pembelian' AFTER harga_beli;


-- ═══════════════════════════════════════════════════════════════════════
-- === BAGIAN 3: PRINTER — tambah harga_beli & tanggal_beli ===
-- ═══════════════════════════════════════════════════════════════════════
-- ⚠️ Skip kalau status printer udah "✅ ADA"

ALTER TABLE printer
    ADD COLUMN harga_beli DECIMAL(12,2) NULL DEFAULT NULL
    COMMENT 'Harga beli (Rp). NULL = belum diinput' AFTER ip_address;

ALTER TABLE printer
    ADD COLUMN tanggal_beli DATE NULL DEFAULT NULL
    COMMENT 'Tanggal pembelian' AFTER harga_beli;


-- ═══════════════════════════════════════════════════════════════════════
-- === BAGIAN 4: INVENTARIS_LAPTOP — tambah harga_beli & tanggal_beli ===
-- ═══════════════════════════════════════════════════════════════════════
-- ⚠️ Skip kalau status inventaris_laptop udah "✅ ADA"

ALTER TABLE inventaris_laptop
    ADD COLUMN harga_beli DECIMAL(12,2) NULL DEFAULT NULL
    COMMENT 'Harga beli (Rp). NULL = belum diinput' AFTER catatan;

ALTER TABLE inventaris_laptop
    ADD COLUMN tanggal_beli DATE NULL DEFAULT NULL
    COMMENT 'Tanggal pembelian' AFTER harga_beli;


-- ═══════════════════════════════════════════════════════════════════════
-- === BAGIAN 5: HANDPHONE — tambah harga_beli & tanggal_beli ===
-- ═══════════════════════════════════════════════════════════════════════
-- ⚠️ Skip kalau status handphone udah "✅ ADA"

ALTER TABLE handphone
    ADD COLUMN harga_beli DECIMAL(12,2) NULL DEFAULT NULL
    COMMENT 'Harga beli (Rp). NULL = belum diinput' AFTER catatan;

ALTER TABLE handphone
    ADD COLUMN tanggal_beli DATE NULL DEFAULT NULL
    COMMENT 'Tanggal pembelian' AFTER harga_beli;


-- ═══════════════════════════════════════════════════════════════════════
-- === BAGIAN 6: CREATE TABLE DRONE ===
-- ═══════════════════════════════════════════════════════════════════════
-- IF NOT EXISTS, jadi aman dijalanin meski tabel udah ada.

CREATE TABLE IF NOT EXISTS `drone` (
    `id` INT(11) NOT NULL AUTO_INCREMENT,
    `nomor_inventaris` VARCHAR(50) NOT NULL UNIQUE,
    `merek` VARCHAR(100) NOT NULL,
    `model` VARCHAR(100) DEFAULT NULL,
    `serial_number` VARCHAR(100) DEFAULT NULL,
    `spesifikasi` TEXT DEFAULT NULL COMMENT 'Contoh: 4K kamera, GPS, 30 min flight time',
    `warna` VARCHAR(50) DEFAULT NULL,
    `status` ENUM('Tersedia','Digunakan Karyawan','Servis','Rusak','Hilang') DEFAULT 'Tersedia',
    `kondisi` ENUM('Baik','Rusak Ringan','Rusak Berat') DEFAULT 'Baik',
    `karyawan_id` VARCHAR(20) DEFAULT NULL,
    `lokasi_penyimpanan` VARCHAR(100) DEFAULT NULL,
    `catatan` TEXT DEFAULT NULL,
    `foto` TEXT DEFAULT NULL COMMENT 'JSON: depan, belakang, kerusakan',
    `harga_beli` DECIMAL(12,2) NULL DEFAULT NULL COMMENT 'Harga beli (Rp). NULL = belum diinput',
    `tanggal_beli` DATE NULL DEFAULT NULL COMMENT 'Tanggal pembelian',
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    KEY `idx_drone_karyawan` (`karyawan_id`),
    KEY `idx_drone_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;


-- ═══════════════════════════════════════════════════════════════════════
-- === BAGIAN 7: UPDATE ENUM riwayat_pemakaian — tambah 'drone' ===
-- ═══════════════════════════════════════════════════════════════════════
-- Aman dijalanin berkali-kali (ALTER MODIFY itu idempotent secara natural).

ALTER TABLE riwayat_pemakaian
    MODIFY COLUMN tipe_barang ENUM('laptop','handphone','kendaraan','printer','drone') NOT NULL;


-- ═══════════════════════════════════════════════════════════════════════
-- === BAGIAN 8: UPDATE ENUM stock_opname_detail — tambah 'drone' ===
-- ═══════════════════════════════════════════════════════════════════════
-- ⚠️ HANYA jalanin kalau lo udah pakai fitur Stock Opname.
-- Kalau tabel stock_opname_detail belum ada, abaikan/skip bagian ini.

ALTER TABLE stock_opname_detail
    MODIFY COLUMN tipe_barang ENUM('laptop','handphone','kendaraan','printer','drone') NOT NULL;


-- ═══════════════════════════════════════════════════════════════════════
-- === BAGIAN 9: VERIFIKASI FINAL ===
-- ═══════════════════════════════════════════════════════════════════════
-- Jalankan ini di akhir untuk konfirmasi semua udah beres.

SELECT
    TABLE_NAME AS tabel,
    COLUMN_NAME AS kolom,
    COLUMN_TYPE AS tipe,
    IS_NULLABLE AS nullable
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND COLUMN_NAME IN ('harga_beli', 'tanggal_beli')
  AND TABLE_NAME IN ('kendaraan', 'printer', 'inventaris_laptop', 'handphone', 'drone')
ORDER BY TABLE_NAME, COLUMN_NAME;

-- Hasil yang diharapkan: 10 row (5 tabel × 2 kolom)

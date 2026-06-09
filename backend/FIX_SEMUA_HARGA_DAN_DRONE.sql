-- ═══════════════════════════════════════════════════════════════════════
-- 🔧 MIGRATION ALL-IN-ONE: Fix harga_beli di SEMUA tabel + Drone
-- ═══════════════════════════════════════════════════════════════════════
-- Migration ini ngeberesin:
--   1. Kendaraan  → tambah harga_beli + tanggal_beli (kalau belum ada)
--   2. Printer    → tambah harga_beli + tanggal_beli (kalau belum ada)
--   3. Laptop     → tambah harga_beli + tanggal_beli (kalau belum ada)
--   4. Handphone  → tambah harga_beli + tanggal_beli (kalau belum ada)
--   5. Drone      → CREATE TABLE (kalau belum ada)
--   6. Riwayat enum → tambah 'drone'
--   7. Stock opname enum → tambah 'drone'
--
-- ⭐ IDEMPOTENT: aman dijalanin berkali-kali. Kalau udah ada, skip.
-- ⭐ Jalankan via phpMyAdmin → tab SQL → paste seluruh isi → Go
-- ⭐ ATAU CLI: mysql -u root karyawan_db < FIX_SEMUA_HARGA_DAN_DRONE.sql
-- ═══════════════════════════════════════════════════════════════════════

DROP PROCEDURE IF EXISTS fix_semua_harga;
DELIMITER $$
CREATE PROCEDURE fix_semua_harga()
BEGIN
    -- ━━━ 1. KENDARAAN ━━━
    IF NOT EXISTS (
        SELECT * FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'kendaraan'
          AND COLUMN_NAME = 'harga_beli'
    ) THEN
        ALTER TABLE kendaraan
            ADD COLUMN harga_beli DECIMAL(12,2) NULL DEFAULT NULL
            COMMENT 'Harga beli (Rp). NULL = belum diinput' AFTER km_terakhir;
        ALTER TABLE kendaraan
            ADD COLUMN tanggal_beli DATE NULL DEFAULT NULL
            COMMENT 'Tanggal pembelian' AFTER harga_beli;
        SELECT '✅ Kendaraan: kolom harga_beli & tanggal_beli ditambahkan' AS info;
    ELSE
        SELECT '⏭️  Kendaraan: kolom udah ada, skip' AS info;
    END IF;

    -- ━━━ 2. PRINTER ━━━
    IF NOT EXISTS (
        SELECT * FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'printer'
          AND COLUMN_NAME = 'harga_beli'
    ) THEN
        ALTER TABLE printer
            ADD COLUMN harga_beli DECIMAL(12,2) NULL DEFAULT NULL
            COMMENT 'Harga beli (Rp). NULL = belum diinput' AFTER ip_address;
        ALTER TABLE printer
            ADD COLUMN tanggal_beli DATE NULL DEFAULT NULL
            COMMENT 'Tanggal pembelian' AFTER harga_beli;
        SELECT '✅ Printer: kolom harga_beli & tanggal_beli ditambahkan' AS info;
    ELSE
        SELECT '⏭️  Printer: kolom udah ada, skip' AS info;
    END IF;

    -- ━━━ 3. INVENTARIS LAPTOP ━━━
    IF NOT EXISTS (
        SELECT * FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'inventaris_laptop'
          AND COLUMN_NAME = 'harga_beli'
    ) THEN
        ALTER TABLE inventaris_laptop
            ADD COLUMN harga_beli DECIMAL(12,2) NULL DEFAULT NULL
            COMMENT 'Harga beli (Rp). NULL = belum diinput' AFTER catatan;
        ALTER TABLE inventaris_laptop
            ADD COLUMN tanggal_beli DATE NULL DEFAULT NULL
            COMMENT 'Tanggal pembelian' AFTER harga_beli;
        SELECT '✅ Inventaris Laptop: kolom harga_beli & tanggal_beli ditambahkan' AS info;
    ELSE
        SELECT '⏭️  Inventaris Laptop: kolom udah ada, skip' AS info;
    END IF;

    -- ━━━ 4. HANDPHONE ━━━
    IF NOT EXISTS (
        SELECT * FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'handphone'
          AND COLUMN_NAME = 'harga_beli'
    ) THEN
        ALTER TABLE handphone
            ADD COLUMN harga_beli DECIMAL(12,2) NULL DEFAULT NULL
            COMMENT 'Harga beli (Rp). NULL = belum diinput' AFTER catatan;
        ALTER TABLE handphone
            ADD COLUMN tanggal_beli DATE NULL DEFAULT NULL
            COMMENT 'Tanggal pembelian' AFTER harga_beli;
        SELECT '✅ Handphone: kolom harga_beli & tanggal_beli ditambahkan' AS info;
    ELSE
        SELECT '⏭️  Handphone: kolom udah ada, skip' AS info;
    END IF;
END$$
DELIMITER ;

CALL fix_semua_harga();
DROP PROCEDURE fix_semua_harga;


-- ━━━ 5. CREATE TABLE DRONE ━━━
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
    `foto` TEXT DEFAULT NULL COMMENT 'JSON: {"depan":"url","belakang":"url","kerusakan":"url"}',
    `harga_beli` DECIMAL(12,2) NULL DEFAULT NULL COMMENT 'Harga beli (Rp). NULL = belum diinput',
    `tanggal_beli` DATE NULL DEFAULT NULL COMMENT 'Tanggal pembelian',
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    KEY `idx_drone_karyawan` (`karyawan_id`),
    KEY `idx_drone_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;


-- ━━━ 6. Update enum riwayat_pemakaian.tipe_barang (tambah 'drone') ━━━
ALTER TABLE riwayat_pemakaian
    MODIFY COLUMN tipe_barang ENUM('laptop','handphone','kendaraan','printer','drone') NOT NULL;


-- ━━━ 7. Update enum stock_opname_detail.tipe_barang (tambah 'drone') ━━━
DROP PROCEDURE IF EXISTS update_enum_stock_opname;
DELIMITER $$
CREATE PROCEDURE update_enum_stock_opname()
BEGIN
    IF EXISTS (
        SELECT * FROM INFORMATION_SCHEMA.TABLES
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'stock_opname_detail'
    ) THEN
        ALTER TABLE stock_opname_detail
            MODIFY COLUMN tipe_barang ENUM('laptop','handphone','kendaraan','printer','drone') NOT NULL;
    END IF;
END$$
DELIMITER ;

CALL update_enum_stock_opname();
DROP PROCEDURE update_enum_stock_opname;


-- ═══════════════════════════════════════════════════════════════════════
-- ✅ DONE — verifikasi:
-- ═══════════════════════════════════════════════════════════════════════
SELECT '━━━ VERIFIKASI ━━━' AS info;

-- Cek semua tabel ada kolom harga_beli
SELECT
    TABLE_NAME AS tabel,
    COLUMN_NAME AS kolom,
    COLUMN_TYPE AS tipe
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND COLUMN_NAME IN ('harga_beli', 'tanggal_beli')
  AND TABLE_NAME IN ('kendaraan', 'printer', 'inventaris_laptop', 'handphone', 'drone')
ORDER BY TABLE_NAME, COLUMN_NAME;

-- Cek tabel drone ada
SELECT
    CASE WHEN COUNT(*) > 0 THEN '✅ Tabel drone ADA'
         ELSE '❌ Tabel drone GAK ADA' END AS status_drone
FROM INFORMATION_SCHEMA.TABLES
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'drone';

SELECT '✅ Migration SELESAI! Coba restart server dan refresh browser.' AS info;

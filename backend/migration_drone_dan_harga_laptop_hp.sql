-- ═══════════════════════════════════════════════════════════════════════
-- MIGRATION: Tambah Drone + harga_beli/tanggal_beli ke Laptop & HP
-- ═══════════════════════════════════════════════════════════════════════
-- Yang dilakukan:
--   1. CREATE TABLE `drone` (jika belum ada) — sudah include harga_beli & tanggal_beli
--   2. ALTER TABLE `inventaris_laptop` ADD harga_beli + tanggal_beli (jika belum ada)
--   3. ALTER TABLE `handphone` ADD harga_beli + tanggal_beli (jika belum ada)
--   4. ALTER ENUM `riwayat_pemakaian.tipe_barang` → tambah 'drone'
--   5. ALTER ENUM `stock_opname_detail.tipe_barang` → tambah 'drone'
--
-- Catatan: idempotent, aman dijalanin berkali-kali.
--
-- Cara jalanin:
--   phpMyAdmin → DB karyawan_db → tab SQL → paste & Go
--   ATAU CMD: mysql -u root karyawan_db < migration_drone_dan_harga_laptop_hp.sql
-- ═══════════════════════════════════════════════════════════════════════

-- ─── 1. Tabel DRONE ───
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


-- ─── 2,3. Tambah harga_beli & tanggal_beli ke laptop & HP ───
DROP PROCEDURE IF EXISTS add_harga_laptop_hp;
DELIMITER $$
CREATE PROCEDURE add_harga_laptop_hp()
BEGIN
    -- Inventaris Laptop
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
    END IF;

    -- Handphone
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
    END IF;
END$$
DELIMITER ;

CALL add_harga_laptop_hp();
DROP PROCEDURE add_harga_laptop_hp;


-- ─── 4. Tambah 'drone' ke enum riwayat_pemakaian.tipe_barang ───
-- ALTER ENUM aman dijalanin berkali-kali (idempotent secara natural)
ALTER TABLE riwayat_pemakaian
    MODIFY COLUMN tipe_barang ENUM('laptop','handphone','kendaraan','printer','drone') NOT NULL;


-- ─── 5. Tambah 'drone' ke enum stock_opname_detail.tipe_barang ───
-- Cek dulu apakah tabel stock_opname_detail sudah ada (kalau belum, skip)
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


-- ─── Verifikasi (uncomment buat cek) ───
-- DESCRIBE drone;                  -- harus ada semua kolom termasuk harga_beli
-- DESCRIBE inventaris_laptop;      -- harus ada harga_beli & tanggal_beli
-- DESCRIBE handphone;              -- harus ada harga_beli & tanggal_beli
-- SHOW COLUMNS FROM riwayat_pemakaian LIKE 'tipe_barang';      -- enum harus include 'drone'
-- SHOW COLUMNS FROM stock_opname_detail LIKE 'tipe_barang';    -- enum harus include 'drone'

SELECT '✅ Migration drone & harga laptop/HP selesai!' AS info;

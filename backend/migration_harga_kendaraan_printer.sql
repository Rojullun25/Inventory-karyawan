-- ═══════════════════════════════════════════════════════════════════════
-- Migration: Tambah harga_beli & tanggal_beli ke kendaraan & printer
-- ═══════════════════════════════════════════════════════════════════════
-- Yang ditambah:
--   1. inventaris kendaraan: kolom harga_beli + tanggal_beli
--   2. inventaris printer: kolom harga_beli + tanggal_beli
--
-- Catatan: idempotent, aman dijalanin berkali-kali. Kalau kolom udah ada,
-- procedure akan skip (gak error).
--
-- Cara jalanin:
--   phpMyAdmin → DB karyawan_db → tab SQL → paste & Go
--   ATAU CMD: mysql -u root karyawan_db < migration_harga_kendaraan_printer.sql
-- ═══════════════════════════════════════════════════════════════════════

DROP PROCEDURE IF EXISTS add_harga_kendaraan_printer;
DELIMITER $$
CREATE PROCEDURE add_harga_kendaraan_printer()
BEGIN
    -- ─── Kendaraan ───
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
    END IF;

    -- ─── Printer ───
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
    END IF;
END$$
DELIMITER ;

CALL add_harga_kendaraan_printer();
DROP PROCEDURE add_harga_kendaraan_printer;

-- ─── Verifikasi ───
-- DESCRIBE kendaraan;   -- harus ada harga_beli & tanggal_beli
-- DESCRIBE printer;     -- harus ada harga_beli & tanggal_beli

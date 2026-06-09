-- ============================================================
-- MIGRATION: Stock Opname (Audit Inventaris Bulanan)
-- ============================================================

-- 1. Tabel HEADER opname (1 row per session audit)
CREATE TABLE IF NOT EXISTS `stock_opname` (
    `id` INT(11) NOT NULL AUTO_INCREMENT,
    `periode` VARCHAR(20) NOT NULL              COMMENT 'Format: 2026-05 (YYYY-MM)',
    `judul` VARCHAR(100) NOT NULL               COMMENT 'Misal: Audit Mei 2026',
    `tanggal_mulai` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `tanggal_selesai` DATETIME DEFAULT NULL,

    `status` ENUM('in_progress','completed','cancelled') DEFAULT 'in_progress',

    -- Statistik (diupdate saat finalize)
    `total_asset` INT(11) DEFAULT 0,
    `total_ditemukan` INT(11) DEFAULT 0,
    `total_rusak` INT(11) DEFAULT 0,
    `total_hilang` INT(11) DEFAULT 0,
    `total_pending` INT(11) DEFAULT 0,

    -- Audit trail
    `dibuat_oleh_user_id` INT(11) DEFAULT NULL,
    `dibuat_oleh_username` VARCHAR(100) DEFAULT NULL,
    `selesai_oleh_user_id` INT(11) DEFAULT NULL,
    `selesai_oleh_username` VARCHAR(100) DEFAULT NULL,

    `catatan` TEXT DEFAULT NULL,

    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (`id`),
    UNIQUE KEY `unique_periode` (`periode`),
    KEY `idx_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;


-- 2. Tabel DETAIL opname (1 row per asset per session)
CREATE TABLE IF NOT EXISTS `stock_opname_detail` (
    `id` INT(11) NOT NULL AUTO_INCREMENT,
    `opname_id` INT(11) NOT NULL,

    -- Snapshot data asset saat audit dimulai
    `tipe_barang` ENUM('laptop','handphone','kendaraan','printer') NOT NULL,
    `barang_id` INT(11) NOT NULL,
    `nama_barang` VARCHAR(255) DEFAULT NULL,
    `nomor_inventaris` VARCHAR(100) DEFAULT NULL,
    `karyawan_id_snapshot` VARCHAR(50) DEFAULT NULL,
    `nama_karyawan_snapshot` VARCHAR(255) DEFAULT NULL,
    `lokasi_snapshot` VARCHAR(255) DEFAULT NULL,
    `kondisi_snapshot` VARCHAR(50) DEFAULT NULL,

    -- Hasil audit
    `status_audit` ENUM('pending','ditemukan','rusak','hilang') DEFAULT 'pending',
    `lokasi_aktual` VARCHAR(255) DEFAULT NULL,
    `kondisi_aktual` VARCHAR(50) DEFAULT NULL,
    `foto_bukti` VARCHAR(500) DEFAULT NULL,
    `catatan` TEXT DEFAULT NULL,

    -- Audit trail
    `diaudit_oleh_user_id` INT(11) DEFAULT NULL,
    `diaudit_oleh_username` VARCHAR(100) DEFAULT NULL,
    `diaudit_at` DATETIME DEFAULT NULL,

    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (`id`),
    KEY `idx_opname_id` (`opname_id`),
    KEY `idx_tipe_barang` (`tipe_barang`, `barang_id`),
    KEY `idx_status_audit` (`status_audit`),
    CONSTRAINT `fk_opname_detail`
        FOREIGN KEY (`opname_id`) REFERENCES `stock_opname` (`id`)
        ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;


-- ============================================================
-- CATATAN:
-- 1. Periode pakai format YYYY-MM, jadi cuma 1 audit per bulan
-- 2. Saat audit dimulai, otomatis snapshot SEMUA asset existing
--    ke tabel detail dengan status 'pending'
-- 3. Saat finalize, sistem hitung statistik & set ke header
-- 4. ON DELETE CASCADE: kalau header opname dihapus, detail ikut terhapus
-- ============================================================

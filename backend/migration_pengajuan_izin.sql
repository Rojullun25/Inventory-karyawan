-- ============================================================
-- MIGRATION: Sistem Pengajuan Izin Karyawan
-- Termasuk: tabel pengajuan, saldo cuti, dan extend users
-- ============================================================

-- 1. EXTEND TABEL USERS untuk support role karyawan
-- ─────────────────────────────────────────────────────────
ALTER TABLE `users`
    ADD COLUMN `karyawan_id` VARCHAR(50) NULL AFTER `nama_lengkap`,
    ADD COLUMN `email` VARCHAR(255) NULL AFTER `karyawan_id`,
    ADD COLUMN `must_change_password` TINYINT(1) DEFAULT 1 AFTER `email`,
    ADD KEY `idx_karyawan_id` (`karyawan_id`);

-- Update kolom role: tambah 'hr' dan 'karyawan'
ALTER TABLE `users`
    MODIFY COLUMN `role` ENUM('admin','hr','manager','karyawan','user') DEFAULT 'karyawan';


-- 2. TABEL SALDO CUTI per karyawan per tahun
-- ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `saldo_cuti` (
    `id` INT(11) NOT NULL AUTO_INCREMENT,
    `karyawan_id` VARCHAR(50) NOT NULL,
    `tahun` INT(4) NOT NULL,
    `jatah` INT(3) NOT NULL DEFAULT 12       COMMENT 'Total jatah cuti tahunan',
    `terpakai` INT(3) NOT NULL DEFAULT 0      COMMENT 'Jumlah hari yang sudah dipakai',
    `sisa` INT(3) GENERATED ALWAYS AS (`jatah` - `terpakai`) VIRTUAL,
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `unique_karyawan_tahun` (`karyawan_id`, `tahun`),
    KEY `idx_karyawan` (`karyawan_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;


-- 3. TABEL PENGAJUAN IZIN (utama)
-- ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `pengajuan_izin` (
    `id` INT(11) NOT NULL AUTO_INCREMENT,
    `karyawan_id` VARCHAR(50) NOT NULL,
    `nama_karyawan` VARCHAR(255) NOT NULL    COMMENT 'Snapshot nama saat ajuan dibuat',
    `divisi` VARCHAR(100) DEFAULT NULL,

    `jenis_izin` ENUM(
        'cuti_tahunan',
        'sakit',
        'izin_pribadi',
        'cuti_melahirkan',
        'cuti_menikah',
        'wfh',
        'dinas_luar'
    ) NOT NULL,

    `tanggal_mulai` DATE NOT NULL,
    `tanggal_selesai` DATE NOT NULL,
    `jumlah_hari` INT(3) NOT NULL,

    `alasan` TEXT NOT NULL,
    `lampiran` VARCHAR(500) DEFAULT NULL    COMMENT 'URL surat dokter/lampiran lain',

    `status` ENUM('pending','approved','rejected','cancelled') DEFAULT 'pending',

    -- Info approval
    `approved_by_user_id` INT(11) DEFAULT NULL,
    `approved_by_username` VARCHAR(100) DEFAULT NULL,
    `approved_at` DATETIME DEFAULT NULL,
    `catatan_hr` TEXT DEFAULT NULL          COMMENT 'Catatan dari HR saat approve/reject',

    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (`id`),
    KEY `idx_karyawan` (`karyawan_id`),
    KEY `idx_status` (`status`),
    KEY `idx_jenis` (`jenis_izin`),
    KEY `idx_tanggal` (`tanggal_mulai`, `tanggal_selesai`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;


-- 4. SEED: Buat saldo cuti otomatis untuk semua karyawan tahun ini
-- ─────────────────────────────────────────────────────────
INSERT INTO `saldo_cuti` (`karyawan_id`, `tahun`, `jatah`, `terpakai`)
SELECT
    k.id,
    YEAR(CURDATE()),
    12,  -- standar 12 hari/tahun
    0
FROM `karyawan` k
WHERE NOT EXISTS (
    SELECT 1 FROM `saldo_cuti` s
    WHERE s.karyawan_id = k.id AND s.tahun = YEAR(CURDATE())
);


-- ============================================================
-- CATATAN PENTING:
-- 1. Setelah migration ini, saldo cuti otomatis terbuat utk
--    semua karyawan existing dengan jatah 12 hari.
-- 2. Untuk karyawan baru ke depan, saldo cuti perlu dibuatkan
--    secara otomatis (akan ditangani di endpoint POST /api/karyawan).
-- 3. Setiap awal tahun, saldo perlu di-reset (bisa pakai cron
--    atau jalankan query INSERT di atas tiap 1 Januari).
-- ============================================================

-- ============================================================
-- MIGRATION: License Management
-- Track software license: Office 365, AutoCAD, SAP, Kaspersky, Tekla, dll
-- ============================================================

-- 1. TABEL MASTER LICENSE
CREATE TABLE IF NOT EXISTS `software_license` (
    `id` INT(11) NOT NULL AUTO_INCREMENT,

    -- Info dasar
    `nama_software` VARCHAR(150) NOT NULL              COMMENT 'Misal: Office 365 Family, AutoCAD 2024',
    `vendor` VARCHAR(100) DEFAULT NULL                  COMMENT 'Microsoft, Autodesk, CSI, Kaspersky, Trimble',
    `versi` VARCHAR(50) DEFAULT NULL                    COMMENT 'v22, 2024, dll',

    -- Tipe & model
    `tipe_license` ENUM('per_user','per_device','per_organization') NOT NULL DEFAULT 'per_user',
    `model_pembayaran` ENUM('subscription_tahunan','subscription_bulanan','one_time') NOT NULL DEFAULT 'subscription_tahunan',

    -- Capacity
    `total_seat` INT(5) NOT NULL DEFAULT 1               COMMENT 'Berapa user/device max',
    `terpakai` INT(5) NOT NULL DEFAULT 0                 COMMENT 'Cache: berapa yang assigned (auto-update)',

    -- Pricing
    `harga_total` DECIMAL(12,2) DEFAULT NULL,
    `harga_per_seat` DECIMAL(12,2) DEFAULT NULL,
    `currency` VARCHAR(5) DEFAULT 'IDR',

    -- Tanggal
    `tanggal_pembelian` DATE DEFAULT NULL,
    `tanggal_expired` DATE DEFAULT NULL                  COMMENT 'NULL kalau perpetual/one_time',

    -- Akun master / serial
    `akun_master` VARCHAR(255) DEFAULT NULL              COMMENT 'Email admin (untuk Office 365), atau admin AutoCAD',
    `license_key` TEXT DEFAULT NULL                      COMMENT 'Serial number / product key',

    -- Vendor info
    `vendor_contact` VARCHAR(255) DEFAULT NULL,
    `invoice_url` VARCHAR(500) DEFAULT NULL              COMMENT 'Link/path ke invoice file',
    `catatan` TEXT DEFAULT NULL,

    -- Status
    `status` ENUM('active','expired','cancelled') DEFAULT 'active',

    -- Audit
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (`id`),
    KEY `idx_status` (`status`),
    KEY `idx_expired` (`tanggal_expired`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;


-- 2. TABEL LICENSE ASSIGNMENT (siapa/device mana pakai license apa)
CREATE TABLE IF NOT EXISTS `license_assignment` (
    `id` INT(11) NOT NULL AUTO_INCREMENT,
    `license_id` INT(11) NOT NULL,

    -- Assignment target (salah satu di-pakai sesuai tipe_license)
    `assigned_to_type` ENUM('karyawan','laptop','email_external') NOT NULL,
    `karyawan_id` VARCHAR(50) DEFAULT NULL              COMMENT 'Untuk per-user yang ada di sistem',
    `laptop_id` INT(11) DEFAULT NULL                    COMMENT 'Untuk per-device',
    `email_assigned` VARCHAR(255) DEFAULT NULL          COMMENT 'Untuk Office 365 family member yang external',

    -- Snapshot info (jaga2 kalau target dihapus)
    `nama_target` VARCHAR(255) DEFAULT NULL             COMMENT 'Nama karyawan / nomor inventaris laptop',

    -- Status
    `status` ENUM('active','unassigned') DEFAULT 'active',
    `tanggal_assign` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `tanggal_unassign` DATETIME DEFAULT NULL,

    -- Audit
    `assigned_by_username` VARCHAR(100) DEFAULT NULL,
    `unassigned_by_username` VARCHAR(100) DEFAULT NULL,
    `catatan` TEXT DEFAULT NULL,

    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (`id`),
    KEY `idx_license_id` (`license_id`),
    KEY `idx_karyawan_id` (`karyawan_id`),
    KEY `idx_laptop_id` (`laptop_id`),
    KEY `idx_status` (`status`),
    CONSTRAINT `fk_license_assignment`
        FOREIGN KEY (`license_id`) REFERENCES `software_license` (`id`)
        ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;


-- ============================================================
-- SEED: Contoh data dengan 5 software yang lo punya
-- (boleh dihapus kalau lo mau input manual)
-- ============================================================
INSERT INTO `software_license`
    (`nama_software`, `vendor`, `tipe_license`, `model_pembayaran`, `total_seat`,
     `harga_total`, `currency`, `tanggal_pembelian`, `tanggal_expired`, `akun_master`, `catatan`)
VALUES
    ('Office 365 Family', 'Microsoft', 'per_user', 'subscription_tahunan',
     6, 1500000, 'IDR', '2026-01-01', '2027-01-01', 'parent@ptwiratama.com',
     'Office 365 Family — 1 parent + 5 family members. Max 6 akun.'),

    ('AutoCAD 2024', 'Autodesk', 'per_user', 'subscription_tahunan',
     5, 25000000, 'IDR', '2025-08-15', '2026-08-15', 'admin.autocad@ptwiratama.com',
     'Side admin bisa pindahkan license antar karyawan via portal Autodesk.'),

    ('SAP 2000 v22', 'CSI', 'per_user', 'one_time',
     1, 50000000, 'IDR', '2024-03-10', NULL, NULL,
     'Perpetual license, dipakai 1 karyawan tetap (engineering struktur).'),

    ('Kaspersky Premium', 'Kaspersky', 'per_device', 'subscription_tahunan',
     50, 12500000, 'IDR', '2026-02-01', '2027-02-01', NULL,
     'Antivirus untuk semua laptop kantor. License key di catatan vendor.'),

    ('Tekla Structures', 'Trimble', 'per_user', 'subscription_tahunan',
     3, 45000000, 'IDR', '2025-11-20', '2026-11-20', NULL,
     'Software design struktur, dipakai bergantian (no side admin).');


-- ============================================================
-- TIPS:
-- 1. Kolom `terpakai` di-cache untuk performa list view, di-update otomatis
--    via endpoint assign/unassign
-- 2. Untuk Office 365 Family, parent diasumsikan akun admin yang bayar.
--    Saat assign seat, isi `email_assigned` dengan email family member.
-- 3. Status `expired` akan otomatis di-set oleh sistem saat tanggal_expired
--    sudah lewat (lazy update saat list dibuka).
-- ============================================================

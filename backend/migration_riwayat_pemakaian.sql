-- ============================================================
-- MIGRATION: Tabel Riwayat Pemakaian Barang Inventaris
-- Mencatat siapa memakai barang apa, kapan assign, kapan return,
-- dan siapa user yang melakukan assign/reassign.
-- ============================================================

CREATE TABLE IF NOT EXISTS `riwayat_pemakaian` (
    `id` INT(11) NOT NULL AUTO_INCREMENT,

    -- Jenis barang: 'laptop', 'handphone', 'kendaraan', 'printer'
    `tipe_barang` ENUM('laptop','handphone','kendaraan','printer') NOT NULL,

    -- ID barang di tabel masing-masing (inventaris_laptop.id, handphone.id, dll)
    `barang_id` INT(11) NOT NULL,

    -- Snapshot nama barang saat dipakai (jaga-jaga kalau barang dihapus)
    `nama_barang` VARCHAR(255) DEFAULT NULL,

    -- Karyawan yang memakai (NULL = barang balik ke gudang)
    `karyawan_id` VARCHAR(50) DEFAULT NULL,
    `nama_karyawan` VARCHAR(255) DEFAULT NULL,

    -- Tanggal assign & return
    `tanggal_assign` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `tanggal_return` DATETIME DEFAULT NULL,

    -- Kondisi saat assign & return
    `kondisi_assign` VARCHAR(50) DEFAULT NULL,
    `kondisi_return` VARCHAR(50) DEFAULT NULL,

    -- User sistem yang melakukan assign/return
    `assigned_by_user_id` INT(11) DEFAULT NULL,
    `assigned_by_username` VARCHAR(100) DEFAULT NULL,
    `returned_by_user_id` INT(11) DEFAULT NULL,
    `returned_by_username` VARCHAR(100) DEFAULT NULL,

    -- Catatan (opsional)
    `catatan_assign` TEXT DEFAULT NULL,
    `catatan_return` TEXT DEFAULT NULL,

    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (`id`),
    KEY `idx_tipe_barang` (`tipe_barang`, `barang_id`),
    KEY `idx_karyawan` (`karyawan_id`),
    KEY `idx_tanggal_assign` (`tanggal_assign`),
    KEY `idx_aktif` (`tanggal_return`) COMMENT 'NULL berarti masih aktif/sedang dipakai'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- Seed: Backfill data yang sudah ada
-- Untuk laptop/handphone/kendaraan/printer yang saat ini sedang
-- dipakai karyawan, otomatis buat record riwayat dengan
-- tanggal_assign = created_at, tanggal_return = NULL
-- ============================================================

-- Laptop yang sedang dipakai
INSERT INTO riwayat_pemakaian
    (tipe_barang, barang_id, nama_barang, karyawan_id, nama_karyawan,
     tanggal_assign, kondisi_assign, catatan_assign)
SELECT
    'laptop',
    il.id,
    CONCAT(il.merek, ' ', COALESCE(il.model, ''), ' (', il.nomor_inventaris, ')'),
    il.karyawan_id,
    k.nama,
    il.created_at,
    il.kondisi,
    'Backfill otomatis dari data existing'
FROM inventaris_laptop il
LEFT JOIN karyawan k ON il.karyawan_id = k.id
WHERE il.karyawan_id IS NOT NULL
  AND il.status = 'Digunakan Karyawan';

-- Handphone yang sedang dipakai
INSERT INTO riwayat_pemakaian
    (tipe_barang, barang_id, nama_barang, karyawan_id, nama_karyawan,
     tanggal_assign, kondisi_assign, catatan_assign)
SELECT
    'handphone',
    h.id,
    CONCAT(h.merek, ' ', COALESCE(h.model, ''), ' (', h.nomor_inventaris, ')'),
    h.karyawan_id,
    k.nama,
    h.created_at,
    h.kondisi,
    'Backfill otomatis dari data existing'
FROM handphone h
LEFT JOIN karyawan k ON h.karyawan_id = k.id
WHERE h.karyawan_id IS NOT NULL
  AND h.status = 'Digunakan Karyawan';

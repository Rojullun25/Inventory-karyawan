-- ============================================================
-- MIGRATION: Tambah kolom perusahaan ke tabel karyawan
-- Jalankan query ini di MySQL/phpMyAdmin SEKALI SAJA
-- ============================================================

ALTER TABLE karyawan 
ADD COLUMN perusahaan VARCHAR(100) NULL DEFAULT NULL 
COMMENT 'Nama PT/Perusahaan tempat karyawan bernaung'
AFTER email;

-- Verifikasi kolom sudah ditambahkan:
-- SHOW COLUMNS FROM karyawan;

-- (Opsional) Isi data lama dengan default PT utama:
-- UPDATE karyawan SET perusahaan = 'PT. Wiratama Globalindo Jaya' WHERE perusahaan IS NULL;

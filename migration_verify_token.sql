-- ============================================================
-- MIGRATION: Tambah kolom verify_token ke tabel karyawan
-- Jalankan query ini di MySQL/phpMyAdmin SEKALI SAJA
-- ============================================================

-- 1. Tambah kolom verify_token
ALTER TABLE karyawan
ADD COLUMN verify_token VARCHAR(48) NULL DEFAULT NULL
COMMENT 'Token unik untuk verifikasi keaslian kartu ID'
AFTER perusahaan;

-- 2. Buat index agar pencarian token cepat
CREATE INDEX idx_verify_token ON karyawan (verify_token);

-- ============================================================
-- 3. Generate token untuk semua karyawan LAMA yang sudah ada
--    (karyawan baru otomatis dapat token saat ditambahkan)
--
--    Cara generate token di MySQL menggunakan SHA2 + UUID:
-- ============================================================
UPDATE karyawan
SET verify_token = LOWER(HEX(RANDOM_BYTES(24)))
WHERE verify_token IS NULL;

-- ============================================================
-- Verifikasi hasil:
-- SELECT id, nama, verify_token FROM karyawan LIMIT 10;
-- ============================================================

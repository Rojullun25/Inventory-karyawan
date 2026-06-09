-- ============================================================
-- MIGRATION: Security Patch - Auth & Password Hashing
-- Jalankan file ini SEBELUM menjalankan hash_passwords_migration.js
-- ============================================================

-- 1. Pastikan kolom password di tabel users cukup panjang untuk bcrypt hash (60 char)
ALTER TABLE `users`
  MODIFY COLUMN `password` VARCHAR(255) NOT NULL;

-- 2. Pastikan kolom password di tabel software juga cukup (untuk hash jika ingin)
ALTER TABLE `software`
  MODIFY COLUMN `password` VARCHAR(255) DEFAULT NULL;

-- ============================================================
-- CATATAN PENTING:
-- Setelah menjalankan migration SQL ini, jalankan:
--   node hash_passwords_migration.js
-- untuk meng-hash semua password plain-text yang sudah ada.
-- ============================================================

-- ============================================================
-- FIX: Convert foto URL dari hardcoded localhost ke relative
-- Jalankan SEKALI untuk fix foto-foto lama yang udah ada di DB
-- ============================================================

-- 1. Fix kolom `foto` di tabel karyawan
UPDATE `karyawan`
SET `foto` = REPLACE(`foto`, 'http://localhost:3000', '')
WHERE `foto` LIKE 'http://localhost:3000%';

-- Juga fix kalau ada yang tersimpan pakai IP lama (misal 127.0.0.1)
UPDATE `karyawan`
SET `foto` = REPLACE(`foto`, 'http://127.0.0.1:3000', '')
WHERE `foto` LIKE 'http://127.0.0.1:3000%';

-- 2. Fix di tabel inventaris (foto laptop kolom JSON)
UPDATE `inventaris_laptop`
SET `foto` = REPLACE(`foto`, 'http://localhost:3000', '')
WHERE `foto` LIKE '%http://localhost:3000%';

UPDATE `inventaris_laptop`
SET `foto` = REPLACE(`foto`, 'http://127.0.0.1:3000', '')
WHERE `foto` LIKE '%http://127.0.0.1:3000%';

-- 3. Fix di tabel handphone
UPDATE `handphone`
SET `foto` = REPLACE(`foto`, 'http://localhost:3000', '')
WHERE `foto` LIKE '%http://localhost:3000%';

UPDATE `handphone`
SET `foto` = REPLACE(`foto`, 'http://127.0.0.1:3000', '')
WHERE `foto` LIKE '%http://127.0.0.1:3000%';

-- 4. Fix di tabel kendaraan
UPDATE `kendaraan`
SET `foto` = REPLACE(`foto`, 'http://localhost:3000', '')
WHERE `foto` LIKE '%http://localhost:3000%';

UPDATE `kendaraan`
SET `foto` = REPLACE(`foto`, 'http://127.0.0.1:3000', '')
WHERE `foto` LIKE '%http://127.0.0.1:3000%';

-- 5. Fix di tabel printer
UPDATE `printer`
SET `foto` = REPLACE(`foto`, 'http://localhost:3000', '')
WHERE `foto` LIKE '%http://localhost:3000%';

UPDATE `printer`
SET `foto` = REPLACE(`foto`, 'http://127.0.0.1:3000', '')
WHERE `foto` LIKE '%http://127.0.0.1:3000%';

-- 6. Fix lampiran di pengajuan_izin (kalau ada)
UPDATE `pengajuan_izin`
SET `lampiran` = REPLACE(`lampiran`, 'http://localhost:3000', '')
WHERE `lampiran` LIKE 'http://localhost:3000%';

-- 7. Fix foto bukti di stock opname detail
UPDATE `stock_opname_detail`
SET `foto_bukti` = REPLACE(`foto_bukti`, 'http://localhost:3000', '')
WHERE `foto_bukti` LIKE 'http://localhost:3000%';

-- ============================================================
-- VERIFIKASI hasil:
-- Hasil bisa di-cek dengan query ini.
-- Setelah update, harusnya foto-foto pakai path relative (/uploads/xxx.jpg)
-- ============================================================
SELECT 'karyawan' as tabel, foto FROM karyawan WHERE foto IS NOT NULL LIMIT 3;
SELECT 'inventaris_laptop' as tabel, foto FROM inventaris_laptop WHERE foto IS NOT NULL LIMIT 3;
SELECT 'handphone' as tabel, foto FROM handphone WHERE foto IS NOT NULL LIMIT 3;

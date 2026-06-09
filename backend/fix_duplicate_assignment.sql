-- ============================================================
-- FIX: Karyawan punya >1 laptop aktif sekaligus
-- Aturan: 1 karyawan = 1 laptop aktif (yang terbaru)
-- Laptop lain otomatis dilepas (set status 'Tersedia', karyawan_id NULL)
-- ============================================================

-- STEP 1: Lihat karyawan yang punya laptop ganda (untuk preview saja)
SELECT
    karyawan_id,
    COUNT(*) as jumlah_laptop,
    GROUP_CONCAT(CONCAT(merek, ' ', COALESCE(model, ''), ' (ID:', id, ')') SEPARATOR ' | ') as laptop_list
FROM inventaris_laptop
WHERE karyawan_id IS NOT NULL
  AND status = 'Digunakan Karyawan'
GROUP BY karyawan_id
HAVING COUNT(*) > 1;

-- STEP 2: Lepas laptop yang BUKAN paling baru (berdasarkan updated_at terbaru)
-- Yang dipertahankan: laptop dengan updated_at terbaru per karyawan
UPDATE inventaris_laptop il1
INNER JOIN (
    SELECT il2.id
    FROM inventaris_laptop il2
    INNER JOIN (
        SELECT karyawan_id, MAX(updated_at) as max_update
        FROM inventaris_laptop
        WHERE karyawan_id IS NOT NULL AND status = 'Digunakan Karyawan'
        GROUP BY karyawan_id
        HAVING COUNT(*) > 1
    ) latest ON il2.karyawan_id = latest.karyawan_id
             AND il2.updated_at < latest.max_update
    WHERE il2.status = 'Digunakan Karyawan'
) to_release ON il1.id = to_release.id
SET il1.karyawan_id = NULL,
    il1.status = 'Tersedia';

-- STEP 3: Lakukan hal yang sama untuk handphone (jaga-jaga)
UPDATE handphone hp1
INNER JOIN (
    SELECT hp2.id
    FROM handphone hp2
    INNER JOIN (
        SELECT karyawan_id, MAX(updated_at) as max_update
        FROM handphone
        WHERE karyawan_id IS NOT NULL AND status = 'Digunakan Karyawan'
        GROUP BY karyawan_id
        HAVING COUNT(*) > 1
    ) latest ON hp2.karyawan_id = latest.karyawan_id
             AND hp2.updated_at < latest.max_update
    WHERE hp2.status = 'Digunakan Karyawan'
) to_release ON hp1.id = to_release.id
SET hp1.karyawan_id = NULL,
    hp1.status = 'Tersedia';

-- STEP 4: Verifikasi tidak ada lagi karyawan dengan >1 laptop/HP aktif
SELECT 'CEK LAPTOP' as label, karyawan_id, COUNT(*) as jumlah
FROM inventaris_laptop
WHERE karyawan_id IS NOT NULL AND status = 'Digunakan Karyawan'
GROUP BY karyawan_id
HAVING COUNT(*) > 1
UNION ALL
SELECT 'CEK HANDPHONE' as label, karyawan_id, COUNT(*) as jumlah
FROM handphone
WHERE karyawan_id IS NOT NULL AND status = 'Digunakan Karyawan'
GROUP BY karyawan_id
HAVING COUNT(*) > 1;
-- Kalau hasil query terakhir KOSONG = sukses, tidak ada lagi double assignment.

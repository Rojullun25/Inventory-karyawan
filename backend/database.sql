-- Buat database
CREATE DATABASE IF NOT EXISTS karyawan_db;
USE karyawan_db;

-- ==================== TABEL UTAMA ====================

-- Tabel users untuk login
CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(50) NOT NULL UNIQUE,
    password VARCHAR(255) NOT NULL,
    nama_lengkap VARCHAR(100),
    role ENUM('admin', 'user') DEFAULT 'user',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tabel divisi
CREATE TABLE IF NOT EXISTS divisi (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nama_divisi VARCHAR(100) NOT NULL UNIQUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tabel karyawan
CREATE TABLE IF NOT EXISTS karyawan (
    id VARCHAR(20) PRIMARY KEY,
    nama VARCHAR(100) NOT NULL,
    divisi_id INT,
    jabatan VARCHAR(100),
    email VARCHAR(100),
    no_hp VARCHAR(20),
    foto TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (divisi_id) REFERENCES divisi(id) ON DELETE SET NULL
);

-- Tabel laptop (untuk karyawan)
CREATE TABLE IF NOT EXISTS laptop (
    id INT AUTO_INCREMENT PRIMARY KEY,
    karyawan_id VARCHAR(20) NOT NULL,
    merek VARCHAR(100),
    serial_number VARCHAR(100),
    foto TEXT,
    FOREIGN KEY (karyawan_id) REFERENCES karyawan(id) ON DELETE CASCADE
);

-- Tabel software
CREATE TABLE IF NOT EXISTS software (
    id INT AUTO_INCREMENT PRIMARY KEY,
    karyawan_id VARCHAR(20) NOT NULL,
    nama VARCHAR(100) NOT NULL,
    serial_number VARCHAR(100),
    email VARCHAR(100),
    password VARCHAR(255),
    FOREIGN KEY (karyawan_id) REFERENCES karyawan(id) ON DELETE CASCADE
);

-- ==================== TABEL INVENTARIS ====================

-- Tabel inventaris kendaraan
CREATE TABLE IF NOT EXISTS kendaraan (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nomor_plat VARCHAR(15) NOT NULL UNIQUE,
    jenis VARCHAR(50) NOT NULL,
    merek VARCHAR(100),
    model VARCHAR(100),
    tahun INT,
    warna VARCHAR(30),
    status ENUM('Tersedia', 'Digunakan', 'Servis', 'Rusak') DEFAULT 'Tersedia',
    kondisi ENUM('Baik', 'Rusak Ringan', 'Rusak Berat') DEFAULT 'Baik',
    km_terakhir INT DEFAULT 0,
    lokasi_penyimpanan VARCHAR(100),
    catatan TEXT,
    foto TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Tabel inventaris printer
CREATE TABLE IF NOT EXISTS printer (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nomor_inventaris VARCHAR(50) NOT NULL UNIQUE,
    merek VARCHAR(100) NOT NULL,
    model VARCHAR(100),
    tipe ENUM('Laser', 'Inkjet', 'Dot Matrix', 'Thermal') DEFAULT 'Laser',
    status ENUM('Tersedia', 'Digunakan', 'Servis', 'Rusak') DEFAULT 'Tersedia',
    kondisi ENUM('Baik', 'Rusak Ringan', 'Rusak Berat') DEFAULT 'Baik',
    lokasi VARCHAR(100),
    ip_address VARCHAR(15),
    catatan TEXT,
    foto TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Tabel inventaris laptop (terpisah dari laptop karyawan)
CREATE TABLE IF NOT EXISTS inventaris_laptop (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nomor_inventaris VARCHAR(50) NOT NULL UNIQUE,
    merek VARCHAR(100) NOT NULL,
    model VARCHAR(100),
    serial_number VARCHAR(100) UNIQUE,
    spesifikasi TEXT,
    status ENUM('Tersedia', 'Digunakan Karyawan', 'Servis', 'Rusak', 'Hilang') DEFAULT 'Tersedia',
    kondisi ENUM('Baik', 'Rusak Ringan', 'Rusak Berat') DEFAULT 'Baik',
    karyawan_id VARCHAR(20),
    lokasi_penyimpanan VARCHAR(100),
    catatan TEXT,
    foto TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (karyawan_id) REFERENCES karyawan(id) ON DELETE SET NULL
);

-- Tabel untuk mencatat riwayat pemakaian
CREATE TABLE IF NOT EXISTS riwayat_pemakaian (
    id INT AUTO_INCREMENT PRIMARY KEY,
    tipe_barang ENUM('Kendaraan', 'Printer', 'Laptop') NOT NULL,
    barang_id INT NOT NULL,
    karyawan_id VARCHAR(20),
    tanggal_mulai DATETIME NOT NULL,
    tanggal_selesai DATETIME,
    keperluan TEXT,
    catatan TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (karyawan_id) REFERENCES karyawan(id) ON DELETE SET NULL
);

-- ==================== INSERT DATA MASTER ====================

-- Insert user admin (password: admin123)
INSERT INTO users (username, password, nama_lengkap, role) VALUES
('admin', 'admin123', 'Administrator', 'admin'),
('user', 'user123', 'Regular User', 'user');

-- Insert data divisi
INSERT INTO divisi (nama_divisi) VALUES
('Direktur'),
('HRD'),
('GM Production'),
('GM QA'),
('GM FAT'),
('Logistic Staff'),
('Project Site'),
('QC Staff'),
('IT System Officer'),
('Drafter'),
('Accounting');

-- ==================== INSERT SAMPLE DATA KARYAWAN ====================

-- Insert sample data karyawan (pastikan divisi_id sesuai)
INSERT INTO karyawan (id, nama, divisi_id, jabatan, email, no_hp, foto) VALUES
('EMP001', 'Budi Santoso', (SELECT id FROM divisi WHERE nama_divisi = 'IT System Officer'), 'Staff IT', 'budi@wiratama.com', '081234567890', 'https://ui-avatars.com/api/?name=Budi+Santoso&size=200&background=1A4D8C&color=fff'),
('EMP002', 'Siti Aminah', (SELECT id FROM divisi WHERE nama_divisi = 'HRD'), 'HR Manager', 'siti@wiratama.com', '081234567891', 'https://ui-avatars.com/api/?name=Siti+Aminah&size=200&background=1A4D8C&color=fff'),
('EMP003', 'Ahmad Hidayat', (SELECT id FROM divisi WHERE nama_divisi = 'GM Production'), 'Production Supervisor', 'ahmad@wiratama.com', '081234567892', 'https://ui-avatars.com/api/?name=Ahmad+Hidayat&size=200&background=1A4D8C&color=fff'),
('EMP004', 'Dewi Lestari', (SELECT id FROM divisi WHERE nama_divisi = 'Accounting'), 'Senior Accountant', 'dewi@wiratama.com', '081234567893', 'https://ui-avatars.com/api/?name=Dewi+Lestari&size=200&background=1A4D8C&color=fff'),
('EMP005', 'Rizki Pratama', (SELECT id FROM divisi WHERE nama_divisi = 'Project Site'), 'Site Manager', 'rizki@wiratama.com', '081234567894', 'https://ui-avatars.com/api/?name=Rizki+Pratama&size=200&background=1A4D8C&color=fff');

-- Insert sample laptop untuk karyawan
INSERT INTO laptop (karyawan_id, merek, serial_number, foto) VALUES
('EMP001', 'Lenovo ThinkPad X1', 'SN-X1-2024-001', 'https://ui-avatars.com/api/?name=Lenovo+X1&size=200&background=2B6EB0&color=fff'),
('EMP002', 'MacBook Pro M2', 'SN-MBP-2024-002', 'https://ui-avatars.com/api/?name=MacBook+Pro&size=200&background=2B6EB0&color=fff'),
('EMP003', 'HP EliteBook 840', 'SN-HP-2024-003', 'https://ui-avatars.com/api/?name=HP+EliteBook&size=200&background=2B6EB0&color=fff'),
('EMP004', 'Dell Latitude 7430', 'SN-DELL-2024-004', 'https://ui-avatars.com/api/?name=Dell+Latitude&size=200&background=2B6EB0&color=fff'),
('EMP005', 'Lenovo ThinkPad P16', 'SN-P16-2024-005', 'https://ui-avatars.com/api/?name=Lenovo+P16&size=200&background=2B6EB0&color=fff');

-- Insert sample software
INSERT INTO software (karyawan_id, nama, serial_number, email, password) VALUES
('EMP001', 'AutoCAD 2024', 'AC-12345-67890', 'budi@autodesk.com', 'Budi@2024'),
('EMP001', 'Visual Studio 2022', 'VS-54321-09876', 'budi@microsoft.com', 'Budi@2024'),
('EMP001', 'Microsoft Office 365', 'OFF-11111-22222', 'budi@office.com', 'Budi@2024'),
('EMP002', 'Microsoft Office 365', 'OFF-54321-12345', 'siti@office.com', 'Siti@2024'),
('EMP002', 'HRIS System', 'HRIS-2024-001', 'siti@hris.com', 'Siti@2024'),
('EMP002', 'Zoom Business', 'ZOOM-77777-88888', 'siti@zoom.com', 'Siti@2024'),
('EMP003', 'SAP Business One', 'SAP-11111-22222', 'ahmad@sap.com', 'Ahmad@2024'),
('EMP003', 'Microsoft Project', 'PROJ-33333-44444', 'ahmad@microsoft.com', 'Ahmad@2024'),
('EMP003', 'AutoCAD', 'ACAD-55555-66666', 'ahmad@autodesk.com', 'Ahmad@2024'),
('EMP004', 'Accurate Online', 'ACC-77777-88888', 'dewi@accurate.com', 'Dewi@2024'),
('EMP004', 'Microsoft Excel', 'EXCEL-99999-00000', 'dewi@microsoft.com', 'Dewi@2024'),
('EMP004', 'SQL Server', 'SQL-12345-67890', 'dewi@microsoft.com', 'Dewi@2024'),
('EMP005', 'AutoCAD Civil 3D', 'ACAD-55555-66666', 'rizki@autodesk.com', 'Rizki@2024'),
('EMP005', 'Primavera P6', 'P6-77777-88888', 'rizki@oracle.com', 'Rizki@2024'),
('EMP005', 'Microsoft Project', 'PROJ-99999-00000', 'rizki@microsoft.com', 'Rizki@2024');

-- ==================== INSERT SAMPLE DATA INVENTARIS ====================

-- Insert sample data kendaraan
INSERT INTO kendaraan (nomor_plat, jenis, merek, model, tahun, warna, status, kondisi, km_terakhir, lokasi_penyimpanan) VALUES
('B 1234 XYZ', 'Pickup', 'Mitsubishi', 'L300', 2022, 'Silver', 'Tersedia', 'Baik', 12500, 'Garasi Kantor'),
('B 5678 ABC', 'SUV', 'Toyota', 'Fortuner', 2023, 'Hitam', 'Digunakan', 'Baik', 8500, 'Pool Kendaraan'),
('B 9012 DEF', 'Motor', 'Honda', 'Vario 150', 2023, 'Merah', 'Servis', 'Rusak Ringan', 3200, 'Parkiran Motor'),
('B 3456 GHI', 'Pickup', 'Suzuki', 'Carry', 2021, 'Putih', 'Tersedia', 'Baik', 15800, 'Garasi Kantor'),
('B 7890 JKL', 'Sedan', 'Honda', 'Accord', 2022, 'Abu-abu', 'Rusak', 'Rusak Berat', 22300, 'Bengkel');

-- Insert sample data printer
INSERT INTO printer (nomor_inventaris, merek, model, tipe, status, kondisi, lokasi, ip_address) VALUES
('PRN-001', 'Epson', 'L3110', 'Inkjet', 'Digunakan', 'Baik', 'Ruang Admin', '192.168.1.10'),
('PRN-002', 'Canon', 'MF645Cx', 'Laser', 'Tersedia', 'Baik', 'Ruang IT', '192.168.1.20'),
('PRN-003', 'HP', 'LaserJet Pro M402dn', 'Laser', 'Servis', 'Rusak Ringan', 'Ruang Direktur', '192.168.1.30'),
('PRN-004', 'Epson', 'LX-310', 'Dot Matrix', 'Tersedia', 'Baik', 'Gudang', NULL),
('PRN-005', 'Brother', 'DCP-T520W', 'Inkjet', 'Digunakan', 'Baik', 'Ruang Accounting', '192.168.1.40');

-- Insert sample data inventaris laptop
INSERT INTO inventaris_laptop (nomor_inventaris, merek, model, serial_number, spesifikasi, status, kondisi, karyawan_id, lokasi_penyimpanan) VALUES
('LAP-001', 'Lenovo', 'ThinkPad X1 Carbon', 'SN-LEN-001', 'i7-1260P, 16GB DDR5, 512GB NVMe SSD', 'Digunakan Karyawan', 'Baik', 'EMP001', 'Ruang IT'),
('LAP-002', 'Dell', 'Latitude 7430', 'SN-DELL-002', 'i5-1235U, 8GB DDR4, 256GB SSD', 'Tersedia', 'Baik', NULL, 'Ruang Penyimpanan'),
('LAP-003', 'HP', 'EliteBook 840 G9', 'SN-HP-003', 'i7-1255U, 16GB DDR4, 512GB SSD', 'Servis', 'Rusak Ringan', NULL, 'IT Service'),
('LAP-004', 'Apple', 'MacBook Pro M2', 'SN-APP-004', 'M2 Pro, 16GB Unified, 1TB SSD', 'Tersedia', 'Baik', NULL, 'Ruang Direktur'),
('LAP-005', 'Asus', 'ZenBook Pro Duo', 'SN-ASUS-005', 'i9-12900H, 32GB DDR5, 1TB SSD + 1TB HDD', 'Rusak', 'Rusak Berat', NULL, 'Gudang');

-- ==================== INSERT SAMPLE DATA RIWAYAT ====================

-- Insert sample riwayat pemakaian
INSERT INTO riwayat_pemakaian (tipe_barang, barang_id, karyawan_id, tanggal_mulai, tanggal_selesai, keperluan, catatan) VALUES
('Kendaraan', 2, 'EMP003', '2024-01-10 08:00:00', '2024-01-12 17:00:00', 'Dinas ke proyek Site A', 'Perjalanan luar kota'),
('Kendaraan', 1, 'EMP005', '2024-01-15 09:00:00', '2024-01-15 16:00:00', 'Meeting dengan client', 'Kembali tepat waktu'),
('Printer', 1, 'EMP001', '2024-01-01 00:00:00', NULL, 'Penggunaan harian', 'Printer di ruang admin'),
('Laptop', 1, 'EMP001', '2024-01-01 00:00:00', NULL, 'Penggunaan harian', 'Laptop untuk pekerjaan IT');

-- ==================== VIEW UNTUK MEMUDAHKAN QUERY ====================

-- View untuk data karyawan lengkap
CREATE OR REPLACE VIEW v_karyawan_lengkap AS
SELECT 
    k.id,
    k.nama,
    d.nama_divisi AS divisi,
    k.jabatan,
    k.email,
    k.no_hp,
    k.foto,
    l.merek AS laptop_merek,
    l.serial_number AS laptop_sn,
    l.foto AS laptop_foto,
    COUNT(DISTINCT s.id) AS jumlah_software
FROM karyawan k
LEFT JOIN divisi d ON k.divisi_id = d.id
LEFT JOIN laptop l ON k.id = l.karyawan_id
LEFT JOIN software s ON k.id = s.karyawan_id
GROUP BY k.id;

-- View untuk statistik inventaris
CREATE OR REPLACE VIEW v_statistik_inventaris AS
SELECT 
    'Kendaraan' AS tipe,
    COUNT(*) AS total,
    SUM(CASE WHEN status = 'Tersedia' THEN 1 ELSE 0 END) AS tersedia,
    SUM(CASE WHEN status = 'Digunakan' THEN 1 ELSE 0 END) AS digunakan,
    SUM(CASE WHEN status IN ('Servis', 'Rusak') THEN 1 ELSE 0 END) AS masalah
FROM kendaraan
UNION ALL
SELECT 
    'Printer' AS tipe,
    COUNT(*),
    SUM(CASE WHEN status = 'Tersedia' THEN 1 ELSE 0 END),
    SUM(CASE WHEN status = 'Digunakan' THEN 1 ELSE 0 END),
    SUM(CASE WHEN status IN ('Servis', 'Rusak') THEN 1 ELSE 0 END)
FROM printer
UNION ALL
SELECT 
    'Laptop Inventaris' AS tipe,
    COUNT(*),
    SUM(CASE WHEN status = 'Tersedia' THEN 1 ELSE 0 END),
    SUM(CASE WHEN status = 'Digunakan Karyawan' THEN 1 ELSE 0 END),
    SUM(CASE WHEN status IN ('Servis', 'Rusak', 'Hilang') THEN 1 ELSE 0 END)
FROM inventaris_laptop;

-- ==================== INDEX UNTUK OPTIMASI ====================

CREATE INDEX idx_karyawan_divisi ON karyawan(divisi_id);
CREATE INDEX idx_laptop_karyawan ON laptop(karyawan_id);
CREATE INDEX idx_software_karyawan ON software(karyawan_id);
CREATE INDEX idx_inventaris_laptop_karyawan ON inventaris_laptop(karyawan_id);
CREATE INDEX idx_riwayat_barang ON riwayat_pemakaian(tipe_barang, barang_id);
CREATE INDEX idx_riwayat_tanggal ON riwayat_pemakaian(tanggal_mulai);

-- ==================== TRIGGER UNTUK LOGGING ====================

-- Trigger untuk mencatat perubahan status kendaraan
DELIMITER $$
CREATE TRIGGER trg_kendaraan_update
AFTER UPDATE ON kendaraan
FOR EACH ROW
BEGIN
    IF OLD.status != NEW.status THEN
        INSERT INTO riwayat_pemakaian (tipe_barang, barang_id, tanggal_mulai, catatan)
        VALUES ('Kendaraan', NEW.id, NOW(), CONCAT('Status berubah dari ', OLD.status, ' menjadi ', NEW.status));
    END IF;
END$$
DELIMITER ;

-- Tampilkan hasil
SELECT '✅ Database berhasil dibuat!' AS info;
SELECT CONCAT('📊 Total Karyawan: ', COUNT(*)) AS info FROM karyawan;
SELECT CONCAT('🚗 Total Kendaraan: ', COUNT(*)) AS info FROM kendaraan;
SELECT CONCAT('🖨️ Total Printer: ', COUNT(*)) AS info FROM printer;
SELECT CONCAT('💻 Total Laptop Inventaris: ', COUNT(*)) AS info FROM inventaris_laptop;
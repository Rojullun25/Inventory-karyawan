require('dotenv').config();

const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const bodyParser = require('body-parser');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

// ─────────────────────────────────────────────────────────
// MIDDLEWARE: Autentikasi JWT
// Semua route yang pakai requireAuth wajib sertakan header:
//   Authorization: Bearer <token>
// ─────────────────────────────────────────────────────────
const JWT_SECRET = process.env.JWT_SECRET || 'ganti-ini-dengan-secret-kuat-di-.env';
const JWT_EXPIRES_IN = '8h'; // Token expired setelah 8 jam

function requireAuth(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

    if (!token) {
        return res.status(401).json({ success: false, message: 'Akses ditolak. Token tidak ada.' });
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded; // { id, username, role }
        next();
    } catch (err) {
        return res.status(403).json({ success: false, message: 'Token tidak valid atau sudah kadaluarsa.' });
    }
}

// Middleware khusus admin saja
function requireAdmin(req, res, next) {
    if (req.user?.role !== 'admin') {
        return res.status(403).json({ success: false, message: 'Hanya admin yang bisa mengakses ini.' });
    }
    next();
}

const app = express();
const PORT = process.env.PORT || 3000;

// APP_URL: kosong = pakai relative URL (otomatis adapt ke hostname/IP user).
// Set env APP_URL hanya kalau pakai CDN external atau reverse proxy beda domain.
const APP_URL = process.env.APP_URL || '';

// Helper: convert path foto relative → URL absolut berdasarkan request.
// Dipanggil saat membaca data dari DB sebelum dikirim ke client.
function absolutizeUrl(req, urlOrPath) {
    if (!urlOrPath) return urlOrPath;
    // Auto-fix legacy URL yang hardcoded localhost
    if (urlOrPath.startsWith('http://localhost:') || urlOrPath.startsWith('http://127.0.0.1:')) {
        const path = urlOrPath.replace(/^https?:\/\/[^/]+/, '');
        return `${req.protocol}://${req.get('host')}${path}`;
    }
    // External URL (bukan localhost lama) — biarkan
    if (/^https?:\/\//.test(urlOrPath)) return urlOrPath;
    // Relative path → prepend host dari request
    if (urlOrPath.startsWith('/')) return `${req.protocol}://${req.get('host')}${urlOrPath}`;
    return urlOrPath;
}

// Helper: process row(s) untuk convert kolom foto/lampiran jadi URL absolut
function processFotoFields(req, data) {
    if (!data) return data;
    const FOTO_FIELDS = ['foto', 'foto_bukti', 'lampiran', 'foto_kerusakan', 'foto_depan', 'foto_belakang', 'foto_samping'];
    const processOne = (row) => {
        if (!row || typeof row !== 'object') return row;
        FOTO_FIELDS.forEach(field => {
            if (row[field]) {
                // Kalau JSON string (foto laptop kadang JSON), parse, fix, stringify back
                if (typeof row[field] === 'string' && row[field].startsWith('{')) {
                    try {
                        const obj = JSON.parse(row[field]);
                        Object.keys(obj).forEach(k => {
                            if (obj[k]) obj[k] = absolutizeUrl(req, obj[k]);
                        });
                        row[field] = JSON.stringify(obj);
                    } catch(e) {
                        row[field] = absolutizeUrl(req, row[field]);
                    }
                } else {
                    row[field] = absolutizeUrl(req, row[field]);
                }
            }
        });
        return row;
    };
    return Array.isArray(data) ? data.map(processOne) : processOne(data);
}

// Make these helpers available globally to all route handlers
app.locals.absolutizeUrl = absolutizeUrl;
app.locals.processFotoFields = processFotoFields;

// Middleware
app.use(cors());
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true }));

// ─── Middleware: auto-convert foto path jadi URL absolut sesuai request ───
// Trick: override res.json supaya semua response otomatis diproses.
// HARUS safely handle: Date, Buffer, circular refs, dan error apapun
// (kalau gagal, fallback ke original response tanpa convert).
app.use((req, res, next) => {
    const originalJson = res.json.bind(res);
    res.json = (data) => {
        try {
            if (data && typeof data === 'object') {
                const seen = new WeakSet();  // Cegah circular reference
                const walk = (obj) => {
                    if (!obj || typeof obj !== 'object') return;
                    if (seen.has(obj)) return;  // Skip kalau udah dikunjungi
                    if (obj instanceof Date) return;  // Skip Date
                    if (Buffer.isBuffer(obj)) return;  // Skip Buffer
                    seen.add(obj);

                    if (Array.isArray(obj)) {
                        obj.forEach(walk);
                    } else {
                        try { processFotoFields(req, obj); } catch(e) {}
                        // Recurse hanya ke plain object dan array
                        Object.values(obj).forEach(v => {
                            if (v && typeof v === 'object' && !(v instanceof Date) && !Buffer.isBuffer(v)) {
                                walk(v);
                            }
                        });
                    }
                };
                walk(data);
            }
        } catch (err) {
            // Kalau ada error apapun saat walking, log tapi jangan blokir response
            console.warn('[res.json walker] Error:', err.message);
        }
        return originalJson(data);
    };
    next();
});

// Buat folder uploads jika belum ada
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

// Serve file HTML, CSS, JS frontend langsung dari server
// Serve dari backend root (untuk akses langsung file di backend/)
app.use(express.static(path.join(__dirname)));
// Serve dari folder frontend/ — ini yang fix 404 pada database.js, style.css, dll
app.use(express.static(path.join(__dirname, '..', 'frontend')));

// Konfigurasi multer untuk upload file
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'uploads/');
    },
    filename: function (req, file, cb) {
        // Buat nama file unik: timestamp + originalname
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = path.extname(file.originalname);
        cb(null, file.fieldname + '-' + uniqueSuffix + ext);
    }
});

// Filter file yang diizinkan (hanya gambar)
const fileFilter = (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|webp/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);

    if (mimetype && extname) {
        return cb(null, true);
    } else {
        cb(new Error('Hanya file gambar yang diizinkan!'));
    }
};

const upload = multer({ 
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
    fileFilter: fileFilter
});

// Serve static files dari folder uploads
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Koneksi MySQL
const pool = mysql.createPool({
    host:     process.env.DB_HOST     || 'localhost',
    port:     process.env.DB_PORT     || 3306,
    user:     process.env.DB_USER     || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME     || 'karyawan_db',
    waitForConnections: true,
    connectionLimit: 10
});

// ─────────────────────────────────────────────────────────
// API: Login
// POST /api/login  →  { username, password }
// Response: { success, token, user: { id, username, nama_lengkap, role } }
// ─────────────────────────────────────────────────────────
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ success: false, message: 'Username dan password wajib diisi.' });
    }

    pool.query('SELECT * FROM users WHERE username = ?', [username], async (err, rows) => {
        if (err) return res.status(500).json({ success: false, message: 'Terjadi kesalahan server.' });
        if (rows.length === 0) {
            // Pesan sengaja samar supaya tidak bocorkan apakah username ada atau tidak
            return res.status(401).json({ success: false, message: 'Username atau password salah.' });
        }

        const user = rows[0];

        let passwordValid = false;
        try {
            // Bandingkan password dengan hash di DB
            passwordValid = await bcrypt.compare(password, user.password);
        } catch (bcryptErr) {
            console.error('Bcrypt error, falling back to plain text comparison:', bcryptErr.message);
            // Fallback jika password di DB masih berupa plain text
            if (password === user.password) {
                passwordValid = true;
            }
        }

        if (!passwordValid) {
            return res.status(401).json({ success: false, message: 'Username atau password salah.' });
        }

        // Buat JWT token (sertakan karyawan_id supaya endpoint /api/me/* bisa pakai)
        const token = jwt.sign(
            { id: user.id, username: user.username, role: user.role, karyawan_id: user.karyawan_id || null },
            JWT_SECRET,
            { expiresIn: JWT_EXPIRES_IN }
        );

        res.json({
            success: true,
            token,
            user: {
                id: user.id,
                username: user.username,
                nama_lengkap: user.nama_lengkap,
                role: user.role,
                karyawan_id: user.karyawan_id || null,
                must_change_password: user.must_change_password === 1
            }
        });
    });
});

// ─────────────────────────────────────────────────────────
// API: Cek status token (untuk frontend cek apakah masih login)
// GET /api/auth/me  →  kembalikan info user dari token
// ─────────────────────────────────────────────────────────
app.get('/api/auth/me', requireAuth, (req, res) => {
    res.json({ success: true, user: req.user });
});

// Test koneksi
app.get('/api/test', (req, res) => {
    pool.query('SELECT 1 + 1 AS hasil', (error, results) => {
        if (error) {
            return res.status(500).json({ success: false, message: error.message });
        }
        res.json({ success: true, message: 'Database connected!', data: results[0].hasil });
    });
});

// API: Get all karyawan
app.get('/api/karyawan', requireAuth, (req, res) => {
    const query = `
        SELECT 
            k.*,
            k.perusahaan,
            d.nama_divisi as divisi,
            il.id as inventaris_laptop_id,
            il.nomor_inventaris as laptop_nomor_inv,
            il.merek as laptop_merek,
            il.model as laptop_model,
            il.serial_number as snLaptop,
            il.foto as fotoLaptopRaw,
            (SELECT COUNT(*) FROM software WHERE karyawan_id = k.id) as total_software
        FROM karyawan k
        LEFT JOIN divisi d ON k.divisi_id = d.id
        LEFT JOIN inventaris_laptop il ON il.karyawan_id = k.id AND il.status = 'Digunakan Karyawan'
        ORDER BY k.id ASC
    `;
    
    pool.query(query, (error, rows) => {
        if (error) return res.status(500).json({ success: false, message: error.message });
        if (rows.length === 0) return res.json([]);
        
        const karyawanWithSoftware = [];
        let processed = 0;
        
        rows.forEach((karyawan, index) => {
            // Parse foto laptop dari JSON
            let fotoLaptop = null;
            try {
                const fotoObj = karyawan.fotoLaptopRaw ? JSON.parse(karyawan.fotoLaptopRaw) : {};
                fotoLaptop = fotoObj.depan || null;
            } catch(e) {}

            pool.query(
                'SELECT id, nama, serial_number as sn, email FROM software WHERE karyawan_id = ?',
                [karyawan.id],
                (err, software) => {
                    if (err) software = [];
                    
                    karyawanWithSoftware[index] = {
                        ...karyawan,
                        fotoLaptopRaw: undefined,
                        fotoLaptop: fotoLaptop,
                        laptop: karyawan.laptop_merek
                            ? `${karyawan.laptop_merek}${karyawan.laptop_model ? ' ' + karyawan.laptop_model : ''}`
                            : null,
                        software: software || [],
                        total_software: software?.length || 0
                    };
                    
                    processed++;
                    if (processed === rows.length) res.json(karyawanWithSoftware);
                }
            );
        });
    });
});

// API: Get karyawan by ID
app.get('/api/karyawan/:id', requireAuth, (req, res) => {
    const { id } = req.params;
    
    const query = `
        SELECT 
            k.*,
            k.perusahaan,
            d.nama_divisi as divisi,
            il.id as inventaris_laptop_id,
            il.nomor_inventaris as laptop_nomor_inv,
            il.merek as laptop_merek,
            il.model as laptop_model,
            il.serial_number as snLaptop,
            il.foto as fotoLaptopRaw
        FROM karyawan k
        LEFT JOIN divisi d ON k.divisi_id = d.id
        LEFT JOIN inventaris_laptop il ON il.karyawan_id = k.id AND il.status = 'Digunakan Karyawan'
        WHERE k.id = ?
    `;
    
    pool.query(query, [id], (error, rows) => {
        if (error) return res.status(500).json({ success: false, message: error.message });
        if (rows.length === 0) return res.status(404).json({ success: false, message: 'Karyawan tidak ditemukan' });
        
        const karyawan = rows[0];

        let fotoLaptop = null;
        try {
            const fotoObj = karyawan.fotoLaptopRaw ? JSON.parse(karyawan.fotoLaptopRaw) : {};
            fotoLaptop = fotoObj.depan || null;
        } catch(e) {}

        karyawan.fotoLaptop = fotoLaptop;
        karyawan.laptop = karyawan.laptop_merek
            ? `${karyawan.laptop_merek}${karyawan.laptop_model ? ' ' + karyawan.laptop_model : ''}`
            : null;
        delete karyawan.fotoLaptopRaw;
        
        pool.query(
            'SELECT nama, serial_number as sn, email FROM software WHERE karyawan_id = ?',
            [id],
            (err, software) => {
                if (err) console.error('Software error:', err);
                karyawan.software = software || [];
                res.json(karyawan);
            }
        );
    });
});

// API: Get all divisi
app.get('/api/divisi', requireAuth, (req, res) => {
    pool.query('SELECT * FROM divisi ORDER BY nama_divisi', (err, rows) => {
        if (err) return res.status(500).json({ success: false, message: err.message });
        res.json(rows);
    });
});

// API: Tambah karyawan
app.post('/api/karyawan', requireAuth, upload.single('foto'), (req, res) => {
    const { id, nama, divisi, jabatan, email, no_hp, software, inventaris_laptop_id, perusahaan } = req.body;
    let softwareArray = [];
    try { softwareArray = software ? JSON.parse(software) : []; } catch(e) {}

    if (!id || !nama || !divisi) {
        if (req.file) fs.unlinkSync(req.file.path);
        return res.status(400).json({ success: false, message: 'ID, Nama, dan Divisi harus diisi' });
    }

    const fotoUrl = req.file ? `${APP_URL}/uploads/${req.file.filename}` : null;

    pool.getConnection((err, conn) => {
        if (err) { if (req.file) fs.unlinkSync(req.file.path); return res.status(500).json({ success: false, message: err.message }); }

        conn.beginTransaction(err => {
            if (err) { conn.release(); return res.status(500).json({ success: false, message: err.message }); }

            conn.query('SELECT id FROM divisi WHERE nama_divisi = ?', [divisi], (err, divisiRows) => {
                if (err || divisiRows.length === 0) {
                    return conn.rollback(() => { conn.release(); res.status(400).json({ success: false, message: 'Divisi tidak ditemukan' }); });
                }
                const divisi_id = divisiRows[0].id;
                const verify_token = crypto.randomBytes(24).toString('hex'); // 48-char unik token

                conn.query(
                    'INSERT INTO karyawan (id, nama, divisi_id, jabatan, email, no_hp, foto, perusahaan, verify_token) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
                    [id, nama, divisi_id, jabatan || null, email || null, no_hp || null, fotoUrl, perusahaan || null, verify_token],
                    (err) => {
                        if (err) return conn.rollback(() => { conn.release(); res.status(500).json({ success: false, message: err.message }); });

                        // Assign laptop inventaris ke karyawan jika dipilih
                        const doAssignLaptop = (cb) => {
                            if (!inventaris_laptop_id) return cb();
                            conn.query(
                                `UPDATE inventaris_laptop SET karyawan_id = NULL, status = 'Tersedia' WHERE karyawan_id = ? AND id != ?`,
                                [id, inventaris_laptop_id],
                                () => {
                                    conn.query(
                                        `UPDATE inventaris_laptop SET karyawan_id = ?, status = 'Digunakan Karyawan' WHERE id = ?`,
                                        [id, inventaris_laptop_id],
                                        (err) => {
                                            if (err) console.error('Assign laptop error:', err);
                                            // Log riwayat (di luar transaction supaya tidak mengganggu rollback)
                                            // Pakai pool langsung, bukan conn
                                            setImmediate(() => {
                                                logRiwayatChange('laptop', inventaris_laptop_id, null, id, null, req.user, () => {});
                                            });
                                            cb();
                                        }
                                    );
                                }
                            );
                        };

                        doAssignLaptop(() => {
                            const validSW = softwareArray.filter(s => s.nama && s.nama.trim());
                            if (validSW.length === 0) return doCommit();
                            let done = 0;
                            validSW.forEach(sw => {
                                conn.query(
                                    'INSERT INTO software (karyawan_id, nama, serial_number, email, password) VALUES (?, ?, ?, ?, ?)',
                                    [id, sw.nama, sw.sn || null, sw.email || null, sw.password || null],
                                    () => { if (++done === validSW.length) doCommit(); }
                                );
                            });
                        });

                        function doCommit() {
                            conn.commit(err => {
                                conn.release();
                                if (err) return res.status(500).json({ success: false, message: err.message });
                                console.log('✅ Karyawan added:', id);
                                res.json({ success: true, message: 'Karyawan berhasil ditambahkan' });
                            });
                        }
                    }
                );
            });
        });
    });
});

// API: Update karyawan
app.put('/api/karyawan/:id', requireAuth, upload.single('foto'), (req, res) => {
    const { id: oldId } = req.params;
    const { id: newIdRaw, nama, divisi, jabatan, email, no_hp, software, inventaris_laptop_id, unassign_laptop, perusahaan } = req.body;
    let softwareArray = [];
    try { softwareArray = software ? JSON.parse(software) : []; } catch(e) {}

    if (!nama || !divisi) return res.status(400).json({ success: false, message: 'Nama dan Divisi harus diisi' });

    // Cek apakah ID berubah (rename primary key)
    const newId = (newIdRaw && String(newIdRaw).trim()) || oldId;
    const idChanged = newId !== oldId;

    pool.getConnection((err, conn) => {
        if (err) return res.status(500).json({ success: false, message: err.message });

        conn.beginTransaction(err => {
            if (err) { conn.release(); return res.status(500).json({ success: false, message: err.message }); }

            // Helper untuk rollback + response error
            const fail = (status, msg) => conn.rollback(() => { conn.release(); res.status(status).json({ success: false, message: msg }); });

            // ─── Kalau ID berubah, cek dulu apakah ID baru sudah dipakai karyawan lain ───
            const checkIdAvailable = (cb) => {
                if (!idChanged) return cb();
                conn.query('SELECT id FROM karyawan WHERE id = ?', [newId], (err, rows) => {
                    if (err) return fail(500, err.message);
                    if (rows.length > 0) return fail(400, `ID karyawan "${newId}" sudah dipakai karyawan lain. Pilih ID lain.`);
                    cb();
                });
            };

            checkIdAvailable(() => {
                conn.query('SELECT id FROM divisi WHERE nama_divisi = ?', [divisi], (err, divisiRows) => {
                    if (err || divisiRows.length === 0) return fail(400, 'Divisi tidak ditemukan');
                    const divisi_id = divisiRows[0].id;

                    // Ambil foto lama
                    conn.query('SELECT foto FROM karyawan WHERE id = ?', [oldId], (err, oldRows) => {
                        if (err) return fail(500, err.message);
                        if (oldRows.length === 0) return fail(404, 'Karyawan tidak ditemukan');

                        let fotoUrl = null;
                        if (req.file) {
                            fotoUrl = `${APP_URL}/uploads/${req.file.filename}`;
                            // Hapus foto lama
                            if (oldRows[0]?.foto) {
                                const oldPath = path.join(__dirname, 'uploads', path.basename(oldRows[0].foto));
                                if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
                            }
                        }

                        // ─── Update karyawan (termasuk id baru kalau berubah & no_hp) ───
                        const updateSql = idChanged
                            ? 'UPDATE karyawan SET id=?, nama=?, divisi_id=?, jabatan=?, email=?, no_hp=?, foto=COALESCE(?,foto), perusahaan=? WHERE id=?'
                            : 'UPDATE karyawan SET nama=?, divisi_id=?, jabatan=?, email=?, no_hp=?, foto=COALESCE(?,foto), perusahaan=? WHERE id=?';
                        const updateParams = idChanged
                            ? [newId, nama, divisi_id, jabatan || null, email || null, no_hp || null, fotoUrl, perusahaan || null, oldId]
                            : [nama, divisi_id, jabatan || null, email || null, no_hp || null, fotoUrl, perusahaan || null, oldId];

                        conn.query(updateSql, updateParams, (err, result) => {
                            if (err) return fail(500, err.message);
                            if (result.affectedRows === 0) return fail(404, 'Karyawan tidak ditemukan');

                            // ─── Kalau ID berubah, propagate ke semua tabel anak ───
                            const propagateIdChange = (cb) => {
                                if (!idChanged) return cb();
                                // Daftar tabel yang punya kolom karyawan_id
                                const updates = [
                                    ['inventaris_laptop', 'karyawan_id'],
                                    ['handphone', 'karyawan_id'],
                                    ['drone', 'karyawan_id'],
                                    ['software', 'karyawan_id'],
                                    ['users', 'karyawan_id'],
                                    ['pengajuan_izin', 'karyawan_id'],
                                    ['saldo_cuti', 'karyawan_id'],
                                    ['riwayat_pemakaian', 'karyawan_id'],
                                    ['license_assignment', 'karyawan_id']
                                ];
                                let done = 0;
                                let hadError = false;
                                updates.forEach(([tbl, col]) => {
                                    conn.query(`UPDATE \`${tbl}\` SET \`${col}\` = ? WHERE \`${col}\` = ?`, [newId, oldId], (err) => {
                                        // Silent fallback kalau tabel/kolom belum ada (misal drone belum dimigrate)
                                        if (err && err.code !== 'ER_NO_SUCH_TABLE' && err.code !== 'ER_BAD_FIELD_ERROR') {
                                            console.warn(`⚠️  Update ${tbl}.${col} failed:`, err.message);
                                        }
                                        if (++done === updates.length) cb();
                                    });
                                });
                            };

                            propagateIdChange(() => {
                                // ─── ID untuk operasi selanjutnya pakai newId (karena oldId udah berubah) ───
                                const currentId = newId;

                            // Handle laptop inventaris
                            const doLaptop = (cb) => {
                                if (unassign_laptop === 'true') {
                                    // Cari semua laptop karyawan ini dulu untuk di-log
                                    conn.query(
                                        `SELECT id FROM inventaris_laptop WHERE karyawan_id = ?`,
                                        [currentId],
                                        (err, oldLaptops) => {
                                            // Lepas semua laptop dari karyawan ini
                                            conn.query(
                                                `UPDATE inventaris_laptop SET karyawan_id = NULL, status = 'Tersedia' WHERE karyawan_id = ?`,
                                                [currentId],
                                                () => {
                                                    // Log riwayat untuk tiap laptop yang di-unassign
                                                    if (oldLaptops && oldLaptops.length > 0) {
                                                        oldLaptops.forEach(lp => {
                                                            setImmediate(() => {
                                                                logRiwayatChange('laptop', lp.id, currentId, null, null, req.user, () => {});
                                                            });
                                                        });
                                                    }
                                                    cb();
                                                }
                                            );
                                        }
                                    );
                                } else if (inventaris_laptop_id) {
                                    // Cari laptop lama (yang akan dilepas) untuk di-log
                                    conn.query(
                                        `SELECT id FROM inventaris_laptop WHERE karyawan_id = ? AND id != ?`,
                                        [currentId, inventaris_laptop_id],
                                        (err, oldLaptops) => {
                                            // Lepas laptop lain dulu
                                            conn.query(
                                                `UPDATE inventaris_laptop SET karyawan_id = NULL, status = 'Tersedia' WHERE karyawan_id = ? AND id != ?`,
                                                [currentId, inventaris_laptop_id],
                                                () => {
                                                    conn.query(
                                                        `UPDATE inventaris_laptop SET karyawan_id = ?, status = 'Digunakan Karyawan' WHERE id = ?`,
                                                        [currentId, inventaris_laptop_id],
                                                        () => {
                                                            // Log riwayat: laptop lama di-unassign
                                                            if (oldLaptops && oldLaptops.length > 0) {
                                                                oldLaptops.forEach(lp => {
                                                                    setImmediate(() => {
                                                                        logRiwayatChange('laptop', lp.id, currentId, null, null, req.user, () => {});
                                                                    });
                                                                });
                                                            }
                                                            // Log riwayat: laptop baru di-assign (cek dulu apakah memang berubah)
                                                            setImmediate(() => {
                                                                pool.query(
                                                                    'SELECT karyawan_id FROM riwayat_pemakaian WHERE tipe_barang=? AND barang_id=? AND tanggal_return IS NULL ORDER BY tanggal_assign DESC LIMIT 1',
                                                                    ['laptop', inventaris_laptop_id],
                                                                    (e, r) => {
                                                                        const oldOwner = r && r.length > 0 ? r[0].karyawan_id : null;
                                                                        if (oldOwner !== currentId) {
                                                                            logRiwayatChange('laptop', inventaris_laptop_id, oldOwner, currentId, null, req.user, () => {});
                                                                        }
                                                                    }
                                                                );
                                                            });
                                                            cb();
                                                        }
                                                    );
                                                }
                                            );
                                        }
                                    );
                                } else { cb(); }
                            };

                            doLaptop(() => {
                                // Update software: hapus lama, insert baru
                                conn.query('DELETE FROM software WHERE karyawan_id = ?', [currentId], () => {
                                    const validSW = softwareArray.filter(s => s.nama && s.nama.trim());
                                    if (validSW.length === 0) return doCommit();
                                    let done = 0;
                                    validSW.forEach(sw => {
                                        conn.query(
                                            'INSERT INTO software (karyawan_id, nama, serial_number, email, password) VALUES (?, ?, ?, ?, ?)',
                                            [currentId, sw.nama, sw.sn || null, sw.email || null, sw.password || null],
                                            () => { if (++done === validSW.length) doCommit(); }
                                        );
                                    });
                                });
                            });

                            function doCommit() {
                                conn.commit(err => {
                                    conn.release();
                                    if (err) return res.status(500).json({ success: false, message: err.message });
                                    console.log('✅ Karyawan updated:', currentId + (idChanged ? ' (renamed from ' + oldId + ')' : ''));
                                    res.json({ success: true, message: idChanged ? `Karyawan berhasil diupdate (ID berubah: ${oldId} → ${currentId})` : 'Karyawan berhasil diupdate' });
                                });
                            }
                        }
                    );
                            }); // end propagateIdChange callback
                });
            });
            }); // end checkIdAvailable callback
        });
    });
});

// API: Delete karyawan
app.delete('/api/karyawan/:id', requireAuth, (req, res) => {
    const { id } = req.params;
    pool.query('SELECT foto FROM karyawan WHERE id = ?', [id], (err, kRows) => {
        // Cari semua laptop & handphone yang dipakai karyawan ini untuk di-log
        pool.query(`SELECT id FROM inventaris_laptop WHERE karyawan_id = ?`, [id], (err, oldLaptops) => {
            pool.query(`SELECT id FROM handphone WHERE karyawan_id = ?`, [id], (err, oldHps) => {
                // Lepas semua barang dari karyawan ini
                pool.query(`UPDATE inventaris_laptop SET karyawan_id = NULL, status = 'Tersedia' WHERE karyawan_id = ?`, [id], () => {
                    pool.query(`UPDATE handphone SET karyawan_id = NULL, status = 'Tersedia' WHERE karyawan_id = ?`, [id], () => {
                        // Lepas drone juga (silent fallback kalau tabel belum ada)
                        pool.query(`UPDATE drone SET karyawan_id = NULL, status = 'Tersedia' WHERE karyawan_id = ?`, [id], () => {
                            pool.query('DELETE FROM karyawan WHERE id = ?', [id], (err, result) => {
                                if (err) return res.status(500).json({ success: false, message: err.message });
                                if (result.affectedRows === 0) return res.status(404).json({ success: false, message: 'Karyawan tidak ditemukan' });

                                // Log riwayat: tutup semua riwayat aktif karyawan ini
                                pool.query(
                                    `UPDATE riwayat_pemakaian
                                     SET tanggal_return = NOW(),
                                         returned_by_user_id = ?,
                                         returned_by_username = ?,
                                         catatan_return = 'Auto-return karena karyawan dihapus dari sistem'
                                     WHERE karyawan_id = ? AND tanggal_return IS NULL`,
                                    [req.user.id, req.user.username, id],
                                    () => {}
                                );

                                // Hapus foto fisik
                                if (kRows[0]?.foto) {
                                    const p = path.join(__dirname, 'uploads', path.basename(kRows[0].foto));
                                    if (fs.existsSync(p)) fs.unlinkSync(p);
                                }
                                res.json({ success: true, message: 'Karyawan berhasil dihapus' });
                            });
                        });
                    });
                });
            });
        });
    });
});

// ─────────────────────────────────────────────────────────
// API: Verifikasi keaslian kartu karyawan
// ─────────────────────────────────────────────────────────
// API: Profil publik karyawan (untuk halaman QR scan)
// GET /api/public/karyawan/:id
// TIDAK perlu login — hanya return data yang aman ditampilkan publik.
// Tidak ada: password, verify_token, software credentials.
// ─────────────────────────────────────────────────────────
app.get('/api/public/karyawan/:id', (req, res) => {
    const { id } = req.params;

    const query = `
        SELECT
            k.id, k.nama, k.jabatan, k.email, k.foto, k.perusahaan, k.no_hp,
            d.nama_divisi as divisi,
            il.nomor_inventaris as laptop_nomor_inv,
            il.merek as laptop_merek,
            il.model as laptop_model
        FROM karyawan k
        LEFT JOIN divisi d ON k.divisi_id = d.id
        LEFT JOIN inventaris_laptop il ON il.karyawan_id = k.id AND il.status = 'Digunakan Karyawan'
        WHERE k.id = ?
    `;

    pool.query(query, [id], (error, rows) => {
        if (error) return res.status(500).json({ success: false, message: 'Terjadi kesalahan server.' });
        if (rows.length === 0) return res.status(404).json({ success: false, message: 'Karyawan tidak ditemukan' });

        const k = rows[0];
        k.laptop = k.laptop_merek
            ? `${k.laptop_merek}${k.laptop_model ? ' ' + k.laptop_model : ''}`
            : null;
        delete k.laptop_merek;
        delete k.laptop_model;

        res.json(k);
    });
});

// GET /api/verify?id=WGJ-001&token=abc123...
// ─────────────────────────────────────────────────────────
app.get('/api/verify', (req, res) => {
    const { id, token } = req.query;
    if (!id || !token) {
        return res.json({ valid: false, reason: 'Parameter tidak lengkap' });
    }

    const query = `
        SELECT k.id, k.nama, k.jabatan, k.perusahaan, k.foto, k.verify_token,
               d.nama_divisi as divisi
        FROM karyawan k
        LEFT JOIN divisi d ON k.divisi_id = d.id
        WHERE k.id = ?
    `;
    pool.query(query, [id], (err, rows) => {
        if (err) return res.status(500).json({ valid: false, reason: 'Database error' });
        if (rows.length === 0) return res.json({ valid: false, reason: 'ID karyawan tidak ditemukan' });

        const k = rows[0];

        // Bandingkan token secara aman (timing-safe)
        const isValid = k.verify_token &&
            token.length === k.verify_token.length &&
            crypto.timingSafeEqual(Buffer.from(token), Buffer.from(k.verify_token));

        if (isValid) {
            res.json({
                valid: true,
                karyawan: {
                    id: k.id,
                    nama: k.nama,
                    jabatan: k.jabatan || '-',
                    divisi: k.divisi || '-',
                    perusahaan: k.perusahaan || '-',
                    foto: k.foto || null,
                },
                verified_at: new Date().toISOString()
            });
        } else {
            res.json({ valid: false, reason: 'Token tidak valid — kartu ini mungkin palsu atau sudah kadaluarsa' });
        }
    });
});

// ─────────────────────────────────────────────────────────
// API: Regenerate verify_token (jika kartu hilang/dicuri)
// POST /api/karyawan/:id/regenerate-token
// (hanya bisa dipanggil dari sistem internal, butuh login)
// ─────────────────────────────────────────────────────────
app.post('/api/karyawan/:id/regenerate-token', requireAuth, requireAdmin, (req, res) => {
    const { id } = req.params;
    const newToken = crypto.randomBytes(24).toString('hex');
    pool.query('UPDATE karyawan SET verify_token = ? WHERE id = ?', [newToken, id], (err, result) => {
        if (err) return res.status(500).json({ success: false, message: err.message });
        if (result.affectedRows === 0) return res.status(404).json({ success: false, message: 'Karyawan tidak ditemukan' });
        console.log('🔄 Token regenerated for:', id);
        res.json({ success: true, message: 'Token berhasil direset. Cetak ulang kartu karyawan.' });
    });
});

// ─────────────────────────────────────────────────────────
// SHORT URL untuk QR Code di kartu ID karyawan
// GET /q/:token
// Tujuan: persingkat URL agar QR code lebih simpel & mudah di-scan dari HP.
// Token (48 char hex) di-lookup ke karyawan, lalu redirect ke profil publik.
// URL pendek (~ 85 char) jauh lebih scannable daripada URL panjang
// (~ 150+ char) yang sebelumnya menyebabkan QR jadi padat & sulit dibaca kamera.
//
// Setup arsitektur:
//   - Apache (XAMPP) di port 80 → serve frontend dari htdocs
//   - Node.js Express di port 3000 → handle API + endpoint /q/:token
//
// Jadi setelah HP scan QR (ke port 3000), Node.js redirect ke URL profil
// di Apache (port 80). Path-nya configurable via env variable PROFILE_URL_BASE.
// Default: '/Inventory-karyawan/frontend/profil-karyawan.html' (relative ke host).
// ─────────────────────────────────────────────────────────
const PROFILE_URL_BASE = process.env.PROFILE_URL_BASE
    || '/Inventory-karyawan/frontend/profil-karyawan.html';

app.get('/q/:token', (req, res) => {
    const { token } = req.params;
    if (!token || token.length !== 48) {
        return res.status(400).send('Token tidak valid');
    }
    // Build redirect URL — kalau PROFILE_URL_BASE pakai full URL (http://...),
    // langsung dipakai. Kalau path relatif, dibuild dari host header dengan port 80.
    const buildRedirectUrl = (id) => {
        const params = `view=${encodeURIComponent(id || '')}&token=${encodeURIComponent(token)}`;
        if (PROFILE_URL_BASE.startsWith('http://') || PROFILE_URL_BASE.startsWith('https://')) {
            return `${PROFILE_URL_BASE}?${params}`;
        }
        // Relatif: pakai hostname dari request, force ke port 80 (Apache)
        const host = req.hostname; // contoh: "10.100.203.51"
        return `http://${host}${PROFILE_URL_BASE}?${params}`;
    };

    pool.query('SELECT id FROM karyawan WHERE verify_token = ? LIMIT 1', [token], (err, rows) => {
        if (err) {
            console.error('[/q/:token] DB error:', err);
            return res.status(500).send('Terjadi kesalahan server');
        }
        if (rows.length === 0) {
            // Token tidak cocok — biarkan profil-karyawan.html yang handle (akan tampil "tidak valid")
            return res.redirect(buildRedirectUrl(''));
        }
        const id = rows[0].id;
        res.redirect(buildRedirectUrl(id));
    });
});

// ─────────────────────────────────────────────────────────
// API: Lihat password software milik karyawan (ADMIN ONLY)
// GET /api/karyawan/:id/software-credentials
// Password hanya bisa dilihat oleh admin yang sudah login.
// ─────────────────────────────────────────────────────────
app.get('/api/karyawan/:id/software-credentials', requireAuth, requireAdmin, (req, res) => {
    const { id } = req.params;
    pool.query(
        'SELECT id, nama, serial_number as sn, email, password FROM software WHERE karyawan_id = ?',
        [id],
        (err, rows) => {
            if (err) return res.status(500).json({ success: false, message: 'Terjadi kesalahan server.' });
            res.json({ success: true, data: rows });
        }
    );
});

// API: Get laptop inventaris tersedia (untuk dropdown di form karyawan)
app.get('/api/inventaris-laptop/tersedia', requireAuth, (req, res) => {
    const karyawanId = req.query.karyawan_id || null;
    pool.query(
        `SELECT il.id, il.nomor_inventaris, il.merek, il.model, il.serial_number, il.status, il.kondisi, il.foto
         FROM inventaris_laptop il
         WHERE il.status IN ('Tersedia', 'Digunakan Karyawan')
           AND (il.karyawan_id IS NULL OR il.karyawan_id = ?)
         ORDER BY il.merek, il.model`,
        [karyawanId],
        (err, rows) => {
            if (err) return res.status(500).json({ success: false, message: err.message });
            const result = rows.map(r => {
                let fotoDepan = null;
                try { fotoDepan = r.foto ? JSON.parse(r.foto).depan : null; } catch(e) {}
                return { ...r, foto_depan: fotoDepan, foto: undefined };
            });
            res.json(result);
        }
    );
});

// ==================== INVENTARIS API ====================

// --- HANDPHONE ---
app.get('/api/handphone', requireAuth, (req, res) => {
    const query = `
        SELECT h.*, k.nama as karyawan_nama
        FROM handphone h
        LEFT JOIN karyawan k ON h.karyawan_id = k.id
        ORDER BY h.created_at DESC
    `;
    pool.query(query, (err, rows) => {
        if (err) return res.status(500).json({ success: false, message: err.message });
        const result = rows.map(r => {
            let foto_depan = null;
            try { foto_depan = r.foto ? JSON.parse(r.foto).depan : null; } catch(e) {}
            return { ...r, foto_depan, foto: undefined };
        });
        res.json(result);
    });
});

app.post('/api/handphone', requireAuth, upload.single('foto'), (req, res) => {
    const { nomor_inventaris, merek, model, serial_number, spesifikasi, warna, status, kondisi, karyawan_id, nomor_sim, lokasi_penyimpanan, catatan, harga_beli, tanggal_beli } = req.body;
    if (!nomor_inventaris || !merek) return res.status(400).json({ success: false, message: 'Nomor inventaris dan merek harus diisi' });
    const fotoUrl = req.file ? `${APP_URL}/uploads/${req.file.filename}` : null;
    const fotoJson = JSON.stringify({ depan: fotoUrl });

    // Normalisasi harga & tanggal
    const hargaBeliVal = (harga_beli === undefined || harga_beli === null || harga_beli === '')
        ? null : parseFloat(harga_beli);
    const tanggalBeliVal = tanggal_beli || null;

    pool.query(
        `INSERT INTO handphone (nomor_inventaris, merek, model, serial_number, spesifikasi, warna, status, kondisi, karyawan_id, nomor_sim, lokasi_penyimpanan, catatan, foto, harga_beli, tanggal_beli)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [nomor_inventaris, merek, model||null, serial_number||null, spesifikasi||null, warna||null, status||'Tersedia', kondisi||'Baik', karyawan_id||null, nomor_sim||null, lokasi_penyimpanan||null, catatan||null, fotoJson, hargaBeliVal, tanggalBeliVal],
        (err, result) => {
            if (err) return res.status(500).json({ success: false, message: err.message });
            res.json({ success: true, message: 'Handphone berhasil ditambahkan', id: result.insertId });
        }
    );
});

app.put('/api/handphone/:id', requireAuth, upload.single('foto'), (req, res) => {
    const { id } = req.params;
    const { nomor_inventaris, merek, model, serial_number, spesifikasi, warna, status, kondisi, karyawan_id, nomor_sim, lokasi_penyimpanan, catatan, foto_existing, harga_beli, tanggal_beli } = req.body;
    if (!nomor_inventaris || !merek) return res.status(400).json({ success: false, message: 'Nomor inventaris dan merek harus diisi' });
    const fotoUrl = req.file ? `${APP_URL}/uploads/${req.file.filename}` : null;
    const fotoJson = JSON.stringify({ depan: fotoUrl || foto_existing || null });

    // Normalisasi harga & tanggal
    const hargaBeliVal = (harga_beli === undefined || harga_beli === null || harga_beli === '')
        ? null : parseFloat(harga_beli);
    const tanggalBeliVal = tanggal_beli || null;

    // STEP 1: Ambil karyawan_id LAMA dari tabel
    pool.query('SELECT karyawan_id FROM handphone WHERE id = ?', [id], (err, oldRows) => {
        if (err) return res.status(500).json({ success: false, message: err.message });
        if (oldRows.length === 0) return res.status(404).json({ success: false, message: 'Data tidak ditemukan' });

        const oldKaryawanId = oldRows[0].karyawan_id || null;
        const newKaryawanId = karyawan_id || null;

        // STEP 2: Cleanup HP lain milik karyawan baru (1 karyawan = 1 HP aktif)
        const cleanupOldHps = (cb) => {
            if (!newKaryawanId || newKaryawanId === oldKaryawanId) return cb();

            pool.query(
                `SELECT id FROM handphone WHERE karyawan_id = ? AND id != ? AND status = 'Digunakan Karyawan'`,
                [newKaryawanId, id],
                (err, otherHps) => {
                    if (err || !otherHps || otherHps.length === 0) return cb();

                    pool.query(
                        `UPDATE handphone SET karyawan_id = NULL, status = 'Tersedia' WHERE karyawan_id = ? AND id != ? AND status = 'Digunakan Karyawan'`,
                        [newKaryawanId, id],
                        () => {
                            otherHps.forEach(hp => {
                                setImmediate(() => {
                                    logRiwayatChange('handphone', hp.id, newKaryawanId, null, null, req.user, () => {});
                                });
                            });
                            cb();
                        }
                    );
                }
            );
        };

        cleanupOldHps(() => {
            // STEP 3: Update HP ini
            pool.query(
                `UPDATE handphone SET nomor_inventaris=?, merek=?, model=?, serial_number=?, spesifikasi=?, warna=?, status=?, kondisi=?, karyawan_id=?, nomor_sim=?, lokasi_penyimpanan=?, catatan=?, foto=?, harga_beli=?, tanggal_beli=? WHERE id=?`,
                [nomor_inventaris, merek, model||null, serial_number||null, spesifikasi||null, warna||null, status||'Tersedia', kondisi||'Baik', newKaryawanId, nomor_sim||null, lokasi_penyimpanan||null, catatan||null, fotoJson, hargaBeliVal, tanggalBeliVal, id],
                (err, result) => {
                    if (err) return res.status(500).json({ success: false, message: err.message });
                    if (result.affectedRows === 0) return res.status(404).json({ success: false, message: 'Data tidak ditemukan' });

                    // STEP 4: Log riwayat (pakai oldKaryawanId dari tabel, bukan dari riwayat)
                    logRiwayatChange('handphone', id, oldKaryawanId, newKaryawanId, kondisi, req.user, () => {
                        res.json({ success: true, message: 'Handphone berhasil diupdate' });
                    });
                }
            );
        });
    });
});

app.delete('/api/handphone/:id', requireAuth, (req, res) => {
    pool.query('DELETE FROM handphone WHERE id = ?', [req.params.id], (err, result) => {
        if (err) return res.status(500).json({ success: false, message: err.message });
        if (result.affectedRows === 0) return res.status(404).json({ success: false, message: 'Data tidak ditemukan' });
        res.json({ success: true, message: 'Handphone berhasil dihapus' });
    });
});



// --- KENDARAAN ---
app.get('/api/kendaraan', requireAuth, (req, res) => {
    pool.query('SELECT * FROM kendaraan ORDER BY created_at DESC', (err, rows) => {
        if (err) return res.status(500).json({ success: false, message: err.message });
        res.json(rows);
    });
});

app.post('/api/kendaraan', requireAuth, upload.single('foto'), (req, res) => {
    const { nomor_plat, jenis, merek, model, tahun, warna, status, kondisi, km_terakhir, harga_beli, tanggal_beli, lokasi_penyimpanan, catatan } = req.body;
    if (!nomor_plat || !jenis) return res.status(400).json({ success: false, message: 'Nomor plat dan jenis harus diisi' });

    // Normalisasi harga & tanggal: kosong → null
    const hargaBeliVal = (harga_beli === undefined || harga_beli === null || harga_beli === '')
        ? null : parseFloat(harga_beli);
    const tanggalBeliVal = tanggal_beli || null;
    const fotoUrl = req.file ? `${APP_URL}/uploads/${req.file.filename}` : null;

    pool.query(
        `INSERT INTO kendaraan (nomor_plat, jenis, merek, model, tahun, warna, status, kondisi, km_terakhir, harga_beli, tanggal_beli, lokasi_penyimpanan, catatan, foto)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [nomor_plat, jenis, merek||null, model||null, tahun||null, warna||null, status||'Tersedia', kondisi||'Baik', km_terakhir||0, hargaBeliVal, tanggalBeliVal, lokasi_penyimpanan||null, catatan||null, fotoUrl],
        (err, result) => {
            if (err) return res.status(500).json({ success: false, message: err.message });
            res.json({ success: true, message: 'Kendaraan berhasil ditambahkan', id: result.insertId });
        }
    );
});

app.put('/api/kendaraan/:id', requireAuth, upload.single('foto'), (req, res) => {
    const { id } = req.params;
    const { nomor_plat, jenis, merek, model, tahun, warna, status, kondisi, km_terakhir, harga_beli, tanggal_beli, lokasi_penyimpanan, catatan, foto_existing } = req.body;
    if (!nomor_plat || !jenis) return res.status(400).json({ success: false, message: 'Nomor plat dan jenis harus diisi' });

    const hargaBeliVal = (harga_beli === undefined || harga_beli === null || harga_beli === '')
        ? null : parseFloat(harga_beli);
    const tanggalBeliVal = tanggal_beli || null;
    // Foto: pakai upload baru kalau ada, kalau enggak pakai foto lama
    const fotoUrl = req.file ? `${APP_URL}/uploads/${req.file.filename}` : (foto_existing || null);

    pool.query(
        `UPDATE kendaraan SET nomor_plat=?, jenis=?, merek=?, model=?, tahun=?, warna=?, status=?, kondisi=?, km_terakhir=?, harga_beli=?, tanggal_beli=?, lokasi_penyimpanan=?, catatan=?, foto=? WHERE id=?`,
        [nomor_plat, jenis, merek||null, model||null, tahun||null, warna||null, status||'Tersedia', kondisi||'Baik', km_terakhir||0, hargaBeliVal, tanggalBeliVal, lokasi_penyimpanan||null, catatan||null, fotoUrl, id],
        (err, result) => {
            if (err) return res.status(500).json({ success: false, message: err.message });
            if (result.affectedRows === 0) return res.status(404).json({ success: false, message: 'Data tidak ditemukan' });
            res.json({ success: true, message: 'Kendaraan berhasil diupdate' });
        }
    );
});

app.delete('/api/kendaraan/:id', requireAuth, (req, res) => {
    pool.query('DELETE FROM kendaraan WHERE id = ?', [req.params.id], (err, result) => {
        if (err) return res.status(500).json({ success: false, message: err.message });
        if (result.affectedRows === 0) return res.status(404).json({ success: false, message: 'Data tidak ditemukan' });
        res.json({ success: true, message: 'Kendaraan berhasil dihapus' });
    });
});

// --- PRINTER ---
app.get('/api/printer', requireAuth, (req, res) => {
    pool.query('SELECT * FROM printer ORDER BY created_at DESC', (err, rows) => {
        if (err) return res.status(500).json({ success: false, message: err.message });
        res.json(rows);
    });
});

app.post('/api/printer', requireAuth, upload.single('foto'), (req, res) => {
    const { nomor_inventaris, merek, model, tipe, status, kondisi, lokasi, ip_address, harga_beli, tanggal_beli, catatan } = req.body;
    if (!nomor_inventaris || !merek) return res.status(400).json({ success: false, message: 'Nomor inventaris dan merek harus diisi' });

    const hargaBeliVal = (harga_beli === undefined || harga_beli === null || harga_beli === '')
        ? null : parseFloat(harga_beli);
    const tanggalBeliVal = tanggal_beli || null;
    const fotoUrl = req.file ? `${APP_URL}/uploads/${req.file.filename}` : null;

    pool.query(
        `INSERT INTO printer (nomor_inventaris, merek, model, tipe, status, kondisi, lokasi, ip_address, harga_beli, tanggal_beli, catatan, foto)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [nomor_inventaris, merek, model||null, tipe||'Laser', status||'Tersedia', kondisi||'Baik', lokasi||null, ip_address||null, hargaBeliVal, tanggalBeliVal, catatan||null, fotoUrl],
        (err, result) => {
            if (err) return res.status(500).json({ success: false, message: err.message });
            res.json({ success: true, message: 'Printer berhasil ditambahkan', id: result.insertId });
        }
    );
});

app.put('/api/printer/:id', requireAuth, upload.single('foto'), (req, res) => {
    const { id } = req.params;
    const { nomor_inventaris, merek, model, tipe, status, kondisi, lokasi, ip_address, harga_beli, tanggal_beli, catatan, foto_existing } = req.body;
    if (!nomor_inventaris || !merek) return res.status(400).json({ success: false, message: 'Nomor inventaris dan merek harus diisi' });

    const hargaBeliVal = (harga_beli === undefined || harga_beli === null || harga_beli === '')
        ? null : parseFloat(harga_beli);
    const tanggalBeliVal = tanggal_beli || null;
    const fotoUrl = req.file ? `${APP_URL}/uploads/${req.file.filename}` : (foto_existing || null);

    pool.query(
        `UPDATE printer SET nomor_inventaris=?, merek=?, model=?, tipe=?, status=?, kondisi=?, lokasi=?, ip_address=?, harga_beli=?, tanggal_beli=?, catatan=?, foto=? WHERE id=?`,
        [nomor_inventaris, merek, model||null, tipe||'Laser', status||'Tersedia', kondisi||'Baik', lokasi||null, ip_address||null, hargaBeliVal, tanggalBeliVal, catatan||null, fotoUrl, id],
        (err, result) => {
            if (err) return res.status(500).json({ success: false, message: err.message });
            if (result.affectedRows === 0) return res.status(404).json({ success: false, message: 'Data tidak ditemukan' });
            res.json({ success: true, message: 'Printer berhasil diupdate' });
        }
    );
});

app.delete('/api/printer/:id', requireAuth, (req, res) => {
    pool.query('DELETE FROM printer WHERE id = ?', [req.params.id], (err, result) => {
        if (err) return res.status(500).json({ success: false, message: err.message });
        if (result.affectedRows === 0) return res.status(404).json({ success: false, message: 'Data tidak ditemukan' });
        res.json({ success: true, message: 'Printer berhasil dihapus' });
    });
});

// --- LAPTOP INVENTARIS ---
app.get('/api/inventaris-laptop', requireAuth, (req, res) => {
    const query = `
        SELECT il.*, k.nama as karyawan_nama
        FROM inventaris_laptop il
        LEFT JOIN karyawan k ON il.karyawan_id = k.id
        ORDER BY il.created_at DESC
    `;
    pool.query(query, (err, rows) => {
        if (err) return res.status(500).json({ success: false, message: err.message });
        res.json(rows);
    });
});

app.post('/api/inventaris-laptop', requireAuth, upload.fields([
    { name: 'foto_depan', maxCount: 1 },
    { name: 'foto_belakang', maxCount: 1 },
    { name: 'foto_samping', maxCount: 1 },
    { name: 'foto_kerusakan', maxCount: 1 }
]), (req, res) => {
    const { nomor_inventaris, merek, model, serial_number, spesifikasi, status, kondisi, karyawan_id, lokasi_penyimpanan, catatan, harga_beli, tanggal_beli } = req.body;
    if (!nomor_inventaris || !merek) return res.status(400).json({ success: false, message: 'Nomor inventaris dan merek harus diisi' });

    const getFileUrl = (fieldName) => {
        return req.files && req.files[fieldName] ? `${APP_URL}/uploads/${req.files[fieldName][0].filename}` : null;
    };

    // Gabungkan semua foto ke satu field JSON
    const fotoData = JSON.stringify({
        depan: getFileUrl('foto_depan'),
        belakang: getFileUrl('foto_belakang'),
        samping: getFileUrl('foto_samping'),
        kerusakan: getFileUrl('foto_kerusakan')
    });

    // Normalisasi harga & tanggal: kosong → null
    const hargaBeliVal = (harga_beli === undefined || harga_beli === null || harga_beli === '')
        ? null : parseFloat(harga_beli);
    const tanggalBeliVal = tanggal_beli || null;

    pool.query(
        `INSERT INTO inventaris_laptop (nomor_inventaris, merek, model, serial_number, spesifikasi, status, kondisi, karyawan_id, lokasi_penyimpanan, catatan, foto, harga_beli, tanggal_beli)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [nomor_inventaris, merek, model||null, serial_number||null, spesifikasi||null, status||'Tersedia', kondisi||'Baik', karyawan_id||null, lokasi_penyimpanan||null, catatan||null, fotoData, hargaBeliVal, tanggalBeliVal],
        (err, result) => {
            if (err) return res.status(500).json({ success: false, message: err.message });
            res.json({ success: true, message: 'Laptop inventaris berhasil ditambahkan', id: result.insertId });
        }
    );
});

app.put('/api/inventaris-laptop/:id', requireAuth, upload.fields([
    { name: 'foto_depan', maxCount: 1 },
    { name: 'foto_belakang', maxCount: 1 },
    { name: 'foto_samping', maxCount: 1 },
    { name: 'foto_kerusakan', maxCount: 1 }
]), (req, res) => {
    const { id } = req.params;
    const { nomor_inventaris, merek, model, serial_number, spesifikasi, status, kondisi, karyawan_id, lokasi_penyimpanan, catatan, foto_existing, harga_beli, tanggal_beli } = req.body;
    if (!nomor_inventaris || !merek) return res.status(400).json({ success: false, message: 'Nomor inventaris dan merek harus diisi' });

    const getFileUrl = (fieldName) => {
        return req.files && req.files[fieldName] ? `${APP_URL}/uploads/${req.files[fieldName][0].filename}` : null;
    };

    let existingFoto = {};
    try { existingFoto = foto_existing ? JSON.parse(foto_existing) : {}; } catch(e) {}

    const fotoData = JSON.stringify({
        depan: getFileUrl('foto_depan') || existingFoto.depan || null,
        belakang: getFileUrl('foto_belakang') || existingFoto.belakang || null,
        samping: getFileUrl('foto_samping') || existingFoto.samping || null,
        kerusakan: getFileUrl('foto_kerusakan') || existingFoto.kerusakan || null
    });

    // Normalisasi harga & tanggal
    const hargaBeliVal = (harga_beli === undefined || harga_beli === null || harga_beli === '')
        ? null : parseFloat(harga_beli);
    const tanggalBeliVal = tanggal_beli || null;

    // STEP 1: Ambil karyawan_id LAMA dari tabel langsung (sumber kebenaran)
    pool.query('SELECT karyawan_id FROM inventaris_laptop WHERE id = ?', [id], (err, oldRows) => {
        if (err) return res.status(500).json({ success: false, message: err.message });
        if (oldRows.length === 0) return res.status(404).json({ success: false, message: 'Data tidak ditemukan' });

        const oldKaryawanId = oldRows[0].karyawan_id || null;
        const newKaryawanId = karyawan_id || null;
        const newStatus = status || 'Tersedia';

        // STEP 2: Kalau ada karyawan baru DAN berbeda dari yang lama,
        // lepas dulu semua laptop lain yang dipakai karyawan baru itu
        // (supaya 1 karyawan tidak punya 2 laptop aktif sekaligus)
        const cleanupOldLaptops = (cb) => {
            if (!newKaryawanId || newKaryawanId === oldKaryawanId) return cb();

            // Cari laptop lain milik karyawan baru
            pool.query(
                `SELECT id FROM inventaris_laptop WHERE karyawan_id = ? AND id != ? AND status = 'Digunakan Karyawan'`,
                [newKaryawanId, id],
                (err, otherLaptops) => {
                    if (err || !otherLaptops || otherLaptops.length === 0) return cb();

                    // Lepas semua laptop lain
                    pool.query(
                        `UPDATE inventaris_laptop SET karyawan_id = NULL, status = 'Tersedia' WHERE karyawan_id = ? AND id != ? AND status = 'Digunakan Karyawan'`,
                        [newKaryawanId, id],
                        () => {
                            // Log riwayat untuk tiap laptop yang dilepas
                            otherLaptops.forEach(lp => {
                                setImmediate(() => {
                                    logRiwayatChange('laptop', lp.id, newKaryawanId, null, null, req.user, () => {});
                                });
                            });
                            cb();
                        }
                    );
                }
            );
        };

        cleanupOldLaptops(() => {
            // STEP 3: Update laptop ini
            pool.query(
                `UPDATE inventaris_laptop SET nomor_inventaris=?, merek=?, model=?, serial_number=?, spesifikasi=?, status=?, kondisi=?, karyawan_id=?, lokasi_penyimpanan=?, catatan=?, foto=?, harga_beli=?, tanggal_beli=? WHERE id=?`,
                [nomor_inventaris, merek, model||null, serial_number||null, spesifikasi||null, newStatus, kondisi||'Baik', newKaryawanId, lokasi_penyimpanan||null, catatan||null, fotoData, hargaBeliVal, tanggalBeliVal, id],
                (err, result) => {
                    if (err) return res.status(500).json({ success: false, message: err.message });
                    if (result.affectedRows === 0) return res.status(404).json({ success: false, message: 'Data tidak ditemukan' });

                    // STEP 4: Log riwayat perubahan kepemilikan (pakai oldKaryawanId yang sudah diambil di step 1)
                    logRiwayatChange('laptop', id, oldKaryawanId, newKaryawanId, kondisi, req.user, () => {
                        res.json({ success: true, message: 'Laptop inventaris berhasil diupdate' });
                    });
                }
            );
        });
    });
});

app.delete('/api/inventaris-laptop/:id', requireAuth, (req, res) => {
    pool.query('DELETE FROM inventaris_laptop WHERE id = ?', [req.params.id], (err, result) => {
        if (err) return res.status(500).json({ success: false, message: err.message });
        if (result.affectedRows === 0) return res.status(404).json({ success: false, message: 'Data tidak ditemukan' });
        res.json({ success: true, message: 'Laptop inventaris berhasil dihapus' });
    });
});

// ═══════════════════════════════════════════════════════════════
// DRONE
// ═══════════════════════════════════════════════════════════════

// --- GET semua drone ---
app.get('/api/drone', requireAuth, (req, res) => {
    const query = `
        SELECT d.*, k.nama as karyawan_nama
        FROM drone d
        LEFT JOIN karyawan k ON d.karyawan_id = k.id
        ORDER BY d.created_at DESC
    `;
    pool.query(query, (err, rows) => {
        if (err) return res.status(500).json({ success: false, message: err.message });
        // Parse field foto (disimpan sebagai JSON string di DB)
        const result = rows.map(r => {
            let foto = {};
            try { foto = r.foto ? JSON.parse(r.foto) : {}; } catch(e) {}
            return { ...r, foto_depan: foto.depan, foto_belakang: foto.belakang, foto_kerusakan: foto.kerusakan };
        });
        res.json(result);
    });
});

// --- POST tambah drone ---
app.post('/api/drone', requireAuth, upload.fields([
    { name: 'foto_depan', maxCount: 1 },
    { name: 'foto_belakang', maxCount: 1 },
    { name: 'foto_kerusakan', maxCount: 1 }
]), (req, res) => {
    const { nomor_inventaris, merek, model, serial_number, spesifikasi, warna, status, kondisi, karyawan_id, lokasi_penyimpanan, catatan, harga_beli, tanggal_beli } = req.body;
    if (!nomor_inventaris || !merek) return res.status(400).json({ success: false, message: 'Nomor inventaris dan merek harus diisi' });

    const getFileUrl = (fieldName) => {
        return req.files && req.files[fieldName] ? `${APP_URL}/uploads/${req.files[fieldName][0].filename}` : null;
    };

    const fotoData = JSON.stringify({
        depan: getFileUrl('foto_depan'),
        belakang: getFileUrl('foto_belakang'),
        kerusakan: getFileUrl('foto_kerusakan')
    });

    // Normalisasi harga & tanggal
    const hargaBeliVal = (harga_beli === undefined || harga_beli === null || harga_beli === '')
        ? null : parseFloat(harga_beli);
    const tanggalBeliVal = tanggal_beli || null;

    pool.query(
        `INSERT INTO drone (nomor_inventaris, merek, model, serial_number, spesifikasi, warna, status, kondisi, karyawan_id, lokasi_penyimpanan, catatan, foto, harga_beli, tanggal_beli)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [nomor_inventaris, merek, model||null, serial_number||null, spesifikasi||null, warna||null, status||'Tersedia', kondisi||'Baik', karyawan_id||null, lokasi_penyimpanan||null, catatan||null, fotoData, hargaBeliVal, tanggalBeliVal],
        (err, result) => {
            if (err) return res.status(500).json({ success: false, message: err.message });
            res.json({ success: true, message: 'Drone berhasil ditambahkan', id: result.insertId });
        }
    );
});

// --- PUT update drone ---
app.put('/api/drone/:id', requireAuth, upload.fields([
    { name: 'foto_depan', maxCount: 1 },
    { name: 'foto_belakang', maxCount: 1 },
    { name: 'foto_kerusakan', maxCount: 1 }
]), (req, res) => {
    const { id } = req.params;
    const { nomor_inventaris, merek, model, serial_number, spesifikasi, warna, status, kondisi, karyawan_id, lokasi_penyimpanan, catatan, foto_existing, harga_beli, tanggal_beli } = req.body;
    if (!nomor_inventaris || !merek) return res.status(400).json({ success: false, message: 'Nomor inventaris dan merek harus diisi' });

    const getFileUrl = (fieldName) => {
        return req.files && req.files[fieldName] ? `${APP_URL}/uploads/${req.files[fieldName][0].filename}` : null;
    };

    let existingFoto = {};
    try { existingFoto = foto_existing ? JSON.parse(foto_existing) : {}; } catch(e) {}

    const fotoData = JSON.stringify({
        depan: getFileUrl('foto_depan') || existingFoto.depan || null,
        belakang: getFileUrl('foto_belakang') || existingFoto.belakang || null,
        kerusakan: getFileUrl('foto_kerusakan') || existingFoto.kerusakan || null
    });

    // Normalisasi harga & tanggal
    const hargaBeliVal = (harga_beli === undefined || harga_beli === null || harga_beli === '')
        ? null : parseFloat(harga_beli);
    const tanggalBeliVal = tanggal_beli || null;

    // STEP 1: Ambil karyawan_id LAMA dari tabel
    pool.query('SELECT karyawan_id FROM drone WHERE id = ?', [id], (err, oldRows) => {
        if (err) return res.status(500).json({ success: false, message: err.message });
        if (oldRows.length === 0) return res.status(404).json({ success: false, message: 'Data tidak ditemukan' });

        const oldKaryawanId = oldRows[0].karyawan_id || null;
        const newKaryawanId = karyawan_id || null;
        const newStatus = status || 'Tersedia';

        // STEP 2: Cleanup drone lain milik karyawan baru (1 karyawan = 1 drone aktif)
        const cleanupOldDrones = (cb) => {
            if (!newKaryawanId || newKaryawanId === oldKaryawanId) return cb();

            pool.query(
                `SELECT id FROM drone WHERE karyawan_id = ? AND id != ? AND status = 'Digunakan Karyawan'`,
                [newKaryawanId, id],
                (err, otherDrones) => {
                    if (err || !otherDrones || otherDrones.length === 0) return cb();

                    pool.query(
                        `UPDATE drone SET karyawan_id = NULL, status = 'Tersedia' WHERE karyawan_id = ? AND id != ? AND status = 'Digunakan Karyawan'`,
                        [newKaryawanId, id],
                        () => {
                            otherDrones.forEach(dr => {
                                setImmediate(() => {
                                    logRiwayatChange('drone', dr.id, newKaryawanId, null, null, req.user, () => {});
                                });
                            });
                            cb();
                        }
                    );
                }
            );
        };

        cleanupOldDrones(() => {
            // STEP 3: Update drone ini
            pool.query(
                `UPDATE drone SET nomor_inventaris=?, merek=?, model=?, serial_number=?, spesifikasi=?, warna=?, status=?, kondisi=?, karyawan_id=?, lokasi_penyimpanan=?, catatan=?, foto=?, harga_beli=?, tanggal_beli=? WHERE id=?`,
                [nomor_inventaris, merek, model||null, serial_number||null, spesifikasi||null, warna||null, newStatus, kondisi||'Baik', newKaryawanId, lokasi_penyimpanan||null, catatan||null, fotoData, hargaBeliVal, tanggalBeliVal, id],
                (err, result) => {
                    if (err) return res.status(500).json({ success: false, message: err.message });
                    if (result.affectedRows === 0) return res.status(404).json({ success: false, message: 'Data tidak ditemukan' });

                    // STEP 4: Log riwayat perubahan kepemilikan
                    logRiwayatChange('drone', id, oldKaryawanId, newKaryawanId, kondisi, req.user, () => {
                        res.json({ success: true, message: 'Drone berhasil diupdate' });
                    });
                }
            );
        });
    });
});

// --- DELETE drone ---
app.delete('/api/drone/:id', requireAuth, (req, res) => {
    pool.query('DELETE FROM drone WHERE id = ?', [req.params.id], (err, result) => {
        if (err) return res.status(500).json({ success: false, message: err.message });
        if (result.affectedRows === 0) return res.status(404).json({ success: false, message: 'Data tidak ditemukan' });
        res.json({ success: true, message: 'Drone berhasil dihapus' });
    });
});

// Update /api/statistics to include inventaris counts
app.get('/api/statistics/inventaris', requireAuth, (req, res) => {
    const stats = {};
    pool.query('SELECT COUNT(*) as total, SUM(status="Tersedia") as tersedia, SUM(status="Digunakan") as digunakan, SUM(status IN ("Servis","Rusak")) as masalah FROM kendaraan', (err, r) => {
        if (err) return res.status(500).json({ success: false, message: err.message });
        stats.kendaraan = r[0];
        pool.query('SELECT COUNT(*) as total, SUM(status="Tersedia") as tersedia, SUM(status="Digunakan") as digunakan, SUM(status IN ("Servis","Rusak")) as masalah FROM printer', (err, r) => {
            if (err) return res.status(500).json({ success: false, message: err.message });
            stats.printer = r[0];
            pool.query('SELECT COUNT(*) as total, SUM(status="Tersedia") as tersedia, SUM(status="Digunakan Karyawan") as digunakan, SUM(status IN ("Servis","Rusak","Hilang")) as masalah FROM inventaris_laptop', (err, r) => {
                if (err) return res.status(500).json({ success: false, message: err.message });
                stats.laptop_inventaris = r[0];
                pool.query('SELECT COUNT(*) as total, SUM(status="Tersedia") as tersedia, SUM(status="Digunakan Karyawan") as digunakan, SUM(status IN ("Servis","Rusak","Hilang")) as masalah FROM drone', (err, r) => {
                    if (err) {
                        // Kalau tabel drone belum ada (migration belum dijalanin), kasih default 0
                        stats.drone = { total: 0, tersedia: 0, digunakan: 0, masalah: 0 };
                    } else {
                        stats.drone = r[0];
                    }
                    res.json({ success: true, data: stats });
                });
            });
        });
    });
});


// API: Get statistics
app.get('/api/statistics', requireAuth, (req, res) => {
    let stats = {};
    
    pool.query('SELECT COUNT(*) as total FROM karyawan', (err, result) => {
        if (err) return res.status(500).json({ success: false, message: err.message });
        stats.total_karyawan = result[0].total;
        
        pool.query('SELECT COUNT(*) as total FROM divisi', (err, result) => {
            if (err) return res.status(500).json({ success: false, message: err.message });
            stats.total_divisi = result[0].total;
            
            // Total laptop dari inventaris_laptop (bukan tabel laptop lama)
            pool.query('SELECT COUNT(*) as total FROM inventaris_laptop', (err, result) => {
                if (err) return res.status(500).json({ success: false, message: err.message });
                stats.total_laptop = result[0].total;
                
                pool.query('SELECT COUNT(*) as total FROM software', (err, result) => {
                    if (err) return res.status(500).json({ success: false, message: err.message });
                    stats.total_software = result[0].total;
                    
                    pool.query(`
                        SELECT 
                            d.nama_divisi,
                            COUNT(k.id) as total
                        FROM divisi d
                        LEFT JOIN karyawan k ON d.id = k.divisi_id
                        GROUP BY d.id, d.nama_divisi
                    `, (err, rows) => {
                        if (err) return res.status(500).json({ success: false, message: err.message });
                        stats.karyawan_per_divisi = rows;

                        // Laptop inventaris yang sedang digunakan karyawan
                        pool.query(`
                            SELECT 
                                il.nomor_inventaris,
                                il.merek,
                                il.model,
                                k.nama as karyawan_nama,
                                k.id as karyawan_id
                            FROM inventaris_laptop il
                            INNER JOIN karyawan k ON il.karyawan_id = k.id
                            WHERE il.status = 'Digunakan Karyawan'
                            ORDER BY k.nama
                        `, (err, laptopRows) => {
                            if (err) return res.status(500).json({ success: false, message: err.message });
                            stats.laptop_digunakan = laptopRows;
                            
                            res.json({ success: true, data: stats });
                        });
                    });
                });
            });
        });
    });
});

// ─────────────────────────────────────────────────────────
// API: Laporan Bulanan
// GET /api/laporan-bulanan?bulan=2025-03
// ─────────────────────────────────────────────────────────
app.get('/api/laporan-bulanan', requireAuth, (req, res) => {
    const bulan = req.query.bulan; // format: YYYY-MM
    if (!bulan || !/^\d{4}-\d{2}$/.test(bulan)) {
        return res.status(400).json({ success: false, message: 'Parameter bulan diperlukan (format: YYYY-MM)' });
    }

    const tglAwal = bulan + '-01';
    const [tahun, bln] = bulan.split('-').map(Number);
    const bln1 = bln === 12 ? 1 : bln + 1;
    const thn1 = bln === 12 ? tahun + 1 : tahun;
    const tglAkhir = `${thn1}-${String(bln1).padStart(2,'0')}-01`;

    const result = {};

    // 1. Karyawan baru masuk bulan ini
    pool.query(`
        SELECT k.id, k.nama, k.jabatan, d.nama_divisi as divisi, k.created_at
        FROM karyawan k
        LEFT JOIN divisi d ON k.divisi_id = d.id
        WHERE k.created_at >= ? AND k.created_at < ?
        ORDER BY k.created_at ASC
    `, [tglAwal, tglAkhir], (err, karyawanBaru) => {
        if (err) return res.status(500).json({ success: false, message: err.message });
        result.karyawan_baru = karyawanBaru;

        // 2. Laptop baru masuk inventaris bulan ini
        pool.query(`
            SELECT nomor_inventaris, merek, model, serial_number, kondisi, status, created_at
            FROM inventaris_laptop
            WHERE created_at >= ? AND created_at < ?
            ORDER BY created_at ASC
        `, [tglAwal, tglAkhir], (err, laptopBaru) => {
            if (err) return res.status(500).json({ success: false, message: err.message });
            result.laptop_baru = laptopBaru;

            // 3. Laptop kondisi rusak (bukan hanya yang baru)
            pool.query(`
                SELECT il.nomor_inventaris, il.merek, il.model, il.kondisi, il.status,
                       k.nama as karyawan_nama, il.created_at
                FROM inventaris_laptop il
                LEFT JOIN karyawan k ON il.karyawan_id = k.id
                WHERE il.kondisi IN ('Rusak Ringan','Rusak Berat') OR il.status IN ('Servis','Rusak','Hilang')
                ORDER BY il.created_at DESC
            `, (err, laptopRusak) => {
                if (err) return res.status(500).json({ success: false, message: err.message });
                result.laptop_bermasalah = laptopRusak;

                // 4. Kendaraan baru masuk bulan ini
                pool.query(`
                    SELECT nomor_plat, jenis, merek, model, tahun, kondisi, status, created_at
                    FROM kendaraan
                    WHERE created_at >= ? AND created_at < ?
                    ORDER BY created_at ASC
                `, [tglAwal, tglAkhir], (err, kendaraanBaru) => {
                    if (err) return res.status(500).json({ success: false, message: err.message });
                    result.kendaraan_baru = kendaraanBaru;

                    // 5. Kendaraan bermasalah
                    pool.query(`
                        SELECT nomor_plat, jenis, merek, model, kondisi, status, created_at
                        FROM kendaraan
                        WHERE kondisi IN ('Rusak Ringan','Rusak Berat') OR status IN ('Servis','Rusak')
                        ORDER BY created_at DESC
                    `, (err, kendaraanRusak) => {
                        if (err) return res.status(500).json({ success: false, message: err.message });
                        result.kendaraan_bermasalah = kendaraanRusak;

                        // 6. Printer baru masuk bulan ini
                        pool.query(`
                            SELECT nomor_inventaris, merek, model, tipe, kondisi, status, created_at
                            FROM printer
                            WHERE created_at >= ? AND created_at < ?
                            ORDER BY created_at ASC
                        `, [tglAwal, tglAkhir], (err, printerBaru) => {
                            if (err) return res.status(500).json({ success: false, message: err.message });
                            result.printer_baru = printerBaru;

                            // 7. Printer bermasalah
                            pool.query(`
                                SELECT nomor_inventaris, merek, model, tipe, kondisi, status, created_at
                                FROM printer
                                WHERE kondisi IN ('Rusak Ringan','Rusak Berat') OR status IN ('Servis','Rusak')
                                ORDER BY created_at DESC
                            `, (err, printerRusak) => {
                                if (err) return res.status(500).json({ success: false, message: err.message });
                                result.printer_bermasalah = printerRusak;

                                // 8. HP baru masuk bulan ini
                                pool.query(`
                                    SELECT nomor_inventaris, merek, model, warna, kondisi, status, created_at
                                    FROM handphone
                                    WHERE created_at >= ? AND created_at < ?
                                    ORDER BY created_at ASC
                                `, [tglAwal, tglAkhir], (err, hpBaru) => {
                                    if (err) return res.status(500).json({ success: false, message: err.message });
                                    result.hp_baru = hpBaru;

                                    // 9. HP bermasalah
                                    pool.query(`
                                        SELECT nomor_inventaris, merek, model, kondisi, status,
                                               karyawan_id, created_at
                                        FROM handphone
                                        WHERE kondisi IN ('Rusak Ringan','Rusak Berat') OR status IN ('Servis','Rusak','Hilang')
                                        ORDER BY created_at DESC
                                    `, (err, hpRusak) => {
                                        if (err) return res.status(500).json({ success: false, message: err.message });
                                        result.hp_bermasalah = hpRusak;

                                        // 10. Laptop yang berganti pengguna bulan ini (assigned bulan ini)
                                        pool.query(`
                                            SELECT il.nomor_inventaris, il.merek, il.model,
                                                   k.nama as karyawan_nama, k.id as karyawan_id,
                                                   il.updated_at
                                            FROM inventaris_laptop il
                                            INNER JOIN karyawan k ON il.karyawan_id = k.id
                                            WHERE il.status = 'Digunakan Karyawan'
                                              AND il.updated_at >= ? AND il.updated_at < ?
                                            ORDER BY il.updated_at ASC
                                        `, [tglAwal, tglAkhir], (err, laptopAssign) => {
                                            if (err) laptopAssign = [];
                                            result.laptop_assign_bulan_ini = laptopAssign;

                                            // 11. Ringkasan total semua aset
                                            pool.query(`
                                                SELECT
                                                    (SELECT COUNT(*) FROM karyawan) as total_karyawan,
                                                    (SELECT COUNT(*) FROM inventaris_laptop) as total_laptop,
                                                    (SELECT COUNT(*) FROM kendaraan) as total_kendaraan,
                                                    (SELECT COUNT(*) FROM printer) as total_printer,
                                                    (SELECT COUNT(*) FROM handphone) as total_hp,
                                                    (SELECT COUNT(*) FROM inventaris_laptop WHERE kondisi IN ('Rusak Ringan','Rusak Berat') OR status IN ('Servis','Rusak','Hilang')) as laptop_masalah,
                                                    (SELECT COUNT(*) FROM kendaraan WHERE kondisi IN ('Rusak Ringan','Rusak Berat') OR status IN ('Servis','Rusak')) as kendaraan_masalah,
                                                    (SELECT COUNT(*) FROM printer WHERE kondisi IN ('Rusak Ringan','Rusak Berat') OR status IN ('Servis','Rusak')) as printer_masalah,
                                                    (SELECT COUNT(*) FROM handphone WHERE kondisi IN ('Rusak Ringan','Rusak Berat') OR status IN ('Servis','Rusak','Hilang')) as hp_masalah
                                            `, (err, ringkasan) => {
                                                if (err) return res.status(500).json({ success: false, message: err.message });
                                                result.ringkasan = ringkasan[0];

                                                // Drone — query terpisah, kalau tabel belum ada (migration belum dijalanin) → default 0
                                                pool.query(`
                                                    SELECT
                                                        COUNT(*) as total_drone,
                                                        SUM(CASE WHEN kondisi IN ('Rusak Ringan','Rusak Berat') OR status IN ('Servis','Rusak','Hilang') THEN 1 ELSE 0 END) as drone_masalah
                                                    FROM drone
                                                `, (err, droneR) => {
                                                    if (err || !droneR || !droneR[0]) {
                                                        result.ringkasan.total_drone = 0;
                                                        result.ringkasan.drone_masalah = 0;
                                                    } else {
                                                        result.ringkasan.total_drone = droneR[0].total_drone || 0;
                                                        result.ringkasan.drone_masalah = droneR[0].drone_masalah || 0;
                                                    }
                                                    result.periode = bulan;
                                                    res.json({ success: true, data: result });
                                                });
                                            });
                                        });
                                    });
                                });
                            });
                        });
                    });
                });
            });
        });
    });
});

// ═══════════════════════════════════════════════════════════════
// RIWAYAT PEMAKAIAN BARANG INVENTARIS
// ═══════════════════════════════════════════════════════════════

// Helper: map tipe_barang ke nama tabel
const TIPE_TABLE_MAP = {
    'laptop': 'inventaris_laptop',
    'handphone': 'handphone',
    'kendaraan': 'kendaraan',
    'printer': 'printer',
    'drone': 'drone'
};

// ─── Helper: Auto-log perubahan kepemilikan ────────────────────
// Dipanggil dari endpoint PUT inventaris untuk catat riwayat otomatis.
// Logic:
//   - Karyawan lama berbeda dengan karyawan baru → tutup riwayat lama, buka baru
//   - Karyawan lama ada, baru kosong → tutup riwayat (return ke gudang)
//   - Karyawan lama kosong, baru ada → buka riwayat baru (assign)
//   - Sama → tidak ada perubahan, skip
function logRiwayatChange(tipe, barangId, oldKaryawanId, newKaryawanId, kondisi, user, callback) {
    // Normalisasi: kalau kosong/undefined, anggap null
    const oldId = oldKaryawanId || null;
    const newId = newKaryawanId || null;

    // Tidak ada perubahan kepemilikan, skip
    if (oldId === newId) return callback(null);

    const tableName = TIPE_TABLE_MAP[tipe];
    if (!tableName) return callback(null);

    // Step 1: Ambil snapshot info barang
    pool.query(`SELECT * FROM ${tableName} WHERE id = ?`, [barangId], (err, barangRows) => {
        if (err || barangRows.length === 0) return callback(err);
        const barang = barangRows[0];
        const namaBarang = `${barang.merek || ''} ${barang.model || ''}`.trim() +
            (barang.nomor_inventaris ? ` (${barang.nomor_inventaris})` : '') +
            (barang.nomor_plat ? ` (${barang.nomor_plat})` : '');

        // Step 2: Tutup riwayat lama yang masih aktif (kalau ada)
        const closeOldSql = `
            UPDATE riwayat_pemakaian
            SET tanggal_return = NOW(),
                kondisi_return = ?,
                returned_by_user_id = ?,
                returned_by_username = ?,
                catatan_return = ?
            WHERE tipe_barang = ? AND barang_id = ? AND tanggal_return IS NULL
        `;
        const catatanReturn = newId
            ? `Auto-logged: barang dipindahkan ke karyawan ${newId}`
            : 'Auto-logged: barang dikembalikan ke gudang';

        pool.query(closeOldSql,
            [kondisi || barang.kondisi, user.id, user.username, catatanReturn, tipe, barangId],
            (err) => {
                if (err) console.error('Gagal close riwayat lama:', err);

                // Step 3: Kalau ada karyawan baru, buka riwayat baru
                if (!newId) return callback(null);

                pool.query('SELECT nama FROM karyawan WHERE id = ?', [newId], (err, kRows) => {
                    if (err || kRows.length === 0) return callback(null); // skip kalau karyawan tidak ditemukan
                    const namaKaryawan = kRows[0].nama;

                    const insertSql = `
                        INSERT INTO riwayat_pemakaian
                            (tipe_barang, barang_id, nama_barang, karyawan_id, nama_karyawan,
                             kondisi_assign, catatan_assign,
                             assigned_by_user_id, assigned_by_username)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    `;
                    pool.query(insertSql,
                        [tipe, barangId, namaBarang, newId, namaKaryawan,
                         kondisi || barang.kondisi,
                         'Auto-logged dari edit inventaris',
                         user.id, user.username],
                        callback
                    );
                });
            }
        );
    });
}

// ─── GET semua riwayat (dengan filter opsional) ─────────────────
// GET /api/riwayat-pemakaian?tipe=laptop&karyawan_id=WGJ-001&aktif=true
app.get('/api/riwayat-pemakaian', requireAuth, (req, res) => {
    const { tipe, karyawan_id, barang_id, aktif } = req.query;

    let query = 'SELECT * FROM riwayat_pemakaian WHERE 1=1';
    const params = [];

    if (tipe) {
        query += ' AND tipe_barang = ?';
        params.push(tipe);
    }
    if (karyawan_id) {
        query += ' AND karyawan_id = ?';
        params.push(karyawan_id);
    }
    if (barang_id) {
        query += ' AND barang_id = ?';
        params.push(barang_id);
    }
    if (aktif === 'true') {
        query += ' AND tanggal_return IS NULL';
    } else if (aktif === 'false') {
        query += ' AND tanggal_return IS NOT NULL';
    }

    query += ' ORDER BY tanggal_assign DESC';

    pool.query(query, params, (err, rows) => {
        if (err) {
            console.error('🔥 RIWAYAT ERROR:', err);
            // TEMPORARY: kirim error detail ke client untuk debug
            return res.status(500).json({
                success: false,
                message: 'Error riwayat: ' + err.message,
                code: err.code,
                sqlState: err.sqlState,
                sql: err.sql
            });
        }
        res.json({ success: true, data: rows });
    });
});

// ─── POST assign barang ke karyawan ─────────────────────────────
// POST /api/riwayat-pemakaian/assign
// Body: { tipe, barang_id, karyawan_id, kondisi, catatan }
app.post('/api/riwayat-pemakaian/assign', requireAuth, (req, res) => {
    const { tipe, barang_id, karyawan_id, kondisi, catatan } = req.body;

    if (!tipe || !barang_id || !karyawan_id) {
        return res.status(400).json({ success: false, message: 'tipe, barang_id, dan karyawan_id wajib diisi.' });
    }
    const tableName = TIPE_TABLE_MAP[tipe];
    if (!tableName) {
        return res.status(400).json({ success: false, message: 'Tipe barang tidak valid.' });
    }

    // 1. Ambil info barang & karyawan untuk snapshot
    const getBarangSql = `SELECT * FROM ${tableName} WHERE id = ?`;
    pool.query(getBarangSql, [barang_id], (err, barangRows) => {
        if (err) return res.status(500).json({ success: false, message: 'Gagal ambil data barang.' });
        if (barangRows.length === 0) return res.status(404).json({ success: false, message: 'Barang tidak ditemukan.' });

        const barang = barangRows[0];
        const namaBarang = `${barang.merek || ''} ${barang.model || ''}`.trim() +
            (barang.nomor_inventaris ? ` (${barang.nomor_inventaris})` : '') +
            (barang.nomor_plat ? ` (${barang.nomor_plat})` : '');

        pool.query('SELECT nama FROM karyawan WHERE id = ?', [karyawan_id], (err, kRows) => {
            if (err) return res.status(500).json({ success: false, message: 'Gagal ambil data karyawan.' });
            if (kRows.length === 0) return res.status(404).json({ success: false, message: 'Karyawan tidak ditemukan.' });

            const namaKaryawan = kRows[0].nama;

            // 2. Tutup riwayat lama yang masih aktif untuk barang ini (auto-return)
            const closeOldSql = `
                UPDATE riwayat_pemakaian
                SET tanggal_return = NOW(),
                    returned_by_user_id = ?,
                    returned_by_username = ?,
                    catatan_return = 'Auto-return karena di-reassign ke karyawan lain'
                WHERE tipe_barang = ? AND barang_id = ? AND tanggal_return IS NULL
            `;
            pool.query(closeOldSql,
                [req.user.id, req.user.username, tipe, barang_id],
                (err) => {
                    if (err) console.error('Gagal close riwayat lama:', err);

                    // 3. Buat record baru
                    const insertSql = `
                        INSERT INTO riwayat_pemakaian
                            (tipe_barang, barang_id, nama_barang, karyawan_id, nama_karyawan,
                             kondisi_assign, catatan_assign,
                             assigned_by_user_id, assigned_by_username)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    `;
                    pool.query(insertSql,
                        [tipe, barang_id, namaBarang, karyawan_id, namaKaryawan,
                         kondisi || barang.kondisi, catatan || null,
                         req.user.id, req.user.username],
                        (err, result) => {
                            if (err) {
                                console.error(err);
                                return res.status(500).json({ success: false, message: 'Gagal simpan riwayat.' });
                            }

                            // 4. Update status & karyawan_id di tabel barang
                            const statusNew = tipe === 'kendaraan' ? 'Digunakan' : 'Digunakan Karyawan';
                            pool.query(
                                `UPDATE ${tableName} SET karyawan_id = ?, status = ? WHERE id = ?`,
                                [karyawan_id, statusNew, barang_id],
                                (err) => {
                                    if (err) console.error('Gagal update status barang:', err);
                                    res.json({
                                        success: true,
                                        message: 'Barang berhasil di-assign ke karyawan.',
                                        riwayat_id: result.insertId
                                    });
                                }
                            );
                        }
                    );
                }
            );
        });
    });
});

// ─── POST return barang (balikin ke gudang) ─────────────────────
// POST /api/riwayat-pemakaian/return
// Body: { tipe, barang_id, kondisi, catatan }
app.post('/api/riwayat-pemakaian/return', requireAuth, (req, res) => {
    const { tipe, barang_id, kondisi, catatan } = req.body;

    if (!tipe || !barang_id) {
        return res.status(400).json({ success: false, message: 'tipe dan barang_id wajib diisi.' });
    }
    const tableName = TIPE_TABLE_MAP[tipe];
    if (!tableName) {
        return res.status(400).json({ success: false, message: 'Tipe barang tidak valid.' });
    }

    // 1. Tutup riwayat aktif
    const closeSql = `
        UPDATE riwayat_pemakaian
        SET tanggal_return = NOW(),
            kondisi_return = ?,
            catatan_return = ?,
            returned_by_user_id = ?,
            returned_by_username = ?
        WHERE tipe_barang = ? AND barang_id = ? AND tanggal_return IS NULL
    `;
    pool.query(closeSql,
        [kondisi || null, catatan || null, req.user.id, req.user.username, tipe, barang_id],
        (err, result) => {
            if (err) {
                console.error(err);
                return res.status(500).json({ success: false, message: 'Gagal update riwayat.' });
            }
            if (result.affectedRows === 0) {
                return res.status(404).json({ success: false, message: 'Tidak ada riwayat aktif untuk barang ini.' });
            }

            // 2. Update status barang jadi Tersedia & hapus karyawan_id
            pool.query(
                `UPDATE ${tableName} SET karyawan_id = NULL, status = 'Tersedia' WHERE id = ?`,
                [barang_id],
                (err) => {
                    if (err) console.error('Gagal update status barang:', err);
                    res.json({ success: true, message: 'Barang berhasil dikembalikan ke gudang.' });
                }
            );
        }
    );
});

// ─── GET riwayat per-barang (lengkap dengan timeline) ──────────
// GET /api/riwayat-pemakaian/barang/:tipe/:id
app.get('/api/riwayat-pemakaian/barang/:tipe/:id', requireAuth, (req, res) => {
    const { tipe, id } = req.params;
    pool.query(
        `SELECT * FROM riwayat_pemakaian
         WHERE tipe_barang = ? AND barang_id = ?
         ORDER BY tanggal_assign DESC`,
        [tipe, id],
        (err, rows) => {
            if (err) return res.status(500).json({ success: false, message: 'Gagal ambil riwayat.' });
            res.json({ success: true, data: rows });
        }
    );
});

// ─── GET riwayat per-karyawan ──────────────────────────────────
// GET /api/riwayat-pemakaian/karyawan/:id
app.get('/api/riwayat-pemakaian/karyawan/:id', requireAuth, (req, res) => {
    const { id } = req.params;
    pool.query(
        `SELECT * FROM riwayat_pemakaian
         WHERE karyawan_id = ?
         ORDER BY tanggal_assign DESC`,
        [id],
        (err, rows) => {
            if (err) return res.status(500).json({ success: false, message: 'Gagal ambil riwayat.' });
            res.json({ success: true, data: rows });
        }
    );
});

// ═══════════════════════════════════════════════════════════════
// SISTEM PENGAJUAN IZIN KARYAWAN
// ═══════════════════════════════════════════════════════════════

// Helper: hitung jumlah hari kerja antara 2 tanggal (inclusive)
function hitungJumlahHari(start, end) {
    const startDate = new Date(start);
    const endDate = new Date(end);
    const diff = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24)) + 1;
    return diff;
}

// Middleware: hanya HR & admin yang bisa approve
function requireHR(req, res, next) {
    if (!['admin', 'hr'].includes(req.user?.role)) {
        return res.status(403).json({ success: false, message: 'Hanya HR/Admin yang bisa mengakses ini.' });
    }
    next();
}

// ─── BUAT AKUN LOGIN UNTUK KARYAWAN (admin only) ────────────────
// POST /api/users/create-from-karyawan
// Body: { karyawan_id, username, password, role }
app.post('/api/users/create-from-karyawan', requireAuth, requireAdmin, async (req, res) => {
    const { karyawan_id, username, password, role } = req.body;

    if (!karyawan_id || !username || !password) {
        return res.status(400).json({ success: false, message: 'karyawan_id, username, dan password wajib diisi.' });
    }
    if (password.length < 6) {
        return res.status(400).json({ success: false, message: 'Password minimal 6 karakter.' });
    }

    try {
        // Cek karyawan ada
        pool.query('SELECT nama, email FROM karyawan WHERE id = ?', [karyawan_id], async (err, kRows) => {
            if (err) {
                console.error('🔥 Query karyawan error:', err);
                return res.status(500).json({ success: false, message: 'DB Error: ' + err.message });
            }
            if (kRows.length === 0) {
                return res.status(404).json({ success: false, message: 'Karyawan tidak ditemukan.' });
            }

            // Cek karyawan sudah punya akun atau belum
            pool.query('SELECT username FROM users WHERE karyawan_id = ?', [karyawan_id], async (err, existRows) => {
                if (existRows && existRows.length > 0) {
                    return res.status(400).json({
                        success: false,
                        message: `Karyawan ini sudah punya akun (username: ${existRows[0].username}). Hapus akun lama dulu jika ingin buat baru.`
                    });
                }

                // Cek username belum dipakai
                pool.query('SELECT id FROM users WHERE username = ?', [username], async (err, uRows) => {
                    if (uRows && uRows.length > 0) {
                        return res.status(400).json({ success: false, message: 'Username sudah dipakai.' });
                    }

                    try {
                        const hashed = await bcrypt.hash(password, 10);
                        pool.query(
                            `INSERT INTO users (username, password, nama_lengkap, role, karyawan_id, email, must_change_password)
                             VALUES (?, ?, ?, ?, ?, ?, 1)`,
                            [username, hashed, kRows[0].nama, role || 'karyawan', karyawan_id, kRows[0].email || null],
                            (err, result) => {
                                if (err) {
                                    console.error('🔥 INSERT users error:', err);
                                    return res.status(500).json({
                                        success: false,
                                        message: 'Gagal INSERT: ' + err.message,
                                        code: err.code
                                    });
                                }
                                res.json({
                                    success: true,
                                    message: 'Akun berhasil dibuat. Karyawan akan diminta ganti password saat login pertama.',
                                    user_id: result.insertId
                                });
                            }
                        );
                    } catch (hashErr) {
                        console.error('🔥 Hash error:', hashErr);
                        return res.status(500).json({ success: false, message: 'Hash Error: ' + hashErr.message });
                    }
                });
            });
        });
    } catch (e) {
        console.error('🔥 General error:', e);
        res.status(500).json({ success: false, message: e.message });
    }
});

// ─── GANTI PASSWORD (login pertama / ganti manual) ──────────────
// POST /api/users/change-password
// Body: { current_password, new_password }
app.post('/api/users/change-password', requireAuth, async (req, res) => {
    const { current_password, new_password } = req.body;
    if (!current_password || !new_password) {
        return res.status(400).json({ success: false, message: 'Password lama dan baru wajib diisi.' });
    }
    if (new_password.length < 6) {
        return res.status(400).json({ success: false, message: 'Password baru minimal 6 karakter.' });
    }

    pool.query('SELECT password FROM users WHERE id = ?', [req.user.id], async (err, rows) => {
        if (err || rows.length === 0) return res.status(500).json({ success: false, message: 'User tidak ditemukan.' });

        const valid = await bcrypt.compare(current_password, rows[0].password);
        if (!valid) return res.status(401).json({ success: false, message: 'Password lama salah.' });

        const hashed = await bcrypt.hash(new_password, 10);
        pool.query(
            'UPDATE users SET password = ?, must_change_password = 0 WHERE id = ?',
            [hashed, req.user.id],
            (err) => {
                if (err) return res.status(500).json({ success: false, message: err.message });
                res.json({ success: true, message: 'Password berhasil diganti.' });
            }
        );
    });
});

// ─── PROFIL KARYAWAN YANG SEDANG LOGIN ─────────────────────────
// GET /api/me/profile
app.get('/api/me/profile', requireAuth, (req, res) => {
    if (!req.user.karyawan_id) {
        return res.json({ success: true, user: req.user, karyawan: null });
    }

    const query = `
        SELECT k.*, d.nama_divisi as divisi
        FROM karyawan k
        LEFT JOIN divisi d ON k.divisi_id = d.id
        WHERE k.id = ?
    `;
    pool.query(query, [req.user.karyawan_id], (err, rows) => {
        if (err || rows.length === 0) {
            return res.json({ success: true, user: req.user, karyawan: null });
        }
        res.json({ success: true, user: req.user, karyawan: rows[0] });
    });
});

// ─── INVENTARIS KARYAWAN YANG SEDANG LOGIN ─────────────────────
// GET /api/me/inventaris
app.get('/api/me/inventaris', requireAuth, (req, res) => {
    if (!req.user.karyawan_id) return res.json({ success: true, data: { laptop: [], handphone: [], drone: [] } });

    const result = { laptop: [], handphone: [], drone: [] };
    pool.query(
        'SELECT id, nomor_inventaris, merek, model, serial_number, kondisi, status FROM inventaris_laptop WHERE karyawan_id = ?',
        [req.user.karyawan_id],
        (err, laptops) => {
            result.laptop = laptops || [];
            pool.query(
                'SELECT id, nomor_inventaris, merek, model, serial_number, kondisi, status FROM handphone WHERE karyawan_id = ?',
                [req.user.karyawan_id],
                (err, hps) => {
                    result.handphone = hps || [];
                    pool.query(
                        'SELECT id, nomor_inventaris, merek, model, serial_number, kondisi, status FROM drone WHERE karyawan_id = ?',
                        [req.user.karyawan_id],
                        (err, drones) => {
                            // Kalau tabel drone belum ada, hasilnya kosong (silent fallback)
                            result.drone = (err || !drones) ? [] : drones;
                            res.json({ success: true, data: result });
                        }
                    );
                }
            );
        }
    );
});

// ─── SALDO CUTI KARYAWAN YANG SEDANG LOGIN ─────────────────────
// GET /api/me/saldo-cuti
app.get('/api/me/saldo-cuti', requireAuth, (req, res) => {
    if (!req.user.karyawan_id) return res.status(403).json({ success: false, message: 'Akun bukan karyawan.' });

    const tahun = req.query.tahun || new Date().getFullYear();
    pool.query(
        'SELECT * FROM saldo_cuti WHERE karyawan_id = ? AND tahun = ?',
        [req.user.karyawan_id, tahun],
        (err, rows) => {
            if (err) return res.status(500).json({ success: false, message: err.message });
            if (rows.length === 0) {
                // Auto-create kalau belum ada
                pool.query(
                    'INSERT INTO saldo_cuti (karyawan_id, tahun, jatah, terpakai) VALUES (?, ?, 12, 0)',
                    [req.user.karyawan_id, tahun],
                    () => {
                        res.json({ success: true, data: { karyawan_id: req.user.karyawan_id, tahun, jatah: 12, terpakai: 0, sisa: 12 } });
                    }
                );
            } else {
                res.json({ success: true, data: rows[0] });
            }
        }
    );
});

// ─── SUBMIT PENGAJUAN IZIN (karyawan) ──────────────────────────
// POST /api/pengajuan-izin
// Body: { jenis_izin, tanggal_mulai, tanggal_selesai, alasan, lampiran }
app.post('/api/pengajuan-izin', requireAuth, upload.single('lampiran'), (req, res) => {
    const { jenis_izin, tanggal_mulai, tanggal_selesai, alasan } = req.body;

    if (!req.user.karyawan_id) {
        return res.status(403).json({ success: false, message: 'Akun ini tidak terhubung ke data karyawan.' });
    }
    if (!jenis_izin || !tanggal_mulai || !tanggal_selesai || !alasan) {
        return res.status(400).json({ success: false, message: 'Semua field wajib diisi.' });
    }

    const jenisValid = ['cuti_tahunan','sakit','izin_pribadi','cuti_melahirkan','cuti_menikah','wfh','dinas_luar'];
    if (!jenisValid.includes(jenis_izin)) {
        return res.status(400).json({ success: false, message: 'Jenis izin tidak valid.' });
    }

    const jumlahHari = hitungJumlahHari(tanggal_mulai, tanggal_selesai);
    if (jumlahHari < 1) {
        return res.status(400).json({ success: false, message: 'Tanggal selesai harus >= tanggal mulai.' });
    }

    const lampiranUrl = req.file ? `${APP_URL}/uploads/${req.file.filename}` : null;

    // Untuk cuti tahunan, cek saldo dulu
    const checkSaldo = (cb) => {
        if (jenis_izin !== 'cuti_tahunan') return cb(null);
        const tahun = new Date(tanggal_mulai).getFullYear();
        pool.query(
            'SELECT jatah, terpakai FROM saldo_cuti WHERE karyawan_id = ? AND tahun = ?',
            [req.user.karyawan_id, tahun],
            (err, rows) => {
                if (err) return cb(err);
                const sisa = rows.length > 0 ? (rows[0].jatah - rows[0].terpakai) : 12;
                if (sisa < jumlahHari) {
                    return cb(`Saldo cuti tidak cukup. Sisa: ${sisa} hari, diajukan: ${jumlahHari} hari.`);
                }
                cb(null);
            }
        );
    };

    checkSaldo((err) => {
        if (err) return res.status(400).json({ success: false, message: err });

        // Ambil snapshot data karyawan
        pool.query(
            `SELECT k.nama, d.nama_divisi as divisi FROM karyawan k LEFT JOIN divisi d ON k.divisi_id = d.id WHERE k.id = ?`,
            [req.user.karyawan_id],
            (err, kRows) => {
                if (err || kRows.length === 0) {
                    return res.status(500).json({ success: false, message: 'Data karyawan tidak ditemukan.' });
                }

                pool.query(
                    `INSERT INTO pengajuan_izin
                        (karyawan_id, nama_karyawan, divisi, jenis_izin, tanggal_mulai, tanggal_selesai, jumlah_hari, alasan, lampiran)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [req.user.karyawan_id, kRows[0].nama, kRows[0].divisi, jenis_izin, tanggal_mulai, tanggal_selesai, jumlahHari, alasan, lampiranUrl],
                    (err, result) => {
                        if (err) {
                            console.error(err);
                            return res.status(500).json({ success: false, message: 'Gagal menyimpan pengajuan.' });
                        }
                        res.json({
                            success: true,
                            message: 'Pengajuan berhasil dikirim. Menunggu review HR.',
                            id: result.insertId
                        });
                    }
                );
            }
        );
    });
});

// ─── PENGAJUAN SAYA (karyawan) ─────────────────────────────────
// GET /api/me/pengajuan
app.get('/api/me/pengajuan', requireAuth, (req, res) => {
    if (!req.user.karyawan_id) return res.json({ success: true, data: [] });
    pool.query(
        'SELECT * FROM pengajuan_izin WHERE karyawan_id = ? ORDER BY created_at DESC',
        [req.user.karyawan_id],
        (err, rows) => {
            if (err) return res.status(500).json({ success: false, message: err.message });
            res.json({ success: true, data: rows });
        }
    );
});

// ─── CANCEL PENGAJUAN SENDIRI (karyawan, hanya yang masih pending) ─
// POST /api/me/pengajuan/:id/cancel
app.post('/api/me/pengajuan/:id/cancel', requireAuth, (req, res) => {
    pool.query(
        'UPDATE pengajuan_izin SET status = ? WHERE id = ? AND karyawan_id = ? AND status = ?',
        ['cancelled', req.params.id, req.user.karyawan_id, 'pending'],
        (err, result) => {
            if (err) return res.status(500).json({ success: false, message: err.message });
            if (result.affectedRows === 0) return res.status(400).json({ success: false, message: 'Pengajuan tidak bisa dibatalkan.' });
            res.json({ success: true, message: 'Pengajuan berhasil dibatalkan.' });
        }
    );
});

// ─── LIST SEMUA PENGAJUAN (HR) ─────────────────────────────────
// GET /api/pengajuan-izin?status=pending&jenis=cuti_tahunan
app.get('/api/pengajuan-izin', requireAuth, requireHR, (req, res) => {
    const { status, jenis, karyawan_id } = req.query;
    let query = 'SELECT * FROM pengajuan_izin WHERE 1=1';
    const params = [];
    if (status) { query += ' AND status = ?'; params.push(status); }
    if (jenis) { query += ' AND jenis_izin = ?'; params.push(jenis); }
    if (karyawan_id) { query += ' AND karyawan_id = ?'; params.push(karyawan_id); }
    query += ' ORDER BY CASE status WHEN "pending" THEN 1 WHEN "approved" THEN 2 ELSE 3 END, created_at DESC';

    pool.query(query, params, (err, rows) => {
        if (err) return res.status(500).json({ success: false, message: err.message });
        res.json({ success: true, data: rows });
    });
});

// ─── DETAIL 1 PENGAJUAN ────────────────────────────────────────
// GET /api/pengajuan-izin/:id
app.get('/api/pengajuan-izin/:id', requireAuth, (req, res) => {
    pool.query('SELECT * FROM pengajuan_izin WHERE id = ?', [req.params.id], (err, rows) => {
        if (err || rows.length === 0) return res.status(404).json({ success: false, message: 'Pengajuan tidak ditemukan.' });
        // Karyawan biasa hanya boleh lihat punya sendiri
        if (req.user.role === 'karyawan' && rows[0].karyawan_id !== req.user.karyawan_id) {
            return res.status(403).json({ success: false, message: 'Tidak boleh akses pengajuan orang lain.' });
        }
        res.json({ success: true, data: rows[0] });
    });
});

// ─── APPROVE / REJECT PENGAJUAN (HR) ───────────────────────────
// POST /api/pengajuan-izin/:id/decide
// Body: { action: 'approve'|'reject', catatan }
app.post('/api/pengajuan-izin/:id/decide', requireAuth, requireHR, (req, res) => {
    const { action, catatan } = req.body;
    if (!['approve', 'reject'].includes(action)) {
        return res.status(400).json({ success: false, message: 'Action harus approve atau reject.' });
    }

    const newStatus = action === 'approve' ? 'approved' : 'rejected';

    pool.query('SELECT * FROM pengajuan_izin WHERE id = ?', [req.params.id], (err, rows) => {
        if (err || rows.length === 0) return res.status(404).json({ success: false, message: 'Pengajuan tidak ditemukan.' });
        const pengajuan = rows[0];
        if (pengajuan.status !== 'pending') {
            return res.status(400).json({ success: false, message: 'Pengajuan sudah diputuskan sebelumnya.' });
        }

        pool.query(
            `UPDATE pengajuan_izin SET status = ?, approved_by_user_id = ?, approved_by_username = ?, approved_at = NOW(), catatan_hr = ? WHERE id = ?`,
            [newStatus, req.user.id, req.user.username, catatan || null, req.params.id],
            (err) => {
                if (err) return res.status(500).json({ success: false, message: err.message });

                // Kalau approve cuti tahunan, kurangi saldo
                if (action === 'approve' && pengajuan.jenis_izin === 'cuti_tahunan') {
                    const tahun = new Date(pengajuan.tanggal_mulai).getFullYear();
                    pool.query(
                        `UPDATE saldo_cuti SET terpakai = terpakai + ? WHERE karyawan_id = ? AND tahun = ?`,
                        [pengajuan.jumlah_hari, pengajuan.karyawan_id, tahun],
                        () => {}
                    );
                }

                res.json({ success: true, message: `Pengajuan berhasil di-${action}.` });
            }
        );
    });
});

// ─── LIST USER (admin) ─────────────────────────────────────────
// GET /api/users
app.get('/api/users', requireAuth, requireAdmin, (req, res) => {
    pool.query(
        'SELECT id, username, nama_lengkap, role, karyawan_id, email, must_change_password, created_at FROM users ORDER BY created_at DESC',
        (err, rows) => {
            if (err) return res.status(500).json({ success: false, message: err.message });
            res.json({ success: true, data: rows });
        }
    );
});

// ─── DELETE USER (admin) ───────────────────────────────────────
app.delete('/api/users/:id', requireAuth, requireAdmin, (req, res) => {
    if (parseInt(req.params.id) === req.user.id) {
        return res.status(400).json({ success: false, message: 'Tidak bisa hapus akun sendiri.' });
    }
    pool.query('DELETE FROM users WHERE id = ?', [req.params.id], (err, result) => {
        if (err) return res.status(500).json({ success: false, message: err.message });
        if (result.affectedRows === 0) return res.status(404).json({ success: false, message: 'User tidak ditemukan.' });
        res.json({ success: true, message: 'User berhasil dihapus.' });
    });
});

// ─── RESET PASSWORD USER (admin) ───────────────────────────────
// POST /api/users/:id/reset-password
// Body: { new_password }
app.post('/api/users/:id/reset-password', requireAuth, requireAdmin, async (req, res) => {
    const { new_password } = req.body;
    if (!new_password || new_password.length < 6) {
        return res.status(400).json({ success: false, message: 'Password minimal 6 karakter.' });
    }
    const hashed = await bcrypt.hash(new_password, 10);
    pool.query(
        'UPDATE users SET password = ?, must_change_password = 1 WHERE id = ?',
        [hashed, req.params.id],
        (err, result) => {
            if (err) return res.status(500).json({ success: false, message: err.message });
            if (result.affectedRows === 0) return res.status(404).json({ success: false, message: 'User tidak ditemukan.' });
            res.json({ success: true, message: 'Password berhasil direset.' });
        }
    );
});

// ═══════════════════════════════════════════════════════════════
// STOCK OPNAME (Audit Inventaris Bulanan)
// ═══════════════════════════════════════════════════════════════

// ─── GET semua opname (list per bulan) ─────────────────────────
app.get('/api/stock-opname', requireAuth, (req, res) => {
    pool.query(
        `SELECT * FROM stock_opname ORDER BY periode DESC`,
        (err, rows) => {
            if (err) return res.status(500).json({ success: false, message: err.message });
            res.json({ success: true, data: rows });
        }
    );
});

// ─── GET detail 1 opname (header + items) ──────────────────────
app.get('/api/stock-opname/:id', requireAuth, (req, res) => {
    const { id } = req.params;
    pool.query('SELECT * FROM stock_opname WHERE id = ?', [id], (err, hRows) => {
        if (err || hRows.length === 0) {
            return res.status(404).json({ success: false, message: 'Opname tidak ditemukan.' });
        }
        pool.query(
            'SELECT * FROM stock_opname_detail WHERE opname_id = ? ORDER BY tipe_barang, nama_barang',
            [id],
            (err, dRows) => {
                if (err) return res.status(500).json({ success: false, message: err.message });
                res.json({ success: true, header: hRows[0], detail: dRows });
            }
        );
    });
});

// ─── MULAI opname baru ─────────────────────────────────────────
// POST /api/stock-opname/start
// Body: { periode (optional, default = bulan ini), judul (optional), catatan (optional) }
app.post('/api/stock-opname/start', requireAuth, requireAdmin, (req, res) => {
    const now = new Date();
    const periode = req.body.periode || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const namaBulan = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
    const [year, month] = periode.split('-');
    const judul = req.body.judul || `Audit ${namaBulan[parseInt(month) - 1]} ${year}`;

    // Cek apakah sudah ada opname untuk periode ini
    pool.query('SELECT id, status FROM stock_opname WHERE periode = ?', [periode], (err, exist) => {
        if (err) return res.status(500).json({ success: false, message: err.message });
        if (exist.length > 0) {
            return res.status(400).json({
                success: false,
                message: `Audit untuk periode ${periode} sudah ada (status: ${exist[0].status}).`,
                existing_id: exist[0].id
            });
        }

        // INSERT header
        pool.query(
            `INSERT INTO stock_opname (periode, judul, catatan, dibuat_oleh_user_id, dibuat_oleh_username)
             VALUES (?, ?, ?, ?, ?)`,
            [periode, judul, req.body.catatan || null, req.user.id, req.user.username],
            (err, result) => {
                if (err) return res.status(500).json({ success: false, message: err.message });
                const opnameId = result.insertId;

                // SNAPSHOT semua asset yang ada saat ini ke tabel detail
                // 1. Laptop
                const insertLaptops = `
                    INSERT INTO stock_opname_detail
                        (opname_id, tipe_barang, barang_id, nama_barang, nomor_inventaris,
                         karyawan_id_snapshot, nama_karyawan_snapshot, lokasi_snapshot, kondisi_snapshot)
                    SELECT
                        ?, 'laptop', il.id,
                        CONCAT(il.merek, ' ', COALESCE(il.model, '')),
                        il.nomor_inventaris,
                        il.karyawan_id, k.nama,
                        COALESCE(il.lokasi_penyimpanan, k.nama, 'Gudang'),
                        il.kondisi
                    FROM inventaris_laptop il
                    LEFT JOIN karyawan k ON il.karyawan_id = k.id
                `;
                // 2. Handphone
                const insertHps = `
                    INSERT INTO stock_opname_detail
                        (opname_id, tipe_barang, barang_id, nama_barang, nomor_inventaris,
                         karyawan_id_snapshot, nama_karyawan_snapshot, lokasi_snapshot, kondisi_snapshot)
                    SELECT
                        ?, 'handphone', h.id,
                        CONCAT(h.merek, ' ', COALESCE(h.model, '')),
                        h.nomor_inventaris,
                        h.karyawan_id, k.nama,
                        COALESCE(h.lokasi_penyimpanan, k.nama, 'Gudang'),
                        h.kondisi
                    FROM handphone h
                    LEFT JOIN karyawan k ON h.karyawan_id = k.id
                `;
                // 3. Kendaraan
                const insertKendaraan = `
                    INSERT INTO stock_opname_detail
                        (opname_id, tipe_barang, barang_id, nama_barang, nomor_inventaris, lokasi_snapshot, kondisi_snapshot)
                    SELECT
                        ?, 'kendaraan', id,
                        CONCAT(merek, ' ', COALESCE(model, '')),
                        COALESCE(nomor_plat, CONCAT('KDR-', id)),
                        'Garasi/Pool',
                        kondisi
                    FROM kendaraan
                `;
                // 4. Printer
                const insertPrinter = `
                    INSERT INTO stock_opname_detail
                        (opname_id, tipe_barang, barang_id, nama_barang, nomor_inventaris, lokasi_snapshot, kondisi_snapshot)
                    SELECT
                        ?, 'printer', id,
                        CONCAT(merek, ' ', COALESCE(model, '')),
                        COALESCE(serial_number, CONCAT('PRT-', id)),
                        COALESCE(lokasi, 'Kantor'),
                        kondisi
                    FROM printer
                `;
                // 5. Drone
                const insertDrone = `
                    INSERT INTO stock_opname_detail
                        (opname_id, tipe_barang, barang_id, nama_barang, nomor_inventaris,
                         karyawan_id_snapshot, nama_karyawan_snapshot, lokasi_snapshot, kondisi_snapshot)
                    SELECT
                        ?, 'drone', d.id,
                        CONCAT(d.merek, ' ', COALESCE(d.model, '')),
                        d.nomor_inventaris,
                        d.karyawan_id, k.nama,
                        COALESCE(d.lokasi_penyimpanan, k.nama, 'Gudang'),
                        d.kondisi
                    FROM drone d
                    LEFT JOIN karyawan k ON d.karyawan_id = k.id
                `;

                // Run all inserts sequentially, then update total
                pool.query(insertLaptops, [opnameId], () => {
                    pool.query(insertHps, [opnameId], () => {
                        pool.query(insertKendaraan, [opnameId], () => {
                            pool.query(insertPrinter, [opnameId], () => {
                                // Drone bisa fail kalau tabel drone belum ada (migration belum dijalanin)
                                pool.query(insertDrone, [opnameId], () => {
                                    // Update total_asset & total_pending
                                    pool.query(
                                        `UPDATE stock_opname
                                         SET total_asset = (SELECT COUNT(*) FROM stock_opname_detail WHERE opname_id = ?),
                                             total_pending = (SELECT COUNT(*) FROM stock_opname_detail WHERE opname_id = ?)
                                         WHERE id = ?`,
                                        [opnameId, opnameId, opnameId],
                                        () => {
                                            res.json({
                                                success: true,
                                                message: `Audit "${judul}" berhasil dimulai. Snapshot ${opnameId} asset.`,
                                                opname_id: opnameId
                                            });
                                        }
                                    );
                                });
                            });
                        });
                    });
                });
            }
        );
    });
});

// ─── UPDATE status 1 item dalam opname ────────────────────────
// PUT /api/stock-opname/:opname_id/items/:detail_id
// Body (multipart): { status_audit, lokasi_aktual, kondisi_aktual, catatan, foto }
app.put('/api/stock-opname/:opname_id/items/:detail_id', requireAuth, requireAdmin, upload.single('foto'), (req, res) => {
    const { opname_id, detail_id } = req.params;
    const { status_audit, lokasi_aktual, kondisi_aktual, catatan } = req.body;

    if (!['pending','ditemukan','rusak','hilang'].includes(status_audit)) {
        return res.status(400).json({ success: false, message: 'Status audit tidak valid.' });
    }

    // Cek opname masih in_progress
    pool.query('SELECT status FROM stock_opname WHERE id = ?', [opname_id], (err, hRows) => {
        if (err || hRows.length === 0) return res.status(404).json({ success: false, message: 'Opname tidak ditemukan.' });
        if (hRows[0].status !== 'in_progress') {
            return res.status(400).json({ success: false, message: 'Opname sudah selesai/dibatalkan, tidak bisa diubah.' });
        }

        // Ambil foto existing kalau gak upload baru
        const fotoUrl = req.file ? `${APP_URL}/uploads/${req.file.filename}` : (req.body.foto_existing || null);

        pool.query(
            `UPDATE stock_opname_detail
             SET status_audit = ?, lokasi_aktual = ?, kondisi_aktual = ?, foto_bukti = ?, catatan = ?,
                 diaudit_oleh_user_id = ?, diaudit_oleh_username = ?, diaudit_at = NOW()
             WHERE id = ? AND opname_id = ?`,
            [status_audit, lokasi_aktual || null, kondisi_aktual || null, fotoUrl, catatan || null,
             req.user.id, req.user.username, detail_id, opname_id],
            (err, result) => {
                if (err) return res.status(500).json({ success: false, message: err.message });
                if (result.affectedRows === 0) return res.status(404).json({ success: false, message: 'Item tidak ditemukan.' });
                res.json({ success: true, message: 'Status item berhasil diupdate.' });
            }
        );
    });
});

// ─── FINALIZE opname (tandai selesai + hitung statistik) ──────
// POST /api/stock-opname/:id/finalize
app.post('/api/stock-opname/:id/finalize', requireAuth, requireAdmin, (req, res) => {
    const { id } = req.params;
    pool.query('SELECT status FROM stock_opname WHERE id = ?', [id], (err, hRows) => {
        if (err || hRows.length === 0) return res.status(404).json({ success: false, message: 'Opname tidak ditemukan.' });
        if (hRows[0].status !== 'in_progress') {
            return res.status(400).json({ success: false, message: 'Opname sudah final.' });
        }

        // Hitung statistik
        pool.query(
            `SELECT
                COUNT(*) as total,
                SUM(status_audit = 'ditemukan') as ditemukan,
                SUM(status_audit = 'rusak') as rusak,
                SUM(status_audit = 'hilang') as hilang,
                SUM(status_audit = 'pending') as pending
             FROM stock_opname_detail WHERE opname_id = ?`,
            [id],
            (err, sRows) => {
                if (err) return res.status(500).json({ success: false, message: err.message });
                const s = sRows[0];

                pool.query(
                    `UPDATE stock_opname SET
                        status = 'completed',
                        tanggal_selesai = NOW(),
                        total_asset = ?, total_ditemukan = ?, total_rusak = ?, total_hilang = ?, total_pending = ?,
                        selesai_oleh_user_id = ?, selesai_oleh_username = ?
                     WHERE id = ?`,
                    [s.total, s.ditemukan, s.rusak, s.hilang, s.pending,
                     req.user.id, req.user.username, id],
                    (err) => {
                        if (err) return res.status(500).json({ success: false, message: err.message });

                        // Auto-update status barang yang dilabel "rusak" atau "hilang" di tabel asset
                        // (optional, tapi menjaga konsistensi data)
                        pool.query(
                            `SELECT tipe_barang, barang_id, status_audit FROM stock_opname_detail
                             WHERE opname_id = ? AND status_audit IN ('rusak','hilang')`,
                            [id],
                            (err, items) => {
                                const TABLE_MAP = { laptop:'inventaris_laptop', handphone:'handphone', kendaraan:'kendaraan', printer:'printer', drone:'drone' };
                                (items || []).forEach(item => {
                                    const tableName = TABLE_MAP[item.tipe_barang];
                                    if (!tableName) return;
                                    const newStatus = item.status_audit === 'rusak' ? 'Servis' : 'Hilang';
                                    pool.query(`UPDATE ${tableName} SET status = ? WHERE id = ?`, [newStatus, item.barang_id], () => {});
                                });
                            }
                        );

                        res.json({
                            success: true,
                            message: `Audit selesai! Total: ${s.total} asset (${s.ditemukan} ditemukan, ${s.rusak} rusak, ${s.hilang} hilang, ${s.pending} belum dicek).`,
                            statistik: s
                        });
                    }
                );
            }
        );
    });
});

// ─── HAPUS opname (hanya kalau in_progress) ───────────────────
app.delete('/api/stock-opname/:id', requireAuth, requireAdmin, (req, res) => {
    pool.query('SELECT status FROM stock_opname WHERE id = ?', [req.params.id], (err, hRows) => {
        if (err || hRows.length === 0) return res.status(404).json({ success: false, message: 'Opname tidak ditemukan.' });
        if (hRows[0].status === 'completed') {
            return res.status(400).json({ success: false, message: 'Opname yang sudah selesai tidak bisa dihapus.' });
        }
        pool.query('DELETE FROM stock_opname WHERE id = ?', [req.params.id], (err) => {
            if (err) return res.status(500).json({ success: false, message: err.message });
            res.json({ success: true, message: 'Opname berhasil dihapus.' });
        });
    });
});

// ═══════════════════════════════════════════════════════════════
// LICENSE MANAGEMENT
// ═══════════════════════════════════════════════════════════════

// Helper: hitung sisa hari ke expired
function calcDaysToExpired(expiredDate) {
    if (!expiredDate) return null;
    const now = new Date();
    const exp = new Date(expiredDate);
    return Math.ceil((exp - now) / (1000 * 60 * 60 * 24));
}

// Helper: tentukan status urgensi
function getUrgencyStatus(daysToExpired, status) {
    if (status === 'cancelled') return 'cancelled';
    if (daysToExpired === null) return 'perpetual';  // perpetual / one-time
    if (daysToExpired < 0) return 'expired';
    if (daysToExpired <= 7) return 'critical';      // 7 hari
    if (daysToExpired <= 14) return 'warning';      // 14 hari
    if (daysToExpired <= 30) return 'reminder';     // 30 hari
    return 'active';
}

// Helper: refresh kolom `terpakai` di license berdasarkan jumlah assignment aktif
function refreshTerpakai(licenseId, callback) {
    pool.query(
        `UPDATE software_license SET terpakai = (
            SELECT COUNT(*) FROM license_assignment
            WHERE license_id = ? AND status = 'active'
        ) WHERE id = ?`,
        [licenseId, licenseId],
        callback || (() => {})
    );
}

// ─── GET semua license ─────────────────────────────────────────
app.get('/api/license', requireAuth, (req, res) => {
    pool.query(
        `SELECT * FROM software_license ORDER BY
            CASE status WHEN 'active' THEN 1 WHEN 'expired' THEN 2 ELSE 3 END,
            tanggal_expired ASC, nama_software ASC`,
        (err, rows) => {
            if (err) return res.status(500).json({ success: false, message: err.message });

            // Enrich dengan info urgency
            const enriched = rows.map(r => {
                const days = calcDaysToExpired(r.tanggal_expired);
                return {
                    ...r,
                    days_to_expired: days,
                    urgency: getUrgencyStatus(days, r.status),
                    sisa: r.total_seat - (r.terpakai || 0)
                };
            });

            res.json({ success: true, data: enriched });
        }
    );
});

// ─── GET license expiring soon (untuk dashboard widget) ────────
app.get('/api/license/expiring-soon', requireAuth, (req, res) => {
    const threshold = parseInt(req.query.days) || 30;
    pool.query(
        `SELECT id, nama_software, vendor, tanggal_expired, total_seat, terpakai
         FROM software_license
         WHERE status = 'active'
           AND tanggal_expired IS NOT NULL
           AND tanggal_expired <= DATE_ADD(CURDATE(), INTERVAL ? DAY)
         ORDER BY tanggal_expired ASC`,
        [threshold],
        (err, rows) => {
            if (err) return res.status(500).json({ success: false, message: err.message });
            const enriched = (rows || []).map(r => ({
                ...r,
                days_to_expired: calcDaysToExpired(r.tanggal_expired),
                urgency: getUrgencyStatus(calcDaysToExpired(r.tanggal_expired), 'active')
            }));
            res.json({ success: true, data: enriched });
        }
    );
});

// ─── GET detail 1 license + assignments ───────────────────────
app.get('/api/license/:id', requireAuth, (req, res) => {
    pool.query('SELECT * FROM software_license WHERE id = ?', [req.params.id], (err, lRows) => {
        if (err || lRows.length === 0) return res.status(404).json({ success: false, message: 'License tidak ditemukan.' });

        pool.query(
            `SELECT la.*, k.nama as karyawan_nama, il.nomor_inventaris as laptop_nomor_inv,
                    il.merek as laptop_merek, il.model as laptop_model
             FROM license_assignment la
             LEFT JOIN karyawan k ON la.karyawan_id = k.id
             LEFT JOIN inventaris_laptop il ON la.laptop_id = il.id
             WHERE la.license_id = ?
             ORDER BY la.status ASC, la.tanggal_assign DESC`,
            [req.params.id],
            (err, aRows) => {
                if (err) return res.status(500).json({ success: false, message: err.message });

                const license = lRows[0];
                const days = calcDaysToExpired(license.tanggal_expired);

                res.json({
                    success: true,
                    license: {
                        ...license,
                        days_to_expired: days,
                        urgency: getUrgencyStatus(days, license.status),
                        sisa: license.total_seat - (license.terpakai || 0)
                    },
                    assignments: aRows || []
                });
            }
        );
    });
});

// ─── CREATE license baru ──────────────────────────────────────
app.post('/api/license', requireAuth, requireAdmin, (req, res) => {
    const {
        nama_software, vendor, versi, tipe_license, model_pembayaran,
        total_seat, harga_total, harga_per_seat, currency,
        tanggal_pembelian, tanggal_expired, akun_master, license_key,
        vendor_contact, invoice_url, catatan
    } = req.body;

    if (!nama_software) return res.status(400).json({ success: false, message: 'Nama software wajib diisi.' });

    pool.query(
        `INSERT INTO software_license
            (nama_software, vendor, versi, tipe_license, model_pembayaran, total_seat,
             harga_total, harga_per_seat, currency,
             tanggal_pembelian, tanggal_expired, akun_master, license_key,
             vendor_contact, invoice_url, catatan)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [nama_software, vendor || null, versi || null,
         tipe_license || 'per_user', model_pembayaran || 'subscription_tahunan',
         parseInt(total_seat) || 1,
         harga_total || null, harga_per_seat || null, currency || 'IDR',
         tanggal_pembelian || null, tanggal_expired || null,
         akun_master || null, license_key || null,
         vendor_contact || null, invoice_url || null, catatan || null],
        (err, result) => {
            if (err) return res.status(500).json({ success: false, message: err.message });
            res.json({ success: true, message: 'License berhasil ditambahkan.', id: result.insertId });
        }
    );
});

// ─── UPDATE license ───────────────────────────────────────────
app.put('/api/license/:id', requireAuth, requireAdmin, (req, res) => {
    const {
        nama_software, vendor, versi, tipe_license, model_pembayaran,
        total_seat, harga_total, harga_per_seat, currency,
        tanggal_pembelian, tanggal_expired, akun_master, license_key,
        vendor_contact, invoice_url, catatan, status
    } = req.body;

    pool.query(
        `UPDATE software_license SET
            nama_software=?, vendor=?, versi=?, tipe_license=?, model_pembayaran=?,
            total_seat=?, harga_total=?, harga_per_seat=?, currency=?,
            tanggal_pembelian=?, tanggal_expired=?, akun_master=?, license_key=?,
            vendor_contact=?, invoice_url=?, catatan=?, status=?
         WHERE id=?`,
        [nama_software, vendor || null, versi || null,
         tipe_license, model_pembayaran, parseInt(total_seat) || 1,
         harga_total || null, harga_per_seat || null, currency || 'IDR',
         tanggal_pembelian || null, tanggal_expired || null,
         akun_master || null, license_key || null,
         vendor_contact || null, invoice_url || null, catatan || null,
         status || 'active', req.params.id],
        (err, result) => {
            if (err) return res.status(500).json({ success: false, message: err.message });
            if (result.affectedRows === 0) return res.status(404).json({ success: false, message: 'License tidak ditemukan.' });
            res.json({ success: true, message: 'License berhasil diupdate.' });
        }
    );
});

// ─── DELETE license ───────────────────────────────────────────
app.delete('/api/license/:id', requireAuth, requireAdmin, (req, res) => {
    pool.query('DELETE FROM software_license WHERE id = ?', [req.params.id], (err, result) => {
        if (err) return res.status(500).json({ success: false, message: err.message });
        if (result.affectedRows === 0) return res.status(404).json({ success: false, message: 'License tidak ditemukan.' });
        res.json({ success: true, message: 'License berhasil dihapus.' });
    });
});

// ─── ASSIGN license ke karyawan/laptop/email ─────────────────
// POST /api/license/:id/assign
// Body: { assigned_to_type, karyawan_id?, laptop_id?, email_assigned?, catatan? }
app.post('/api/license/:id/assign', requireAuth, requireAdmin, (req, res) => {
    const { assigned_to_type, karyawan_id, laptop_id, email_assigned, catatan } = req.body;
    const licenseId = req.params.id;

    if (!assigned_to_type) return res.status(400).json({ success: false, message: 'Tipe assignment wajib.' });

    // Cek seat tersedia
    pool.query('SELECT total_seat, terpakai FROM software_license WHERE id = ?', [licenseId], (err, lRows) => {
        if (err || lRows.length === 0) return res.status(404).json({ success: false, message: 'License tidak ditemukan.' });
        const license = lRows[0];
        if (license.terpakai >= license.total_seat) {
            return res.status(400).json({
                success: false,
                message: `Seat sudah penuh (${license.terpakai}/${license.total_seat}). Unassign yang lain dulu atau tambah total seat.`
            });
        }

        // Validasi: pastikan target gak duplicate (1 karyawan/laptop tidak boleh punya 2 license aktif yang sama)
        let dupQuery = 'SELECT id FROM license_assignment WHERE license_id = ? AND status = "active" AND ';
        const dupParams = [licenseId];
        if (assigned_to_type === 'karyawan' && karyawan_id) {
            dupQuery += 'karyawan_id = ?';
            dupParams.push(karyawan_id);
        } else if (assigned_to_type === 'laptop' && laptop_id) {
            dupQuery += 'laptop_id = ?';
            dupParams.push(laptop_id);
        } else if (assigned_to_type === 'email_external' && email_assigned) {
            dupQuery += 'email_assigned = ?';
            dupParams.push(email_assigned);
        } else {
            return res.status(400).json({ success: false, message: 'Data assignment tidak lengkap.' });
        }

        pool.query(dupQuery, dupParams, (err, dupRows) => {
            if (dupRows && dupRows.length > 0) {
                return res.status(400).json({ success: false, message: 'Target sudah punya seat aktif untuk license ini.' });
            }

            // Get nama_target untuk snapshot
            const setNamaTarget = (cb) => {
                if (assigned_to_type === 'karyawan' && karyawan_id) {
                    pool.query('SELECT nama FROM karyawan WHERE id = ?', [karyawan_id], (e, r) => {
                        cb(r && r[0] ? r[0].nama : null);
                    });
                } else if (assigned_to_type === 'laptop' && laptop_id) {
                    pool.query('SELECT CONCAT(merek, " ", COALESCE(model, ""), " (", nomor_inventaris, ")") as label FROM inventaris_laptop WHERE id = ?', [laptop_id], (e, r) => {
                        cb(r && r[0] ? r[0].label : null);
                    });
                } else {
                    cb(email_assigned);
                }
            };

            setNamaTarget((namaTarget) => {
                pool.query(
                    `INSERT INTO license_assignment
                        (license_id, assigned_to_type, karyawan_id, laptop_id, email_assigned,
                         nama_target, catatan, assigned_by_username)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                    [licenseId, assigned_to_type,
                     karyawan_id || null, laptop_id || null, email_assigned || null,
                     namaTarget, catatan || null, req.user.username],
                    (err) => {
                        if (err) return res.status(500).json({ success: false, message: err.message });
                        refreshTerpakai(licenseId, () => {
                            res.json({ success: true, message: 'License berhasil di-assign.' });
                        });
                    }
                );
            });
        });
    });
});

// ─── UNASSIGN license ─────────────────────────────────────────
// POST /api/license/:id/unassign/:assignmentId
app.post('/api/license/:id/unassign/:assignmentId', requireAuth, requireAdmin, (req, res) => {
    pool.query(
        `UPDATE license_assignment SET
            status = 'unassigned',
            tanggal_unassign = NOW(),
            unassigned_by_username = ?
         WHERE id = ? AND license_id = ? AND status = 'active'`,
        [req.user.username, req.params.assignmentId, req.params.id],
        (err, result) => {
            if (err) return res.status(500).json({ success: false, message: err.message });
            if (result.affectedRows === 0) return res.status(404).json({ success: false, message: 'Assignment tidak ditemukan / sudah unassigned.' });
            refreshTerpakai(req.params.id, () => {
                res.json({ success: true, message: 'License berhasil di-unassign.' });
            });
        }
    );
});

// ─── STATISTIK LICENSE (untuk dashboard) ──────────────────────
app.get('/api/license/stats/summary', requireAuth, (req, res) => {
    const result = {};
    pool.query(
        `SELECT
            COUNT(*) as total,
            SUM(status = 'active') as aktif,
            SUM(status = 'expired') as expired_count,
            SUM(CASE WHEN tanggal_expired IS NOT NULL AND tanggal_expired < CURDATE() THEN 1 ELSE 0 END) as overdue,
            SUM(CASE WHEN tanggal_expired BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 30 DAY) THEN 1 ELSE 0 END) as expiring_30,
            SUM(CASE WHEN status = 'active' THEN harga_total ELSE 0 END) as total_investasi
         FROM software_license`,
        (err, rows) => {
            if (err) return res.status(500).json({ success: false, message: err.message });
            res.json({ success: true, data: rows[0] });
        }
    );
});

// Error handler
app.use((err, req, res, next) => {
    console.error('🔥 Error:', err);
    res.status(500).json({ success: false, message: err.message });
});

// Start server
const os = require('os');

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server running!`);
    console.log(`📁 Upload folder: ${uploadDir}`);
    console.log(`\n🌐 Akses dari komputer ini:`);
    console.log(`   http://localhost:${PORT}`);

    // Tampilkan semua IP network supaya karyawan lain tau alamatnya
    console.log(`\n🌐 Akses dari komputer lain di jaringan:`);
    const interfaces = os.networkInterfaces();
    Object.keys(interfaces).forEach(name => {
        interfaces[name].forEach(iface => {
            if (iface.family === 'IPv4' && !iface.internal) {
                console.log(`   http://${iface.address}:${PORT}   (${name})`);
            }
        });
    });
    console.log(`\n📝 Test endpoint: /api/test`);
});
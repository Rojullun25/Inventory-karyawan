/**
 * RESET PASSWORD USER
 *
 * Gunakan ini untuk reset password user ke plain text,
 * lalu server akan hash ulang dengan rounds=10 saat login pertama.
 *
 * Cara pakai:
 *   node reset_password.js <username> <password_baru>
 *
 * Contoh:
 *   node reset_password.js admin admin123
 *   node reset_password.js user user123
 */

require('dotenv').config();
const mysql = require('mysql2');
const bcrypt = require('bcryptjs');

const BCRYPT_ROUNDS = 10;

const username = process.argv[2];
const newPassword = process.argv[3];

if (!username || !newPassword) {
    console.log('❌ Usage: node reset_password.js <username> <password_baru>');
    console.log('   Contoh: node reset_password.js admin admin123');
    process.exit(1);
}

const db = mysql.createConnection({
    host:     process.env.DB_HOST     || 'localhost',
    port:     process.env.DB_PORT     || 3306,
    user:     process.env.DB_USER     || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME     || 'karyawan_db',
});

db.connect(err => {
    if (err) {
        console.error('❌ Gagal konek ke database:', err.message);
        process.exit(1);
    }

    bcrypt.hash(newPassword, BCRYPT_ROUNDS, (err, hashed) => {
        if (err) {
            console.error('❌ Gagal hash password:', err.message);
            db.end();
            return;
        }

        db.query(
            'UPDATE users SET password = ? WHERE username = ?',
            [hashed, username],
            (err, result) => {
                if (err) {
                    console.error('❌ Gagal update database:', err.message);
                } else if (result.affectedRows === 0) {
                    console.log(`❌ User "${username}" tidak ditemukan.`);
                } else {
                    console.log(`✅ Password "${username}" berhasil direset (rounds=${BCRYPT_ROUNDS}).`);
                    console.log(`   Login akan jauh lebih cepat sekarang.`);
                }
                db.end();
            }
        );
    });
});

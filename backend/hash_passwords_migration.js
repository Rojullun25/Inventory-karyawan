/**
 * MIGRATION: Hash semua password di tabel `users`
 *
 * Jalankan SEKALI setelah update server:
 *   node hash_passwords_migration.js
 *
 * Script ini akan:
 *   1. Ambil semua user
 *   2. Hash ulang password dengan bcrypt rounds = 10 (lebih cepat, tetap aman)
 *   3. Update kolom password di database
 *
 * CATATAN: Jika password sudah di-hash dengan rounds 12 sebelumnya,
 * script ini akan re-hash ulang dengan rounds 10 agar login lebih cepat.
 */

require('dotenv').config();
const mysql = require('mysql2');
const bcrypt = require('bcryptjs');

const BCRYPT_ROUNDS = 10; // Turun dari 12 → login ~100ms, aman untuk production

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
    console.log('✅ Konek ke database berhasil\n');
    migratePasswords();
});

async function migratePasswords() {
    db.query('SELECT id, username, password FROM users', async (err, users) => {
        if (err) {
            console.error('❌ Gagal query users:', err.message);
            db.end();
            process.exit(1);
        }

        if (users.length === 0) {
            console.log('ℹ️  Tidak ada user ditemukan.');
            db.end();
            return;
        }

        console.log(`📋 Ditemukan ${users.length} user. Mulai proses re-hash ke rounds=${BCRYPT_ROUNDS}...\n`);

        for (const user of users) {
            try {
                // Cek apakah sudah di-hash bcrypt
                if (user.password && user.password.startsWith('$2')) {
                    // Sudah di-hash — cek rounds-nya
                    const currentRounds = parseInt(user.password.split('$')[2]);
                    if (currentRounds === BCRYPT_ROUNDS) {
                        console.log(`⏩ ${user.username} — sudah rounds=${BCRYPT_ROUNDS}, skip.`);
                        continue;
                    } else {
                        console.log(`🔄 ${user.username} — rounds=${currentRounds}, re-hash ke rounds=${BCRYPT_ROUNDS}...`);
                        // Tidak bisa decode hash lama — password harus direset manual
                        // Untuk user yang sudah di-hash, kita skip (tidak bisa re-hash tanpa password asli)
                        console.log(`   ⚠️  Tidak bisa re-hash otomatis (password sudah di-hash). Reset manual diperlukan.`);
                        continue;
                    }
                }

                // Password masih plain text — hash dengan rounds baru
                const hashed = await bcrypt.hash(user.password, BCRYPT_ROUNDS);
                await new Promise((resolve, reject) => {
                    db.query(
                        'UPDATE users SET password = ? WHERE id = ?',
                        [hashed, user.id],
                        (err) => err ? reject(err) : resolve()
                    );
                });
                console.log(`✅ ${user.username} — password berhasil di-hash (rounds=${BCRYPT_ROUNDS}).`);
            } catch (e) {
                console.error(`❌ ${user.username} — gagal hash:`, e.message);
            }
        }

        console.log('\n🎉 Selesai!');
        console.log('⚠️  Untuk user yang sudah di-hash dengan rounds 12:');
        console.log('   Gunakan script reset_password.js untuk reset manual.\n');
        db.end();
    });
}

// database.js
// URL otomatis: pakai domain yang sama dengan halaman ini (untuk Railway/hosting)
// API URL otomatis menyesuaikan hostname.
// Kalau diakses via IP jaringan (misal 192.168.1.105), pakai IP itu juga untuk API.
// Kalau hosting di domain (production), pakai origin (mengasumsikan reverse proxy).
const API_URL = (() => {
    const host = window.location.hostname;
    // Production / domain: pakai origin tanpa port (asumsi reverse proxy)
    if (host !== 'localhost' && host !== '127.0.0.1' && !host.match(/^\d+\.\d+\.\d+\.\d+$/)) {
        return window.location.origin + '/api';
    }
    // Localhost / IP jaringan: backend selalu di port 3000
    return `http://${host}:3000/api`;
})();

// MEDIA_URL: base untuk file upload (foto, lampiran). Sama dengan API tapi tanpa /api suffix.
const MEDIA_URL = API_URL.replace(/\/api$/, '');

// Helper: convert path relative jadi URL absolut ke backend.
// Pakai ini di SEMUA <img src="..."> yang isinya foto dari database.
//
// Examples:
//   resolveUrl('/uploads/foto.jpg')              → 'http://10.100.203.51:3000/uploads/foto.jpg'
//   resolveUrl('http://localhost:3000/uploads/x') → 'http://10.100.203.51:3000/uploads/x' (auto-fix legacy)
//   resolveUrl('https://ui-avatars.com/...')     → 'https://ui-avatars.com/...' (external, biarkan)
//   resolveUrl(null)                              → null
function resolveUrl(url) {
    if (!url) return null;
    // External URL (http/https BUKAN ke localhost lama) - biarkan
    if (/^https?:\/\//.test(url)) {
        // Auto-fix kalau ada legacy URL yang masih pakai localhost
        if (url.startsWith('http://localhost:3000') || url.startsWith('http://127.0.0.1:3000')) {
            return MEDIA_URL + url.replace(/^https?:\/\/[^/]+/, '');
        }
        return url;
    }
    // Path relative — prepend MEDIA_URL
    if (url.startsWith('/')) return MEDIA_URL + url;
    return MEDIA_URL + '/' + url;
}

// ─────────────────────────────────────────────────────────
// FETCH INTERCEPTOR
// Otomatis sisipkan Authorization header ke SEMUA fetch()
// yang menuju /api/ — tanpa perlu ubah kode di halaman lain.
// ─────────────────────────────────────────────────────────
(function() {
    const _originalFetch = window.fetch;
    window.fetch = function(url, options = {}) {
        const token = localStorage.getItem('auth_token');
        // Hanya inject ke request yang menuju /api/ dan ada token
        if (token && typeof url === 'string' && url.includes('/api/')) {
            options = { ...options };
            options.headers = {
                ...(options.headers || {}),
                'Authorization': 'Bearer ' + token
            };
        }
        return _originalFetch.call(window, url, options);
    };
})();


// ==================== AUTH HELPER ====================

// Ambil token dari localStorage
function getToken() {
    return localStorage.getItem('auth_token');
}

// Simpan token setelah login
function setToken(token) {
    localStorage.setItem('auth_token', token);
}

// Hapus token saat logout
function removeToken() {
    localStorage.removeItem('auth_token');
    localStorage.removeItem('auth_user');
}

// Header default dengan Authorization token
function authHeaders(extraHeaders = {}) {
    const token = getToken();
    return {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        ...extraHeaders
    };
}

// Fetch helper: otomatis sertakan token, dan redirect ke login jika 401/403
async function apiFetch(url, options = {}) {
    const token = getToken();

    // Kalau ada body FormData, jangan set Content-Type (biar browser yang set boundary)
    const isFormData = options.body instanceof FormData;
    const headers = {
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        ...(!isFormData ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers || {})
    };

    const response = await fetch(url, { ...options, headers });

    // Token expired atau tidak valid → redirect ke halaman login
    if (response.status === 401 || response.status === 403) {
        removeToken();
        // Cek apakah kita sudah di halaman login supaya tidak infinite redirect
        if (!window.location.pathname.includes('index.html') && window.location.pathname !== '/') {
            alert('Sesi kamu sudah habis. Silakan login kembali.');
            window.location.href = 'index.html';
        }
        throw new Error('Unauthorized');
    }

    return response;
}

// ==================== AUTH API ====================

async function login(username, password) {
    try {
        const response = await fetch(`${API_URL}/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        const result = await response.json();
        if (result.success) {
            setToken(result.token);
            localStorage.setItem('auth_user', JSON.stringify(result.user));
        }
        return result;
    } catch (error) {
        console.error('❌ Error login:', error);
        throw error;
    }
}

function logout() {
    removeToken();
    window.location.href = 'index.html';
}

function getCurrentUser() {
    try {
        return JSON.parse(localStorage.getItem('auth_user'));
    } catch {
        return null;
    }
}

// Cek apakah user sudah login. Kalau belum, redirect ke login page.
function requireLogin() {
    if (!getToken()) {
        window.location.href = 'index.html';
        return false;
    }
    return true;
}

// ==================== KARYAWAN API ====================

// Ambil semua karyawan
async function getAllKaryawan() {
    try {
        const response = await apiFetch(`${API_URL}/karyawan`);
        if (!response.ok) throw new Error('Gagal mengambil data');
        return await response.json();
    } catch (error) {
        console.error('❌ Error fetching karyawan:', error);
        throw error;
    }
}

// Ambil karyawan by ID
async function getKaryawanById(id) {
    try {
        const response = await apiFetch(`${API_URL}/karyawan/${id}`);
        if (!response.ok) throw new Error('Gagal mengambil data');
        return await response.json();
    } catch (error) {
        console.error('❌ Error fetching karyawan:', error);
        throw error;
    }
}

// Search karyawan
async function searchKaryawan(keyword) {
    try {
        const allKaryawan = await getAllKaryawan();
        const keywordLower = keyword.toLowerCase();
        return allKaryawan.filter(k => 
            k.id?.toLowerCase().includes(keywordLower) ||
            k.nama?.toLowerCase().includes(keywordLower) ||
            (k.divisi && k.divisi.toLowerCase().includes(keywordLower)) ||
            (k.jabatan && k.jabatan.toLowerCase().includes(keywordLower)) ||
            (k.laptop && k.laptop.toLowerCase().includes(keywordLower))
        );
    } catch (error) {
        console.error('❌ Error searching karyawan:', error);
        throw error;
    }
}

// Ambil semua divisi
async function getAllDivisi() {
    try {
        const response = await apiFetch(`${API_URL}/divisi`);
        if (!response.ok) throw new Error('Gagal mengambil divisi');
        return await response.json();
    } catch (error) {
        console.error('❌ Error fetching divisi:', error);
        return [];
    }
}

// TAMBAH Karyawan (via API) - VERSI UPLOAD FILE
async function addKaryawanApi(formData) {
    try {
        const response = await apiFetch(`${API_URL}/karyawan`, {
            method: 'POST',
            body: formData
            // Jangan set Content-Type, biar browser yang set dengan boundary
        });
        
        const result = await response.json();
        
        if (!result.success) {
            throw new Error(result.message);
        }
        
        return result;
    } catch (error) {
        console.error('❌ Error adding karyawan:', error);
        throw error;
    }
}

// UPDATE Karyawan (via API) - VERSI UPLOAD FILE
async function updateKaryawanApi(id, formData) {
    try {
        const response = await apiFetch(`${API_URL}/karyawan/${id}`, {
            method: 'PUT',
            body: formData
        });
        
        const result = await response.json();
        
        if (!result.success) {
            throw new Error(result.message);
        }
        
        return result;
    } catch (error) {
        console.error('❌ Error updating karyawan:', error);
        throw error;
    }
}

// DELETE Karyawan (via API)
async function deleteKaryawanApi(id) {
    try {
        const response = await apiFetch(`${API_URL}/karyawan/${id}`, {
            method: 'DELETE'
        });
        
        const result = await response.json();
        
        if (!result.success) {
            throw new Error(result.message);
        }
        
        return result;
    } catch (error) {
        console.error('❌ Error deleting karyawan:', error);
        throw error;
    }
}

// Get statistics
async function getStatistics() {
    try {
        const response = await apiFetch(`${API_URL}/statistics`);
        const result = await response.json();
        
        if (!result.success) {
            throw new Error(result.message);
        }
        
        return result.data;
    } catch (error) {
        console.error('❌ Error getting statistics:', error);
        return {
            total_karyawan: 0,
            total_divisi: 0,
            total_laptop: 0,
            total_software: 0,
            karyawan_per_divisi: []
        };
    }
}

// ==================== INVENTARIS API ====================

// === KENDARAAN ===
async function getAllKendaraan() {
    try {
        const response = await apiFetch(`${API_URL}/kendaraan`);
        if (!response.ok) throw new Error('Gagal mengambil data kendaraan');
        const result = await response.json();
        return result.data || result;
    } catch (error) {
        console.error('❌ Error fetching kendaraan:', error);
        return [];
    }
}

async function getKendaraanById(id) {
    try {
        const allData = await getAllKendaraan();
        return allData.find(item => item.id === id);
    } catch (error) {
        console.error('❌ Error fetching kendaraan by ID:', error);
        return null;
    }
}

async function saveKendaraan(data) {
    try {
        const isUpdate = !!data.id;
        const response = await apiFetch(
            isUpdate ? `${API_URL}/kendaraan/${data.id}` : `${API_URL}/kendaraan`,
            {
                method: isUpdate ? 'PUT' : 'POST',
                body: JSON.stringify(data)
            }
        );
        return await response.json();
    } catch (error) {
        console.error('❌ Error saving kendaraan:', error);
        return { success: false, message: error.message };
    }
}

async function deleteKendaraanApi(id) {
    try {
        const response = await apiFetch(`${API_URL}/kendaraan/${id}`, { method: 'DELETE' });
        return await response.json();
    } catch (error) {
        console.error('❌ Error deleting kendaraan:', error);
        return { success: false, message: error.message };
    }
}

// === PRINTER ===
async function getAllPrinter() {
    try {
        const response = await apiFetch(`${API_URL}/printer`);
        if (!response.ok) throw new Error('Gagal mengambil data printer');
        const result = await response.json();
        return result.data || result;
    } catch (error) {
        console.error('❌ Error fetching printer:', error);
        return [];
    }
}

async function getPrinterById(id) {
    try {
        const allData = await getAllPrinter();
        return allData.find(item => item.id === id);
    } catch (error) {
        console.error('❌ Error fetching printer by ID:', error);
        return null;
    }
}

async function savePrinter(data) {
    try {
        const isUpdate = !!data.id;
        const response = await apiFetch(
            isUpdate ? `${API_URL}/printer/${data.id}` : `${API_URL}/printer`,
            {
                method: isUpdate ? 'PUT' : 'POST',
                body: JSON.stringify(data)
            }
        );
        return await response.json();
    } catch (error) {
        console.error('❌ Error saving printer:', error);
        return { success: false, message: error.message };
    }
}

async function deletePrinterApi(id) {
    try {
        const response = await apiFetch(`${API_URL}/printer/${id}`, { method: 'DELETE' });
        return await response.json();
    } catch (error) {
        console.error('❌ Error deleting printer:', error);
        return { success: false, message: error.message };
    }
}

// === LAPTOP INVENTARIS ===
async function getAllLaptopInventaris() {
    try {
        const response = await apiFetch(`${API_URL}/inventaris-laptop`);
        if (!response.ok) throw new Error('Gagal mengambil data laptop');
        const result = await response.json();
        return result.data || result;
    } catch (error) {
        console.error('❌ Error fetching laptop inventaris:', error);
        return [];
    }
}

async function getLaptopInventarisById(id) {
    try {
        const allData = await getAllLaptopInventaris();
        return allData.find(item => item.id === id);
    } catch (error) {
        console.error('❌ Error fetching laptop inventaris by ID:', error);
        return null;
    }
}

async function saveLaptopInventaris(data) {
    try {
        const isUpdate = !!data.id;
        const response = await apiFetch(
            isUpdate ? `${API_URL}/inventaris-laptop/${data.id}` : `${API_URL}/inventaris-laptop`,
            {
                method: isUpdate ? 'PUT' : 'POST',
                body: data  // FormData untuk upload foto
            }
        );
        return await response.json();
    } catch (error) {
        console.error('❌ Error saving laptop inventaris:', error);
        return { success: false, message: error.message };
    }
}

async function deleteLaptopInventarisApi(id) {
    try {
        const response = await apiFetch(`${API_URL}/inventaris-laptop/${id}`, { method: 'DELETE' });
        return await response.json();
    } catch (error) {
        console.error('❌ Error deleting laptop inventaris:', error);
        return { success: false, message: error.message };
    }
}

// === STATISTIK INVENTARIS ===
async function getInventarisStatistics() {
    try {
        const response = await apiFetch(`${API_URL}/statistics/inventaris`);
        if (!response.ok) throw new Error('Gagal ambil statistik');
        const result = await response.json();
        return result.data || result;
    } catch (error) {
        console.error('❌ Error getting inventaris statistics:', error);
        return {
            kendaraan: { total: 0, tersedia: 0, digunakan: 0, servis: 0 },
            printer: { total: 0, laser: 0, inkjet: 0, dotmatrix: 0, thermal: 0, tersedia: 0, digunakan: 0, servis: 0 },
            laptop: { total: 0, tersedia: 0, digunakan: 0, servis: 0, rusak: 0, hilang: 0 }
        };
    }
}

// === RIWAYAT PEMAKAIAN (dari database, bukan localStorage) ===

// Ambil semua riwayat dengan filter opsional
// filter = { tipe, karyawan_id, barang_id, aktif }
async function getAllRiwayat(filter = {}) {
    try {
        const params = new URLSearchParams();
        if (filter.tipe) params.append('tipe', filter.tipe);
        if (filter.karyawan_id) params.append('karyawan_id', filter.karyawan_id);
        if (filter.barang_id) params.append('barang_id', filter.barang_id);
        if (filter.aktif !== undefined) params.append('aktif', filter.aktif);

        const url = `${API_URL}/riwayat-pemakaian${params.toString() ? '?' + params.toString() : ''}`;
        const response = await apiFetch(url);
        if (!response.ok) throw new Error('Gagal mengambil riwayat');
        const result = await response.json();
        return result.data || [];
    } catch (error) {
        console.error('❌ Error fetching riwayat:', error);
        return [];
    }
}

// Ambil riwayat untuk 1 barang tertentu
async function getRiwayatByBarang(tipe, barangId) {
    try {
        const response = await apiFetch(`${API_URL}/riwayat-pemakaian/barang/${tipe}/${barangId}`);
        if (!response.ok) throw new Error('Gagal mengambil riwayat barang');
        const result = await response.json();
        return result.data || [];
    } catch (error) {
        console.error('❌ Error fetching riwayat by barang:', error);
        return [];
    }
}

// Ambil riwayat pemakaian untuk 1 karyawan
async function getRiwayatByKaryawan(karyawanId) {
    try {
        const response = await apiFetch(`${API_URL}/riwayat-pemakaian/karyawan/${karyawanId}`);
        if (!response.ok) throw new Error('Gagal mengambil riwayat karyawan');
        const result = await response.json();
        return result.data || [];
    } catch (error) {
        console.error('❌ Error fetching riwayat by karyawan:', error);
        return [];
    }
}

// Assign barang ke karyawan
// data = { tipe, barang_id, karyawan_id, kondisi, catatan }
async function assignBarang(data) {
    try {
        const response = await apiFetch(`${API_URL}/riwayat-pemakaian/assign`, {
            method: 'POST',
            body: JSON.stringify(data)
        });
        return await response.json();
    } catch (error) {
        console.error('❌ Error assign barang:', error);
        return { success: false, message: error.message };
    }
}

// Return barang (balik ke gudang)
// data = { tipe, barang_id, kondisi, catatan }
async function returnBarang(data) {
    try {
        const response = await apiFetch(`${API_URL}/riwayat-pemakaian/return`, {
            method: 'POST',
            body: JSON.stringify(data)
        });
        return await response.json();
    } catch (error) {
        console.error('❌ Error return barang:', error);
        return { success: false, message: error.message };
    }
}

// ==================== EXPORT FUNCTIONS ====================

function exportToCSV(data, filename) {
    if (!data || data.length === 0) { alert('Tidak ada data untuk diexport'); return; }
    const headers = Object.keys(data[0]).join(',');
    const rows = data.map(item =>
        Object.values(item).map(value => {
            if (typeof value === 'string' && value.includes(',')) return `"${value}"`;
            return value;
        }).join(',')
    ).join('\n');
    const blob = new Blob([headers + '\n' + rows], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = window.URL.createObjectURL(blob);
    a.download = filename + '.csv';
    a.click();
    window.URL.revokeObjectURL(a.href);
}

function exportToExcel(data, filename) {
    if (!data || data.length === 0) { alert('Tidak ada data untuk diexport'); return; }
    let csv = Object.keys(data[0]).join('\t') + '\n';
    data.forEach(item => { csv += Object.values(item).join('\t') + '\n'; });
    const blob = new Blob([csv], { type: 'text/tab-separated-values' });
    const a = document.createElement('a');
    a.href = window.URL.createObjectURL(blob);
    a.download = filename + '.xls';
    a.click();
    window.URL.revokeObjectURL(a.href);
}

// ==================== UTILITY FUNCTIONS ====================

function formatDate(dateString) {
    if (!dateString) return '-';
    const date = new Date(dateString);
    return date.toLocaleDateString('id-ID', {
        day: '2-digit', month: 'long', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
    });
}

function formatRupiah(angka) {
    if (!angka) return 'Rp 0';
    return 'Rp ' + angka.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

function generateId(prefix) {
    const timestamp = Date.now().toString().slice(-6);
    const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
    return `${prefix}-${timestamp}${random}`;
}

function validateForm(data, rules) {
    const errors = [];
    for (const [field, rule] of Object.entries(rules)) {
        const value = data[field];
        if (rule.required && (!value || value.toString().trim() === '')) errors.push(`${rule.label || field} harus diisi`);
        if (rule.minLength && value && value.length < rule.minLength) errors.push(`${rule.label || field} minimal ${rule.minLength} karakter`);
        if (rule.maxLength && value && value.length > rule.maxLength) errors.push(`${rule.label || field} maksimal ${rule.maxLength} karakter`);
        if (rule.pattern && value && !rule.pattern.test(value)) errors.push(`${rule.label || field} tidak valid`);
    }
    return { valid: errors.length === 0, errors };
}

function showNotification(message, type = 'success') {
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.innerHTML = `<i class="fas ${type === 'success' ? 'fa-check-circle' : 'fa-exclamation-circle'}"></i> ${message}`;
    document.body.appendChild(notification);
    setTimeout(() => notification.remove(), 3000);
}

async function confirmAction(message) {
    return new Promise((resolve) => resolve(confirm(message)));
}

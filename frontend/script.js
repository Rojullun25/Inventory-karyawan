// Fungsi logout (gunakan yang ada di database.js untuk hapus JWT token juga)
function logout() {
    localStorage.removeItem('auth_token');
    localStorage.removeItem('auth_user');
    localStorage.removeItem('isLoggedIn');
    window.location.href = 'index.html';
}

// Format tanggal
function formatDate(date) {
    return new Date(date).toLocaleDateString('id-ID', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });
}

// Export data ke CSV
function exportToCSV() {
    const karyawan = JSON.parse(localStorage.getItem('karyawan')) || [];
    if(karyawan.length === 0) {
        alert('Tidak ada data untuk diexport');
        return;
    }
    
    const headers = Object.keys(karyawan[0]).join(',');
    const rows = karyawan.map(k => Object.values(k).map(v => `"${v}"`).join(',')).join('\n');
    const csv = headers + '\n' + rows;
    
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'data-karyawan.csv';
    a.click();
}
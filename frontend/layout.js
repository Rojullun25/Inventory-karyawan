/**
 * LAYOUT.JS — Auto-inject responsive layout (topbar + drawer)
 *
 * Usage: just include this script after database.js in any HTML page.
 * The script auto-detects current page from URL and applies active state.
 *
 * Menu structure can be customized below in MENU_CONFIG.
 */

(function() {
    // ─── MENU CONFIG ────────────────────────────────────────────
    const MENU = [
        {
            type: 'link',
            page: 'dashboard',
            href: 'dashboard.html',
            icon: 'fa-home',
            label: 'Dashboard'
        },
        {
            type: 'group',
            label: 'Apps',
            icon: 'fa-th-large',
            children: [
                { page: 'data-karyawan',     href: 'data-karyawan.html',     icon: 'fa-users',         label: 'Data Karyawan' },
                { page: 'inventaris',        href: 'inventaris.html',        icon: 'fa-laptop',        label: 'Data Inventaris' },
                { page: 'riwayat-pemakaian', href: 'riwayat-pemakaian.html', icon: 'fa-history',       label: 'Riwayat Pemakaian' },
                { page: 'stock-opname',      href: 'stock-opname.html',      icon: 'fa-clipboard-check', label: 'Stock Opname' },
                { page: 'license-management',href: 'license-management.html',icon: 'fa-key',           label: 'License Software' },
            ]
        },
        {
            type: 'link',
            page: 'laporan-bulanan',
            href: 'laporan-bulanan.html',
            icon: 'fa-file-alt',
            label: 'Laporan Bulanan'
        },
    ];

    // Detect current page from URL
    const currentPage = (window.location.pathname.split('/').pop() || 'dashboard.html')
        .replace('.html', '')
        .toLowerCase();

    // Get user info from localStorage
    const user = (() => {
        try { return JSON.parse(localStorage.getItem('auth_user')); }
        catch(e) { return null; }
    })();

    const userName = user?.nama_lengkap || user?.username || 'User';
    const userRole = (user?.role || 'guest').toUpperCase();
    const userInitial = (userName[0] || 'U').toUpperCase();

    // ─── BUILD TOPBAR HTML ─────────────────────────────────────
    function buildDesktopNav() {
        return MENU.map(item => {
            if (item.type === 'link') {
                const isActive = item.page === currentPage;
                return `
                    <div class="app-nav-item">
                        <a href="${item.href}" class="app-nav-link ${isActive ? 'active' : ''}">
                            <i class="fas ${item.icon}"></i> ${item.label}
                        </a>
                    </div>
                `;
            }
            if (item.type === 'group') {
                const hasActive = item.children.some(c => c.page === currentPage);
                const dropdownItems = item.children.map(c => `
                    <a href="${c.href}" class="${c.page === currentPage ? 'active' : ''}">
                        <i class="fas ${c.icon}"></i> ${c.label}
                    </a>
                `).join('');
                return `
                    <div class="app-nav-item" data-group>
                        <button class="app-nav-trigger ${hasActive ? 'has-active' : ''}">
                            <i class="fas ${item.icon}"></i> ${item.label}
                            <i class="fas fa-chevron-down" style="font-size:10px;"></i>
                        </button>
                        <div class="app-dropdown">${dropdownItems}</div>
                    </div>
                `;
            }
            return '';
        }).join('');
    }

    function buildDrawerNav() {
        let html = '';
        MENU.forEach(item => {
            if (item.type === 'link') {
                const isActive = item.page === currentPage;
                html += `
                    <a href="${item.href}" class="app-drawer-link ${isActive ? 'active' : ''}">
                        <i class="fas ${item.icon}"></i> ${item.label}
                    </a>
                `;
            }
            if (item.type === 'group') {
                html += `<div class="app-drawer-section-title">${item.label}</div>`;
                item.children.forEach(c => {
                    const isActive = c.page === currentPage;
                    html += `
                        <a href="${c.href}" class="app-drawer-link ${isActive ? 'active' : ''}">
                            <i class="fas ${c.icon}"></i> ${c.label}
                        </a>
                    `;
                });
            }
        });
        return html;
    }

    // ─── INJECT HTML ───────────────────────────────────────────
    const topbarHTML = `
        <header class="app-topbar">
            <button class="app-hamburger" id="appHamburger" aria-label="Menu">
                <i class="fas fa-bars"></i>
            </button>
            <div class="app-brand">
                <img src="img/logo-topbar.png" alt="Logo" onerror="this.style.display='none'">
                <div class="app-brand-text">
                    <h1>PT Wiratama</h1>
                    <p>Globalindo Jaya</p>
                </div>
            </div>
            <nav class="app-desktop-nav">${buildDesktopNav()}</nav>
            <div class="app-user">
                <div class="app-user-info">
                    <div class="name">${userName}</div>
                    <div class="role">${userRole}</div>
                </div>
                <div class="app-user-avatar">${userInitial}</div>
                <button class="app-logout-btn" onclick="logout()">Logout</button>
            </div>
        </header>

        <div class="app-drawer-backdrop" id="appDrawerBackdrop"></div>
        <aside class="app-drawer" id="appDrawer">
            <div class="app-drawer-header">
                <img src="img/logo-topbar.png" alt="Logo" onerror="this.style.display='none'">
                <div>
                    <div class="name">PT Wiratama</div>
                    <div class="sub">Globalindo Jaya</div>
                </div>
            </div>
            <div class="app-drawer-user">
                <div class="avatar">${userInitial}</div>
                <div>
                    <div class="name">${userName}</div>
                    <div class="role">${userRole}</div>
                </div>
            </div>
            <nav class="app-drawer-nav">${buildDrawerNav()}</nav>
            <div class="app-drawer-footer">
                <button class="app-drawer-logout" onclick="logout()">
                    <i class="fas fa-sign-out-alt"></i> Logout
                </button>
            </div>
        </aside>
    `;

    // Insert at start of body
    function inject() {
        // Hapus navbar lama yang mungkin ada
        document.querySelectorAll('nav.navbar').forEach(n => n.remove());
        // Insert layout
        document.body.insertAdjacentHTML('afterbegin', topbarHTML);
        bindEvents();
    }

    function bindEvents() {
        const hamburger = document.getElementById('appHamburger');
        const drawer = document.getElementById('appDrawer');
        const backdrop = document.getElementById('appDrawerBackdrop');

        const openDrawer = () => {
            drawer.classList.add('show');
            backdrop.classList.add('show');
            document.body.style.overflow = 'hidden';
        };
        const closeDrawer = () => {
            drawer.classList.remove('show');
            backdrop.classList.remove('show');
            document.body.style.overflow = '';
        };

        hamburger?.addEventListener('click', openDrawer);
        backdrop?.addEventListener('click', closeDrawer);

        // Close drawer when clicking a link
        drawer?.querySelectorAll('a').forEach(a => {
            a.addEventListener('click', closeDrawer);
        });

        // Desktop dropdown — click to toggle
        document.querySelectorAll('[data-group]').forEach(group => {
            const trigger = group.querySelector('.app-nav-trigger');
            trigger?.addEventListener('click', (e) => {
                e.stopPropagation();
                const wasOpen = group.classList.contains('open');
                document.querySelectorAll('[data-group]').forEach(g => g.classList.remove('open'));
                if (!wasOpen) group.classList.add('open');
            });
        });

        // Click outside → close all dropdowns
        document.addEventListener('click', () => {
            document.querySelectorAll('[data-group]').forEach(g => g.classList.remove('open'));
        });

        // Hover to open on desktop (extra UX)
        document.querySelectorAll('[data-group]').forEach(group => {
            group.addEventListener('mouseenter', () => {
                if (window.innerWidth >= 1024) {
                    document.querySelectorAll('[data-group]').forEach(g => {
                        if (g !== group) g.classList.remove('open');
                    });
                    group.classList.add('open');
                }
            });
            group.addEventListener('mouseleave', () => {
                if (window.innerWidth >= 1024) group.classList.remove('open');
            });
        });

        // Esc key closes drawer
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') closeDrawer();
        });
    }

    // Inject when DOM ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', inject);
    } else {
        inject();
    }
})();

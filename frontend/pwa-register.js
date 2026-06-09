/**
 * PWA-REGISTER.JS — Register service worker, handle install prompt & offline status
 * Include script ini di setiap halaman SETELAH layout.js
 */

(function() {
    'use strict';

    // ─── 1. REGISTER SERVICE WORKER ────────────────────────────
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('./service-worker.js')
                .then(reg => {
                    console.log('[PWA] Service Worker registered:', reg.scope);

                    // Check for update every 1 hour
                    setInterval(() => reg.update(), 60 * 60 * 1000);

                    // Listen for new SW available
                    reg.addEventListener('updatefound', () => {
                        const newSW = reg.installing;
                        newSW?.addEventListener('statechange', () => {
                            if (newSW.state === 'installed' && navigator.serviceWorker.controller) {
                                showUpdateBanner();
                            }
                        });
                    });
                })
                .catch(err => console.warn('[PWA] SW registration failed:', err));
        });
    }

    // ─── 2. INSTALL PROMPT (Chrome/Edge) ───────────────────────
    let deferredPrompt = null;

    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        deferredPrompt = e;
        console.log('[PWA] Install prompt ready');
        showInstallButton();
    });

    window.addEventListener('appinstalled', () => {
        console.log('[PWA] App installed!');
        hideInstallButton();
        deferredPrompt = null;
        showToast('✅ Aplikasi berhasil diinstall!', 'success');
    });

    function showInstallButton() {
        // Wait until topbar is rendered by layout.js
        const tryShow = () => {
            const userArea = document.querySelector('.app-user');
            if (!userArea) {
                setTimeout(tryShow, 200);
                return;
            }
            if (document.getElementById('pwaInstallBtn')) return; // Already added

            const btn = document.createElement('button');
            btn.id = 'pwaInstallBtn';
            btn.className = 'pwa-install-btn';
            btn.innerHTML = '<i class="fas fa-download"></i> <span class="pwa-install-text">Install App</span>';
            btn.title = 'Install aplikasi ke perangkat';
            btn.onclick = installPWA;

            // Insert before app-user-info / avatar
            userArea.insertBefore(btn, userArea.firstChild);
        };
        tryShow();
    }

    function hideInstallButton() {
        document.getElementById('pwaInstallBtn')?.remove();
    }

    async function installPWA() {
        if (!deferredPrompt) {
            // iOS atau browser yang gak support beforeinstallprompt
            showInstallInstructions();
            return;
        }
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        console.log('[PWA] User choice:', outcome);
        if (outcome === 'accepted') {
            hideInstallButton();
        }
        deferredPrompt = null;
    }

    function showInstallInstructions() {
        // Untuk iOS / browser yang gak support install prompt
        const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
        const msg = isIOS
            ? 'Untuk install: tap tombol Share (📤) di Safari, lalu pilih "Add to Home Screen".'
            : 'Untuk install: buka menu browser (⋮), lalu pilih "Install App" atau "Add to Home Screen".';

        const modal = document.createElement('div');
        modal.className = 'pwa-modal-bg';
        modal.innerHTML = `
            <div class="pwa-modal">
                <h3>📲 Install Aplikasi</h3>
                <p>${msg}</p>
                <button class="pwa-btn-primary" onclick="this.closest('.pwa-modal-bg').remove()">Mengerti</button>
            </div>
        `;
        document.body.appendChild(modal);
    }

    // ─── 3. UPDATE BANNER ──────────────────────────────────────
    function showUpdateBanner() {
        if (document.getElementById('pwaUpdateBanner')) return;
        const banner = document.createElement('div');
        banner.id = 'pwaUpdateBanner';
        banner.className = 'pwa-update-banner';
        banner.innerHTML = `
            <span><i class="fas fa-arrow-up"></i> Versi baru tersedia</span>
            <button onclick="window.location.reload()">Refresh</button>
            <button onclick="this.parentElement.remove()">Nanti</button>
        `;
        document.body.appendChild(banner);
    }

    // ─── 4. ONLINE / OFFLINE INDICATOR ─────────────────────────
    function updateOnlineStatus() {
        let badge = document.getElementById('pwaOfflineBadge');
        if (navigator.onLine) {
            badge?.remove();
        } else if (!badge) {
            badge = document.createElement('div');
            badge.id = 'pwaOfflineBadge';
            badge.className = 'pwa-offline-badge';
            badge.innerHTML = '<i class="fas fa-wifi-slash"></i> Anda sedang offline';
            document.body.appendChild(badge);
        }
    }
    window.addEventListener('online', () => {
        updateOnlineStatus();
        showToast('✅ Koneksi internet pulih', 'success');
    });
    window.addEventListener('offline', () => {
        updateOnlineStatus();
        showToast('⚠️ Anda offline. Beberapa fitur terbatas.', 'warning');
    });
    updateOnlineStatus();

    // ─── 5. TOAST helper ────────────────────────────────────────
    function showToast(msg, type = 'info') {
        const toast = document.createElement('div');
        toast.className = `pwa-toast pwa-toast-${type}`;
        toast.textContent = msg;
        document.body.appendChild(toast);
        setTimeout(() => toast.classList.add('show'), 10);
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 300);
        }, 3500);
    }

    // ─── 6. CSS untuk PWA UI elements ─────────────────────────
    const styles = `
        .pwa-install-btn {
            background: rgba(255,255,255,0.15);
            border: 1px solid rgba(255,255,255,0.3);
            color: white;
            padding: 7px 14px;
            border-radius: 8px;
            cursor: pointer;
            font-size: 13px;
            font-weight: 500;
            display: inline-flex;
            align-items: center;
            gap: 6px;
            margin-right: 8px;
            transition: all 0.2s;
        }
        .pwa-install-btn:hover {
            background: rgba(255,255,255,0.25);
            transform: translateY(-1px);
        }
        @media (max-width: 1023px) {
            .pwa-install-btn { padding: 7px 10px; }
            .pwa-install-text { display: none; }
        }

        .pwa-update-banner {
            position: fixed;
            top: 80px;
            right: 20px;
            background: #1A4D8C;
            color: white;
            padding: 12px 16px;
            border-radius: 10px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.2);
            z-index: 99998;
            display: flex;
            align-items: center;
            gap: 10px;
            font-size: 13px;
        }
        .pwa-update-banner button {
            background: white;
            color: #1A4D8C;
            border: none;
            padding: 6px 12px;
            border-radius: 6px;
            cursor: pointer;
            font-weight: 600;
            font-size: 12px;
        }
        .pwa-update-banner button:last-child {
            background: rgba(255,255,255,0.2);
            color: white;
        }

        .pwa-offline-badge {
            position: fixed;
            bottom: 20px;
            left: 50%;
            transform: translateX(-50%);
            background: #dc2626;
            color: white;
            padding: 10px 20px;
            border-radius: 24px;
            box-shadow: 0 4px 14px rgba(220,38,38,0.4);
            z-index: 99998;
            font-size: 13px;
            font-weight: 500;
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .pwa-toast {
            position: fixed;
            bottom: 30px;
            left: 50%;
            transform: translateX(-50%) translateY(100px);
            background: #1e293b;
            color: white;
            padding: 12px 20px;
            border-radius: 10px;
            box-shadow: 0 6px 20px rgba(0,0,0,0.2);
            z-index: 99999;
            font-size: 13px;
            opacity: 0;
            transition: all 0.3s;
        }
        .pwa-toast.show {
            opacity: 1;
            transform: translateX(-50%) translateY(0);
        }
        .pwa-toast-success { background: #15803d; }
        .pwa-toast-warning { background: #ea580c; }

        .pwa-modal-bg {
            position: fixed;
            inset: 0;
            background: rgba(0,0,0,0.5);
            z-index: 100000;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
        }
        .pwa-modal {
            background: white;
            border-radius: 12px;
            padding: 24px;
            max-width: 400px;
            text-align: center;
        }
        .pwa-modal h3 { margin: 0 0 12px; color: #1A4D8C; }
        .pwa-modal p { color: #475569; line-height: 1.6; margin-bottom: 16px; }
        .pwa-btn-primary {
            background: #1A4D8C;
            color: white;
            border: none;
            padding: 10px 24px;
            border-radius: 8px;
            cursor: pointer;
            font-weight: 600;
        }

        /* Hide install button kalau udah di-install (running as PWA) */
        @media (display-mode: standalone) {
            .pwa-install-btn { display: none !important; }
        }
    `;
    const styleEl = document.createElement('style');
    styleEl.textContent = styles;
    document.head.appendChild(styleEl);

    // ─── 7. Track if running as PWA ───────────────────────────
    if (window.matchMedia('(display-mode: standalone)').matches) {
        console.log('[PWA] Running as installed app');
        document.body.classList.add('pwa-installed');
    }
})();

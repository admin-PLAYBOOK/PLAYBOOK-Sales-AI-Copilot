const ThemeManager = {
    STORAGE_KEY: 'pb_theme',

    init() {
        const saved  = localStorage.getItem(this.STORAGE_KEY);
        const system = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
        this.setTheme(saved || system, false);
        this._attachButtons();
    },

    setTheme(theme, persist = true) {
        document.documentElement.setAttribute('data-theme', theme);
        if (persist) localStorage.setItem(this.STORAGE_KEY, theme);

        const icon  = theme === 'dark' ? '☀️' : '🌙';
        const label = `Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`;
        document.querySelectorAll('.js-theme-toggle').forEach(btn => {
            btn.textContent = icon;
            btn.setAttribute('aria-label', label);
        });
    },

    toggle() {
        const current = document.documentElement.getAttribute('data-theme') || 'light';
        this.setTheme(current === 'dark' ? 'light' : 'dark');
    },

    _attachButtons() {
        const isAdmin = !!document.getElementById('adminDash');

        if (!isAdmin) {
            // Client page: inject floating button if not already present
            if (!document.querySelector('.js-theme-toggle')) {
                const btn = document.createElement('button');
                btn.className = 'theme-toggle js-theme-toggle';
                btn.setAttribute('aria-label', 'Toggle theme');
                document.body.appendChild(btn);
            }
        }

        // Wire all .js-theme-toggle buttons (floating or inline)
        document.querySelectorAll('.js-theme-toggle').forEach(btn => {
            btn.addEventListener('click', () => this.toggle());
        });

        // Sync icons now that buttons exist
        const current = document.documentElement.getAttribute('data-theme') || 'light';
        this.setTheme(current, false);
    }
};

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => ThemeManager.init());
} else {
    ThemeManager.init();
}
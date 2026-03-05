// Donor activation & premium features system

const DonorManager = {
  THEMES: {
    midnight: {
      id: 'midnight',
      name: 'Midnight',
      free: true,
      colors: {
        '--bg-primary': '#0f1117',
        '--bg-secondary': '#161822',
        '--bg-tertiary': '#1c1f2e',
        '--bg-hover': '#252839',
        '--bg-card': '#181b28',
        '--bg-glass': 'rgba(30, 34, 52, 0.85)',
        '--text-primary': '#eaedf3',
        '--text-secondary': '#9ca3b8',
        '--text-muted': '#5c6378',
        '--accent': '#10b981',
        '--accent-hover': '#34d399',
        '--accent-light': 'rgba(16, 185, 129, 0.12)',
        '--accent-glow': 'rgba(16, 185, 129, 0.25)',
        '--accent-2': '#06b6d4',
        '--accent-2-light': 'rgba(6, 182, 212, 0.12)',
        '--border': 'rgba(255, 255, 255, 0.06)',
        '--border-light': 'rgba(255, 255, 255, 0.1)',
        '--danger': '#ef4444',
        '--danger-hover': '#dc2626',
        '--shadow': '0 2px 12px rgba(0, 0, 0, 0.25)',
        '--shadow-lg': '0 12px 40px rgba(0, 0, 0, 0.4)',
        '--shadow-glow': '0 0 20px rgba(16, 185, 129, 0.15)',
        '--body-gradient-1': 'rgba(16, 185, 129, 0.03)',
        '--body-gradient-2': 'rgba(6, 182, 212, 0.03)',
      }
    },
    aurora: {
      id: 'aurora',
      name: 'Aurora',
      free: false,
      colors: {
        '--bg-primary': '#0a0e1a',
        '--bg-secondary': '#0f1525',
        '--bg-tertiary': '#152030',
        '--bg-hover': '#1a2840',
        '--bg-card': '#111a2a',
        '--bg-glass': 'rgba(15, 21, 37, 0.88)',
        '--text-primary': '#e8ecf4',
        '--text-secondary': '#8b9dc3',
        '--text-muted': '#4a5f80',
        '--accent': '#7c3aed',
        '--accent-hover': '#a78bfa',
        '--accent-light': 'rgba(124, 58, 237, 0.12)',
        '--accent-glow': 'rgba(124, 58, 237, 0.25)',
        '--accent-2': '#ec4899',
        '--accent-2-light': 'rgba(236, 72, 153, 0.12)',
        '--border': 'rgba(124, 58, 237, 0.08)',
        '--border-light': 'rgba(124, 58, 237, 0.15)',
        '--danger': '#ef4444',
        '--danger-hover': '#dc2626',
        '--shadow': '0 2px 12px rgba(0, 0, 0, 0.3)',
        '--shadow-lg': '0 12px 40px rgba(0, 0, 0, 0.5)',
        '--shadow-glow': '0 0 20px rgba(124, 58, 237, 0.2)',
        '--body-gradient-1': 'rgba(124, 58, 237, 0.04)',
        '--body-gradient-2': 'rgba(236, 72, 153, 0.03)',
      }
    },
    sunset: {
      id: 'sunset',
      name: 'Sunset',
      free: false,
      colors: {
        '--bg-primary': '#140c08',
        '--bg-secondary': '#1c1210',
        '--bg-tertiary': '#261a16',
        '--bg-hover': '#33221c',
        '--bg-card': '#1e1412',
        '--bg-glass': 'rgba(28, 18, 16, 0.88)',
        '--text-primary': '#f5ebe6',
        '--text-secondary': '#c4a594',
        '--text-muted': '#7a5e50',
        '--accent': '#f97316',
        '--accent-hover': '#fb923c',
        '--accent-light': 'rgba(249, 115, 22, 0.12)',
        '--accent-glow': 'rgba(249, 115, 22, 0.25)',
        '--accent-2': '#ef4444',
        '--accent-2-light': 'rgba(239, 68, 68, 0.12)',
        '--border': 'rgba(249, 115, 22, 0.08)',
        '--border-light': 'rgba(249, 115, 22, 0.15)',
        '--danger': '#ef4444',
        '--danger-hover': '#dc2626',
        '--shadow': '0 2px 12px rgba(0, 0, 0, 0.35)',
        '--shadow-lg': '0 12px 40px rgba(0, 0, 0, 0.5)',
        '--shadow-glow': '0 0 20px rgba(249, 115, 22, 0.15)',
        '--body-gradient-1': 'rgba(249, 115, 22, 0.04)',
        '--body-gradient-2': 'rgba(239, 68, 68, 0.03)',
      }
    },
    ocean: {
      id: 'ocean',
      name: 'Ocean',
      free: false,
      colors: {
        '--bg-primary': '#080e14',
        '--bg-secondary': '#0c1520',
        '--bg-tertiary': '#121e2c',
        '--bg-hover': '#1a2a3c',
        '--bg-card': '#0e1824',
        '--bg-glass': 'rgba(12, 21, 32, 0.88)',
        '--text-primary': '#e4eef8',
        '--text-secondary': '#7da8cc',
        '--text-muted': '#3d6080',
        '--accent': '#0ea5e9',
        '--accent-hover': '#38bdf8',
        '--accent-light': 'rgba(14, 165, 233, 0.12)',
        '--accent-glow': 'rgba(14, 165, 233, 0.25)',
        '--accent-2': '#06b6d4',
        '--accent-2-light': 'rgba(6, 182, 212, 0.12)',
        '--border': 'rgba(14, 165, 233, 0.08)',
        '--border-light': 'rgba(14, 165, 233, 0.15)',
        '--danger': '#ef4444',
        '--danger-hover': '#dc2626',
        '--shadow': '0 2px 12px rgba(0, 0, 0, 0.3)',
        '--shadow-lg': '0 12px 40px rgba(0, 0, 0, 0.5)',
        '--shadow-glow': '0 0 20px rgba(14, 165, 233, 0.2)',
        '--body-gradient-1': 'rgba(14, 165, 233, 0.04)',
        '--body-gradient-2': 'rgba(6, 182, 212, 0.03)',
      }
    },
    sakura: {
      id: 'sakura',
      name: 'Sakura',
      free: false,
      colors: {
        '--bg-primary': '#12080f',
        '--bg-secondary': '#1a1018',
        '--bg-tertiary': '#241822',
        '--bg-hover': '#30202c',
        '--bg-card': '#1c1219',
        '--bg-glass': 'rgba(26, 16, 24, 0.88)',
        '--text-primary': '#f5e8f0',
        '--text-secondary': '#c094b0',
        '--text-muted': '#7a4e68',
        '--accent': '#ec4899',
        '--accent-hover': '#f472b6',
        '--accent-light': 'rgba(236, 72, 153, 0.12)',
        '--accent-glow': 'rgba(236, 72, 153, 0.25)',
        '--accent-2': '#a855f7',
        '--accent-2-light': 'rgba(168, 85, 247, 0.12)',
        '--border': 'rgba(236, 72, 153, 0.08)',
        '--border-light': 'rgba(236, 72, 153, 0.15)',
        '--danger': '#ef4444',
        '--danger-hover': '#dc2626',
        '--shadow': '0 2px 12px rgba(0, 0, 0, 0.3)',
        '--shadow-lg': '0 12px 40px rgba(0, 0, 0, 0.5)',
        '--shadow-glow': '0 0 20px rgba(236, 72, 153, 0.2)',
        '--body-gradient-1': 'rgba(236, 72, 153, 0.04)',
        '--body-gradient-2': 'rgba(168, 85, 247, 0.03)',
      }
    }
  },

  // Wall of Fame - updated with each release
  WALL_OF_FAME: [
    // { name: 'Early Supporter', date: '2026-03', message: 'Love this extension!' },
  ],

  async init() {
    await this.loadDonorState();
    await this.loadTheme();
  },

  async loadDonorState() {
    const { donorState } = await chrome.storage.local.get('donorState');
    this._state = donorState || { activated: false, name: '', code: '', activatedAt: null };
  },

  async saveDonorState() {
    await chrome.storage.local.set({ donorState: this._state });
  },

  isActivated() {
    return this._state && this._state.activated;
  },

  getDonorName() {
    return this._state?.name || '';
  },

  // Simple activation: developer gives donor a code after confirming TX
  // Code format: DOOBY-<name_hash>-<timestamp_hash>
  async activate(code, name) {
    // Basic format validation
    if (!code || !code.startsWith('DOOBY-') || code.split('-').length < 3) {
      return { success: false, error: 'Invalid activation code format' };
    }

    this._state = {
      activated: true,
      name: name || 'Anonymous Supporter',
      code: code,
      activatedAt: Date.now()
    };
    await this.saveDonorState();
    return { success: true };
  },

  async deactivate() {
    this._state = { activated: false, name: '', code: '', activatedAt: null };
    await this.saveDonorState();
  },

  // Theme management
  async loadTheme() {
    const { activeTheme } = await chrome.storage.local.get('activeTheme');
    const themeId = activeTheme || 'midnight';
    this.applyTheme(themeId);
    return themeId;
  },

  async setTheme(themeId) {
    const theme = this.THEMES[themeId];
    if (!theme) return false;
    if (!theme.free && !this.isActivated()) return false;

    await chrome.storage.local.set({ activeTheme: themeId });
    this.applyTheme(themeId);
    return true;
  },

  applyTheme(themeId) {
    const theme = this.THEMES[themeId];
    if (!theme) return;

    const root = document.documentElement;
    for (const [prop, value] of Object.entries(theme.colors)) {
      root.style.setProperty(prop, value);
    }

    // Update body gradient
    const g1 = theme.colors['--body-gradient-1'] || 'rgba(16, 185, 129, 0.03)';
    const g2 = theme.colors['--body-gradient-2'] || 'rgba(6, 182, 212, 0.03)';
    document.body.style.background = `
      radial-gradient(ellipse at 20% 50%, ${g1} 0%, transparent 50%),
      radial-gradient(ellipse at 80% 20%, ${g2} 0%, transparent 50%),
      ${theme.colors['--bg-primary']}
    `;

    this._currentTheme = themeId;
  },

  getCurrentTheme() {
    return this._currentTheme || 'midnight';
  },

  getThemeList() {
    return Object.values(this.THEMES).map(t => ({
      id: t.id,
      name: t.name,
      free: t.free,
      locked: !t.free && !this.isActivated(),
      active: t.id === this._currentTheme,
      accent: t.colors['--accent']
    }));
  }
};

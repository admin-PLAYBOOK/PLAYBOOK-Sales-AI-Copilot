// ─────────────────────────────────────────────
// PLAYBOOK Admin — admin.js (rebuilt)
// ─────────────────────────────────────────────

let currentConvId    = null;
let allConversations = [];
let activeFilters    = { intent: 'all', emailOnly: false, search: '' };
let refreshTimer     = null;
let isLoading        = false;

// ─────────────────────────────────────────────
// THEME
// ─────────────────────────────────────────────

function initTheme() {
    const saved  = localStorage.getItem('pb_theme');
    const system = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    applyTheme(saved || system);

    document.getElementById('themeToggle').addEventListener('click', () => {
        const current = document.documentElement.getAttribute('data-theme');
        applyTheme(current === 'dark' ? 'light' : 'dark');
    });
}

function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('pb_theme', theme);
    const btn = document.getElementById('themeToggle');
    if (btn) btn.textContent = theme === 'dark' ? '☀️' : '🌙';
}

// ─────────────────────────────────────────────
// LOGIN
// ─────────────────────────────────────────────

async function login() {
    const pw  = document.getElementById('passwordInput').value.trim();
    const err = document.getElementById('loginError');
    const btn = document.getElementById('loginBtn');
    if (!pw) return;

    btn.disabled = true;
    btn.textContent = '…';
    err.style.display = 'none';

    try {
        const res = await fetch('/api/admin/login', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ password: pw }),
        });

        if (res.ok) {
            document.getElementById('loginGate').style.display = 'none';
            document.getElementById('adminDash').style.display = 'flex';
            boot();
        } else {
            err.style.display = 'block';
            document.getElementById('passwordInput').value = '';
            document.getElementById('passwordInput').focus();
        }
    } catch (_) {
        err.textContent   = 'Connection error — try again.';
        err.style.display = 'block';
    } finally {
        btn.disabled = false;
        btn.textContent = '→';
    }
}

// ─────────────────────────────────────────────
// BOOT (post-login)
// ─────────────────────────────────────────────

async function boot() {
    await loadStats();
    await loadConversations();
    refreshTimer = setInterval(async () => {
        await loadStats();
        await loadConversations();
        if (currentConvId) openConversation(currentConvId);
    }, 10_000);
}

// ─────────────────────────────────────────────
// STATS
// ─────────────────────────────────────────────

async function loadStats() {
    try {
        const res = await fetch('/api/admin/stats');
        if (res.status === 401) { handleExpiry(); return; }
        if (!res.ok) return;
        const d = await res.json();
        document.getElementById('statTotal').textContent  = d.total           ?? '—';
        document.getElementById('statHigh').textContent   = d.high_intent     ?? '—';
        document.getElementById('statMedium').textContent = d.medium_intent   ?? '—';
        document.getElementById('statLow').textContent    = d.low_intent      ?? '—';
        document.getElementById('statEmails').textContent = d.emails_captured ?? '—';
    } catch (_) {}
}

// ─────────────────────────────────────────────
// CONVERSATIONS LIST
// ─────────────────────────────────────────────

async function loadConversations() {
    if (isLoading) return;
    isLoading = true;

    const btn = document.getElementById('refreshBtn');
    btn?.classList.add('spinning');

    try {
        const res = await fetch('/api/admin/conversations?limit=200');
        if (res.status === 401) { handleExpiry(); return; }
        if (!res.ok) { renderFeedError(`Failed to load (${res.status})`); return; }

        const data      = await res.json();
        allConversations = data.conversations || [];
        const total     = data.total ?? allConversations.length;
        document.getElementById('countText').textContent =
            `${total} conversation${total !== 1 ? 's' : ''}`;
        applyFilters();
    } catch (_) {
        renderFeedError('Network error');
    } finally {
        isLoading = false;
        btn?.classList.remove('spinning');
    }
}

function applyFilters() {
    let list = allConversations;

    if (activeFilters.intent !== 'all') {
        list = list.filter(c => (c.lead_data?.intent_level || 'Low') === activeFilters.intent);
    }
    if (activeFilters.emailOnly) {
        list = list.filter(c => c.lead_data?.email);
    }
    if (activeFilters.search) {
        const q = activeFilters.search;
        list = list.filter(c =>
            (c.lead_data?.name              || '').toLowerCase().includes(q) ||
            (c.lead_data?.email             || '').toLowerCase().includes(q) ||
            (c.lead_data?.main_interest     || '').toLowerCase().includes(q) ||
            (c.lead_data?.conversation_vibe || '').toLowerCase().includes(q)
        );
    }

    renderFeed(list);
}

function renderFeedError(msg) {
    document.getElementById('conversationFeed').innerHTML =
        `<div class="feed-empty">⚠️ ${esc(msg)}</div>`;
}

function renderFeed(list) {
    const feed      = document.getElementById('conversationFeed');
    const prevScroll = feed.scrollTop;
    feed.innerHTML  = '';

    if (!list.length) {
        feed.innerHTML = '<div class="feed-empty">No conversations match.</div>';
        return;
    }

    list.forEach(conv => {
        const name   = conv.lead_data?.name  || 'Anonymous';
        const intent = conv.lead_data?.intent_level || 'Low';
        const vibe   = conv.lead_data?.conversation_vibe || '';
        const time   = relativeTime(conv.timestamp);
        const channel = conv.lead_data?.channel || 'Web';

        const item = document.createElement('div');
        item.className = 'feed-item' + (conv.id === currentConvId ? ' feed-item--active' : '');
        item.dataset.id = conv.id;
        item.setAttribute('role', 'listitem');

        item.innerHTML = `
            <div class="feed-item-top">
                <div class="feed-name">${esc(name)}</div>
                <div class="feed-time">${channel === 'WhatsApp' ? '📱 ' : '🌐 '}${time}</div>
            </div>
            <div class="feed-item-bottom">
                <div class="feed-vibe">${vibeEmoji(vibe)} ${esc(vibe)}</div>
                <div class="feed-intent feed-intent--${intent.toLowerCase()}">${intent}</div>
            </div>`;

        item.addEventListener('click', () => openConversation(conv.id));
        feed.appendChild(item);
    });

    feed.scrollTop = prevScroll;
}

// ─────────────────────────────────────────────
// CONVERSATION DETAIL
// ─────────────────────────────────────────────

async function openConversation(id) {
    currentConvId = id;

    // Highlight active item
    document.querySelectorAll('.feed-item').forEach(el => {
        el.classList.toggle('feed-item--active', el.dataset.id === id);
    });

    try {
        const res = await fetch(`/api/admin/conversations/${id}`);
        if (res.status === 401) { handleExpiry(); return; }
        if (!res.ok) return;
        const { conversation } = await res.json();

        renderDetail(conversation);

        document.getElementById('emptyState').style.display = 'none';
        document.getElementById('convDetail').style.display = 'flex';
        document.getElementById('convDetail').style.flexDirection = 'column';
    } catch (_) {}
}

function renderDetail(conv) {
    const lead    = conv.lead_data    || {};
    const sales   = conv.sales_output || {};
    const hubspot = conv.hubspot      || {};
    const history = conv.history      || [];

    // ── Header ──
    document.getElementById('detailName').textContent = lead.name || 'Anonymous';
    document.getElementById('detailMeta').textContent = [
        lead.email,
        conv.timestamp ? fullDate(conv.timestamp) : null,
    ].filter(Boolean).join('  ·  ');

    const channel = lead.channel || 'Web';
    const chEl    = document.getElementById('detailChannel');
    chEl.textContent = channel === 'WhatsApp' ? '📱 WhatsApp' : '🌐 Web';

    const vibe  = lead.conversation_vibe || '';
    const vibeEl = document.getElementById('detailVibe');
    vibeEl.textContent = vibe ? `${vibeEmoji(vibe)} ${vibe}` : '';
    vibeEl.style.display = vibe ? '' : 'none';

    const intent    = lead.intent_level || 'Low';
    const intentEl  = document.getElementById('detailIntent');
    intentEl.textContent  = intent;
    intentEl.className    = `badge badge--intent-${intent.toLowerCase()}`;

    const slackEl = document.getElementById('slackBadge');
    slackEl.style.display = (lead.slack_alert_sent || conv.slack_alert_sent) ? '' : 'none';

    // Delete
    document.getElementById('deleteBtn').onclick = () => openDeleteModal(conv.id);

    // ── Lead data ──
    const fields = [
        { label: 'Name',      value: lead.name          },
        { label: 'Email',     value: lead.email         },
        { label: 'Lead Type', value: lead.lead_type     },
        { label: 'Interest',  value: lead.main_interest },
        { label: 'Blocker',   value: lead.blocker && lead.blocker !== 'none identified' ? lead.blocker : null },
        { label: 'Pillar',    value: lead.pillar_interest },
    ].filter(f => f.value);

    document.getElementById('leadGrid').innerHTML = fields.map(f => `
        <div class="lead-field">
            <div class="lead-label">${esc(f.label)}</div>
            <div class="lead-value">${esc(String(f.value))}</div>
        </div>`).join('') || '<div class="lead-field"><div class="lead-value" style="color:var(--text-3)">No data extracted yet.</div></div>';

    // ── Vibe ──
    document.getElementById('vibeCard').innerHTML = `
        <div class="vibe-big">${vibeEmoji(vibe)}</div>
        <div class="vibe-name">${esc(vibe || '—')}</div>
        <div class="vibe-note">${esc(lead.vibe_note || lead.intent_signals || '—')}</div>`;

    // ── Sales ──
    document.getElementById('nextAction').textContent = sales.recommended_next_action || '—';
    document.getElementById('followUp').textContent   = sales.follow_up_message       || '—';

    // ── HubSpot ──
    const hsEl = document.getElementById('hubspotStatus');
    if (hubspot.success) {
        hsEl.innerHTML = `<div class="hs-status hs-status--ok">✅ ${esc(hubspot.message || 'Synced')}${hubspot.contactId ? ` · ID ${hubspot.contactId}` : ''}</div>`;
    } else {
        hsEl.innerHTML = `<div class="hs-status hs-status--no">⏳ ${esc(hubspot.message || 'Not synced yet')}</div>`;
    }
    document.getElementById('convTimestamp').textContent = conv.timestamp ? `Saved: ${fullDate(conv.timestamp)}` : '';
    document.getElementById('convModel').textContent     = conv.model_used ? `Model: ${conv.model_used}` : '';

    // ── Running summary ──
    const summary     = lead.running_summary || conv.running_summary || '';
    const summaryCard = document.getElementById('summaryCard');
    const summaryBody = document.getElementById('summaryBody');
    if (summary) {
        summaryCard.style.display = '';
        summaryBody.textContent   = summary;
    } else {
        summaryCard.style.display = 'none';
    }

    // ── Transcript ──
    const tEl = document.getElementById('transcript');
    if (!history.length) {
        tEl.innerHTML = '<div class="t-empty">No transcript available.</div>';
    } else {
        tEl.innerHTML = history.map(m => {
            const isAI = m.role === 'assistant';
            return `<div class="t-msg t-msg--${isAI ? 'ai' : 'user'}">
                        <div class="t-sender">${isAI ? 'Layla' : 'User'}</div>
                        <div class="t-bubble">${esc(m.content)}</div>
                    </div>`;
        }).join('');
        tEl.scrollTop = 0;
    }
}

// ─────────────────────────────────────────────
// DELETE
// ─────────────────────────────────────────────

function openDeleteModal(id) {
    const modal = document.getElementById('deleteModal');
    modal.style.display = 'flex';

    document.getElementById('modalConfirm').onclick = async () => {
        modal.style.display = 'none';
        await deleteConversation(id);
    };
    document.getElementById('modalCancel').onclick = () => {
        modal.style.display = 'none';
    };
}

async function deleteConversation(id) {
    try {
        const res = await fetch(`/api/admin/conversations/${id}`, { method: 'DELETE' });
        if (!res.ok) return;

        allConversations = allConversations.filter(c => c.id !== id);
        applyFilters();

        if (currentConvId === id) {
            currentConvId = null;
            document.getElementById('convDetail').style.display = 'none';
            document.getElementById('emptyState').style.display = 'flex';
        }

        await loadStats();
    } catch (_) {}
}

// ─────────────────────────────────────────────
// COLLAPSIBLES
// ─────────────────────────────────────────────

function initCollapsibles() {
    [
        ['salesToggle',   'salesBody'],
        ['hubspotToggle', 'hubspotBody'],
        ['summaryToggle', 'summaryBody'],
    ].forEach(([toggleId, bodyId]) => {
        const toggle = document.getElementById(toggleId);
        const body   = document.getElementById(bodyId);
        if (!toggle || !body) return;

        toggle.addEventListener('click', () => {
            const open = toggle.getAttribute('aria-expanded') === 'true';
            toggle.setAttribute('aria-expanded', String(!open));
            body.style.display = open ? 'none' : '';
        });
    });
}

// ─────────────────────────────────────────────
// SESSION EXPIRY / LOGOUT
// ─────────────────────────────────────────────

function handleExpiry() {
    clearInterval(refreshTimer);
    document.getElementById('conversationFeed').innerHTML =
        '<div class="feed-empty">Session expired — reloading…</div>';
    setTimeout(() => location.reload(), 2000);
}

async function logout() {
    clearInterval(refreshTimer);
    try { await fetch('/api/admin/logout', { method: 'POST' }); } catch (_) {}
    location.reload();
}

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

function esc(text) {
    const d = document.createElement('div');
    d.textContent = String(text ?? '');
    return d.innerHTML;
}

function vibeEmoji(vibe) {
    return {
        serious: '🎯', excited: '🔥', curious: '🤔', skeptical: '🧐',
        funny: '😄', annoyed: '😤', trolling: '🧌', distracted: '💭',
        overwhelmed: '😰', cold: '🧊',
    }[vibe] || '💬';
}

function relativeTime(ts) {
    if (!ts) return '';
    const mins = Math.floor((Date.now() - new Date(ts)) / 60000);
    if (mins < 1)    return 'just now';
    if (mins < 60)   return `${mins}m ago`;
    if (mins < 1440) return `${Math.floor(mins / 60)}h ago`;
    return new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function fullDate(ts) {
    if (!ts) return '';
    return new Date(ts).toLocaleString([], {
        month: 'short', day: 'numeric', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
    });
}

// ─────────────────────────────────────────────
// BOOT
// ─────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    initCollapsibles();

    // Login
    document.getElementById('loginBtn').addEventListener('click', login);
    document.getElementById('passwordInput').addEventListener('keydown', e => {
        if (e.key === 'Enter') login();
    });

    // Logout + refresh
    document.getElementById('logoutBtn').addEventListener('click', logout);
    document.getElementById('refreshBtn').addEventListener('click', async () => {
        await loadStats();
        await loadConversations();
        if (currentConvId) openConversation(currentConvId);
    });

    // Intent filter pills
    document.querySelectorAll('.pill[data-intent]').forEach(btn => {
        btn.addEventListener('click', () => {
            activeFilters.intent = btn.dataset.intent;
            document.querySelectorAll('.pill[data-intent]').forEach(b =>
                b.classList.toggle('pill--active', b === btn)
            );
            applyFilters();
        });
    });

    // Email filter
    document.getElementById('filterEmail').addEventListener('change', e => {
        activeFilters.emailOnly = e.target.checked;
        applyFilters();
    });

    // Search
    document.getElementById('searchInput').addEventListener('input', e => {
        activeFilters.search = e.target.value.toLowerCase().trim();
        applyFilters();
    });

    // Modal: close on backdrop click or Escape
    document.getElementById('deleteModal').addEventListener('click', e => {
        if (e.target === document.getElementById('deleteModal'))
            document.getElementById('deleteModal').style.display = 'none';
    });
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape')
            document.getElementById('deleteModal').style.display = 'none';
    });
});
// ─────────────────────────────────────────────
// ADMIN DASHBOARD — admin.js
// ─────────────────────────────────────────────

let currentConvId    = null;
let allConversations = [];
let activeFilters    = { intent: 'all', emailOnly: false };

// ─────────────────────────────────────────────
// LOGIN
// ─────────────────────────────────────────────

async function adminLogin() {
    const password = document.getElementById('passwordInput').value.trim();
    const errorEl  = document.getElementById('loginError');
    const loginBtn = document.getElementById('loginBtn');

    if (!password) return;

    loginBtn.disabled    = true;
    loginBtn.textContent = 'Signing in…';
    errorEl.style.display = 'none';

    try {
        const res = await fetch('/api/admin/login', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ password }),
        });

        if (res.ok) {
            document.getElementById('loginGate').style.display = 'none';
            document.getElementById('adminDash').style.display = 'flex';
            await loadStats();
            await loadConversations();
        } else {
            errorEl.style.display = 'block';
            document.getElementById('passwordInput').value = '';
            document.getElementById('passwordInput').focus();
        }
    } catch (err) {
        errorEl.textContent   = 'Connection error — try again';
        errorEl.style.display = 'block';
    } finally {
        loginBtn.disabled    = false;
        loginBtn.textContent = 'Sign in →';
    }
}

// ─────────────────────────────────────────────
// STATS
// ─────────────────────────────────────────────

async function loadStats() {
    try {
        const res  = await fetch('/api/admin/stats');
        if (!res.ok) return;
        const data = await res.json();

        document.getElementById('statTotal').textContent  = data.total           ?? '—';
        document.getElementById('statHigh').textContent   = data.high_intent     ?? '—';
        document.getElementById('statMedium').textContent = data.medium_intent   ?? '—';
        document.getElementById('statLow').textContent    = data.low_intent      ?? '—';
        document.getElementById('statEmails').textContent = data.emails_captured ?? '—';
    } catch (_) {}
}

// ─────────────────────────────────────────────
// FILTERS
// ─────────────────────────────────────────────

function applyFilters() {
    let filtered = allConversations;

    if (activeFilters.intent !== 'all') {
        filtered = filtered.filter(c =>
            (c.lead_data?.intent_level || 'Low') === activeFilters.intent
        );
    }

    if (activeFilters.emailOnly) {
        filtered = filtered.filter(c => c.lead_data?.email);
    }

    renderFeed(filtered);
    document.getElementById('countText').textContent =
        `${filtered.length} conversation${filtered.length !== 1 ? 's' : ''}`;
}

function setIntentFilter(value) {
    activeFilters.intent = value;
    document.querySelectorAll('.filter-pill[data-intent]').forEach(btn => {
        btn.classList.toggle('filter-pill-active', btn.dataset.intent === value);
    });
    applyFilters();
}

function toggleEmailFilter() {
    activeFilters.emailOnly = document.getElementById('filterEmail').checked;
    applyFilters();
}

// ─────────────────────────────────────────────
// CONVERSATION FEED
// ─────────────────────────────────────────────

async function loadConversations() {
    try {
        const res  = await fetch('/api/admin/conversations?limit=200');
        if (!res.ok) return;
        const data = await res.json();

        allConversations = data.conversations || [];
        applyFilters();
    } catch (_) {}
}

function renderFeed(conversations) {
    const feed = document.getElementById('conversationFeed');
    feed.innerHTML = '';

    if (!conversations.length) {
        feed.innerHTML = '<div class="feed-empty">No conversations match</div>';
        return;
    }

    conversations.forEach(conv => {
        const name      = conv.lead_data?.name  || 'Anonymous';
        const intent    = conv.lead_data?.intent_level || 'Low';
        const vibe      = conv.lead_data?.conversation_vibe || '';
        const vibeEmoji = getVibeEmoji(vibe);
        const time      = formatTime(conv.timestamp);
        const channel   = conv.lead_data?.channel || 'Web';
        const channelTag = channel === 'WhatsApp'
            ? `<span class="feed-channel feed-channel-whatsapp">📱</span>`
            : `<span class="feed-channel feed-channel-web">🌐</span>`;

        const item      = document.createElement('div');
        item.className  = 'feed-item' + (conv.id === currentConvId ? ' feed-item-active' : '');
        item.setAttribute('role', 'listitem');
        item.dataset.id = conv.id;

        item.innerHTML = `
            <div class="feed-item-top">
                <div class="feed-name">${escapeHtml(name)}</div>
                <div class="feed-time">${channelTag}${time}</div>
            </div>
            <div class="feed-item-bottom">
                <div class="feed-vibe">${vibeEmoji} ${escapeHtml(vibe)}</div>
                <div class="feed-intent intent-${intent.toLowerCase()}">${intent}</div>
            </div>`;

        item.addEventListener('click', () => openConversation(conv.id));
        feed.appendChild(item);
    });
}

// ─────────────────────────────────────────────
// CONVERSATION DETAIL
// ─────────────────────────────────────────────

async function openConversation(id) {
    currentConvId = id;

    document.querySelectorAll('.feed-item').forEach(el => {
        el.classList.toggle('feed-item-active', el.dataset.id === id);
    });

    try {
        const res  = await fetch(`/api/admin/conversations/${id}`);
        if (!res.ok) return;
        const { conversation: conv } = await res.json();

        renderDetail(conv);

        document.getElementById('emptyState').style.display = 'none';
        document.getElementById('convDetail').style.display = 'block';
    } catch (_) {}
}

function renderDetail(conv) {
    const lead    = conv.lead_data    || {};
    const sales   = conv.sales_output || {};
    const hubspot = conv.hubspot      || {};
    const history = conv.history      || [];

    // Header
    const dialectMap = {
        gulf:      { flag: '🇸🇦', label: 'Gulf',      cls: 'dialect-badge-gulf'     },
        levantine: { flag: '🇱🇧', label: 'Levantine', cls: 'dialect-badge-levant'   },
        egyptian:  { flag: '🇪🇬', label: 'Egyptian',  cls: 'dialect-badge-egypt'    },
        moroccan:  { flag: '🇲🇦', label: 'Moroccan',  cls: 'dialect-badge-moroccan' },
        msa:       { flag: '📖',  label: 'MSA',       cls: 'dialect-badge-msa'      },
        unknown:   { flag: '🌍',  label: 'Unknown',   cls: 'dialect-badge-unknown'  },
    };
    const countryFlagMap = {
        'bahrain':      '🇧🇭', 'saudi arabia': '🇸🇦', 'kuwait':   '🇰🇼',
        'uae':          '🇦🇪', 'oman':         '🇴🇲', 'qatar':    '🇶🇦',
        'jordan':       '🇯🇴', 'lebanon':      '🇱🇧', 'syria':    '🇸🇾',
        'palestine':    '🇵🇸', 'egypt':        '🇪🇬', 'morocco':  '🇲🇦',
        'iraq':         '🇮🇶', 'libya':        '🇱🇾', 'tunisia':  '🇹🇳',
    };
    const dialectKey   = (lead.dialect || '').toLowerCase();
    const dialectInfo  = dialectMap[dialectKey] || null;
    const country      = lead.dialect_country || '';
    const countryFlag  = countryFlagMap[country.toLowerCase()] || '';
    const countryLabel = (country && country !== 'Unknown') ? ` · ${countryFlag} ${country}` : '';
    const dialectLabel = dialectInfo
        ? ` <span class="dialect-badge ${dialectInfo.cls}">${dialectInfo.flag} ${dialectInfo.label}${escapeHtml(countryLabel)}</span>`
        : '';
    document.getElementById('detailName').innerHTML = escapeHtml(lead.name || 'Anonymous') + dialectLabel;
    document.getElementById('detailMeta').textContent = lead.email
        ? `${lead.email} · ${formatFull(conv.timestamp)}`
        : formatFull(conv.timestamp);

    // Vibe badge
    const vibe = lead.conversation_vibe || '';
    document.getElementById('detailVibeBadge').textContent = `${getVibeEmoji(vibe)} ${vibe}`;

    // Channel badge
    const channel    = lead.channel || conv.channel || 'Web';
    const channelEl  = document.getElementById('detailChannel');
    channelEl.className   = `channel-badge channel-${channel.toLowerCase()}`;
    channelEl.textContent = channel === 'WhatsApp' ? '📱 WhatsApp' : '🌐 Web';

    // Priority badge
    const pri   = (sales.priority || 'Low').toLowerCase();
    const priEl = document.getElementById('detailPriority');
    priEl.className   = `priority-badge priority-${pri}`;
    priEl.textContent = sales.priority || 'Low';

    // Lead data grid
    const fields = [
        { label: 'Name',      value: lead.name          || '—' },
        { label: 'Email',     value: lead.email         || '—' },
        { label: 'Lead Type', value: lead.lead_type     || '—' },
        { label: 'Interest',  value: lead.main_interest || '—' },
    ];
    document.getElementById('leadGrid').innerHTML = fields.map(f => `
        <div class="lead-field">
            <div class="lead-label">${f.label}</div>
            <div class="lead-value">${escapeHtml(String(f.value))}</div>
        </div>`).join('');

    // Intent row — intent level + pillar_interest pill
    const intentLevel = lead.intent_level || 'Low';
    const intentColor = intentLevel === 'High' ? 'error' : intentLevel === 'Medium' ? 'warning' : 'success';
    const pillar      = (lead.pillar_interest || '').toLowerCase();
    const pillarHtml  = pillar
        ? `<span class="pillar-pill pillar-${pillar}">${escapeHtml(lead.pillar_interest)}</span>`
        : '';
    document.getElementById('intentRow').innerHTML =
        `<span class="status-badge status-${intentColor}">${intentLevel} Intent</span>${pillarHtml}`;
    document.getElementById('intentSignals').textContent = lead.intent_signals || '';

    // Vibe detail
    document.getElementById('vibeDetail').innerHTML = `
        <div class="vibe-badge-large">${getVibeEmoji(vibe)} ${escapeHtml(vibe)}</div>
        <div class="vibe-note">${escapeHtml(lead.vibe_note || '—')}</div>`;

    // Sales recs
    document.getElementById('nextAction').textContent = sales.recommended_next_action || '—';
    document.getElementById('followUp').textContent   = sales.follow_up_message       || '—';

    // HubSpot
    const hs = document.getElementById('hubspotStatus');
    if (hubspot.success) {
        hs.innerHTML = `
            <span class="status-badge status-success">✅ ${escapeHtml(hubspot.message || 'Synced')}</span>
            ${hubspot.contactId ? `<div class="lead-label" style="margin-top:8px">Contact ID: ${hubspot.contactId}</div>` : ''}`;
    } else {
        hs.innerHTML = `<span class="status-badge status-warning">⏳ ${escapeHtml(hubspot.message || 'Not synced')}</span>`;
    }

    // Timestamp + model
    document.getElementById('convTimestamp').textContent = `Conversation: ${formatFull(conv.timestamp)}`;
    document.getElementById('convModel').textContent     = conv.model_used ? `Model: ${conv.model_used}` : '';

    // Running summary
    const summaryEl  = document.getElementById('runningSummaryText');
    const summaryWrap = document.getElementById('runningSummaryWrap');
    const summary = lead.running_summary || conv.running_summary || '';
    if (summary) {
        summaryEl.textContent   = summary;
        summaryWrap.style.display = 'block';
    } else {
        summaryWrap.style.display = 'none';
    }

    // Slack alert tick
    const slackEl = document.getElementById('slackAlertIndicator');
    const slackSent = lead.slack_alert_sent || conv.slack_alert_sent || false;
    slackEl.style.display = slackSent ? 'inline-flex' : 'none';

    // Transcript
    const transcriptEl = document.getElementById('transcript');
    if (!history.length) {
        transcriptEl.innerHTML = '<div class="transcript-empty">No transcript available</div>';
    } else {
        transcriptEl.innerHTML = history.map(m => {
            const isAI = m.role === 'assistant';
            return `<div class="transcript-msg ${isAI ? 'transcript-ai' : 'transcript-user'}">
                        <div class="transcript-sender">${isAI ? 'Layla' : 'User'}</div>
                        <div class="transcript-text">${escapeHtml(m.content)}</div>
                    </div>`;
        }).join('');
        transcriptEl.scrollTop = 0;
    }

    // Delete button
    document.getElementById('deleteConvBtn').onclick = () => showDeleteModal(conv.id);
}

// ─────────────────────────────────────────────
// DELETE MODAL
// ─────────────────────────────────────────────

function showDeleteModal(id) {
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
// LOGOUT
// ─────────────────────────────────────────────

async function adminLogout() {
    try { await fetch('/api/admin/logout', { method: 'POST' }); } catch (_) {}
    location.reload();
}

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = String(text || '');
    return div.innerHTML;
}

function getVibeEmoji(vibe) {
    const map = {
        serious: '🎯', excited: '🔥', curious: '🤔', skeptical: '🧐',
        funny: '😄', annoyed: '😤', trolling: '🧌', distracted: '💭',
        overwhelmed: '😰', cold: '🧊',
    };
    return map[vibe] || '💬';
}

function formatTime(ts) {
    if (!ts) return '';
    const d    = new Date(ts);
    const mins = Math.floor((Date.now() - d) / 60000);
    if (mins < 1)    return 'just now';
    if (mins < 60)   return `${mins}m ago`;
    if (mins < 1440) return `${Math.floor(mins / 60)}h ago`;
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function formatFull(ts) {
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
    // Login
    document.getElementById('loginBtn').addEventListener('click', adminLogin);
    document.getElementById('passwordInput').addEventListener('keydown', e => {
        if (e.key === 'Enter') adminLogin();
    });

    // Logout & refresh
    document.getElementById('logoutBtn').addEventListener('click', adminLogout);
    document.getElementById('refreshBtn').addEventListener('click', async () => {
        await loadStats();
        await loadConversations();
        if (currentConvId) openConversation(currentConvId);
    });

    // Filter pills — intent
    document.querySelectorAll('.filter-pill[data-intent]').forEach(btn => {
        btn.addEventListener('click', () => setIntentFilter(btn.dataset.intent));
    });

    // Filter checkbox — email only
    document.getElementById('filterEmail').addEventListener('change', toggleEmailFilter);

    // Running summary toggle
    document.getElementById('summaryToggle').addEventListener('click', () => {
        const textEl    = document.getElementById('runningSummaryText');
        const chevron   = document.querySelector('.summary-chevron');
        const toggle    = document.getElementById('summaryToggle');
        const expanded  = toggle.getAttribute('aria-expanded') === 'true';
        toggle.setAttribute('aria-expanded', !expanded);
        textEl.classList.toggle('collapsed', expanded);
        chevron.textContent = expanded ? '▶' : '▼';
    });
    document.getElementById('summaryToggle').addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') document.getElementById('summaryToggle').click();
    });
        if (e.target === document.getElementById('deleteModal'))
            document.getElementById('deleteModal').style.display = 'none';
    });
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape')
            document.getElementById('deleteModal').style.display = 'none';
    });
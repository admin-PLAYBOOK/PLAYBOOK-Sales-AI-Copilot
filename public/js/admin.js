const POLL_INTERVAL = 8000;

let selectedConvId = null;
let conversations  = [];
let pollTimer      = null;
let isLoggedIn     = false;

// ─────────────────────────────────────────────
// LOGIN — posts password to server, gets httpOnly cookie back
// Token never touches the browser JS environment
// ─────────────────────────────────────────────

async function attemptLogin() {
    const password = document.getElementById('passwordInput').value;
    const loginBtn = document.getElementById('loginBtn');
    const errEl    = document.getElementById('loginError');

    loginBtn.disabled    = true;
    loginBtn.textContent = 'Signing in…';
    errEl.style.display  = 'none';

    try {
        const res = await fetch('/api/admin/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password }),
            credentials: 'same-origin', // include cookies
        });

        if (res.ok) {
            showDashboard();
        } else {
            errEl.style.display  = 'block';
            loginBtn.disabled    = false;
            loginBtn.textContent = 'Sign in →';
            document.getElementById('passwordInput').value = '';
            document.getElementById('passwordInput').focus();
        }
    } catch (err) {
        errEl.textContent   = 'Connection error — is the server running?';
        errEl.style.display = 'block';
        loginBtn.disabled   = false;
        loginBtn.textContent = 'Sign in →';
    }
}

async function logout() {
    await fetch('/api/admin/logout', { method: 'POST', credentials: 'same-origin' });
    isLoggedIn = false;
    stopPolling();
    document.getElementById('adminDash').style.display  = 'none';
    document.getElementById('loginGate').style.display  = 'flex';
    document.getElementById('passwordInput').value      = '';
    selectedConvId = null;
    conversations  = [];
}

function showDashboard() {
    isLoggedIn = true;
    document.getElementById('loginGate').style.display = 'none';
    document.getElementById('adminDash').style.display = 'flex';
    startPolling();
    fetchStats();
}

// ─────────────────────────────────────────────
// POLLING
// ─────────────────────────────────────────────

function startPolling() {
    fetchConversations();
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(() => {
        fetchConversations();
        fetchStats();
    }, POLL_INTERVAL);
}

function stopPolling() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

async function fetchConversations() {
    try {
        const res = await fetch('/api/admin/conversations', { credentials: 'same-origin' });

        if (res.status === 401) { logout(); return; }
        if (!res.ok) return;

        const data    = await res.json();
        conversations = data.conversations || [];

        renderFeed();

        const countText = document.getElementById('countText');
        if (countText) countText.textContent =
            `${conversations.length} conversation${conversations.length !== 1 ? 's' : ''}`;

        // Re-render detail if selected convo was updated
        if (selectedConvId && conversations.some(c => c.id === selectedConvId)) {
            selectConversation(selectedConvId);
        }
    } catch (err) {
        console.error('Poll error:', err);
    }
}

async function fetchStats() {
    try {
        const res = await fetch('/api/admin/stats', { credentials: 'same-origin' });
        if (!res.ok) return;
        const s = await res.json();
        setText('statTotal',  s.total            ?? '—');
        setText('statHigh',   s.high_intent       ?? '—');
        setText('statMedium', s.medium_intent      ?? '—');
        setText('statLow',    s.low_intent         ?? '—');
        setText('statEmails', s.emails_captured    ?? '—');
    } catch (err) {
        console.error('Stats error:', err);
    }
}

function setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
}

// ─────────────────────────────────────────────
// FEED
// ─────────────────────────────────────────────

function renderFeed() {
    const feed = document.getElementById('conversationFeed');
    if (!feed) return;

    if (conversations.length === 0) {
        feed.innerHTML = '<div class="feed-empty">No conversations yet</div>';
        return;
    }

    // Build HTML — use data-conv-id + event delegation, no inline onclick
    feed.innerHTML = conversations
        .slice().reverse()
        .map(conv => {
            const lead  = conv.lead_data || {};
            const name  = lead.name || 'Anonymous';
            const vibe  = lead.conversation_vibe || 'curious';
            const intent = lead.intent_level || 'Low';
            const time  = conv.timestamp
                ? new Date(conv.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                : '';
            const intentClass = intent === 'High' ? 'intent-high'
                : intent === 'Medium' ? 'intent-medium' : 'intent-low';
            const isActive  = conv.id === selectedConvId ? 'feed-item-active' : '';
            const vibeEmoji = VIBE_EMOJI[vibe] || '💬';
            const emailBadge = lead.email ? '📧 ' : '';

            return `<div class="feed-item ${isActive}"
                        data-conv-id="${escapeAttr(conv.id)}"
                        tabindex="0" role="button"
                        aria-label="View conversation with ${escapeHtml(name)}">
                <div class="feed-item-top">
                    <span class="feed-name">${emailBadge}${escapeHtml(name)}</span>
                    <span class="feed-time">${escapeHtml(time)}</span>
                </div>
                <div class="feed-item-bottom">
                    <span class="feed-vibe">${vibeEmoji} ${escapeHtml(vibe)}</span>
                    <span class="feed-intent ${intentClass}">${escapeHtml(intent)}</span>
                </div>
            </div>`;
        })
        .join('');
}

// ─────────────────────────────────────────────
// DETAIL VIEW
// ─────────────────────────────────────────────

function selectConversation(id) {
    selectedConvId = id;
    renderFeed(); // update active state

    const conv = conversations.find(c => c.id === id);
    if (!conv) return;

    document.getElementById('emptyState').style.display = 'none';
    document.getElementById('convDetail').style.display = 'block';

    const lead  = conv.lead_data   || {};
    const sales = conv.sales_output || {};

    // Header
    setText('detailName', lead.name || 'Anonymous');
    setText('detailMeta',
        [lead.email, lead.lead_type].filter(Boolean).join(' · ') || 'No contact info yet');

    // Vibe badge
    const vibeEmoji = VIBE_EMOJI[lead.conversation_vibe] || '💬';
    const vibeLabel = lead.conversation_vibe
        ? lead.conversation_vibe.charAt(0).toUpperCase() + lead.conversation_vibe.slice(1)
        : '—';
    setText('detailVibeBadge', `${vibeEmoji} ${vibeLabel}`);

    // Priority badge
    const priority    = (sales.priority || 'Low').toLowerCase();
    const priorityEl  = document.getElementById('detailPriority');
    if (priorityEl) {
        priorityEl.textContent = `${sales.priority || 'Low'} Priority`;
        priorityEl.className   = `priority-badge priority-${priority}`;
    }

    // Lead grid
    const leadGrid = document.getElementById('leadGrid');
    if (leadGrid) {
        leadGrid.innerHTML = [
            { label: 'Name',     value: lead.name },
            { label: 'Email',    value: lead.email },
            { label: 'Type',     value: lead.lead_type },
            { label: 'Interest', value: lead.main_interest },
        ].map(f => `
            <div class="lead-field">
                <span class="lead-label">${f.label}</span>
                <span class="lead-value">${escapeHtml(f.value || '—')}</span>
            </div>`).join('');
    }

    // Intent row
    const intentClass = lead.intent_level === 'High'   ? 'status-success'
        : lead.intent_level === 'Medium' ? 'status-warning' : 'status-error';
    const intentRow = document.getElementById('intentRow');
    if (intentRow) {
        intentRow.innerHTML = `
            <span class="lead-label">Intent</span>
            <span class="status-badge ${intentClass}" style="font-size:0.75rem;padding:3px 10px;margin-top:0">
                ${escapeHtml(lead.intent_level || 'Low')}
            </span>`;
    }
    setText('intentSignals', lead.intent_signals || '');

    // Vibe detail
    const vibeDetail = document.getElementById('vibeDetail');
    if (vibeDetail) {
        vibeDetail.innerHTML = `
            <div class="vibe-badge-large">${vibeEmoji} ${escapeHtml(vibeLabel)}</div>
            <div class="vibe-note">${escapeHtml(lead.vibe_note || '—')}</div>`;
    }

    // Sales recs
    setText('nextAction', sales.recommended_next_action || '—');
    setText('followUp',   sales.follow_up_message       || '—');

    // HubSpot
    const hs = conv.hubspot || {};
    const hubspotStatus = document.getElementById('hubspotStatus');
    if (hubspotStatus) {
        if (hs.success) {
            hubspotStatus.innerHTML = `
                <div class="status-badge status-success">✅ ${escapeHtml(hs.message || 'Synced')}</div>
                ${hs.contactId ? `<div class="rec-label" style="margin-top:8px">Contact ID: ${escapeHtml(String(hs.contactId))}</div>` : ''}`;
        } else {
            const sc = hs.message?.includes('email') ? 'status-warning' : 'status-error';
            hubspotStatus.innerHTML = `
                <div class="status-badge ${sc}">
                    ${hs.message?.includes('email') ? '⚠️ Waiting for email' : `❌ ${escapeHtml(hs.message || 'Error')}`}
                </div>`;
        }
    }

    setText('convTimestamp', conv.timestamp ? '🕐 ' + new Date(conv.timestamp).toLocaleString() : '');
    setText('convModel',     conv.model_used ? `🤖 ${conv.model_used}` : '');

    // Transcript
    const transcriptEl = document.getElementById('transcript');
    if (transcriptEl) {
        const history = conv.history || [];
        if (history.length === 0) {
            transcriptEl.innerHTML = '<div class="transcript-empty">No transcript available</div>';
        } else {
            transcriptEl.innerHTML = history.map(m => `
                <div class="transcript-msg ${m.role === 'user' ? 'transcript-user' : 'transcript-ai'}">
                    <span class="transcript-sender">${m.role === 'user' ? 'User' : 'Layla'}</span>
                    <span class="transcript-text">${escapeHtml(m.content)}</span>
                </div>`).join('');
            transcriptEl.scrollTop = transcriptEl.scrollHeight;
        }
    }
}

function showEmptyState() {
    document.getElementById('emptyState').style.display = 'flex';
    document.getElementById('convDetail').style.display = 'none';
}

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

const VIBE_EMOJI = {
    serious:'🎯', excited:'🔥', curious:'🤔', skeptical:'🧐',
    funny:'😄', annoyed:'😤', trolling:'🧌', distracted:'💭',
    overwhelmed:'😰', cold:'🧊'
};

function escapeHtml(text) {
    if (!text) return '';
    const d = document.createElement('div');
    d.textContent = String(text);
    return d.innerHTML;
}

function escapeAttr(text) {
    return String(text || '')
        .replace(/&/g,'&amp;').replace(/"/g,'&quot;')
        .replace(/'/g,'&#39;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ─────────────────────────────────────────────
// INIT
// ─────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {

    // ── Login button (no form, no default submit) ──
    document.getElementById('loginBtn').addEventListener('click', attemptLogin);
    document.getElementById('passwordInput').addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); attemptLogin(); }
    });

    // ── Logout / refresh ──
    document.getElementById('logoutBtn').addEventListener('click', e => {
        e.preventDefault(); logout();
    });
    document.getElementById('refreshBtn').addEventListener('click', e => {
        e.preventDefault(); fetchConversations(); fetchStats();
    });

    // ── Feed: event delegation ──
    const feed = document.getElementById('conversationFeed');
    if (feed) {
        feed.addEventListener('click', e => {
            e.preventDefault();      // stop any accidental link/form behaviour
            e.stopPropagation();
            const item = e.target.closest('[data-conv-id]');
            if (item) selectConversation(item.dataset.convId);
        });
        feed.addEventListener('keydown', e => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                const item = e.target.closest('[data-conv-id]');
                if (item) selectConversation(item.dataset.convId);
            }
        });
    }

    // ── Keyboard shortcut: Escape deselects ──
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && selectedConvId) {
            selectedConvId = null;
            showEmptyState();
            renderFeed();
        }
    });

    // ── Check if we already have a valid session (cookie) ──
    // Try fetching stats — if it returns 401, show login gate; otherwise go straight to dashboard
    fetch('/api/admin/stats', { credentials: 'same-origin' })
        .then(res => {
            if (res.ok) {
                showDashboard();
            } else {
                document.getElementById('loginGate').style.display = 'flex';
                document.getElementById('passwordInput').focus();
            }
        })
        .catch(() => {
            document.getElementById('loginGate').style.display = 'flex';
        });
});
// ─────────────────────────────────────────────
// ADMIN DASHBOARD — admin.js
// ─────────────────────────────────────────────

let currentConvId = null;
let allConversations = [];

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

        document.getElementById('statTotal').textContent  = data.total            ?? '—';
        document.getElementById('statHigh').textContent   = data.high_intent      ?? '—';
        document.getElementById('statMedium').textContent = data.medium_intent    ?? '—';
        document.getElementById('statLow').textContent    = data.low_intent       ?? '—';
        document.getElementById('statEmails').textContent = data.emails_captured  ?? '—';
    } catch (_) {}
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
        renderFeed(allConversations);
        document.getElementById('countText').textContent = `${allConversations.length} conversation${allConversations.length !== 1 ? 's' : ''}`;
    } catch (_) {}
}

function renderFeed(conversations) {
    const feed = document.getElementById('conversationFeed');
    feed.innerHTML = '';

    if (!conversations.length) {
        feed.innerHTML = '<div class="feed-empty">No conversations yet</div>';
        return;
    }

    conversations.forEach(conv => {
        const name      = conv.lead_data?.name  || 'Anonymous';
        const intent    = conv.lead_data?.intent_level || 'Low';
        const vibe      = conv.lead_data?.conversation_vibe || '';
        const vibeEmoji = getVibeEmoji(vibe);
        const time      = formatTime(conv.timestamp);

        const item      = document.createElement('div');
        item.className  = 'feed-item' + (conv.id === currentConvId ? ' feed-item-active' : '');
        item.setAttribute('role', 'listitem');
        item.dataset.id = conv.id;

        item.innerHTML = `
            <div class="feed-item-top">
                <div class="feed-name">${escapeHtml(name)}</div>
                <div class="feed-time">${time}</div>
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

    // Highlight active item in feed
    document.querySelectorAll('.feed-item').forEach(el => {
        el.classList.toggle('feed-item-active', el.dataset.id === id);
    });

    try {
        const res  = await fetch(`/api/admin/conversations/${id}`);
        if (!res.ok) return;
        const { conversation: conv } = await res.json();

        renderDetail(conv);

        document.getElementById('emptyState').style.display  = 'none';
        document.getElementById('convDetail').style.display  = 'block';
    } catch (_) {}
}

function renderDetail(conv) {
    const lead    = conv.lead_data    || {};
    const sales   = conv.sales_output || {};
    const hubspot = conv.hubspot      || {};
    const history = conv.history      || [];

    // Header
    document.getElementById('detailName').textContent = lead.name || 'Anonymous';
    document.getElementById('detailMeta').textContent = lead.email
        ? `${lead.email} · ${formatFull(conv.timestamp)}`
        : formatFull(conv.timestamp);

    // Vibe badge
    const vibeBadge = document.getElementById('detailVibeBadge');
    const vibe = lead.conversation_vibe || '';
    vibeBadge.textContent = `${getVibeEmoji(vibe)} ${vibe}`;

    // Priority badge
    const priEl = document.getElementById('detailPriority');
    const pri   = (sales.priority || 'Low').toLowerCase();
    priEl.className   = `priority-badge priority-${pri}`;
    priEl.textContent = sales.priority || 'Low';

    // Lead data grid
    const leadGrid = document.getElementById('leadGrid');
    const fields = [
        { label: 'Name',      value: lead.name          || '—' },
        { label: 'Email',     value: lead.email         || '—' },
        { label: 'Lead Type', value: lead.lead_type     || '—' },
        { label: 'Interest',  value: lead.main_interest || '—' },
    ];
    leadGrid.innerHTML = fields.map(f => `
        <div class="lead-field">
            <div class="lead-label">${f.label}</div>
            <div class="lead-value">${escapeHtml(String(f.value))}</div>
        </div>`).join('');

    // Intent row
    const intentLevel = lead.intent_level || 'Low';
    document.getElementById('intentRow').innerHTML =
        `<span class="status-badge status-${intentLevel === 'High' ? 'error' : intentLevel === 'Medium' ? 'warning' : 'success'}">
            ${intentLevel} Intent
         </span>`;

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

    // Transcript
    const transcriptEl = document.getElementById('transcript');
    if (!history.length) {
        transcriptEl.innerHTML = '<div class="transcript-empty">No transcript available</div>';
    } else {
        transcriptEl.innerHTML = history.map(m => {
            const isAI   = m.role === 'assistant';
            const sender = isAI ? 'Layla' : 'User';
            return `<div class="transcript-msg ${isAI ? 'transcript-ai' : 'transcript-user'}">
                        <div class="transcript-sender">${sender}</div>
                        <div class="transcript-text">${escapeHtml(m.content)}</div>
                    </div>`;
        }).join('');
        transcriptEl.scrollTop = 0;
    }

    // Wire up delete button
    const delBtn = document.getElementById('deleteConvBtn');
    delBtn.onclick = () => showDeleteModal(conv.id);
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

        // Remove from local list and re-render feed
        allConversations = allConversations.filter(c => c.id !== id);
        renderFeed(allConversations);
        document.getElementById('countText').textContent = `${allConversations.length} conversation${allConversations.length !== 1 ? 's' : ''}`;

        // Hide detail panel if we just deleted the active one
        if (currentConvId === id) {
            currentConvId = null;
            document.getElementById('convDetail').style.display  = 'none';
            document.getElementById('emptyState').style.display  = 'flex';
        }

        await loadStats();
    } catch (_) {}
}

// ─────────────────────────────────────────────
// LOGOUT
// ─────────────────────────────────────────────

async function adminLogout() {
    try {
        await fetch('/api/admin/logout', { method: 'POST' });
    } catch (_) {}
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
        serious:     '🎯',
        excited:     '🔥',
        curious:     '🤔',
        skeptical:   '🧐',
        funny:       '😄',
        annoyed:     '😤',
        trolling:    '🧌',
        distracted:  '💭',
        overwhelmed: '😰',
        cold:        '🧊',
    };
    return map[vibe] || '💬';
}

function formatTime(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    const now = new Date();
    const diffMs = now - d;
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1)   return 'just now';
    if (diffMins < 60)  return `${diffMins}m ago`;
    if (diffMins < 1440) return `${Math.floor(diffMins / 60)}h ago`;
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
    // Login events
    document.getElementById('loginBtn').addEventListener('click', adminLogin);
    document.getElementById('passwordInput').addEventListener('keydown', e => {
        if (e.key === 'Enter') adminLogin();
    });

    // Dashboard events
    document.getElementById('logoutBtn').addEventListener('click', adminLogout);
    document.getElementById('refreshBtn').addEventListener('click', async () => {
        await loadStats();
        await loadConversations();
        // Re-open current conversation if one was selected
        if (currentConvId) openConversation(currentConvId);
    });

    // Close modal on backdrop click
    document.getElementById('deleteModal').addEventListener('click', e => {
        if (e.target === document.getElementById('deleteModal')) {
            document.getElementById('deleteModal').style.display = 'none';
        }
    });

    // Close modal on Escape
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape') {
            document.getElementById('deleteModal').style.display = 'none';
        }
    });
});
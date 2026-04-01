const POLL_INTERVAL = 8000;

let selectedConvId = null;
let conversations = [];
let pollTimer = null;

// ─────────────────────────────────────────────
// INITIALIZATION
// ─────────────────────────────────────────────

function initAdmin() {
    const loginGate = document.getElementById('loginGate');
    const adminDash = document.getElementById('adminDash');
    if (loginGate) loginGate.style.display = 'none';
    if (adminDash) adminDash.style.display = 'flex';
    startPolling();
    updateLiveStatus();
}

function logout() {
    window.location.reload();
}

// ─────────────────────────────────────────────
// POLLING
// ─────────────────────────────────────────────

function startPolling() {
    fetchConversations();
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(fetchConversations, POLL_INTERVAL);
}

function stopPolling() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

async function fetchConversations() {
    try {
        // FIX: Token now read from meta tag instead of hardcoded in JS
        const tokenMeta = document.querySelector('meta[name="admin-token"]');
        const token = tokenMeta ? tokenMeta.getAttribute('content') : '';

        const res = await fetch('/api/admin/conversations', {
            headers: { 'x-admin-token': token }
        });
        
        if (!res.ok) {
            console.error('Failed to fetch conversations:', res.status);
            return;
        }
        
        const data = await res.json();
        conversations = data.conversations || [];
        renderFeed();
        
        const countText = document.getElementById('countText');
        if (countText) {
            countText.textContent = `${conversations.length} conversation${conversations.length !== 1 ? 's' : ''}`;
        }
        
        if (selectedConvId) {
            const stillExists = conversations.some(c => c.id === selectedConvId);
            if (stillExists) {
                selectConversation(selectedConvId);
            } else {
                selectedConvId = null;
                showEmptyState();
                renderFeed();
            }
        }
    } catch (err) {
        console.error('Poll error:', err);
    }
}

function showEmptyState() {
    const emptyState = document.getElementById('emptyState');
    const convDetail = document.getElementById('convDetail');
    if (emptyState) emptyState.style.display = 'flex';
    if (convDetail) convDetail.style.display = 'none';
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

    feed.innerHTML = conversations
        .slice()
        .reverse()
        .map(conv => {
            const lead = conv.lead_data || {};
            const name = lead.name || 'Anonymous';
            const vibe = lead.conversation_vibe || 'curious';
            const intent = lead.intent_level || 'Low';
            const time = conv.timestamp
                ? new Date(conv.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                : '';
            const intentClass = intent === 'High' ? 'intent-high'
                : intent === 'Medium' ? 'intent-medium' : 'intent-low';
            const isSelected = conv.id === selectedConvId ? 'feed-item-active' : '';
            const vibeEmoji = VIBE_EMOJI[vibe] || '💬';
            const hasEmail = lead.email ? '📧' : '';

            // FIX: use data attribute + event delegation instead of inline onclick with raw id
            return `<div class="feed-item ${isSelected}" data-conv-id="${escapeAttr(conv.id)}" tabindex="0" role="button" aria-label="View conversation with ${escapeHtml(name)}">
                <div class="feed-item-top">
                    <span class="feed-name">${escapeHtml(name)} ${hasEmail}</span>
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
    renderFeed();

    const conv = conversations.find(c => c.id === id);
    if (!conv) return;

    const emptyState = document.getElementById('emptyState');
    const convDetail = document.getElementById('convDetail');
    if (emptyState) emptyState.style.display = 'none';
    if (convDetail) convDetail.style.display = 'block';

    const lead = conv.lead_data || {};
    const sales = conv.sales_output || {};

    const detailName = document.getElementById('detailName');
    const detailMeta = document.getElementById('detailMeta');
    if (detailName) detailName.textContent = lead.name || 'Anonymous';
    if (detailMeta) {
        detailMeta.textContent = [lead.email, lead.lead_type]
            .filter(Boolean).join(' · ') || 'No contact info yet';
    }

    const vibeEmoji = VIBE_EMOJI[lead.conversation_vibe] || '💬';
    const vibeLabel = lead.conversation_vibe
        ? lead.conversation_vibe.charAt(0).toUpperCase() + lead.conversation_vibe.slice(1)
        : '—';
    const detailVibeBadge = document.getElementById('detailVibeBadge');
    if (detailVibeBadge) detailVibeBadge.textContent = `${vibeEmoji} ${vibeLabel}`;

    const priorityEl = document.getElementById('detailPriority');
    if (priorityEl) {
        const priority = (sales.priority || 'Low').toLowerCase();
        priorityEl.textContent = `${sales.priority || 'Low'} Priority`;
        priorityEl.className = `priority-badge priority-${priority}`;
    }

    const leadGrid = document.getElementById('leadGrid');
    if (leadGrid) {
        leadGrid.innerHTML = [
            { label: 'Name', value: lead.name },
            { label: 'Email', value: lead.email },
            { label: 'Type', value: lead.lead_type },
            { label: 'Interest', value: lead.main_interest }
        ].map(f => `
            <div class="lead-field">
                <span class="lead-label">${escapeHtml(f.label)}</span>
                <span class="lead-value">${escapeHtml(f.value || '—')}</span>
            </div>
        `).join('');
    }

    const intentClass = lead.intent_level === 'High' ? 'status-success'
        : lead.intent_level === 'Medium' ? 'status-warning' : 'status-error';
    const intentRow = document.getElementById('intentRow');
    if (intentRow) {
        intentRow.innerHTML = `
            <span class="lead-label">Intent</span>
            <span class="status-badge ${intentClass}" style="font-size:0.75rem; padding:3px 10px; margin-top:0">
                ${escapeHtml(lead.intent_level || 'Low')}
            </span>
        `;
    }
    
    const intentSignals = document.getElementById('intentSignals');
    if (intentSignals) intentSignals.textContent = lead.intent_signals || '';

    const vibeDetail = document.getElementById('vibeDetail');
    if (vibeDetail) {
        vibeDetail.innerHTML = `
            <div class="vibe-badge-large">${vibeEmoji} ${escapeHtml(vibeLabel)}</div>
            <div class="vibe-note">${escapeHtml(lead.vibe_note || '—')}</div>
        `;
    }

    const nextAction = document.getElementById('nextAction');
    const followUp = document.getElementById('followUp');
    if (nextAction) nextAction.textContent = sales.recommended_next_action || '—';
    if (followUp) followUp.textContent = sales.follow_up_message || '—';

    const hs = conv.hubspot || {};
    const hubspotStatus = document.getElementById('hubspotStatus');
    if (hubspotStatus) {
        let hsHtml = '';
        if (hs.success) {
            hsHtml = `<div class="status-badge status-success">✅ ${escapeHtml(hs.message || 'Synced')}</div>`;
            if (hs.contactId) hsHtml += `<div class="rec-label" style="margin-top:8px">Contact ID: ${escapeHtml(hs.contactId)}</div>`;
        } else {
            const statusClass = hs.message?.includes('email') ? 'status-warning' : 'status-error';
            hsHtml = `<div class="status-badge ${statusClass}">
                ${hs.message?.includes('email') ? '⚠️ Waiting for email' : `❌ ${escapeHtml(hs.message || 'Error')}`}
            </div>`;
        }
        hubspotStatus.innerHTML = hsHtml;
    }
    
    const convTimestamp = document.getElementById('convTimestamp');
    if (convTimestamp) convTimestamp.textContent = conv.timestamp ? '🕐 ' + new Date(conv.timestamp).toLocaleString() : '';
    
    const convModel = document.getElementById('convModel');
    if (convModel) convModel.textContent = conv.model_used ? `🤖 ${conv.model_used}` : '';

    const transcriptEl = document.getElementById('transcript');
    if (transcriptEl) {
        const history = conv.history || [];
        if (history.length === 0) {
            transcriptEl.innerHTML = '<div class="transcript-empty">No transcript available</div>';
        } else {
            transcriptEl.innerHTML = history.map(m => `
                <div class="transcript-msg ${m.role === 'user' ? 'transcript-user' : 'transcript-ai'}">
                    <span class="transcript-sender">${m.role === 'user' ? 'User' : 'Raya'}</span>
                    <span class="transcript-text">${escapeHtml(m.content)}</span>
                </div>
            `).join('');
            // FIX: auto-scroll transcript to bottom so latest message is visible
            transcriptEl.scrollTop = transcriptEl.scrollHeight;
        }
    }
}

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

const VIBE_EMOJI = {
    serious: '🎯', excited: '🔥', curious: '🤔', skeptical: '🧐',
    funny: '😄', annoyed: '😤', trolling: '🧌', distracted: '💭',
    overwhelmed: '😰', cold: '🧊'
};

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = String(text);
    return div.innerHTML;
}

// FIX: separate escaper for HTML attribute values (handles quotes)
function escapeAttr(text) {
    if (!text) return '';
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

// ─────────────────────────────────────────────
// KEYBOARD SHORTCUTS
// ─────────────────────────────────────────────

function handleKeyboardShortcuts(e) {
    if (e.key === 'Escape' && selectedConvId) {
        e.preventDefault();
        selectedConvId = null;
        showEmptyState();
        renderFeed();
    }
}

// ─────────────────────────────────────────────
// AUTO-REFRESH STATUS
// ─────────────────────────────────────────────

function updateLiveStatus() {
    const liveCount = document.getElementById('liveCount');
    if (liveCount) {
        const dot = liveCount.querySelector('.status-dot');
        if (dot) dot.style.animation = 'pulse 2s infinite';
    }
}

// ─────────────────────────────────────────────
// INIT
// ─────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
    initAdmin();
    document.addEventListener('keydown', handleKeyboardShortcuts);

    // FIX: event delegation on the feed instead of inline onclick per item
    const feed = document.getElementById('conversationFeed');
    if (feed) {
        feed.addEventListener('click', (e) => {
            const item = e.target.closest('[data-conv-id]');
            if (item) selectConversation(item.dataset.convId);
        });
        // Keyboard accessibility: Enter/Space activates item
        feed.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                const item = e.target.closest('[data-conv-id]');
                if (item) { e.preventDefault(); selectConversation(item.dataset.convId); }
            }
        });
    }

    const sidebarFooter = document.querySelector('.sidebar-footer');
    if (sidebarFooter && !document.getElementById('refreshBtn')) {
        const refreshBtn = document.createElement('button');
        refreshBtn.id = 'refreshBtn';
        refreshBtn.className = 'refresh-btn';
        refreshBtn.textContent = '⟳ Refresh';
        refreshBtn.onclick = (e) => { e.preventDefault(); fetchConversations(); };
        const logoutBtn = sidebarFooter.querySelector('.logout-btn');
        if (logoutBtn) sidebarFooter.insertBefore(refreshBtn, logoutBtn);
    }
});

if (typeof window !== 'undefined') {
    window.admin = {
        refresh: fetchConversations,
        logout: logout,
        selectConversation: selectConversation,
        getConversations: () => conversations
    };
}
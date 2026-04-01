const POLL_INTERVAL = 8000; // refresh feed every 8s

let selectedConvId = null;
let conversations = [];
let pollTimer = null;

// ─────────────────────────────────────────────
// INITIALIZATION
// ─────────────────────────────────────────────

function initAdmin() {
    // Hide login gate and show admin dashboard immediately
    const loginGate = document.getElementById('loginGate');
    const adminDash = document.getElementById('adminDash');
    
    if (loginGate) loginGate.style.display = 'none';
    if (adminDash) adminDash.style.display = 'flex';
    
    // Start polling for conversations
    startPolling();
    updateLiveStatus();
}

function logout() {
    // For now, just refresh the page to reset state
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
    if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
    }
}

async function fetchConversations() {
    try {
        const res = await fetch('/api/admin/conversations', {
            headers: { 'x-admin-token': 'playbook2024' } // Keep server-side token
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
        
        // If selected conversation still exists, refresh its view
        if (selectedConvId) {
            const stillExists = conversations.some(c => c.id === selectedConvId);
            if (stillExists) {
                selectConversation(selectedConvId);
            } else {
                // Selected conversation no longer exists
                selectedConvId = null;
                const emptyState = document.getElementById('emptyState');
                const convDetail = document.getElementById('convDetail');
                if (emptyState) emptyState.style.display = 'flex';
                if (convDetail) convDetail.style.display = 'none';
                renderFeed(); // Re-render to remove active state
            }
        }
    } catch (err) {
        console.error('Poll error:', err);
    }
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
        .reverse() // newest first
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

            return `<div class="feed-item ${isSelected}" onclick="selectConversation('${escapeHtml(conv.id)}')">
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
    renderFeed(); // re-render to show active state

    const conv = conversations.find(c => c.id === id);
    if (!conv) return;

    const emptyState = document.getElementById('emptyState');
    const convDetail = document.getElementById('convDetail');
    if (emptyState) emptyState.style.display = 'none';
    if (convDetail) convDetail.style.display = 'block';

    const lead = conv.lead_data || {};
    const sales = conv.sales_output || {};

    // Header
    const detailName = document.getElementById('detailName');
    const detailMeta = document.getElementById('detailMeta');
    if (detailName) detailName.textContent = lead.name || 'Anonymous';
    if (detailMeta) {
        detailMeta.textContent = [lead.email, lead.lead_type]
            .filter(Boolean)
            .join(' · ') || 'No contact info yet';
    }

    // Vibe badge
    const vibeEmoji = VIBE_EMOJI[lead.conversation_vibe] || '💬';
    const vibeLabel = lead.conversation_vibe
        ? lead.conversation_vibe.charAt(0).toUpperCase() + lead.conversation_vibe.slice(1)
        : '—';
    const detailVibeBadge = document.getElementById('detailVibeBadge');
    if (detailVibeBadge) {
        detailVibeBadge.textContent = `${vibeEmoji} ${vibeLabel}`;
    }

    // Priority badge
    const priorityEl = document.getElementById('detailPriority');
    if (priorityEl) {
        const priority = (sales.priority || 'Low').toLowerCase();
        priorityEl.textContent = `${sales.priority || 'Low'} Priority`;
        priorityEl.className = `priority-badge priority-${priority}`;
    }

    // Lead grid
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

    // Intent
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
    if (intentSignals) {
        intentSignals.textContent = lead.intent_signals || '';
    }

    // Vibe detail
    const vibeDetail = document.getElementById('vibeDetail');
    if (vibeDetail) {
        vibeDetail.innerHTML = `
            <div class="vibe-badge-large">${vibeEmoji} ${escapeHtml(vibeLabel)}</div>
            <div class="vibe-note">${escapeHtml(lead.vibe_note || '—')}</div>
        `;
    }

    // Sales recs
    const nextAction = document.getElementById('nextAction');
    const followUp = document.getElementById('followUp');
    if (nextAction) nextAction.textContent = sales.recommended_next_action || '—';
    if (followUp) followUp.textContent = sales.follow_up_message || '—';

    // HubSpot
    const hs = conv.hubspot || {};
    const hubspotStatus = document.getElementById('hubspotStatus');
    if (hubspotStatus) {
        let hsHtml = '';
        if (hs.success) {
            hsHtml = `<div class="status-badge status-success">✅ ${escapeHtml(hs.message || 'Synced')}</div>`;
            if (hs.contactId) {
                hsHtml += `<div class="rec-label" style="margin-top:8px">Contact ID: ${escapeHtml(hs.contactId)}</div>`;
            }
        } else {
            const statusClass = hs.message?.includes('email') ? 'status-warning' : 'status-error';
            hsHtml = `<div class="status-badge ${statusClass}">
                ${hs.message?.includes('email') ? '⚠️ Waiting for email' : `❌ ${escapeHtml(hs.message || 'Error')}`}
            </div>`;
        }
        hubspotStatus.innerHTML = hsHtml;
    }
    
    const convTimestamp = document.getElementById('convTimestamp');
    if (convTimestamp) {
        convTimestamp.textContent = conv.timestamp
            ? '🕐 ' + new Date(conv.timestamp).toLocaleString()
            : '';
    }
    
    const convModel = document.getElementById('convModel');
    if (convModel) {
        convModel.textContent = conv.model_used
            ? `🤖 ${conv.model_used}`
            : '';
    }

    // Transcript
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

// ─────────────────────────────────────────────
// KEYBOARD SHORTCUTS
// ─────────────────────────────────────────────

function handleKeyboardShortcuts(e) {
    // Escape - clear selection
    if (e.key === 'Escape' && selectedConvId) {
        e.preventDefault();
        selectedConvId = null;
        const emptyState = document.getElementById('emptyState');
        const convDetail = document.getElementById('convDetail');
        if (emptyState) emptyState.style.display = 'flex';
        if (convDetail) convDetail.style.display = 'none';
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
        if (dot) {
            dot.style.animation = 'pulse 2s infinite';
        }
    }
}

// ─────────────────────────────────────────────
// INIT
// ─────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
    // Theme is already initialized by theme.js
    // Initialize admin immediately (no login required)
    initAdmin();
    
    // Add keyboard shortcuts
    document.addEventListener('keydown', handleKeyboardShortcuts);
    
    // Add refresh button to sidebar
    const sidebarFooter = document.querySelector('.sidebar-footer');
    if (sidebarFooter && !document.getElementById('refreshBtn')) {
        const refreshBtn = document.createElement('button');
        refreshBtn.id = 'refreshBtn';
        refreshBtn.className = 'refresh-btn';
        refreshBtn.textContent = '⟳ Refresh';
        refreshBtn.onclick = (e) => {
            e.preventDefault();
            fetchConversations();
        };
        
        const logoutBtn = sidebarFooter.querySelector('.logout-btn');
        if (logoutBtn) {
            sidebarFooter.insertBefore(refreshBtn, logoutBtn);
        }
    }
});

// ─────────────────────────────────────────────
// EXPORT FOR DEBUGGING
// ─────────────────────────────────────────────
if (typeof window !== 'undefined') {
    window.admin = {
        refresh: fetchConversations,
        logout: logout,
        selectConversation: selectConversation,
        getConversations: () => conversations
    };
}
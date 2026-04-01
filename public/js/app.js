const API_URL = '/api/chat';
let conversationHistory = [];

// ─────────────────────────────────────────────
// HISTORY MANAGEMENT
// ─────────────────────────────────────────────

function addToHistory(role, content) {
    conversationHistory.push({ role, content });
    // Keep last 20 messages (10 turns)
    if (conversationHistory.length > 20) {
        conversationHistory = conversationHistory.slice(-20);
    }
}

function clearConversationHistory() {
    conversationHistory = [];
}

// ─────────────────────────────────────────────
// SEND MESSAGE
// ─────────────────────────────────────────────

async function sendMessage() {
    const input = document.getElementById('messageInput');
    const message = input.value.trim();
    const sendBtn = document.getElementById('sendBtn');

    if (!message) return;

    // Add to history BEFORE sending so server gets full context
    // (user message goes in now, assistant reply added after)
    addToHistory('user', message);

    sendBtn.disabled = true;
    sendBtn.textContent = '...';
    input.value = '';

    addMessage(message, 'user');
    const loadingId = addTypingIndicator(); // ← looks like real typing, not "Analyzing with AI..."

    try {
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message,
                history: conversationHistory.slice(0, -1) // send history *before* this message
                // server.js appends the current message itself
            })
        });

        if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);

        const data = await response.json();
        removeTypingIndicator(loadingId);

        if (data.success) {
            // Add assistant reply to history
            addToHistory('assistant', data.response);

            // Show Raya's conversational reply — nothing else in chat
            addMessage(data.response, 'ai');

            // Update side panel silently
            displayAnalysis(data);
            updateConnectionStatus(true);
        } else {
            // Remove the user message we added to history since it failed
            conversationHistory.pop();
            addMessage('Something went wrong — please try again.', 'ai');
            displayError(data.error);
        }

    } catch (error) {
        console.error('Error:', error);
        removeTypingIndicator(loadingId);
        conversationHistory.pop(); // roll back failed message
        addMessage('I lost connection for a moment — please try again.', 'ai');
        displayError(error.message);
        updateConnectionStatus(false);
    } finally {
        sendBtn.disabled = false;
        sendBtn.textContent = 'Send →';
        input.focus();
    }
}

// ─────────────────────────────────────────────
// CHAT UI
// ─────────────────────────────────────────────

function addMessage(text, sender) {
    const messagesDiv = document.getElementById('messages');
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${sender === 'user' ? 'user-message' : 'ai-message'}`;
 
    const senderLabel = sender === 'user' ? 'You' : 'Raya';
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
 
    messageDiv.innerHTML = `
        <div class="message-sender">${senderLabel}</div>
        <div class="message-bubble">${escapeHtml(text)}</div>
        <div class="message-time">${time}</div>`;
 
    messagesDiv.appendChild(messageDiv);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
    return messageDiv;
}
 

function addTypingIndicator() {
    const messagesDiv = document.getElementById('messages');
    const id = 'typing-' + Date.now();
    const div = document.createElement('div');
    div.className = 'message ai-message';
    div.id = id;
    div.innerHTML = `
        <div class="message-bubble typing-indicator">
            <span></span><span></span><span></span>
        </div>`;
    messagesDiv.appendChild(div);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
    return id;
}

function removeTypingIndicator(id) {
    const el = document.getElementById(id);
    if (el) el.remove();
}

function clearChat() {
    document.getElementById('messages').innerHTML = `
        <div class="message ai-message">
            <div class="message-bubble">
                Hey! 👋 I'm Raya, your PLAYBOOK guide.<br><br>
                What brings you here today? Whether you're looking to join, learn, invest, or connect — I'm here to help.
            </div>
        </div>`;
    clearConversationHistory();

    document.getElementById('analysisContent').innerHTML = `
        <div class="empty-state">
            💡 Send a message to see AI extraction and sales recommendations
        </div>`;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ─────────────────────────────────────────────
// ANALYSIS PANEL
// ─────────────────────────────────────────────

function displayAnalysis(data) {
    const analysisDiv = document.getElementById('analysisContent');

    let hubspotStatus = '';
    if (data.hubspot.success) {
        hubspotStatus = `<div class="status-badge status-success">✅ ${data.hubspot.message || 'HubSpot synced'}</div>`;
    } else if (data.hubspot.message?.includes('No email')) {
        hubspotStatus = `<div class="status-badge status-warning">⚠️ Waiting for email</div>`;
    } else {
        hubspotStatus = `<div class="status-badge status-error">❌ ${data.hubspot.message || 'HubSpot error'}</div>`;
    }

    const priorityColor = data.sales_output.priority === 'High' ? '🔴'
        : data.sales_output.priority === 'Medium' ? '🟡' : '🟢';
    const priorityClass = `priority-${data.sales_output.priority?.toLowerCase() || 'low'}`;

    analysisDiv.innerHTML = `
        <div class="analysis-section">
            <div class="analysis-title"><span>📋</span><span>Lead Data</span></div>
            <div class="analysis-box">
                <pre>${JSON.stringify(data.lead_data, null, 2)}</pre>
            </div>
        </div>

        <div class="analysis-section">
            <div class="analysis-title"><span>🎯</span><span>Sales Recommendations</span></div>
            <div class="analysis-box">
                <strong>Next Action</strong>
                <div class="recommendation-box">${escapeHtml(data.sales_output.recommended_next_action)}</div>

                <strong>Suggested Follow-up</strong>
                <div class="recommendation-box">${escapeHtml(data.sales_output.follow_up_message)}</div>

                <strong>Priority</strong>
                <div style="margin-top: 8px;">
                    <span class="priority-badge ${priorityClass}">${priorityColor} ${data.sales_output.priority}</span>
                </div>
            </div>
        </div>

        <div class="analysis-section">
            <div class="analysis-title"><span>🔄</span><span>HubSpot</span></div>
            <div class="analysis-box">
                ${hubspotStatus}
                <div class="meta-text">🕐 ${new Date(data.timestamp).toLocaleString()}</div>
                ${data.model_used ? `<div class="meta-text" style="margin-top:6px">🤖 ${data.model_used}</div>` : ''}
            </div>
        </div>`;
}

function displayError(error) {
    document.getElementById('analysisContent').innerHTML = `
        <div class="analysis-section">
            <div class="analysis-title"><span>❌</span><span>Error</span></div>
            <div class="analysis-box">
                <div class="status-badge status-error">${escapeHtml(error)}</div>
                <div class="meta-text" style="margin-top:12px">
                    • Is the server running? (<code>npm start</code>)<br>
                    • Check API keys in <code>.env</code>
                </div>
            </div>
        </div>`;
}

// ─────────────────────────────────────────────
// CONNECTION STATUS
// ─────────────────────────────────────────────

function updateConnectionStatus(connected) {
    const statusDiv = document.getElementById('connectionStatus');
    const statusIndicator = document.querySelector('.status-indicator span');
    const statusDot = document.querySelector('.status-dot');

    if (connected) {
        statusDiv.innerHTML = '✅ Connected';
        statusDiv.classList.remove('disconnected');
        if (statusIndicator) statusIndicator.textContent = 'AI Sales Copilot Active';
        if (statusDot) {
            statusDot.style.background = '#D1FC51';
            statusDot.style.boxShadow = '0 0 8px #D1FC51';
        }
    } else {
        statusDiv.innerHTML = '❌ Disconnected';
        statusDiv.classList.add('disconnected');
        if (statusIndicator) statusIndicator.textContent = 'Disconnected — Check Server';
        if (statusDot) {
            statusDot.style.background = '#EF4444';
            statusDot.style.boxShadow = '0 0 8px #EF4444';
        }
    }
}

async function testConnection() {
    try {
        const res = await fetch('/test');
        updateConnectionStatus(res.ok);
    } catch {
        updateConnectionStatus(false);
    }
}

// ─────────────────────────────────────────────
// QUICK EXAMPLE BUTTONS
// ─────────────────────────────────────────────

function setExample(text) {
    document.getElementById('messageInput').value = text;
    sendMessage();
}

// ─────────────────────────────────────────────
// THEME
// ─────────────────────────────────────────────

function initTheme() {
    const themeToggle = document.getElementById('themeToggle');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)');

    function setTheme(theme) {
        document.body.className = theme;
        localStorage.setItem('theme', theme);
        if (themeToggle) themeToggle.textContent = theme === 'dark-mode' ? '☀️' : '🌙';
    }

    function toggleTheme() {
        setTheme(document.body.className === 'dark-mode' ? 'light-mode' : 'dark-mode');
    }

    const saved = localStorage.getItem('theme') || (prefersDark.matches ? 'dark-mode' : 'light-mode');
    setTheme(saved);

    if (themeToggle) themeToggle.addEventListener('click', toggleTheme);
    prefersDark.addEventListener('change', e => {
        if (!localStorage.getItem('theme')) setTheme(e.matches ? 'dark-mode' : 'light-mode');
    });
}

// ─────────────────────────────────────────────
// INIT
// ─────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
    testConnection();
    setInterval(testConnection, 30000);
    initTheme();

    // Keyboard shortcuts
    document.addEventListener('keydown', e => {
        if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'D') { e.preventDefault(); document.getElementById('themeToggle')?.click(); }
        if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); clearChat(); }
        if ((e.ctrlKey || e.metaKey) && e.key === 'l') { e.preventDefault(); document.getElementById('messageInput').focus(); }
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); sendMessage(); }
    });
});

window.addEventListener('beforeunload', () => clearInterval());
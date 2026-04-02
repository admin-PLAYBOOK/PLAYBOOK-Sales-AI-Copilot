const API_URL = '/api/chat';
let conversationHistory = [];
let conversationId = null; // FIX: persist conversation ID across turns
let quickBtnsHidden = false;
let isSending = false; // FIX: prevent double-sends

// ─────────────────────────────────────────────
// HISTORY
// ─────────────────────────────────────────────

function addToHistory(role, content) {
    conversationHistory.push({ role, content });
    if (conversationHistory.length > 20) conversationHistory = conversationHistory.slice(-20);
}

// ─────────────────────────────────────────────
// SEND
// ─────────────────────────────────────────────

async function sendMessage() {
    if (isSending) return; // FIX: guard against double-send

    const input = document.getElementById('messageInput');
    const message = input.value.trim();
    const sendBtn = document.getElementById('sendBtn');
    if (!message) return;

    if (!quickBtnsHidden) {
        document.getElementById('quickBtns').style.display = 'none';
        quickBtnsHidden = true;
    }

    addToHistory('user', message);
    input.value = '';
    sendBtn.disabled = true;
    isSending = true;

    addMessage(message, 'user');
    const loadingId = addTypingIndicator();

    try {
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message,
                history: conversationHistory.slice(0, -1),
                conversationId // FIX: send persistent ID so server updates same record
            })
        });

        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        removeTypingIndicator(loadingId);

        if (data.success) {
            // FIX: store conversation ID returned by server on first turn
            if (!conversationId && data.conversation_id) {
                conversationId = data.conversation_id;
            }
            addToHistory('assistant', data.response);
            addMessage(data.response, 'ai');
        } else {
            conversationHistory.pop();
            addMessage('Something went wrong — please try again.', 'ai');
        }

    } catch (err) {
        removeTypingIndicator(loadingId);
        conversationHistory.pop();
        addMessage('Connection issue — please try again.', 'ai');
    } finally {
        sendBtn.disabled = false;
        isSending = false;
        input.focus();
    }
}

// ─────────────────────────────────────────────
// CHAT UI
// ─────────────────────────────────────────────

function addMessage(text, sender) {
    const messagesDiv = document.getElementById('messages');
    const div = document.createElement('div');
    div.className = `msg ${sender === 'user' ? 'msg-user' : 'msg-ai'}`;

    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    if (sender === 'ai') {
        div.innerHTML = `
            <div class="msg-avatar">L</div>
            <div class="msg-body">
                <div class="msg-bubble">${escapeHtml(text)}</div>
                <div class="msg-time">${time}</div>
            </div>`;
    } else {
        div.innerHTML = `
            <div class="msg-body">
                <div class="msg-bubble">${escapeHtml(text)}</div>
                <div class="msg-time">${time}</div>
            </div>`;
    }

    messagesDiv.appendChild(div);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

function addTypingIndicator() {
    const messagesDiv = document.getElementById('messages');
    const id = 'typing-' + Date.now();
    const div = document.createElement('div');
    div.className = 'msg msg-ai';
    div.id = id;
    div.innerHTML = `
        <div class="msg-avatar">L</div>
        <div class="msg-body">
            <div class="msg-bubble typing-indicator">
                <span></span><span></span><span></span>
            </div>
        </div>`;
    messagesDiv.appendChild(div);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
    return id;
}

function removeTypingIndicator(id) {
    document.getElementById(id)?.remove();
}

function setExample(text) {
    // FIX: don't call sendMessage if already sending
    if (isSending) return;
    document.getElementById('messageInput').value = text;
    sendMessage();
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ─────────────────────────────────────────────
// INIT
// ─────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
    addMessage("Hi, I'm Layla — your guide to PLAYBOOK. What are you looking to get out of the network?", 'ai');

    const input = document.getElementById('messageInput');
    input.focus();

    // FIX: also handle Enter key on the input element here (not just inline onkeypress)
    // This removes reliance on inline HTML event handlers for Enter key
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });
});
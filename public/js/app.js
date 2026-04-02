const API_URL = '/api/chat';

// ─────────────────────────────────────────────
// CHAT INSTANCE CLASS
// Each window gets its own independent instance
// ─────────────────────────────────────────────

class ChatInstance {
    constructor(containerId, instanceIndex) {
        this.containerId       = containerId;
        this.instanceIndex     = instanceIndex;
        this.conversationId    = null;
        this.conversationHistory = [];
        this.quickBtnsHidden   = false;
        this.isSending         = false;
    }

    // ── History ──

    addToHistory(role, content) {
        this.conversationHistory.push({ role, content });
        if (this.conversationHistory.length > 20)
            this.conversationHistory = this.conversationHistory.slice(-20);
    }

    // ── Persist to localStorage ──

    saveSession() {
        if (!this.conversationId) return;
        const key = `playbook_chat_${this.instanceIndex}`;
        localStorage.setItem(key, JSON.stringify({
            conversationId: this.conversationId,
            savedAt: Date.now()
        }));
    }

    loadSession() {
        const key  = `playbook_chat_${this.instanceIndex}`;
        const raw  = localStorage.getItem(key);
        if (!raw) return null;
        try {
            const data = JSON.parse(raw);
            // Expire sessions older than 24 hours
            if (Date.now() - data.savedAt > 24 * 60 * 60 * 1000) {
                localStorage.removeItem(key);
                return null;
            }
            return data.conversationId;
        } catch (_) { return null; }
    }

    clearSession() {
        localStorage.removeItem(`playbook_chat_${this.instanceIndex}`);
        this.conversationId      = null;
        this.conversationHistory = [];
        this.quickBtnsHidden     = false;
    }

    // ── Restore from DB ──

    async restoreFromDB(conversationId) {
        try {
            const res = await fetch(`/api/chat/${conversationId}`);
            if (!res.ok) return false;
            const data = await res.json();
            if (!data.history || data.history.length === 0) return false;

            this.conversationId      = conversationId;
            this.conversationHistory = data.history;

            const messagesEl = this.el('messages');
            messagesEl.innerHTML = '';

            // Hide quick buttons if conversation already started
            this.el('quickBtns').style.display = 'none';
            this.quickBtnsHidden = true;

            // Replay messages into the UI
            data.history.forEach(m => {
                this.renderMessage(m.content, m.role === 'user' ? 'user' : 'ai', false);
            });
            messagesEl.scrollTop = messagesEl.scrollHeight;
            return true;
        } catch (_) { return false; }
    }

    // ── DOM helper ──

    el(suffix) {
        return document.getElementById(`${this.containerId}-${suffix}`);
    }

    // ── Send ──

    async sendMessage() {
        if (this.isSending) return;

        const input   = this.el('input');
        const sendBtn = this.el('sendBtn');
        const message = input.value.trim();
        if (!message) return;

        if (!this.quickBtnsHidden) {
            this.el('quickBtns').style.display = 'none';
            this.quickBtnsHidden = true;
        }

        this.addToHistory('user', message);
        input.value      = '';
        sendBtn.disabled = true;
        this.isSending   = true;

        this.renderMessage(message, 'user');
        const loadingId = this.addTypingIndicator();

        try {
            const response = await fetch(API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message,
                    history:        this.conversationHistory.slice(0, -1),
                    conversationId: this.conversationId
                })
            });

            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json();
            this.removeTypingIndicator(loadingId);

            if (data.success) {
                if (!this.conversationId && data.conversation_id) {
                    this.conversationId = data.conversation_id;
                    this.saveSession();
                } else if (this.conversationId) {
                    this.saveSession(); // refresh savedAt timestamp
                }
                this.addToHistory('assistant', data.response);
                this.renderMessage(data.response, 'ai');
            } else {
                this.conversationHistory.pop();
                this.renderMessage('Something went wrong — please try again.', 'ai');
            }
        } catch (_) {
            this.removeTypingIndicator(loadingId);
            this.conversationHistory.pop();
            this.renderMessage('Connection issue — please try again.', 'ai');
        } finally {
            sendBtn.disabled = false;
            this.isSending   = false;
            input.focus();
        }
    }

    setExample(text) {
        if (this.isSending) return;
        this.el('input').value = text;
        this.sendMessage();
    }

    newChat() {
        this.clearSession();
        const messagesEl = this.el('messages');
        messagesEl.innerHTML = '';
        this.el('quickBtns').style.display = 'flex';
        this.renderMessage("Hi, I'm Layla — your guide to PLAYBOOK. What are you looking to get out of the network?", 'ai', false);
        this.el('input').focus();
    }

    // ── UI rendering ──

    renderMessage(text, sender, animate = true) {
        const messagesEl = this.el('messages');
        const div  = document.createElement('div');
        div.className = `msg ${sender === 'user' ? 'msg-user' : 'msg-ai'}`;
        if (!animate) div.style.animation = 'none';

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

        messagesEl.appendChild(div);
        messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    addTypingIndicator() {
        const messagesEl = this.el('messages');
        const id  = `typing-${this.containerId}-${Date.now()}`;
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
        messagesEl.appendChild(div);
        messagesEl.scrollTop = messagesEl.scrollHeight;
        return id;
    }

    removeTypingIndicator(id) {
        document.getElementById(id)?.remove();
    }

    // ── Build DOM for this chat window ──

    buildDOM() {
        const cid = this.containerId;
        const idx = this.instanceIndex;

        const wrap = document.createElement('div');
        wrap.className = 'client-wrap';
        wrap.id = cid;

        wrap.innerHTML = `
            <div class="client-header">
                <div class="client-avatar" aria-hidden="true">L</div>
                <div class="client-header-text">
                    <div class="client-name">Layla</div>
                    <div class="client-status"><span class="status-dot" aria-hidden="true"></span> Online</div>
                </div>
                <div class="chat-header-actions">
                    <button class="new-chat-btn" id="${cid}-newChatBtn" title="Start a new conversation" aria-label="New chat">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>
                        New
                    </button>
                    ${idx > 0 ? `<button class="close-chat-btn" id="${cid}-closeBtn" title="Close this chat window" aria-label="Close chat">✕</button>` : ''}
                </div>
            </div>

            <div class="client-messages" id="${cid}-messages" role="log" aria-live="polite" aria-label="Chat messages"></div>

            <div class="client-input-wrap">
                <div class="quick-btns" id="${cid}-quickBtns" role="group" aria-label="Quick message suggestions">
                    <button class="quick-btn" data-chat="${cid}" data-text="I want to join PLAYBOOK as a member">✨ Join</button>
                    <button class="quick-btn" data-chat="${cid}" data-text="Tell me about investing through Women Spark">💰 Invest</button>
                    <button class="quick-btn" data-chat="${cid}" data-text="What masterclasses do you offer?">📚 Learn</button>
                    <button class="quick-btn" data-chat="${cid}" data-text="I'm looking for mentorship">🌟 Connect</button>
                </div>
                <div class="client-input-row">
                    <input type="text" id="${cid}-input" placeholder="Message Layla..." autocomplete="off" aria-label="Type your message">
                    <button id="${cid}-sendBtn" aria-label="Send message">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                            <path d="M22 2L11 13" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                            <path d="M22 2L15 22L11 13L2 9L22 2Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                        </svg>
                    </button>
                </div>
                <div class="client-footer">Powered by PLAYBOOK</div>
            </div>`;

        return wrap;
    }

    // ── Wire up events ──

    bindEvents() {
        const cid = this.containerId;

        // Send button
        this.el('sendBtn').addEventListener('click', () => this.sendMessage());

        // Enter key
        this.el('input').addEventListener('keydown', e => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.sendMessage(); }
        });

        // Quick buttons (delegated)
        this.el('quickBtns').addEventListener('click', e => {
            const btn = e.target.closest('[data-text]');
            if (btn) this.setExample(btn.dataset.text);
        });

        // New chat
        this.el('newChatBtn').addEventListener('click', () => this.newChat());

        // Close (only non-first windows)
        const closeBtn = this.el('closeBtn');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                // Remove DOM + instance from manager
                ChatManager.removeInstance(this.instanceIndex);
            });
        }
    }
}

// ─────────────────────────────────────────────
// CHAT MANAGER — owns all windows
// ─────────────────────────────────────────────

const ChatManager = {
    instances: [],
    maxChats: 3,

    async init() {
        const stage = document.getElementById('chatStage');

        // Always restore or create the first chat
        const first = this.createInstance(stage, true);
        await first;

        // Add-chat button
        document.getElementById('addChatBtn').addEventListener('click', () => {
            this.addNewWindow();
        });

        // Update button visibility
        this.updateAddButton();
    },

    async createInstance(stage, isFirst = false) {
        const idx       = this.instances.length;
        const cid       = `chat-${idx}`;
        const instance  = new ChatInstance(cid, idx);

        this.instances.push(instance);

        const dom = instance.buildDOM();
        stage.appendChild(dom);
        instance.bindEvents();

        // Try to restore previous session
        const savedId = instance.loadSession();
        let restored  = false;

        if (savedId) {
            restored = await instance.restoreFromDB(savedId);
        }

        if (!restored) {
            instance.renderMessage(
                "Hi, I'm Layla — your guide to PLAYBOOK. What are you looking to get out of the network?",
                'ai', false
            );
        }

        instance.el('input').focus();
        return instance;
    },

    async addNewWindow() {
        if (this.instances.length >= this.maxChats) return;
        const stage = document.getElementById('chatStage');
        await this.createInstance(stage, false);
        this.updateAddButton();
        // scroll new window into view on mobile
        stage.lastElementChild?.scrollIntoView({ behavior: 'smooth', inline: 'end' });
    },

    removeInstance(idx) {
        const instance = this.instances.find(i => i.instanceIndex === idx);
        if (!instance) return;
        instance.clearSession();
        document.getElementById(instance.containerId)?.remove();
        this.instances = this.instances.filter(i => i.instanceIndex !== idx);
        this.updateAddButton();
    },

    updateAddButton() {
        const btn = document.getElementById('addChatBtn');
        if (!btn) return;
        const atMax = this.instances.length >= this.maxChats;
        btn.disabled = atMax;
        btn.title    = atMax ? `Maximum ${this.maxChats} chats open at once` : 'Open another chat window';
    }
};

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ─────────────────────────────────────────────
// BOOT
// ─────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => ChatManager.init());
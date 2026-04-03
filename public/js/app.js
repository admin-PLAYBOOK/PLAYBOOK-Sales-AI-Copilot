const API_URL = '/api/chat';

// ─────────────────────────────────────────────
// CHAT INSTANCE CLASS
// Each tab gets its own independent instance
// ─────────────────────────────────────────────

class ChatInstance {
    constructor(containerId, instanceIndex) {
        this.containerId         = containerId;
        this.instanceIndex       = instanceIndex;
        this.conversationId      = null;
        this.conversationHistory = [];
        this.quickBtnsHidden     = false;
        this.isSending           = false;
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
        const key = `playbook_chat_${this.instanceIndex}`;
        const raw = localStorage.getItem(key);
        if (!raw) return null;
        try {
            const data = JSON.parse(raw);
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

            this.el('quickBtns').style.display = 'none';
            const hint = this.el('quickBtns').previousElementSibling;
            if (hint?.classList.contains('quick-btns-hint')) hint.style.display = 'none';
            this.quickBtnsHidden = true;

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
            const hint = this.el('quickBtns').previousElementSibling;
            if (hint?.classList.contains('quick-btns-hint')) hint.style.display = 'none';
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
                    this.saveSession();
                }
                const formattedResponse = marked.parse(data.response);
                this.addToHistory('assistant', data.response);
                this.renderMessage(formattedResponse, 'ai');
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
        const hint = this.el('quickBtns').previousElementSibling;
        if (hint?.classList.contains('quick-btns-hint')) hint.style.display = 'block';
        this.renderMessage(
            "Hi, I'm Layla — your guide to PLAYBOOK. What are you looking to get out of the network?",
            'ai', false
        );
        this.el('input').focus();
        ChatManager.updateTabLabel(this.instanceIndex, null);
    }

    // ── UI rendering ──

    renderMessage(text, sender, animate = true) {
        const messagesEl = this.el('messages');
        const div = document.createElement('div');
        div.className = `msg ${sender === 'user' ? 'msg-user' : 'msg-ai'}`;
        if (!animate) div.style.animation = 'none';

        const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        if (sender === 'ai') {
            div.innerHTML = `
                <div class="msg-avatar">L</div>
                <div class="msg-body">
                    <div class="msg-bubble">${text}</div>
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

    // ── Build DOM for this tab's chat panel ──

    buildDOM() {
        const cid   = this.containerId;
        const panel = document.createElement('div');
        panel.className = 'tab-panel';
        panel.id        = `panel-${cid}`;

        panel.innerHTML = `
            <div class="client-wrap">
                <div class="client-header">
                    <div class="client-avatar" aria-hidden="true">L</div>
                    <div class="client-header-text">
                        <div class="client-name">Layla</div>
                        <div class="client-status">
                            <span class="status-dot" aria-hidden="true"></span> Online
                        </div>
                    </div>
                    <button class="clear-chat-btn" id="${cid}-clearBtn" aria-label="Clear chat">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                            <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                        </svg>
                        Clear
                    </button>
                    <div class="client-logo">PLAYBOOK</div>
                </div>

                <div class="client-messages" id="${cid}-messages"
                     role="log" aria-live="polite" aria-label="Chat messages"></div>

                <div class="client-input-wrap">
                    <div class="quick-btns-hint">Not sure where to start? Try one of these:</div>
                    <div class="quick-btns" id="${cid}-quickBtns"
                         role="group" aria-label="Quick message suggestions">
                        <button class="quick-btn" data-text="I want to join PLAYBOOK as a member">✨ Join</button>
                        <button class="quick-btn" data-text="Tell me about investing through Women Spark">💰 Invest</button>
                        <button class="quick-btn" data-text="What masterclasses do you offer?">📚 Learn</button>
                        <button class="quick-btn" data-text="I'm looking for mentorship">🌟 Connect</button>
                    </div>
                    <div class="client-input-row">
                        <input type="text" id="${cid}-input"
                               placeholder="Message Layla…" autocomplete="off"
                               aria-label="Type your message">
                        <button id="${cid}-sendBtn" aria-label="Send message">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                                <path d="M22 2L11 13" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                                <path d="M22 2L15 22L11 13L2 9L22 2Z" stroke="currentColor" stroke-width="2"
                                      stroke-linecap="round" stroke-linejoin="round"/>
                            </svg>
                        </button>
                    </div>
                    <div class="client-footer">Powered by PLAYBOOK</div>
                </div>
            </div>`;

        return panel;
    }

    // ── Wire up events ──

    bindEvents() {
        this.el('sendBtn').addEventListener('click', () => this.sendMessage());

        this.el('input').addEventListener('keydown', e => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.sendMessage(); }
        });

        this.el('quickBtns').addEventListener('click', e => {
            const btn = e.target.closest('[data-text]');
            if (btn) this.setExample(btn.dataset.text);
        });

        this.el('clearBtn').addEventListener('click', () => this.newChat());
    }
}

// ─────────────────────────────────────────────
// CHAT MANAGER — owns all tabs
// ─────────────────────────────────────────────

const ChatManager = {
    instances:   [],
    activeIndex: 0,
    maxChats:    4,

    async init() {
        await this.createInstance(true);

        document.getElementById('addChatBtn').addEventListener('click', () => {
            this.addNewTab();
        });

        this.updateAddButton();
    },

    async createInstance(isFirst = false) {
        const idx      = this.instances.length;
        const cid      = `chat-${idx}`;
        const instance = new ChatInstance(cid, idx);
        this.instances.push(instance);

        // ── Tab button ──
        const tabBar = document.getElementById('tabBar');
        const tabBtn = document.createElement('button');
        tabBtn.className           = 'tab-btn' + (isFirst ? ' tab-active' : '');
        tabBtn.id                  = `tab-btn-${idx}`;
        tabBtn.dataset.idx         = idx;
        tabBtn.setAttribute('role', 'tab');
        tabBtn.setAttribute('aria-selected', isFirst ? 'true' : 'false');
        tabBtn.setAttribute('aria-controls', `panel-${cid}`);

        tabBtn.innerHTML = `
            <span class="tab-label" id="tab-label-${idx}">Chat ${idx + 1}</span>
            ${idx > 0
                ? `<span class="tab-close" data-idx="${idx}" aria-label="Close tab ${idx + 1}" role="button" tabindex="0">✕</span>`
                : ''}
        `;
        tabBar.appendChild(tabBtn);

        // ── Panel ──
        const panelWrap = document.getElementById('panelWrap');
        const panel     = instance.buildDOM();
        panel.style.display = isFirst ? 'flex' : 'none';
        panelWrap.appendChild(panel);

        instance.bindEvents();

        // ── Tab switch on click ──
        tabBtn.addEventListener('click', e => {
            if (e.target.closest('.tab-close')) return;
            this.switchTab(idx);
        });

        // ── Close button ──
        const closeSpan = tabBtn.querySelector('.tab-close');
        if (closeSpan) {
            closeSpan.addEventListener('click', e => {
                e.stopPropagation();
                this.removeTab(idx);
            });
            closeSpan.addEventListener('keydown', e => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    e.stopPropagation();
                    this.removeTab(idx);
                }
            });
        }

        // ── Restore session or show greeting ──
        const savedId = instance.loadSession();
        let restored  = false;
        if (savedId) restored = await instance.restoreFromDB(savedId);

        if (!restored) {
            instance.renderMessage(
                "Hi, I'm Layla — your guide to PLAYBOOK. What are you looking to get out of the network?",
                'ai', false
            );
        }

        // Switch to this tab (auto-focuses input)
        if (!isFirst) this.switchTab(idx);
        else instance.el('input').focus();

        return instance;
    },

    async addNewTab() {
        if (this.instances.length >= this.maxChats) return;
        await this.createInstance(false);
        this.updateAddButton();
    },

    switchTab(idx) {
        this.instances.forEach(inst => {
            const panel = document.getElementById(`panel-${inst.containerId}`);
            if (panel) panel.style.display = 'none';

            const btn = document.getElementById(`tab-btn-${inst.instanceIndex}`);
            if (btn) {
                btn.classList.remove('tab-active');
                btn.setAttribute('aria-selected', 'false');
            }
        });

        const target = this.instances.find(i => i.instanceIndex === idx);
        if (!target) return;

        const panel = document.getElementById(`panel-${target.containerId}`);
        if (panel) panel.style.display = 'flex';

        const btn = document.getElementById(`tab-btn-${idx}`);
        if (btn) {
            btn.classList.add('tab-active');
            btn.setAttribute('aria-selected', 'true');
        }

        this.activeIndex = idx;
        target.el('input').focus();
    },

    removeTab(idx) {
        if (idx === 0) return; // first tab is permanent

        const instance = this.instances.find(i => i.instanceIndex === idx);
        if (!instance) return;

        instance.clearSession();
        document.getElementById(`panel-${instance.containerId}`)?.remove();
        document.getElementById(`tab-btn-${idx}`)?.remove();

        this.instances = this.instances.filter(i => i.instanceIndex !== idx);

        // If we closed the active tab, switch to the last remaining one
        if (this.activeIndex === idx) {
            const last = this.instances[this.instances.length - 1];
            if (last) this.switchTab(last.instanceIndex);
        }

        this.updateAddButton();
    },

    // Rename a tab label (call this once a user's name is known, if desired)
    updateTabLabel(idx, name) {
        const label = document.getElementById(`tab-label-${idx}`);
        if (label) label.textContent = name || `Chat ${idx + 1}`;
    },

    updateAddButton() {
        const btn = document.getElementById('addChatBtn');
        if (!btn) return;
        const atMax  = this.instances.length >= this.maxChats;
        btn.disabled = atMax;
        btn.title    = atMax
            ? `Maximum ${this.maxChats} chats open`
            : 'Open a new chat tab';
    }
};

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = String(text || '');
    return div.innerHTML;
}

// ─────────────────────────────────────────────
// BOOT
// ─────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => ChatManager.init());
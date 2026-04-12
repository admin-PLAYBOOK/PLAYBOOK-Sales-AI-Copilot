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
        // Persisted lead data — sent back with each request so server
        // can do incremental extraction instead of re-inferring everything
        this.leadData            = {};
        // Language preference — 'en' or 'ar'
        this.language            = 'en';
    }

    // ── History ──

    addToHistory(role, content) {
        this.conversationHistory.push({ role, content });
        if (this.conversationHistory.length > 30)
            this.conversationHistory = this.conversationHistory.slice(-30);
    }

    // ── Persist to localStorage ──

    saveSession() {
        if (!this.conversationId) return;
        const key = `playbook_chat_${this.instanceIndex}`;
        localStorage.setItem(key, JSON.stringify({
            conversationId: this.conversationId,
            leadData:       this.leadData,
            savedAt:        Date.now(),
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
            if (data.leadData) this.leadData = data.leadData;
            return data.conversationId;
        } catch (_) { return null; }
    }

    clearSession() {
        localStorage.removeItem(`playbook_chat_${this.instanceIndex}`);
        this.conversationId      = null;
        this.conversationHistory = [];
        this.quickBtnsHidden     = false;
        this.leadData            = {};
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
            const hint = this.el('quickBtns')?.previousElementSibling;
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

    // ── Send (streaming) ──

    async sendMessage() {
        if (this.isSending) return;

        const input   = this.el('input');
        const sendBtn = this.el('sendBtn');
        const message = input.value.trim();
        if (!message) return;

        if (!this.quickBtnsHidden) {
            this.el('quickBtns').style.display = 'none';
            const hint = this.el('quickBtns')?.previousElementSibling;
            if (hint?.classList.contains('quick-btns-hint')) hint.style.display = 'none';
            this.quickBtnsHidden = true;
        }

        this.addToHistory('user', message);
        input.value      = '';
        input.disabled   = true;
        sendBtn.disabled = true;
        this.isSending   = true;

        this.renderMessage(message, 'user');

        // Create the AI bubble early so we can stream into it
        const aiMsgEl = this.createStreamingBubble();

        try {
            const response = await fetch(API_URL, {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({
                    message,
                    history:        this.conversationHistory.slice(0, -1),
                    conversationId: this.conversationId,
                    leadData:       this.leadData,
                    language:       this.language,
                }),
            });

            if (!response.ok) throw new Error(`HTTP ${response.status}`);

            // ── Read SSE stream ──
            const reader  = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer    = '';
            let fullText  = '';
            const bubble  = aiMsgEl.querySelector('.msg-bubble');

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop();

                for (const line of lines) {
                    if (!line.startsWith('data: ')) continue;
                    const payload = line.slice(6).trim();
                    if (!payload) continue;

                    try {
                        const evt = JSON.parse(payload);

                        if (evt.token !== undefined) {
                            fullText += evt.token;
                            // During streaming, render as plain text to avoid
                            // broken image markdown on partial chunks
                            bubble.innerHTML = escapeHtml(fullText);
                            this.el('messages').scrollTop = this.el('messages').scrollHeight;
                        }

                        if (evt.conversation_id && !this.conversationId) {
                            this.conversationId = evt.conversation_id;
                            this.saveSession();
                        }

                        if (evt.done) {
                            // Stream complete — now parse full markdown including images
                            if (typeof marked !== 'undefined') {
                                bubble.innerHTML = marked.parse(fullText);
                            }
                            this.el('messages').scrollTop = this.el('messages').scrollHeight;
                            // Commit to history
                            this.addToHistory('assistant', fullText);
                            // Seed leadData with whatever the server echoed back (pre-extraction)
                            if (evt.leadData) {
                                this.leadData = { ...this.leadData, ...evt.leadData };
                                if (evt.leadData.name) {
                                    ChatManager.updateTabLabel(this.instanceIndex, evt.leadData.name);
                                }
                            }
                        }

                        // lead_update arrives after extraction completes — update with fresh data
                        if (evt.lead_update && evt.leadData) {
                            this.leadData = { ...this.leadData, ...evt.leadData };
                            if (evt.leadData.name) {
                                ChatManager.updateTabLabel(this.instanceIndex, evt.leadData.name);
                            }
                        }

                        if (evt.error) {
                            bubble.innerHTML = escapeHtml(evt.error);
                            this.conversationHistory.pop(); // remove the user turn we speculatively added
                        }
                    } catch (_) { /* malformed line — skip */ }
                }
            }

            // Final scroll
            this.el('messages').scrollTop = this.el('messages').scrollHeight;

        } catch (_) {
            const bubble = aiMsgEl.querySelector('.msg-bubble');
            if (bubble) bubble.textContent = 'Connection issue — please try again.';
            this.conversationHistory.pop();
        } finally {
            sendBtn.disabled = false;
            input.disabled   = false;
            this.isSending   = false;
            input.focus();
        }
    }

    setExample(text) {
        if (this.isSending) return;
        this.el('input').value = text;
        this.sendMessage();
    }

    setLanguage(lang) {
        this.language = lang;
        
        // Update toggle button label
        const btn = this.el('langToggle');
        if (btn) {
            btn.textContent = lang === 'en' ? 'العربية' : 'English';
        }
        
        // Update input placeholder and panel direction
        const input = this.el('input');
        const panel = document.getElementById(`panel-${this.containerId}`);
        
        // Get quick buttons elements
        const quickBtnsWrapper = this.el('quickBtns');
        const quickBtnsHint = quickBtnsWrapper?.previousElementSibling;
        
        if (lang === 'ar') {
            if (input) input.placeholder = 'راسلي ليلى…';
            if (panel) panel.setAttribute('dir', 'rtl');
            
            // Update hint text
            if (quickBtnsHint && quickBtnsHint.classList.contains('quick-btns-hint')) {
                quickBtnsHint.textContent = 'لست متأكدة من أين تبدأين؟ جربي أحد هذه الخيارات:';
            }
            
            // Update quick button texts
            if (quickBtnsWrapper) {
                const btns = quickBtnsWrapper.querySelectorAll('.quick-btn');
                if (btns.length >= 4) {
                    btns[0].innerHTML = '✨ العضوية';
                    btns[1].innerHTML = '💰 الاستثمار';
                    btns[2].innerHTML = '📚 الدروس';
                    btns[3].innerHTML = '🌟 الإرشاد';
                }
            }
            
            // Update welcome message if it's the initial English greeting
            const messagesEl = this.el('messages');
            const firstMessage = messagesEl.children[0];
            if (firstMessage && firstMessage.querySelector('.msg-bubble')?.innerText.includes("Hi, I'm Layla")) {
                messagesEl.innerHTML = '';
                this.renderMessage(
                    "أهلاً، أنا ليلى — أساعدك في إيجاد ما تحتاجينه في PLAYBOOK، سواء كان درساً متقدماً، تعارفاً مع شخص في مجالك، أو الدخول في عالم الاستثمار الملائكي. بماذا تفكرين؟",
                    'ai', false
                );
            }
        } else {
            if (input) input.placeholder = 'Message Layla…';
            if (panel) panel.removeAttribute('dir');
            
            // Update hint text
            if (quickBtnsHint && quickBtnsHint.classList.contains('quick-btns-hint')) {
                quickBtnsHint.textContent = 'Not sure where to start? Try one of these:';
            }
            
            // Update quick button texts
            if (quickBtnsWrapper) {
                const btns = quickBtnsWrapper.querySelectorAll('.quick-btn');
                if (btns.length >= 4) {
                    btns[0].innerHTML = '✨ Join';
                    btns[1].innerHTML = '💰 Invest';
                    btns[2].innerHTML = '📚 Learn';
                    btns[3].innerHTML = '🌟 Connect';
                }
            }
            
            // Update welcome message if it's the Arabic greeting
            const messagesEl = this.el('messages');
            const firstMessage = messagesEl.children[0];
            if (firstMessage && firstMessage.querySelector('.msg-bubble')?.innerText.includes("أهلاً، أنا ليلى")) {
                messagesEl.innerHTML = '';
                this.renderMessage(
                    "Hi, I'm Layla — I help women find what they need inside PLAYBOOK, whether that's the right masterclass, an intro to someone in their industry, or getting into angel investing. What's on your mind?",
                    'ai', false
                );
            }
        }
    }

    newChat() {
        this.clearSession();
        const messagesEl = this.el('messages');
        messagesEl.innerHTML = '';
        this.el('quickBtns').style.display = 'flex';
        const hint = this.el('quickBtns')?.previousElementSibling;
        if (hint?.classList.contains('quick-btns-hint')) hint.style.display = 'block';
        
        // Use language-appropriate greeting
        const greeting = this.language === 'ar'
            ? "أهلاً، أنا ليلى — أساعدك في إيجاد ما تحتاجينه في PLAYBOOK، سواء كان درساً متقدماً، تعارفاً مع شخص في مجالك، أو الدخول في عالم الاستثمار الملائكي. بماذا تفكرين؟"
            : "Hi, I'm Layla — I help women find what they need inside PLAYBOOK, whether that's the right masterclass, an intro to someone in their industry, or getting into angel investing. What's on your mind?";
        
        this.renderMessage(greeting, 'ai', false);
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
                <div class="msg-avatar"><img src="/images/layla_pfp1.png" alt="Layla" class="avatar-img"></div>
                <div class="msg-body">
                    <div class="msg-bubble">${typeof marked !== 'undefined' ? marked.parse(text) : escapeHtml(text)}</div>
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
        return div;
    }

    /**
     * Create an empty AI bubble with a typing indicator.
     * Returns the message element so the caller can stream tokens into it.
     */
    createStreamingBubble() {
        const messagesEl = this.el('messages');
        const div = document.createElement('div');
        div.className = 'msg msg-ai';

        const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        div.innerHTML = `
            <div class="msg-avatar"><img src="/images/layla_pfp1.png" alt="Layla" class="avatar-img"></div>
            <div class="msg-body">
                <div class="msg-bubble">
                    <span class="typing-indicator"><span></span><span></span><span></span></span>
                </div>
                <div class="msg-time">${time}</div>
            </div>`;

        messagesEl.appendChild(div);
        messagesEl.scrollTop = messagesEl.scrollHeight;
        return div;
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
                    <div class="client-avatar" aria-hidden="true"><img src="/images/layla_pfp1.png" alt="Layla" class="avatar-img"></div>
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
                    <button class="lang-toggle-btn" id="${cid}-langToggle" aria-label="Toggle language">العربية</button>
                    <div class="client-logo">PLAYBOOK</div>
                </div>

                <div class="client-messages" id="${cid}-messages"
                     role="log" aria-live="polite" aria-label="Chat messages"></div>

                <div class="client-input-wrap">
                    <div class="quick-btns-hint">Not sure where to start? Try one of these:</div>
                    <div class="quick-btns" id="${cid}-quickBtns"
                         role="group" aria-label="Quick message suggestions">
                        <button class="quick-btn" data-text="I'm thinking about joining — what do I actually get?">✨ Membership</button>
                        <button class="quick-btn" data-text="I'm curious about angel investing through Women Spark">💰 Investing</button>
                        <button class="quick-btn" data-text="I want to learn new skills — what masterclasses do you have?">📚 Masterclasses</button>
                        <button class="quick-btn" data-text="I'm looking for a mentor or to expand my network">🌟 Mentorship</button>
                    </div>
                    <div class="client-input-row">
                        <input type="text" id="${cid}-input"
                               placeholder="Message Layla…" autocomplete="off"
                               aria-label="Type your message" maxlength="2000">
                        <button id="${cid}-sendBtn" aria-label="Send message">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                                <path d="M22 2L11 13" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                                <path d="M22 2L15 22L11 13L2 9L22 2Z" stroke="currentColor" stroke-width="2"
                                      stroke-linecap="round" stroke-linejoin="round"/>
                            </svg>
                        </button>
                    </div>
                    <div class="input-meta-row">
                        <span class="char-counter" id="${cid}-charCount" aria-live="polite"></span>
                        <div class="client-footer">Powered by PLAYBOOK</div>
                    </div>
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

        // Character counter
        this.el('input').addEventListener('input', () => {
            const len     = this.el('input').value.length;
            const counter = this.el('charCount');
            if (!counter) return;
            if (len >= 1800) {
                counter.textContent = `${len}/2000`;
                counter.style.color = len >= 1950 ? 'var(--color-error, #e74c3c)' : 'var(--color-warning, #f39c12)';
            } else {
                counter.textContent = '';
            }
        });

        this.el('quickBtns').addEventListener('click', e => {
            const btn = e.target.closest('[data-text]');
            if (btn) this.setExample(btn.dataset.text);
        });

        this.el('clearBtn').addEventListener('click', () => this.newChat());

        this.el('langToggle').addEventListener('click', () => {
            const next = this.language === 'en' ? 'ar' : 'en';
            this.setLanguage(next);
        });
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
                "Hi, I'm Layla — I help women find what they need inside PLAYBOOK, whether that's the right masterclass, an intro to someone in their industry, or getting into angel investing. What's on your mind?",
                'ai', false
            );
        }

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
        if (idx === 0) return;

        const instance = this.instances.find(i => i.instanceIndex === idx);
        if (!instance) return;

        instance.clearSession();
        document.getElementById(`panel-${instance.containerId}`)?.remove();
        document.getElementById(`tab-btn-${idx}`)?.remove();

        this.instances = this.instances.filter(i => i.instanceIndex !== idx);

        if (this.activeIndex === idx) {
            const last = this.instances[this.instances.length - 1];
            if (last) this.switchTab(last.instanceIndex);
        }

        this.updateAddButton();
    },

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
    },
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
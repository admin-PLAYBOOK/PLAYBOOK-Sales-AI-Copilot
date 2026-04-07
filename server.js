require('dotenv').config();
const express = require('express');
const axios   = require('axios');
const { v4: uuidv4 } = require('uuid');
const db   = require('./db');
const path = require('path');
const { SYSTEM_PROMPT, EXTRACTION_SYSTEM, buildExtractionPrompt, shouldExtract } = require('./prompts');

const app = express();
app.use(express.json());
app.use(express.static('public'));

const CLAUDE_API_KEY  = process.env.CLAUDE_API_KEY;
const HUBSPOT_TOKEN   = process.env.HUBSPOT_ACCESS_TOKEN;
const HUBSPOT_LIST_ID = process.env.HUBSPOT_LIST_ID;
const ADMIN_TOKEN     = process.env.ADMIN_TOKEN;

// ─────────────────────────────────────────────
// CLAUDE API
// ─────────────────────────────────────────────

const CLAUDE_MODEL    = 'claude-haiku-4-5-20251001';
const FALLBACK_MODELS = ['claude-sonnet-4-6', 'claude-opus-4-6'];

/**
 * Non-streaming call — used for extraction only.
 */
async function callClaude(systemPrompt, messages, maxTokens = 600) {
    for (const model of [CLAUDE_MODEL, ...FALLBACK_MODELS]) {
        try {
            const response = await axios.post(
                'https://api.anthropic.com/v1/messages',
                { model, max_tokens: maxTokens, system: systemPrompt, messages },
                {
                    headers: {
                        'x-api-key':           CLAUDE_API_KEY,
                        'anthropic-version':   '2023-06-01',
                        'content-type':        'application/json',
                    },
                }
            );
            return { text: response.data.content[0].text, model };
        } catch (error) {
            const msg = error.response?.data?.error?.message || error.message;
            console.log(`   ❌ ${model}: ${msg}`);
            if (msg.includes('authentication') || msg.includes('api_key')) throw error;
        }
    }
    throw new Error('All Claude models failed');
}

/**
 * Streaming call — pipes Server-Sent Events directly to the response.
 * Resolves with { fullText, model } once the stream ends.
 */
async function callClaudeStream(systemPrompt, messages, res, maxTokens = 600) {
    for (const model of [CLAUDE_MODEL, ...FALLBACK_MODELS]) {
        try {
            const response = await axios.post(
                'https://api.anthropic.com/v1/messages',
                { model, max_tokens: maxTokens, system: systemPrompt, messages, stream: true },
                {
                    headers: {
                        'x-api-key':           CLAUDE_API_KEY,
                        'anthropic-version':   '2023-06-01',
                        'content-type':        'application/json',
                    },
                    responseType: 'stream',
                }
            );

            return await new Promise((resolve, reject) => {
                let fullText = '';
                let buffer   = '';

                response.data.on('data', chunk => {
                    buffer += chunk.toString();
                    const lines = buffer.split('\n');
                    buffer = lines.pop(); // keep incomplete line

                    for (const line of lines) {
                        if (!line.startsWith('data: ')) continue;
                        const payload = line.slice(6).trim();
                        if (payload === '[DONE]') continue;

                        try {
                            const evt = JSON.parse(payload);

                            if (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta') {
                                const token = evt.delta.text;
                                fullText += token;
                                res.write(`data: ${JSON.stringify({ token })}\n\n`);
                            }

                            if (evt.type === 'message_stop') {
                                resolve({ fullText, model });
                            }
                        } catch (_) { /* malformed SSE line — skip */ }
                    }
                });

                response.data.on('end',   () => resolve({ fullText, model }));
                response.data.on('error', reject);
            });

        } catch (error) {
            const msg = error.response?.data?.error?.message || error.message;
            console.log(`   ❌ ${model} (stream): ${msg}`);
            if (msg.includes('authentication') || msg.includes('api_key')) throw error;
        }
    }
    throw new Error('All Claude models failed');
}

// ─────────────────────────────────────────────
// INPUT VALIDATION
// ─────────────────────────────────────────────

function sanitizeMessage(msg) {
    if (typeof msg !== 'string') return '';
    return msg.trim().slice(0, 2000);
}

function isValidHistory(history) {
    if (!Array.isArray(history)) return false;
    return history.every(m =>
        m && typeof m.role === 'string' && typeof m.content === 'string' &&
        ['user', 'assistant'].includes(m.role)
    );
}

// ─────────────────────────────────────────────
// RATE LIMITING — per IP and per conversation
// ─────────────────────────────────────────────

const ipRateMap   = new Map(); // IP     → { count, resetAt }
const convRateMap = new Map(); // convId → { count, resetAt }

setInterval(() => {
    const now = Date.now();
    for (const [k, v] of ipRateMap.entries())   if (now > v.resetAt) ipRateMap.delete(k);
    for (const [k, v] of convRateMap.entries()) if (now > v.resetAt) convRateMap.delete(k);
}, 5 * 60 * 1000);

function checkRateLimit(map, key, maxRequests, windowMs = 60_000) {
    const now   = Date.now();
    const entry = map.get(key) || { count: 0, resetAt: now + windowMs };
    if (now > entry.resetAt) { entry.count = 0; entry.resetAt = now + windowMs; }
    entry.count++;
    map.set(key, entry);
    return entry.count <= maxRequests;
}

// ─────────────────────────────────────────────
// ADMIN AUTH — DB-backed sessions
// ─────────────────────────────────────────────

const adminSessionsFallback = new Set();

function parseCookies(req) {
    const header = req.headers.cookie || '';
    return Object.fromEntries(
        header.split(';').map(c => {
            const i = c.trim().indexOf('=');
            return i < 0
                ? [decodeURIComponent(c.trim()), '']
                : [decodeURIComponent(c.trim().slice(0, i)), decodeURIComponent(c.trim().slice(i + 1))];
        })
    );
}

app.post('/api/admin/login', express.json(), async (req, res) => {
    const { password } = req.body || {};
    if (!password || password !== ADMIN_TOKEN)
        return res.status(401).json({ error: 'Incorrect password' });

    const sessionId = uuidv4();
    const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000);

    try {
        await db.createSession(sessionId, expiresAt);
    } catch (e) {
        console.warn('⚠️ Session DB save failed, using memory:', e.message);
        adminSessionsFallback.add(sessionId);
    }

    res.cookie('admin_session', sessionId, {
        httpOnly: true, sameSite: 'strict',
        maxAge: 8 * 60 * 60 * 1000, path: '/',
    });
    res.json({ success: true });
});

app.post('/api/admin/logout', async (req, res) => {
    const sid = parseCookies(req)['admin_session'];
    if (sid) {
        try { await db.deleteSession(sid); } catch (_) {}
        adminSessionsFallback.delete(sid);
    }
    res.clearCookie('admin_session');
    res.json({ success: true });
});

async function requireAdminSession(req, res, next) {
    const sid = parseCookies(req)['admin_session'];
    if (!sid) return res.status(401).json({ error: 'Unauthorised — please log in' });

    try {
        const valid = await db.validateSession(sid);
        if (valid) return next();
    } catch (_) {
        if (adminSessionsFallback.has(sid)) return next();
    }
    return res.status(401).json({ error: 'Unauthorised — please log in' });
}

// ─────────────────────────────────────────────
// HUBSPOT HELPERS
// ─────────────────────────────────────────────

async function addContactToList(contactId) {
    if (!HUBSPOT_LIST_ID || !HUBSPOT_TOKEN) return;
    try {
        await axios.post(
            `https://api.hubapi.com/contacts/v1/lists/${HUBSPOT_LIST_ID}/add`,
            { vids: [parseInt(contactId, 10)] },
            { headers: { Authorization: `Bearer ${HUBSPOT_TOKEN}`, 'Content-Type': 'application/json' } }
        );
        console.log(`📋 Added contact ${contactId} to HubSpot list ${HUBSPOT_LIST_ID}`);
    } catch (err) {
        if (err.response?.status !== 400)
            console.warn('⚠️ HubSpot list add failed:', err.response?.data?.message || err.message);
    }
}

/**
 * Upsert a HubSpot contact and attach a single note.
 * Returns a hubspotResult object.
 * Only called once per conversation (when email is first captured).
 */
async function syncToHubspot(leadData, salesOutput) {
    if (!leadData.email || !HUBSPOT_TOKEN)
        return { success: false, message: 'No email yet — continuing conversation' };

    try {
        let contactId = null, existingContact = false;

        // Search existing
        try {
            const searchRes = await axios.post(
                'https://api.hubapi.com/crm/v3/objects/contacts/search',
                { filterGroups: [{ filters: [{ propertyName: 'email', operator: 'EQ', value: leadData.email }] }] },
                { headers: { Authorization: `Bearer ${HUBSPOT_TOKEN}`, 'Content-Type': 'application/json' } }
            );
            if (searchRes.data.results?.length > 0) {
                contactId       = searchRes.data.results[0].id;
                existingContact = true;
            }
        } catch (_) {}

        // Create if not found
        if (!contactId) {
            const props = { email: leadData.email };
            if (leadData.name) {
                props.firstname = leadData.name.split(' ')[0];
                props.lastname  = leadData.name.split(' ').slice(1).join(' ') || '';
            }
            props.lifecyclestage = leadData.intent_level === 'High' ? 'lead' : 'subscriber';
            const contactRes = await axios.post(
                'https://api.hubapi.com/crm/v3/objects/contacts',
                { properties: props },
                { headers: { Authorization: `Bearer ${HUBSPOT_TOKEN}`, 'Content-Type': 'application/json' } }
            );
            contactId = contactRes.data.id;
        }

        await addContactToList(contactId);

        // Add note
        const noteBody = [
            `Source: PLAYBOOK Copilot (Layla)`,
            `Name: ${leadData.name || 'Unknown'}`,
            `Email: ${leadData.email}`,
            `Intent: ${leadData.intent_level}`,
            `Interest: ${leadData.main_interest || 'N/A'}`,
            `Lead Type: ${leadData.lead_type}`,
            `Vibe: ${leadData.conversation_vibe}`,
            ``,
            `Next Action: ${salesOutput.recommended_next_action}`,
            `Timestamp: ${new Date().toLocaleString()}`,
        ].join('\n');

        await axios.post(
            'https://api.hubapi.com/crm/v3/objects/notes',
            {
                properties: { hs_timestamp: new Date().toISOString(), hs_note_body: noteBody },
                associations: [{
                    to: { id: contactId },
                    types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 202 }],
                }],
            },
            { headers: { Authorization: `Bearer ${HUBSPOT_TOKEN}`, 'Content-Type': 'application/json' } }
        );

        return {
            success: true, contactId,
            existing:  existingContact,
            listAdded: !!HUBSPOT_LIST_ID,
            message:   existingContact ? '✅ Note added to existing contact' : '✅ New contact created',
        };
    } catch (err) {
        return { success: false, message: err.response?.data?.message || err.message };
    }
}

// ─────────────────────────────────────────────
// GET /api/chat/:id  — restore a conversation
// ─────────────────────────────────────────────

app.get('/api/chat/:id', async (req, res) => {
    const { id } = req.params;
    if (!/^[0-9a-f-]{36}$/i.test(id))
        return res.status(400).json({ error: 'Invalid conversation ID' });

    try {
        const conv = await db.getConversation(id);
        if (!conv) return res.status(404).json({ error: 'Conversation not found' });
        res.json({ history: conv.history || [] });
    } catch (err) {
        console.error('Error fetching conversation:', err.message);
        res.status(500).json({ error: 'Failed to fetch conversation' });
    }
});

// ─────────────────────────────────────────────
// POST /api/chat  — main chat endpoint (streaming)
// ─────────────────────────────────────────────

app.post('/api/chat', async (req, res) => {
    const ip = req.ip || req.connection?.remoteAddress || 'unknown';

    if (!checkRateLimit(ipRateMap, ip, 20)) {
        return res.status(429).json({ success: false, error: 'Too many requests. Please wait a moment.' });
    }

    const { message: rawMessage, history = [], conversationId, leadData: clientLeadData } = req.body;
    const message = sanitizeMessage(rawMessage);

    if (!message)              return res.status(400).json({ success: false, error: 'No message provided' });
    if (!isValidHistory(history)) return res.status(400).json({ success: false, error: 'Invalid history format' });
    if (!CLAUDE_API_KEY)       return res.status(500).json({ success: false, error: 'Claude API key not configured' });

    const convId = (typeof conversationId === 'string' && /^[0-9a-f-]{36}$/i.test(conversationId))
        ? conversationId : uuidv4();

    // Per-conversation rate limit: max 30 messages per conversation per minute
    if (!checkRateLimit(convRateMap, convId, 30)) {
        return res.status(429).json({ success: false, error: 'Slow down — too many messages in this conversation.' });
    }

    console.log('\n📨 User:', message);

    // ── Set up SSE stream ──
    res.setHeader('Content-Type',  'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection',    'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // disable nginx buffering

    // Send conversation ID immediately so client can store it
    res.write(`data: ${JSON.stringify({ conversation_id: convId })}\n\n`);

    try {
        // ── Step 1: Stream Layla's conversational reply ──
        const conversationMessages = [
            ...history.slice(-18).map(m => ({ role: m.role, content: m.content })),
            { role: 'user', content: message },
        ];

        const { fullText: botReply, model } = await callClaudeStream(
            SYSTEM_PROMPT,
            conversationMessages,
            res,
            600
        );

        console.log('💬 Layla:', botReply);

        // ── Step 2: Conditional extraction ──
        const turnCount     = history.filter(m => m.role === 'user').length + 1;
        const previousLead  = clientLeadData || {};
        const runExtraction = shouldExtract(turnCount, message, previousLead);

        let leadData = {
            name: previousLead.name || null,
            email: previousLead.email || null,
            lead_type: previousLead.lead_type || 'Community',
            main_interest: previousLead.main_interest || null,
            intent_level: previousLead.intent_level || 'Low',
            intent_signals: previousLead.intent_signals || null,
            conversation_vibe: previousLead.conversation_vibe || 'curious',
            vibe_note: previousLead.vibe_note || null,
        };
        let salesOutput = {
            recommended_next_action: previousLead.recommended_next_action || 'Review conversation manually',
            follow_up_message: previousLead.follow_up_message || '',
            priority: previousLead.priority || 'Low',
        };

        if (runExtraction) {
            try {
                const { text: extractionText } = await callClaude(
                    EXTRACTION_SYSTEM,
                    [{ role: 'user', content: buildExtractionPrompt(history, message, previousLead) }],
                    600
                );
                const jsonMatch = extractionText.match(/\{[\s\S]*\}/);
                const parsed    = JSON.parse(jsonMatch ? jsonMatch[0] : extractionText);

                leadData = {
                    name:              parsed.name              || leadData.name,
                    email:             parsed.email             || leadData.email,
                    lead_type:         parsed.lead_type         || leadData.lead_type,
                    main_interest:     parsed.main_interest     || leadData.main_interest,
                    intent_level:      parsed.intent_level      || leadData.intent_level,
                    intent_signals:    parsed.intent_signals    || leadData.intent_signals,
                    conversation_vibe: parsed.conversation_vibe || leadData.conversation_vibe,
                    vibe_note:         parsed.vibe_note         || leadData.vibe_note,
                };
                salesOutput = {
                    recommended_next_action: parsed.recommended_next_action || salesOutput.recommended_next_action,
                    follow_up_message:       parsed.follow_up_message       || salesOutput.follow_up_message,
                    priority:                parsed.priority                || salesOutput.priority,
                };
                console.log(`🎭 Vibe: ${leadData.conversation_vibe} | Intent: ${leadData.intent_level}`);
            } catch (e) {
                console.warn('⚠️ Extraction failed:', e.message);
            }
        }

        // ── Step 3: HubSpot — only sync when email is first captured ──
        // We check: does this turn have an email that the previous turn didn't?
        const emailIsNew = leadData.email && !previousLead.email;
        let hubspotResult = clientLeadData?.hubspot || { success: false, message: 'No email yet — continuing conversation' };

        if (emailIsNew) {
            hubspotResult = await syncToHubspot(leadData, salesOutput);
        }

        // ── Step 4: Save to DB (fire-and-forget style to not delay stream close) ──
        const fullHistory = [
            ...history,
            { role: 'user', content: message },
            { role: 'assistant', content: botReply },
        ];

        db.saveConversation({
            id: convId, timestamp: new Date().toISOString(),
            history: fullHistory, lead_data: leadData,
            sales_output: salesOutput, hubspot: hubspotResult, model_used: model,
        }).catch(err => console.error('❌ Failed to save to DB:', err.message));

        // ── Step 5: Send metadata and close stream ──
        res.write(`data: ${JSON.stringify({
            done: true,
            conversation_id: convId,
            timestamp: new Date().toISOString(),
        })}\n\n`);
        res.end();

    } catch (error) {
        console.error('❌ Server error:', error.message);
        // If headers already sent (stream started), send error event
        try {
            res.write(`data: ${JSON.stringify({ error: 'Something went wrong. Please try again.' })}\n\n`);
            res.end();
        } catch (_) {}
    }
});

// ─────────────────────────────────────────────
// ADMIN API ROUTES
// ─────────────────────────────────────────────

app.get('/api/admin/conversations', requireAdminSession, async (req, res) => {
    try {
        const limit        = Math.min(parseInt(req.query.limit)  || 200, 500);
        const offset       = Math.max(parseInt(req.query.offset) || 0,   0);
        const validIntents = ['High', 'Medium', 'Low'];
        const safeIntent   = validIntents.includes(req.query.intent_level) ? req.query.intent_level : undefined;
        const conversations = await db.getConversations(limit, offset, {
            intent_level: safeIntent,
            has_email:    req.query.has_email === 'true',
        });
        res.json({ conversations, total: conversations.length });
    } catch (err) {
        console.error('DB error:', err);
        res.status(500).json({ error: 'Failed to fetch conversations' });
    }
});

app.get('/api/admin/stats', requireAdminSession, async (req, res) => {
    try {
        const stats = await db.getStats();
        res.json(stats);
    } catch (err) {
        console.error('DB error:', err);
        res.status(500).json({ error: 'Failed to fetch stats' });
    }
});

app.get('/api/admin/conversations/:id', requireAdminSession, async (req, res) => {
    const { id } = req.params;
    if (!/^[0-9a-f-]{36}$/i.test(id)) return res.status(400).json({ error: 'Invalid conversation ID' });
    try {
        const conversation = await db.getConversation(id);
        if (!conversation) return res.status(404).json({ error: 'Not found' });
        res.json({ conversation });
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch conversation' });
    }
});

app.delete('/api/admin/conversations/:id', requireAdminSession, async (req, res) => {
    const { id } = req.params;
    if (!/^[0-9a-f-]{36}$/i.test(id)) return res.status(400).json({ error: 'Invalid conversation ID' });
    try {
        await db.deleteConversation(id);
        res.json({ success: true });
    } catch (err) {
        console.error('Delete error:', err);
        res.status(500).json({ error: 'Failed to delete conversation' });
    }
});

// Health check
app.get('/test', (req, res) => res.json({
    status: 'OK', message: 'Layla is online',
    time: new Date().toISOString(),
    database:    process.env.DATABASE_URL ? 'configured' : 'not configured',
    hubspot:     HUBSPOT_TOKEN            ? 'configured' : 'not configured',
    hubspotList: HUBSPOT_LIST_ID          ? HUBSPOT_LIST_ID : 'not configured',
}));

// Serve admin page
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// ─────────────────────────────────────────────
// START
// ─────────────────────────────────────────────

const PORT = process.env.PORT || 3000;

async function startServer() {
    console.log('\n🚀 Starting PLAYBOOK AI Copilot...');

    if (process.env.DATABASE_URL) {
        try {
            const ok = await db.testConnection();
            if (ok) {
                await db.initSchema();
                await db.cleanExpiredSessions();
            }
        } catch (err) {
            console.error('❌ Database startup error:', err.message);
        }
    } else {
        console.log('ℹ️  DATABASE_URL not set — no persistence');
    }

    if (!CLAUDE_API_KEY)  console.warn('⚠️  CLAUDE_API_KEY not set');
    if (!HUBSPOT_TOKEN)   console.warn('⚠️  HUBSPOT_ACCESS_TOKEN not set');
    if (!HUBSPOT_LIST_ID) console.warn('ℹ️  HUBSPOT_LIST_ID not set — contacts won\'t be added to a list');

    app.listen(PORT, () => {
        console.log('\n' + '='.repeat(50));
        console.log('✅ PLAYBOOK AI Copilot — Layla');
        console.log('='.repeat(50));
        console.log(`📍 Chat:  http://localhost:${PORT}`);
        console.log(`🔐 Admin: http://localhost:${PORT}/admin`);
        console.log('='.repeat(50));
    });
}

startServer();
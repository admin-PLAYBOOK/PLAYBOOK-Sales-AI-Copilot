require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const db = require('./db');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static('public'));

const CLAUDE_API_KEY  = process.env.CLAUDE_API_KEY;
const HUBSPOT_TOKEN   = process.env.HUBSPOT_ACCESS_TOKEN;
const HUBSPOT_LIST_ID = process.env.HUBSPOT_LIST_ID;
const ADMIN_TOKEN     = process.env.ADMIN_TOKEN;

// ─────────────────────────────────────────────
// SYSTEM PROMPT
// ─────────────────────────────────────────────
const SYSTEM_PROMPT = `You are Layla, a warm and knowledgeable community guide for PLAYBOOK — an award-winning private network for professional women in the MENA region and beyond.

About PLAYBOOK:
- 8,340+ members across 100+ countries
- 170+ expert coaches and mentors  
- 15,819+ learning minutes of content
- Founded by Wafa AlObaidat and co-founders
- Co-founder names: Shreya Rammohan, Ismahan Al Saad, Nada Darwish
- Built for women, led by women

What PLAYBOOK offers:
1. CONNECT — Find mentors and collaborators across 100+ countries
2. LEARN — Masterclasses, bootcamps, and expert sessions
3. INVEST — Investor education and startup opportunities through Women Spark

Membership: PLAYBOOK Core at $45.84/month (VAT exclusive) — includes 200+ masterclasses, bootcamps, community events, and learning paths.

Your personality:
- Warm, encouraging, and genuinely curious about the person you're talking to
- You remember everything said earlier in the conversation and reference it naturally
- You ask one thoughtful follow-up question at a time — never fire multiple questions at once
- If someone is just chatting (small talk, venting, off-topic), engage warmly before gently steering back
- You never sound like a script or a chatbot. You sound like a smart friend who happens to know everything about PLAYBOOK
- Keep responses concise — 2–4 sentences max unless more detail is clearly needed
- Never repeat yourself or summarise what the user just said back to them

Lead capture behaviour:
- You are always privately tracking whether you have the user's name and email
- For the first 1–2 messages, focus entirely on understanding what they need — do not ask for any personal info yet
- Once someone has shown clear interest or intent (they want to join, learn, invest, partner, or get more info), ask for their name and email together in a single natural sentence — e.g. "I'd love to get you more details — what's your name and email?" or "Let me make sure the right person follows up with you — can I grab your name and email?"
- Do not ask for name/email if they are clearly just browsing, testing, or haven't shown real interest yet
- Once you have their name, use it naturally in the conversation — do not keep repeating it
- If you already have their email from earlier in the conversation, never ask for it again
- Never say things like "I've noted your interest" or "I'll pass this on to the team" — just be human
- Never ask for name and email on separate turns — always ask for both together in one message`;

// ─────────────────────────────────────────────
// EXTRACTION PROMPT
// ─────────────────────────────────────────────
const EXTRACTION_SYSTEM = `You are a silent data extractor. Given a conversation, extract lead data as JSON only. No extra text, no markdown fences.`;

function buildExtractionPrompt(conversationHistory, latestMessage) {
    const transcript = conversationHistory
        .map(m => `${m.role === 'user' ? 'User' : 'Layla'}: ${m.content}`)
        .join('\n');
    return `Based on this conversation, extract the lead data.

Conversation:
${transcript}
User: ${latestMessage}

Return ONLY valid JSON:
{
  "name": "full name or null",
  "email": "email or null",
  "lead_type": "Membership" | "Learning" | "Investing" | "Partnerships" | "Community" | "Mentorship",
  "main_interest": "specific interest based on conversation or null",
  "intent_level": "High" | "Medium" | "Low",
  "intent_signals": "1-sentence explanation of why you assessed this intent level, quoting specific things they said",
  "conversation_vibe": "serious" | "excited" | "curious" | "skeptical" | "funny" | "annoyed" | "trolling" | "distracted" | "overwhelmed" | "cold",
  "vibe_note": "1-sentence observation about tone that would help a sales rep prepare — be specific and direct",
  "recommended_next_action": "specific next step for sales team",
  "follow_up_message": "short personalised email draft referencing PLAYBOOK offerings, tone-matched to the conversation vibe",
  "priority": "High" | "Medium" | "Low"
}`;
}

// ─────────────────────────────────────────────
// CLAUDE API
// ─────────────────────────────────────────────
const CLAUDE_MODEL    = 'claude-haiku-4-5-20251001';
const FALLBACK_MODELS = ['claude-sonnet-4-6', 'claude-opus-4-6'];

async function callClaude(systemPrompt, messages, maxTokens = 600) {
    for (const model of [CLAUDE_MODEL, ...FALLBACK_MODELS]) {
        try {
            const response = await axios.post('https://api.anthropic.com/v1/messages', {
                model, max_tokens: maxTokens, system: systemPrompt, messages
            }, {
                headers: {
                    'x-api-key': CLAUDE_API_KEY,
                    'anthropic-version': '2023-06-01',
                    'content-type': 'application/json'
                }
            });
            return { text: response.data.content[0].text, model };
        } catch (error) {
            const msg = error.response?.data?.error?.message || error.message;
            console.log(`   ❌ ${model}: ${msg}`);
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
// RATE LIMITING
// ─────────────────────────────────────────────
const rateLimitMap = new Map();

setInterval(() => {
    const now = Date.now();
    for (const [ip, entry] of rateLimitMap.entries()) {
        if (now > entry.resetAt) rateLimitMap.delete(ip);
    }
}, 5 * 60 * 1000);

function checkRateLimit(ip) {
    const now = Date.now();
    const windowMs = 60 * 1000;
    const maxRequests = 20;
    const entry = rateLimitMap.get(ip) || { count: 0, resetAt: now + windowMs };
    if (now > entry.resetAt) { entry.count = 0; entry.resetAt = now + windowMs; }
    entry.count++;
    rateLimitMap.set(ip, entry);
    return entry.count <= maxRequests;
}

// ─────────────────────────────────────────────
// ADMIN AUTH — DB-backed sessions
// ─────────────────────────────────────────────

const adminSessionsFallback = new Set();

app.post('/api/admin/login', express.json(), async (req, res) => {
    const { password } = req.body || {};
    if (!password || password !== ADMIN_TOKEN) {
        return res.status(401).json({ error: 'Incorrect password' });
    }
    const sessionId = uuidv4();
    const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000);

    try {
        await db.createSession(sessionId, expiresAt);
    } catch (e) {
        console.warn('⚠️ Session DB save failed, using memory:', e.message);
        adminSessionsFallback.add(sessionId);
    }

    res.cookie('admin_session', sessionId, {
        httpOnly: true,
        sameSite: 'strict',
        maxAge: 8 * 60 * 60 * 1000,
        path: '/',
    });
    res.json({ success: true });
});

app.post('/api/admin/logout', async (req, res) => {
    const cookieHeader = req.headers.cookie || '';
    const cookies = Object.fromEntries(
        cookieHeader.split(';').map(c => {
            const i = c.trim().indexOf('=');
            return i < 0
                ? [decodeURIComponent(c.trim()), '']
                : [decodeURIComponent(c.trim().slice(0, i)), decodeURIComponent(c.trim().slice(i + 1))];
        })
    );
    const sid = cookies['admin_session'];
    if (sid) {
        try { await db.deleteSession(sid); } catch (_) {}
        adminSessionsFallback.delete(sid);
    }
    res.clearCookie('admin_session');
    res.json({ success: true });
});

async function requireAdminSession(req, res, next) {
    const cookieHeader = req.headers.cookie || '';
    const cookies = Object.fromEntries(
        cookieHeader.split(';').map(c => {
            const i = c.trim().indexOf('=');
            return i < 0
                ? [decodeURIComponent(c.trim()), '']
                : [decodeURIComponent(c.trim().slice(0, i)), decodeURIComponent(c.trim().slice(i + 1))];
        })
    );
    const sid = cookies['admin_session'];
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

/**
 * Add a contact to a HubSpot static list.
 * Uses the v1 lists API (the only one that supports static list membership writes).
 * Silently skips if HUBSPOT_LIST_ID is not configured.
 */
async function addContactToList(contactId) {
    if (!HUBSPOT_LIST_ID || !HUBSPOT_TOKEN) return;
    try {
        await axios.post(
            `https://api.hubapi.com/contacts/v1/lists/${HUBSPOT_LIST_ID}/add`,
            { vids: [parseInt(contactId, 10)] },
            { headers: { 'Authorization': `Bearer ${HUBSPOT_TOKEN}`, 'Content-Type': 'application/json' } }
        );
        console.log(`📋 Added contact ${contactId} to HubSpot list ${HUBSPOT_LIST_ID}`);
    } catch (err) {
        // 400 = already in list — not a real error
        if (err.response?.status !== 400) {
            console.warn('⚠️ HubSpot list add failed:', err.response?.data?.message || err.message);
        }
    }
}

// ─────────────────────────────────────────────
// GET /api/chat/:id  — restore a conversation
// ─────────────────────────────────────────────
app.get('/api/chat/:id', async (req, res) => {
    const { id } = req.params;
    if (!/^[0-9a-f-]{36}$/i.test(id)) {
        return res.status(400).json({ error: 'Invalid conversation ID' });
    }
    try {
        const conv = await db.getConversation(id);
        if (!conv) return res.status(404).json({ error: 'Conversation not found' });
        // Only return the transcript — never leak lead/sales/hubspot data to the client
        res.json({ history: conv.history || [] });
    } catch (err) {
        console.error('Error fetching conversation:', err.message);
        res.status(500).json({ error: 'Failed to fetch conversation' });
    }
});

// ─────────────────────────────────────────────
// POST /api/chat  — main chat endpoint
// ─────────────────────────────────────────────
app.post('/api/chat', async (req, res) => {
    const ip = req.ip || req.connection.remoteAddress;
    if (!checkRateLimit(ip)) {
        return res.status(429).json({ success: false, error: 'Too many requests. Please wait a moment.' });
    }

    const { message: rawMessage, history = [], conversationId } = req.body;
    const message = sanitizeMessage(rawMessage);

    if (!message) return res.status(400).json({ success: false, error: 'No message provided' });
    if (!isValidHistory(history)) return res.status(400).json({ success: false, error: 'Invalid history format' });
    if (!CLAUDE_API_KEY) return res.status(500).json({ success: false, error: 'Claude API key not configured' });

    const convId = (typeof conversationId === 'string' && /^[0-9a-f-]{36}$/i.test(conversationId))
        ? conversationId : uuidv4();

    console.log('\n📨 User:', message);

    try {
        // Step 1: conversational reply
        const conversationMessages = [
            ...history.slice(-18).map(m => ({ role: m.role, content: m.content })),
            { role: 'user', content: message }
        ];
        const { text: botReply, model } = await callClaude(SYSTEM_PROMPT, conversationMessages, 600);
        console.log('💬 Layla:', botReply);

        // Step 2: extraction
        let leadData    = { name: null, email: null, lead_type: 'Community', main_interest: null, intent_level: 'Low', intent_signals: null, conversation_vibe: 'curious', vibe_note: null };
        let salesOutput = { recommended_next_action: 'Review conversation manually', follow_up_message: '', priority: 'Low' };

        try {
            const { text: extractionText } = await callClaude(
                EXTRACTION_SYSTEM,
                [{ role: 'user', content: buildExtractionPrompt(history, message) }],
                600
            );
            const jsonMatch = extractionText.match(/\{[\s\S]*\}/);
            const parsed   = JSON.parse(jsonMatch ? jsonMatch[0] : extractionText);
            leadData = {
                name:               parsed.name              || null,
                email:              parsed.email             || null,
                lead_type:          parsed.lead_type         || 'Community',
                main_interest:      parsed.main_interest     || null,
                intent_level:       parsed.intent_level      || 'Low',
                intent_signals:     parsed.intent_signals    || null,
                conversation_vibe:  parsed.conversation_vibe || 'curious',
                vibe_note:          parsed.vibe_note         || null,
            };
            salesOutput = {
                recommended_next_action: parsed.recommended_next_action || '',
                follow_up_message:       parsed.follow_up_message       || '',
                priority:                parsed.priority                || 'Low',
            };
            console.log(`🎭 Vibe: ${leadData.conversation_vibe} | Intent: ${leadData.intent_level}`);
        } catch (e) {
            console.warn('⚠️ Extraction failed:', e.message);
        }

        // Step 3: HubSpot
        let hubspotResult = { success: false, message: 'No email yet — continuing conversation' };
        if (leadData.email && HUBSPOT_TOKEN) {
            try {
                let contactId = null, existingContact = false;

                // Search for existing contact by email
                try {
                    const searchRes = await axios.post(
                        'https://api.hubapi.com/crm/v3/objects/contacts/search',
                        { filterGroups: [{ filters: [{ propertyName: 'email', operator: 'EQ', value: leadData.email }] }] },
                        { headers: { 'Authorization': `Bearer ${HUBSPOT_TOKEN}`, 'Content-Type': 'application/json' } }
                    );
                    if (searchRes.data.results?.length > 0) {
                        contactId       = searchRes.data.results[0].id;
                        existingContact = true;
                    }
                } catch (_) {}

                // Create contact if not found
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
                        { headers: { 'Authorization': `Bearer ${HUBSPOT_TOKEN}`, 'Content-Type': 'application/json' } }
                    );
                    contactId = contactRes.data.id;
                }

                // Add to static list (if configured)
                await addContactToList(contactId);

                // Add conversation note
                const vibeEmoji = { serious:'🎯',excited:'🔥',curious:'🤔',skeptical:'🧐',funny:'😄',annoyed:'😤',trolling:'🧌',distracted:'💭',overwhelmed:'😰',cold:'🧊' }[leadData.conversation_vibe] || '💬';
                const fullHistory = [...history, { role: 'user', content: message }, { role: 'assistant', content: botReply }];
                const transcript  = fullHistory.map(m => `${m.role === 'user' ? 'User' : 'Layla'}: ${m.content}`).join('\n');
                const noteContent = `🤖 PLAYBOOK AI Copilot — Layla (${model})\n\n${'━'.repeat(35)}\n💬 TRANSCRIPT\n${'━'.repeat(35)}\n${transcript}\n\n${'━'.repeat(35)}\n📋 LEAD INTELLIGENCE\n${'━'.repeat(35)}\nType: ${leadData.lead_type}\nIntent: ${leadData.intent_level}\nIntent signals: ${leadData.intent_signals || 'N/A'}\nInterest: ${leadData.main_interest || 'N/A'}\n\n${vibeEmoji} VIBE: ${leadData.conversation_vibe?.toUpperCase()}\n${leadData.vibe_note || ''}\n\n${'━'.repeat(35)}\n🎯 SALES RECOMMENDATIONS\n${'━'.repeat(35)}\nNext Action: ${salesOutput.recommended_next_action}\nPriority: ${salesOutput.priority}\n\n${'━'.repeat(35)}\n✉️ FOLLOW-UP\n${'━'.repeat(35)}\n${salesOutput.follow_up_message}\n\nTimestamp: ${new Date().toLocaleString()}`;

                await axios.post(
                    'https://api.hubapi.com/crm/v3/objects/notes',
                    {
                        properties: { hs_timestamp: new Date().toISOString(), hs_note_body: noteContent },
                        associations: [{ to: { id: contactId }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 202 }] }]
                    },
                    { headers: { 'Authorization': `Bearer ${HUBSPOT_TOKEN}`, 'Content-Type': 'application/json' } }
                );

                hubspotResult = {
                    success: true, contactId,
                    existing: existingContact,
                    listAdded: !!HUBSPOT_LIST_ID,
                    message: existingContact ? '✅ Note added to existing contact' : '✅ New contact created'
                };
            } catch (hsErr) {
                hubspotResult = { success: false, message: hsErr.response?.data?.message || hsErr.message };
            }
        }

        // Step 4: save to DB
        const fullHistory = [...history, { role: 'user', content: message }, { role: 'assistant', content: botReply }];
        try {
            await db.saveConversation({
                id: convId, timestamp: new Date().toISOString(),
                history: fullHistory, lead_data: leadData,
                sales_output: salesOutput, hubspot: hubspotResult, model_used: model
            });
        } catch (dbError) {
            console.error('❌ Failed to save to DB:', dbError.message);
        }

        // Never expose lead/sales/hubspot data to the client
        res.json({
            success: true,
            response: botReply,
            conversation_id: convId,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('❌ Server error:', error.message);
        res.status(500).json({ success: false, error: 'Something went wrong. Please try again.' });
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

// Health check
app.get('/test', (req, res) => res.json({
    status: 'OK', message: 'Layla is online',
    time: new Date().toISOString(),
    database:   process.env.DATABASE_URL  ? 'configured' : 'not configured',
    hubspot:    HUBSPOT_TOKEN             ? 'configured' : 'not configured',
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

    if (!CLAUDE_API_KEY)   console.warn('⚠️  CLAUDE_API_KEY not set');
    if (!HUBSPOT_TOKEN)    console.warn('⚠️  HUBSPOT_ACCESS_TOKEN not set');
    if (!HUBSPOT_LIST_ID)  console.warn('ℹ️  HUBSPOT_LIST_ID not set — contacts won\'t be added to a list');

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
require('dotenv').config();
const express = require('express');
const axios   = require('axios');
const { v4: uuidv4 } = require('uuid');
const db   = require('./db');
const path = require('path');
const { 
    SYSTEM_PROMPT, 
    SYSTEM_PROMPT_AR,
    EXTRACTION_SYSTEM, 
    RUNNING_SUMMARY_PROMPT, 
    DIALECT_DETECTION_PROMPT,
    buildExtractionPrompt, 
    shouldExtract 
} = require('./prompts');
const { Redis } = require('@upstash/redis');
const { findContent, formatContentLink } = require('./content_library');

const app = express();

// Basic HTTP security headers
try {
    const helmet = require('helmet');
    app.use(helmet({
        contentSecurityPolicy: false, // CSP disabled to allow CDN scripts
        frameguard: false,            // Disable X-Frame-Options so helmet doesn't block iframes
    }));
    // Allow embedding from Webflow — update these domains to match yours
    app.use((req, res, next) => {
        res.setHeader(
            'Content-Security-Policy',
            "frame-ancestors 'self' https://*.webflow.io https://*.webflow.com"
        );
        next();
    });
} catch (_) {
    console.warn('ℹ️  helmet not installed — run: npm install helmet');
}

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

const redis = process.env.UPSTASH_REDIS_URL
  ? new Redis({
      url:   process.env.UPSTASH_REDIS_URL,
      token: process.env.UPSTASH_REDIS_TOKEN,
    })
  : null;

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
                    timeout: 25000,
                }
            );
            return { text: response.data.content[0].text, model };
        } catch (error) {
            const status = error.response?.status;
            const msg = error.response?.data?.error?.message || error.message || JSON.stringify(error);
            console.log(`   ❌ ${model}: ${msg}`, error.code || '');
            if (msg.includes('authentication') || msg.includes('api_key')) throw error;
            // On rate limit, wait 8s before trying next model
            if (status === 429) await new Promise(r => setTimeout(r, 8000));
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
            const status = error.response?.status;
            const msg    = error.response?.data?.error?.message || error.message;
            console.log(`   ❌ ${model} (stream): ${msg}`);
            if (msg.includes('authentication') || msg.includes('api_key')) throw error;
            // On rate limit, wait 8s before trying next model
            if (status === 429) await new Promise(r => setTimeout(r, 8000));
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
// IN-MEMORY MEMORY STORES
// ─────────────────────────────────────────────

// Running summaries — keyed by conversationId
// { runningSummary: string, lastAccessed: number }
const sessionMemory = {};

// Cross-session user profiles are stored in Redis via saveUserProfile / getReturningUserContext

// Purge session memory entries older than 24 hours
setInterval(() => {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    for (const [key, val] of Object.entries(sessionMemory)) {
        if ((val.lastAccessed || 0) < cutoff) delete sessionMemory[key];
    }
}, 60 * 60 * 1000); // run hourly

async function saveUserProfile(email, data) {
    if (!email || !redis) return;
    const prev = await redis.get(`user:${email}`) || {};
    await redis.set(`user:${email}`, {
        name:        data.name          || prev.name,
        pillar:      data.main_interest || prev.pillar,
        stage:       data.lead_type     || prev.stage,
        lastSeen:    new Date().toISOString(),
        totalVisits: (prev.totalVisits  || 0) + 1,
    });
}

async function getReturningUserContext(email) {
    if (!email || !redis) return null;
    const profile = await redis.get(`user:${email}`);
    if (!profile || profile.totalVisits < 2) return null;
    return `Returning user: ${profile.name || 'Unknown'}.`
        + ` Previously interested in: ${profile.pillar || 'unknown'}.`
        + ` Stage: ${profile.stage || 'unknown'}.`
        + ` Greet them by name and reference what they were exploring before.`;
}

// ─────────────────────────────────────────────
// RUNNING SUMMARY — fires every 5 user messages
// ─────────────────────────────────────────────

async function updateRunningSummary(convId, conversationHistory) {
    // Only fire when turn count is a multiple of 5
    const userTurns = conversationHistory.filter(m => m.role === 'user').length;
    if (userTurns === 0 || userTurns % 5 !== 0) return;

    try {
        const last5 = conversationHistory.slice(-5)
            .map(m => `${m.role}: ${m.content}`)
            .join('\n');
        const summaryPrompt = RUNNING_SUMMARY_PROMPT.replace('{{last_5_messages}}', last5);

        const { text: summary } = await callClaude(
            'You are a concise summariser. Output plain text only — no markdown, no preamble.',
            [{ role: 'user', content: summaryPrompt }],
            200
        );

        sessionMemory[convId] = { ...sessionMemory[convId], runningSummary: summary.trim(), lastAccessed: Date.now() };
        console.log(`📝 Running summary updated for ${convId}`);
    } catch (err) {
        console.warn('⚠️ Running summary failed:', err.message);
    }
}

// ─────────────────────────────────────────────
// DIALECT DETECTION — runs once on first Arabic message
// ─────────────────────────────────────────────

async function detectDialect(convId, arabicText) {
    if (sessionMemory[convId]?.dialect) return; // already detected
    try {
        const prompt = DIALECT_DETECTION_PROMPT.replace('{{first_arabic_message}}', arabicText);
        const { text } = await callClaude(
            'You are a dialect analyser. Return only valid JSON.',
            [{ role: 'user', content: prompt }],
            150
        );
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        const dialectData = JSON.parse(jsonMatch ? jsonMatch[0] : text);
        sessionMemory[convId] = {
            ...sessionMemory[convId],
            dialect:         dialectData.dialect,
            dialectToneNote: dialectData.tone_note,
            lastAccessed:    Date.now(),
        };
        console.log(`🌍 Dialect detected for ${convId}: ${dialectData.dialect} (${dialectData.confidence})`);
    } catch (err) {
        console.warn('⚠️ Dialect detection failed:', err.message);
    }
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

const loginAttemptMap = new Map(); // IP → { count, lockedUntil }

function checkLoginRateLimit(ip) {
    const now   = Date.now();
    const entry = loginAttemptMap.get(ip) || { count: 0, lockedUntil: 0 };
    if (now < entry.lockedUntil) return false; // still locked
    if (now > entry.lockedUntil && entry.count >= 5) {
        // window expired — reset
        entry.count = 0;
        entry.lockedUntil = 0;
    }
    entry.count++;
    if (entry.count >= 5) entry.lockedUntil = now + 15 * 60 * 1000; // lock 15 min
    loginAttemptMap.set(ip, entry);
    return entry.count <= 5;
}

app.post('/api/admin/login', express.json(), async (req, res) => {
    const ip = req.ip || req.connection?.remoteAddress || 'unknown';
    if (!checkLoginRateLimit(ip))
        return res.status(429).json({ error: 'Too many attempts — try again in 15 minutes' });

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
        secure: process.env.NODE_ENV === 'production',
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
// SLACK ALERTS — high-intent leads
// ─────────────────────────────────────────────

async function sendSlackAlert(leadData, conversationHistory) {
    const webhookUrl = process.env.SLACK_WEBHOOK_URL;
    if (!webhookUrl) return; // silently skip if not configured

    const lastMsg = conversationHistory[conversationHistory.length - 1]?.content || '';

    const message = {
        text: [
            '🔥 *HOT LEAD* — Layla captured a High Intent conversation',
            `*Name:* ${leadData.name || 'Unknown'}`,
            `*Email:* ${leadData.email || 'Not captured yet'}`,
            `*Interest:* ${leadData.main_interest || 'unclear'}`,
            `*Intent signals:* ${leadData.intent_signals || 'unclear'}`,
            `*Vibe:* ${leadData.conversation_vibe || 'unclear'}`,
            `*Vibe note:* ${leadData.vibe_note || ''}`,
            `*Last message:* "${lastMsg.slice(0, 200)}"`,
            `*Suggested next action:* ${leadData.recommended_next_action || ''}`,
            '→ Check HubSpot and follow up within 30 minutes.',
        ].join('\n'),
    };

    try {
        await axios.post(webhookUrl, message, {
            headers: { 'Content-Type': 'application/json' },
        });
        console.log('🔔 Slack alert sent for high-intent lead');
    } catch (err) {
        console.warn('⚠️ Slack alert failed:', err.response?.data || err.message);
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
        // Return lead_data along with history for client restoration
        res.json({ 
            history: conv.history || [],
            lead_data: conv.lead_data || {}
        });
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

    const { message: rawMessage, history = [], conversationId, leadData: clientLeadData, language = 'en' } = req.body;
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

    // Track if client disconnected — skip extraction/DB work if so
    let clientGone = false;
    req.on('close', () => { clientGone = true; });

    // Send conversation ID immediately so client can store it
    res.write(`data: ${JSON.stringify({ conversation_id: convId })}\n\n`);

    try {
        // ── Step 1: Stream Layla's conversational reply ──

        // turnCount needed before content injection
        const turnCount    = history.filter(m => m.role === 'user').length + 1;
        const previousLead = clientLeadData || {};

        // Build enriched system prompt with memory context
        let enrichedSystemPrompt = SYSTEM_PROMPT;

        // ── Language setting ──
        const safeLanguage = language === 'ar' ? 'ar' : 'en';

        if (safeLanguage === 'ar') {
            enrichedSystemPrompt = SYSTEM_PROMPT_AR;
        } else {
            enrichedSystemPrompt = SYSTEM_PROMPT;
        }

        const langInstruction = safeLanguage === 'ar'
        ? '\n\n## تعليمات اللغة\nأنت تردين فقط بالعربية الحديثة النظيفة. لا تستخدمي الإنجليزية إطلاقاً. كوني طبيعية ودافئة كصديقة.'
        : '\n\n## LANGUAGE INSTRUCTION\nYou respond only in English. Be warm, natural, and conversational.';

        enrichedSystemPrompt += langInstruction;

        // ── Dialect detection (fires once on first Arabic message) ──
        if (safeLanguage === 'ar' && !sessionMemory[convId]?.dialect) {
            detectDialect(convId, message).catch(() => {}); // fire-and-forget
        }
       const dialectNote = sessionMemory[convId]?.dialectToneNote
            ? `\n\n## نصائح اللهجة العربية\n${sessionMemory[convId].dialectToneNote}\nتكلمي بهذه اللهجة بشكل طبيعي، لا تكوني رسمية أكثر من اللازم.`
            : '';

        if (dialectNote && safeLanguage === 'ar') {
            enrichedSystemPrompt += dialectNote;
        }

        // Inject running summary if available
        const runningSummary = sessionMemory[convId]?.runningSummary;
        if (runningSummary) {
            enrichedSystemPrompt += '\n\n## CONVERSATION CONTEXT (do not repeat to user)\n' + runningSummary;
        }

        // Inject returning user context if email is known
        const knownEmail = clientLeadData?.email;
        const returningCtx = await getReturningUserContext(knownEmail);
        if (returningCtx) {
            enrichedSystemPrompt += '\n\n## RETURNING USER\n' + returningCtx;
        }

        // ── Inject relevant content — skip turn 1, cap at 3 items ──
        try {
            const relevantContent = turnCount > 1 ? findContent(message, 3) : [];
            if (relevantContent.length > 0) {
                const contentBlock = relevantContent
                    .map(item => formatContentLink(item))
                    .join('\n\n');
                enrichedSystemPrompt += '\n\n## RELEVANT CONTENT FOR THIS MESSAGE (paste these blocks directly when recommending — they include embedded thumbnails)\n\n' + contentBlock;
            }
        } catch (_) {}

        // Use summary to justify shorter history window
        const historyLimit = runningSummary ? 8 : 18;
        const conversationMessages = [
            ...history.slice(-historyLimit).map(m => ({ role: m.role, content: m.content })),
            { role: 'user', content: message },
        ];

        const { fullText: botReply, model } = await callClaudeStream(
            enrichedSystemPrompt,
            conversationMessages,
            res,
            1400
        );

        console.log('💬 Layla:', botReply);

        // ── Send done immediately — re-enables the client input right away ──
        // Extraction and DB saves happen below as background work.
        res.write(`data: ${JSON.stringify({
            done: true,
            conversation_id: convId,
            timestamp: new Date().toISOString(),
            leadData: clientLeadData || {},
        })}\n\n`);

        // ── Fast contact capture — scan every message for email and name instantly.
        // No AI call. Guarantees contact info is saved even if extraction is skipped.
        const emailMatch = message.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/);
        const capturedEmail = emailMatch ? emailMatch[0].toLowerCase() : null;

        let capturedName = null;
        // Stop capture before conjunctions: "my name is Alya and my email..." → "Alya" only
        const namePatterns = [
            /(?:my name is|i['\u2019]?m called|call me)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)(?=\s*[,!.\n]|\s+and\b|\s+my\b|\s+i\b|$)/i,
            /^(?:i['\u2019]?m|i am)\s+([A-Z][a-z]+)\s*[,!.]?\s*$/i,
            /^(?:hi|hey|hello)[,\s]+(?:i['\u2019]?m\s+)?([A-Z][a-z]+)\s*(?:here|speaking)?\s*[,!.]?\s*$/i,
            /^([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+(?:is|will be)\s+my\s+name/i,
            /^(?:it['\u2019]?s|this is)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s*[,!.]?\s*$/i,
        ];
        for (const re of namePatterns) {
            const m = message.match(re);
            if (m) {
                capturedName = (m[1] || m[2])?.trim() || null;
                if (capturedName) break;
            }
        }

        const resolvedEmail = capturedEmail || clientLeadData?.email || null;
        const resolvedName  = capturedName  || clientLeadData?.name  || null;
        if (capturedEmail || capturedName) {
            console.log(`📇 Contact capture — name: ${resolvedName}, email: ${resolvedEmail}`);
        }

        // ── Minimal save immediately after stream — guarantees conversation appears in admin
        // even if the client disconnects before extraction completes.
        const immediateHistory = [
            ...history,
            { role: 'user', content: message },
            { role: 'assistant', content: botReply },
        ];
        const immediateLeadData = {
            name:              resolvedName  || clientLeadData?.name  || null,
            email:             resolvedEmail || clientLeadData?.email || null,
            lead_type:         clientLeadData?.lead_type         || 'Community',
            main_interest:     clientLeadData?.main_interest     || null,
            intent_level:      clientLeadData?.intent_level      || 'Low',
            intent_signals:    clientLeadData?.intent_signals    || null,
            conversation_vibe: clientLeadData?.conversation_vibe || 'curious',
            vibe_note:         clientLeadData?.vibe_note         || null,
            blocker:           clientLeadData?.blocker           || null,
            pillar_interest:   clientLeadData?.pillar_interest   || null,
            dialect:           sessionMemory[convId]?.dialect    || clientLeadData?.dialect || null,
            channel:           req.body.channel || clientLeadData?.channel || 'Web',
            running_summary:   sessionMemory[convId]?.runningSummary || clientLeadData?.running_summary || null,
            slack_alert_sent:  clientLeadData?.slack_alert_sent  || false,
        };
        db.saveConversation({
            id: convId, timestamp: new Date().toISOString(),
            history: immediateHistory, lead_data: immediateLeadData,
            sales_output: {
                recommended_next_action: clientLeadData?.recommended_next_action || 'Review conversation manually',
                follow_up_message:       clientLeadData?.follow_up_message       || '',
                priority:                clientLeadData?.priority                || 'Low',
            },
            hubspot:    clientLeadData?.hubspot    || { success: false, message: 'No email yet — continuing conversation' },
            model_used: model,
        }).catch(err => console.warn('⚠️ Immediate save failed:', err.message));

        // ── Step 2: Conditional extraction ──
        // NOTE: do NOT early-return here even if clientGone — the proxy often
        // closes the SSE connection during the quiet gap between sending `done`
        // and running extraction, which would silently skip all lead data saves.

        // Always extract if we just captured a new email or name — never miss contact info
        const contactJustArrived = (capturedEmail && !previousLead.email) || (capturedName && !previousLead.name);
        const likelyHasData = message.length > 15 || /[@.]/.test(message);
        const runExtraction = contactJustArrived || (likelyHasData && shouldExtract(turnCount, message, previousLead));

        let leadData = {
            name: previousLead.name || null,
            email: previousLead.email || null,
            lead_type: previousLead.lead_type || 'Community',
            main_interest: previousLead.main_interest || null,
            intent_level: previousLead.intent_level || 'Low',
            intent_signals: previousLead.intent_signals || null,
            conversation_vibe: previousLead.conversation_vibe || 'curious',
            vibe_note: previousLead.vibe_note || null,
            blocker: previousLead.blocker || null,
            pillar_interest:  previousLead.pillar_interest  || null,
            dialect:          sessionMemory[convId]?.dialect || previousLead.dialect || null,
            channel:          req.body.channel || previousLead.channel || 'Web',
            running_summary:  sessionMemory[convId]?.runningSummary || previousLead.running_summary || null,
            slack_alert_sent: previousLead.slack_alert_sent || false,
        };
        let salesOutput = {
            recommended_next_action: previousLead.recommended_next_action || 'Review conversation manually',
            follow_up_message: previousLead.follow_up_message || '',
            priority: previousLead.priority || 'Low',
        };
        
        if (runExtraction) {
            try {
                // Include full exchange so extractor sees Layla's reply too
                const fullHistoryForExtraction = [
                    ...history,
                    { role: 'user', content: message },
                    { role: 'assistant', content: botReply },
                ];
                
                const { text: extractionText } = await callClaude(
                    EXTRACTION_SYSTEM,
                    [{ role: 'user', content: buildExtractionPrompt(fullHistoryForExtraction, previousLead) }],
                    1000
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
                    blocker:           parsed.blocker           || leadData.blocker,
                    pillar_interest:   parsed.pillar_interest   || leadData.pillar_interest,
                    dialect:           sessionMemory[convId]?.dialect || leadData.dialect,
                    channel:           leadData.channel,
                    running_summary:   sessionMemory[convId]?.runningSummary || null,
                    slack_alert_sent:  leadData.slack_alert_sent,
                };
                salesOutput = {
                    recommended_next_action: parsed.recommended_next_action || salesOutput.recommended_next_action,
                    follow_up_message:       parsed.follow_up_message       || salesOutput.follow_up_message,
                    priority:                parsed.priority                || salesOutput.priority,
                };
                console.log(`🎭 Vibe: ${leadData.conversation_vibe} | Intent: ${leadData.intent_level}`);

                // ── Slack alert for high-intent leads — only when email is known ──
                if (leadData.intent_level === 'High' && previousLead.intent_level !== 'High' && leadData.email) {
                    const fullHistoryForSlack = [
                        ...history,
                        { role: 'user', content: message },
                    ];
                    sendSlackAlert({ ...leadData, ...salesOutput }, fullHistoryForSlack)
                        .catch(err => console.warn('⚠️ Slack alert error:', err.message));
                    leadData.slack_alert_sent = true;
                }

                // ── Update user profile for cross-session memory ──
                if (leadData.email) {
                    saveUserProfile(leadData.email, leadData);
                }
            } catch (e) {
                console.warn('⚠️ Extraction failed:', e.message);
                // Log more details if it's a JSON parsing error
                if (e.message.includes('JSON')) {
                    console.warn('   Last extraction attempt may have had malformed JSON');
                }
            }
        }

        // ── Running summary (fire-and-forget, every 5 user turns) ──
        const fullHistoryForSummary = [
            ...history,
            { role: 'user', content: message },
            { role: 'assistant', content: botReply },
        ];
        updateRunningSummary(convId, fullHistoryForSummary)
            .catch(err => console.warn('⚠️ Summary error:', err.message));

        // Refresh running_summary and dialect on leadData before save
        leadData.running_summary = sessionMemory[convId]?.runningSummary || leadData.running_summary || null;
        leadData.dialect         = sessionMemory[convId]?.dialect        || leadData.dialect        || null;

        // ── Step 3: HubSpot — only sync when email is first captured (fire-and-forget) ──
        const fullHistory = [
            ...history,
            { role: 'user', content: message },
            { role: 'assistant', content: botReply },
        ];

        const emailIsNew = leadData.email && !previousLead.email;
        let hubspotResult = clientLeadData?.hubspot || { success: false, message: 'No email yet — continuing conversation' };

        if (emailIsNew) {
            syncToHubspot(leadData, salesOutput)
                .then(result => {
                    // Save again with HubSpot result once it resolves
                    db.saveConversation({
                        id: convId, timestamp: new Date().toISOString(),
                        history: fullHistory, lead_data: leadData,
                        sales_output: salesOutput, hubspot: result, model_used: model,
                    }).catch(err => console.error('❌ Failed to re-save with HubSpot result:', err.message));
                })
                .catch(err => console.warn('⚠️ HubSpot sync error:', err.message));
        }

        // ── Step 4: Save to DB (fire-and-forget style to not delay stream close) ──

        const savePayload = {
            id: convId, timestamp: new Date().toISOString(),
            history: fullHistory, lead_data: leadData,
            sales_output: salesOutput, hubspot: hubspotResult, model_used: model,
        };

        // Save with one automatic retry after 2s
        db.saveConversation(savePayload).catch(err => {
            console.warn('⚠️ DB save failed, retrying in 2s:', err.message);
            setTimeout(() => {
                db.saveConversation(savePayload)
                    .catch(e => console.error('❌ DB save retry failed:', e.message));
            }, 2000);
        });

        // ── Step 5: Send updated lead data now that extraction is done ──
        // The client uses this to update the tab label and local leadData cache.
        if (!res.writableEnded) {
            res.write(`data: ${JSON.stringify({
                lead_update: true,
                conversation_id: convId,
                leadData,
            })}\n\n`);
            res.end();
        }

    } catch (error) {
        console.error('❌ Server error:', error.message);
        // Only write error to client if stream hasn't been closed yet
        if (!res.writableEnded) {
            try {
                res.write(`data: ${JSON.stringify({ error: 'Something went wrong. Please try again.' })}\n\n`);
                res.end();
            } catch (_) {}
        }
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
        const { rows: conversations, total } = await db.getConversations(limit, offset, {
            intent_level: safeIntent,
            has_email:    req.query.has_email === 'true',
        });
        res.json({ conversations, total });
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
    database:    process.env.DATABASE_URL      ? 'configured' : 'not configured',
    hubspot:     HUBSPOT_TOKEN                 ? 'configured' : 'not configured',
    hubspotList: HUBSPOT_LIST_ID               ? HUBSPOT_LIST_ID : 'not configured',
    slack:       process.env.SLACK_WEBHOOK_URL ? 'configured' : 'not configured',
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
    if (!process.env.SLACK_WEBHOOK_URL) console.warn('ℹ️  SLACK_WEBHOOK_URL not set — Slack alerts disabled');

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
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const db = require('./db');
const {
    SYSTEM_PROMPT,
    SYSTEM_PROMPT_AR,
    EXTRACTION_SYSTEM,
    buildExtractionPrompt,
    shouldExtract,
} = require('./prompts');

// ── WhatsApp sessions: phone → { convId, history, leadData, turnCount } ──
// These mirror the in-memory session model used by the web chat.
// On server restart sessions are lost, but DB history is preserved.
const waSessions = new Map();

// ── How long a WhatsApp "session" lives without activity (24h) ──
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

// Clean up stale sessions hourly
setInterval(() => {
    const cutoff = Date.now() - SESSION_TTL_MS;
    for (const [phone, sess] of waSessions.entries()) {
        if ((sess.lastActivity || 0) < cutoff) waSessions.delete(phone);
    }
}, 60 * 60 * 1000);

// ─────────────────────────────────────────────
// TWILIO SIGNATURE VALIDATION
// Prevents random POST requests to your webhook.
// Set TWILIO_AUTH_TOKEN in .env — skip in dev with SKIP_TWILIO_VALIDATION=true
// ─────────────────────────────────────────────

function validateTwilioSignature(req) {
    if (process.env.SKIP_TWILIO_VALIDATION === 'true') return true;

    const authToken = process.env.TWILIO_AUTH_TOKEN;
    if (!authToken) {
        console.warn('⚠️  TWILIO_AUTH_TOKEN not set — skipping signature validation');
        return true;
    }

    const twilioSignature = req.headers['x-twilio-signature'] || '';
    // Reconstruct the full URL Twilio signed
    const proto = req.headers['x-forwarded-proto'] || 'https';
    const host  = req.headers['x-forwarded-host'] || req.headers.host;
    const url   = `${proto}://${host}${req.originalUrl}`;

    // Build the sorted param string Twilio uses
    const params = req.body || {};
    const sortedKeys = Object.keys(params).sort();
    const paramStr   = sortedKeys.reduce((acc, k) => acc + k + params[k], url);

    const expected = crypto
        .createHmac('sha1', authToken)
        .update(paramStr)
        .digest('base64');

    return crypto.timingSafeEqual(
        Buffer.from(twilioSignature),
        Buffer.from(expected)
    );
}

// ─────────────────────────────────────────────
// LANGUAGE DETECTION — reuse existing logic
// ─────────────────────────────────────────────

function isArabic(text) {
    return /[\u0600-\u06FF]/.test(text);
}

// ─────────────────────────────────────────────
// TWIML RESPONSE HELPER
// Twilio expects a plain text TwiML XML response.
// ─────────────────────────────────────────────

function twimlReply(res, messageBody) {
    // WhatsApp messages have a 1600-char limit. Truncate gracefully.
    const safe = messageBody.slice(0, 1590);
    res.set('Content-Type', 'text/xml');
    res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>${escapeXml(safe)}</Message>
</Response>`);
}

function twimlEmpty(res) {
    // Send empty TwiML — no reply (e.g., after an error we already logged)
    res.set('Content-Type', 'text/xml');
    res.send(`<?xml version="1.0" encoding="UTF-8"?><Response></Response>`);
}

function escapeXml(str) {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

// ─────────────────────────────────────────────
// INIT — registers routes on the Express app
// ─────────────────────────────────────────────

function init(app, { callClaude, syncToHubspot, sendSlackAlert }) {
    // Twilio sends URL-encoded form data, not JSON
    app.use('/webhook/whatsapp', require('express').urlencoded({ extended: false }));

    app.post('/webhook/whatsapp', async (req, res) => {
        // ── Signature validation ──
        if (!validateTwilioSignature(req)) {
            console.warn('⚠️  Invalid Twilio signature — rejected');
            return res.status(403).send('Forbidden');
        }

        const incomingMsg = (req.body.Body || '').trim();
        const from        = req.body.From || ''; // e.g. "whatsapp:+97312345678"
        const phone       = from.replace('whatsapp:', ''); // "+97312345678"

        if (!incomingMsg || !phone) return twimlEmpty(res);

        console.log(`📱 WhatsApp [${phone}]: ${incomingMsg.slice(0, 80)}`);

        try {
            // ── Restore or create session ──
            let session = waSessions.get(phone);

            if (!session) {
                // Check DB for a recent conversation from this phone number
                // We tag WA conversations with the phone in lead_data.whatsapp_phone
                const existing = await findExistingWaConversation(phone);
                session = {
                    convId:       existing?.id      || uuidv4(),
                    history:      existing?.history || [],
                    leadData:     existing?.lead_data || {},
                    turnCount:    existing ? (existing.history.filter(m => m.role === 'user').length) : 0,
                    lastActivity: Date.now(),
                };
                waSessions.set(phone, session);
                console.log(`  ${existing ? '🔄 Resumed' : '🆕 Started'} WA session for ${phone} (conv: ${session.convId})`);
            } else {
                session.lastActivity = Date.now();
            }

            const { convId, history } = session;
            const arabic = isArabic(incomingMsg);
            const systemPrompt = arabic ? SYSTEM_PROMPT_AR : SYSTEM_PROMPT;

            // ── Build messages for Claude ──
            const messages = [
                ...history,
                { role: 'user', content: incomingMsg },
            ];

            // ── Call Claude (non-streaming — WhatsApp is request/response) ──
            const { text: botReply, model } = await callClaude(systemPrompt, messages, 600);

            // ── Update session ──
            session.history = [
                ...history,
                { role: 'user',      content: incomingMsg },
                { role: 'assistant', content: botReply },
            ];
            session.turnCount++;

            // ── Extraction (same logic as web route) ──
            const previousLead = { ...session.leadData };

            if (shouldExtract(session.turnCount, incomingMsg, previousLead)) {
                try {
                    const extractionPrompt = buildExtractionPrompt(session.history, previousLead);
                    const { text: extracted } = await callClaude(EXTRACTION_SYSTEM, [
                        { role: 'user', content: extractionPrompt }
                    ], 600);

                    const jsonMatch = extracted.match(/\{[\s\S]*\}/);
                    if (jsonMatch) {
                        const parsed = JSON.parse(jsonMatch[0]);
                        // Merge — don't overwrite existing values with nulls
                        for (const [k, v] of Object.entries(parsed)) {
                            if (v !== null && v !== undefined) session.leadData[k] = v;
                        }
                        // Tag the channel so admin knows this came from WhatsApp
                        session.leadData.channel        = 'whatsapp';
                        session.leadData.whatsapp_phone = phone;

                        // Slack alert for high-intent
                        const salesOutput = {
                            recommended_next_action: session.leadData.recommended_next_action,
                            follow_up_message:       session.leadData.follow_up_message,
                        };

                        if (
                            session.leadData.intent_level === 'High' &&
                            !session.leadData.slack_alert_sent
                        ) {
                            sendSlackAlert({ ...session.leadData, ...salesOutput }, session.history)
                                .catch(err => console.warn('⚠️ Slack alert error:', err.message));
                            session.leadData.slack_alert_sent = true;
                        }

                        // HubSpot sync on first email capture
                        const emailIsNew = session.leadData.email && !previousLead.email;
                        if (emailIsNew) {
                            syncToHubspot(session.leadData, salesOutput)
                                .then(result => {
                                    db.saveConversation({
                                        id: convId, timestamp: new Date().toISOString(),
                                        history: session.history, lead_data: session.leadData,
                                        sales_output: salesOutput, hubspot: result, model_used: model,
                                    }).catch(e => console.error('❌ WA re-save (HubSpot) failed:', e.message));
                                })
                                .catch(err => console.warn('⚠️ HubSpot sync error:', err.message));
                        }
                    }
                } catch (e) {
                    console.warn('⚠️ WA extraction failed:', e.message);
                }
            }

            // ── Save conversation to DB ──
            const salesOutput = {
                recommended_next_action: session.leadData.recommended_next_action || null,
                follow_up_message:       session.leadData.follow_up_message       || null,
            };

            db.saveConversation({
                id: convId, timestamp: new Date().toISOString(),
                history: session.history, lead_data: session.leadData,
                sales_output: salesOutput, hubspot: session.leadData.hubspot || {},
                model_used: model,
            }).catch(err => {
                console.warn('⚠️ WA DB save failed:', err.message);
                setTimeout(() => {
                    db.saveConversation({
                        id: convId, timestamp: new Date().toISOString(),
                        history: session.history, lead_data: session.leadData,
                        sales_output: salesOutput, hubspot: {},
                        model_used: model,
                    }).catch(e => console.error('❌ WA DB retry failed:', e.message));
                }, 2000);
            });

            // ── Reply to Twilio ──
            twimlReply(res, botReply);

        } catch (err) {
            console.error('❌ WhatsApp handler error:', err.message);
            const fallback = isArabic(incomingMsg)
                ? 'عذراً، حدث خطأ. يرجى المحاولة مرة أخرى.'
                : 'Sorry, something went wrong. Please try again in a moment.';
            twimlReply(res, fallback);
        }
    });

    console.log('📱 WhatsApp webhook registered at POST /webhook/whatsapp');
}

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

/**
 * Try to find the most recent DB conversation for this phone number.
 * Looks for lead_data.whatsapp_phone matching the caller.
 */
async function findExistingWaConversation(phone) {
    try {
        // getConversations doesn't filter by phone, so we fetch recent ones
        // and find the match. Acceptable overhead since this only runs on
        // session cold-start (first message after restart / 24h gap).
        const { rows } = await db.getConversations(200, 0, {});
        const match = rows.find(r => r.lead_data?.whatsapp_phone === phone);
        return match || null;
    } catch (err) {
        console.warn('⚠️ Could not look up existing WA session:', err.message);
        return null;
    }
}

module.exports = { init };
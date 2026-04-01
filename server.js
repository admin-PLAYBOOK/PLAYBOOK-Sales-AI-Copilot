require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const db = require('./db');
const app = express();

app.use(express.json());
app.use(express.static('public'));

const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY;
const HUBSPOT_TOKEN = process.env.HUBSPOT_ACCESS_TOKEN;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'playbook2024';

// ─────────────────────────────────────────────
// SYSTEM PROMPT
// ─────────────────────────────────────────────
const SYSTEM_PROMPT = `You are Raya, a warm and knowledgeable community guide for PLAYBOOK — an award-winning private network for professional women in the MENA region and beyond.

About PLAYBOOK:
- 8,340+ members across 100+ countries
- 170+ expert coaches and mentors  
- 15,819+ learning minutes of content
- Founded by Wafa AlObaidat and co-founders
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
        .map(m => `${m.role === 'user' ? 'User' : 'Raya'}: ${m.content}`)
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
const CLAUDE_MODEL = 'claude-haiku-4-5-20251001';
const FALLBACK_MODELS = ['claude-sonnet-4-6', 'claude-opus-4-6'];

async function callClaude(systemPrompt, messages, maxTokens = 600) {
    const models = [CLAUDE_MODEL, ...FALLBACK_MODELS];
    for (const model of models) {
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
// CHAT ENDPOINT
// ─────────────────────────────────────────────
app.post('/api/chat', async (req, res) => {
    const { message, history = [], conversationId } = req.body;
    console.log('\n📨 User:', message);

    if (!message) return res.status(400).json({ success: false, error: 'No message provided' });
    if (!CLAUDE_API_KEY) return res.status(500).json({ success: false, error: 'Claude API key not configured' });

    const convId = conversationId || uuidv4();

    try {
        // Step 1: Conversational reply
        const conversationMessages = [
            ...history.map(m => ({ role: m.role, content: m.content })),
            { role: 'user', content: message }
        ];
        const { text: botReply, model } = await callClaude(SYSTEM_PROMPT, conversationMessages, 600);
        console.log('💬 Raya:', botReply);

        // Step 2: Extraction
        let leadData = { name: null, email: null, lead_type: 'Community', main_interest: null, intent_level: 'Low', intent_signals: null, conversation_vibe: 'curious', vibe_note: null };
        let salesOutput = { recommended_next_action: 'Review conversation manually', follow_up_message: '', priority: 'Low' };

        try {
            const { text: extractionText } = await callClaude(
                EXTRACTION_SYSTEM,
                [{ role: 'user', content: buildExtractionPrompt(history, message) }],
                600
            );
            const jsonMatch = extractionText.match(/\{[\s\S]*\}/);
            const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : extractionText);
            leadData = {
                name: parsed.name || null,
                email: parsed.email || null,
                lead_type: parsed.lead_type || 'Community',
                main_interest: parsed.main_interest || null,
                intent_level: parsed.intent_level || 'Low',
                intent_signals: parsed.intent_signals || null,
                conversation_vibe: parsed.conversation_vibe || 'curious',
                vibe_note: parsed.vibe_note || null
            };
            salesOutput = {
                recommended_next_action: parsed.recommended_next_action || '',
                follow_up_message: parsed.follow_up_message || '',
                priority: parsed.priority || 'Low'
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
                try {
                    const searchRes = await axios.post('https://api.hubapi.com/crm/v3/objects/contacts/search', {
                        filterGroups: [{ filters: [{ propertyName: 'email', operator: 'EQ', value: leadData.email }] }]
                    }, { headers: { 'Authorization': `Bearer ${HUBSPOT_TOKEN}`, 'Content-Type': 'application/json' } });
                    if (searchRes.data.results?.length > 0) { contactId = searchRes.data.results[0].id; existingContact = true; }
                } catch (_) {}

                if (!contactId) {
                    const props = { email: leadData.email };
                    if (leadData.name) { props.firstname = leadData.name.split(' ')[0]; props.lastname = leadData.name.split(' ').slice(1).join(' ') || ''; }
                    props.lifecyclestage = leadData.intent_level === 'High' ? 'lead' : 'subscriber';
                    const contactRes = await axios.post('https://api.hubapi.com/crm/v3/objects/contacts', { properties: props },
                        { headers: { 'Authorization': `Bearer ${HUBSPOT_TOKEN}`, 'Content-Type': 'application/json' } });
                    contactId = contactRes.data.id;
                }

                const vibeEmoji = { serious:'🎯',excited:'🔥',curious:'🤔',skeptical:'🧐',funny:'😄',annoyed:'😤',trolling:'🧌',distracted:'💭',overwhelmed:'😰',cold:'🧊' }[leadData.conversation_vibe] || '💬';
                const fullHistory = [...history, { role: 'user', content: message }, { role: 'assistant', content: botReply }];
                const transcript = fullHistory.map(m => `${m.role === 'user' ? 'User' : 'Raya'}: ${m.content}`).join('\n');

                const noteContent = `🤖 PLAYBOOK AI Copilot — Raya (${model})\n\n${'━'.repeat(35)}\n💬 TRANSCRIPT\n${'━'.repeat(35)}\n${transcript}\n\n${'━'.repeat(35)}\n📋 LEAD INTELLIGENCE\n${'━'.repeat(35)}\nType: ${leadData.lead_type}\nIntent: ${leadData.intent_level}\nIntent signals: ${leadData.intent_signals || 'N/A'}\nInterest: ${leadData.main_interest || 'N/A'}\n\n${vibeEmoji} VIBE: ${leadData.conversation_vibe?.toUpperCase()}\n${leadData.vibe_note || ''}\n\n${'━'.repeat(35)}\n🎯 SALES RECOMMENDATIONS\n${'━'.repeat(35)}\nNext Action: ${salesOutput.recommended_next_action}\nPriority: ${salesOutput.priority}\n\n${'━'.repeat(35)}\n✉️ FOLLOW-UP\n${'━'.repeat(35)}\n${salesOutput.follow_up_message}\n\nTimestamp: ${new Date().toLocaleString()}`;

                await axios.post('https://api.hubapi.com/crm/v3/objects/notes', {
                    properties: { hs_timestamp: new Date().toISOString(), hs_note_body: noteContent },
                    associations: [{ to: { id: contactId }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 202 }] }]
                }, { headers: { 'Authorization': `Bearer ${HUBSPOT_TOKEN}`, 'Content-Type': 'application/json' } });

                hubspotResult = { success: true, contactId, existing: existingContact, message: existingContact ? '✅ Note added to existing contact' : '✅ New contact created' };
            } catch (hsErr) {
                hubspotResult = { success: false, message: hsErr.response?.data?.message || hsErr.message };
            }
        }

        // Step 4: Save to database
        const fullHistory = [...history, { role: 'user', content: message }, { role: 'assistant', content: botReply }];
        
        try {
            await db.saveConversation({
                id: convId,
                timestamp: new Date().toISOString(),
                history: fullHistory,
                lead_data: leadData,
                sales_output: salesOutput,
                hubspot: hubspotResult,
                model_used: model
            });
            console.log('💾 Conversation saved to database');
        } catch (dbError) {
            console.error('❌ Failed to save to database:', dbError.message);
        }

        res.json({
            success: true,
            response: botReply,
            lead_data: leadData,
            sales_output: salesOutput,
            hubspot: hubspotResult,
            model_used: model,
            conversation_id: convId,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('❌ Server error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ─────────────────────────────────────────────
// ADMIN ENDPOINTS
// ─────────────────────────────────────────────

// Get all conversations
app.get('/api/admin/conversations', async (req, res) => {
    const token = req.headers['x-admin-token'];
    if (token !== ADMIN_TOKEN) {
        return res.status(401).json({ error: 'Unauthorised' });
    }
    
    try {
        const { intent_level, has_email, limit = 200, offset = 0 } = req.query;
        const conversations = await db.getConversations(
            parseInt(limit), 
            parseInt(offset), 
            { intent_level, has_email: has_email === 'true' }
        );
        
        res.json({ 
            conversations,
            total: conversations.length
        });
    } catch (err) {
        console.error('Database error:', err);
        res.status(500).json({ error: 'Failed to fetch conversations' });
    }
});

// Get conversation statistics
app.get('/api/admin/stats', async (req, res) => {
    const token = req.headers['x-admin-token'];
    if (token !== ADMIN_TOKEN) {
        return res.status(401).json({ error: 'Unauthorised' });
    }
    
    try {
        const stats = await db.getStats();
        res.json(stats);
    } catch (err) {
        console.error('Database error:', err);
        res.status(500).json({ error: 'Failed to fetch stats' });
    }
});

// Get single conversation
app.get('/api/admin/conversations/:id', async (req, res) => {
    const token = req.headers['x-admin-token'];
    if (token !== ADMIN_TOKEN) {
        return res.status(401).json({ error: 'Unauthorised' });
    }
    
    try {
        const conversation = await db.getConversation(req.params.id);
        if (!conversation) {
            return res.status(404).json({ error: 'Conversation not found' });
        }
        res.json({ conversation });
    } catch (err) {
        console.error('Database error:', err);
        res.status(500).json({ error: 'Failed to fetch conversation' });
    }
});

// Health check endpoint
app.get('/test', (req, res) => res.json({ 
    status: 'OK', 
    message: 'Raya is online', 
    time: new Date().toISOString(),
    database: process.env.DATABASE_URL ? 'configured' : 'not configured'
}));

// Serve admin page
app.get('/admin', (req, res) => res.sendFile('admin.html', { root: './public' }));

// ─────────────────────────────────────────────
// START SERVER
// ─────────────────────────────────────────────
const PORT = process.env.PORT || 3000;

async function startServer() {
    console.log('\n🚀 Starting PLAYBOOK AI Copilot...');
    
    // Test database connection
    if (process.env.DATABASE_URL) {
        try {
            const connected = await db.testConnection();
            if (connected) {
                console.log('✅ Database: Connected to PostgreSQL');
            } else {
                console.warn('⚠️ Database: Connection failed - using in-memory fallback');
            }
        } catch (err) {
            console.error('❌ Database error:', err.message);
        }
    } else {
        console.log('ℹ️  Database: No DATABASE_URL provided - using in-memory storage');
    }
    
    // Check API keys
    if (!CLAUDE_API_KEY) {
        console.warn('⚠️  CLAUDE_API_KEY not set - chat functionality will not work');
    }
    
    if (!HUBSPOT_TOKEN) {
        console.warn('⚠️  HUBSPOT_ACCESS_TOKEN not set - HubSpot integration disabled');
    }
    
    app.listen(PORT, () => {
        console.log('\n' + '='.repeat(50));
        console.log('✅ PLAYBOOK AI Copilot — Raya');
        console.log('='.repeat(50));
        console.log(`📍 Chat:  http://localhost:${PORT}`);
        console.log(`🔐 Admin: http://localhost:${PORT}/admin`);
        console.log(`🔄 Theme: Toggle with floating button in bottom-right corner`);
        console.log('='.repeat(50));
    });
}

startServer();
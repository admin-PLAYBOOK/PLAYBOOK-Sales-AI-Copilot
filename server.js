require('dotenv').config();
const express = require('express');
const axios = require('axios');
const app = express();

app.use(express.json());
app.use(express.static('public'));

const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY;
const HUBSPOT_TOKEN = process.env.HUBSPOT_ACCESS_TOKEN;

// ─────────────────────────────────────────────
// SYSTEM PROMPT — defines personality & memory
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
- Collect name, email, interest area, and intent naturally through conversation — never ask for all of them at once
- If you already have their name from earlier in the conversation, use it
- Only ask for email when there's a natural reason (e.g. "I'd love to send you more details — what's your email?")
- Never say things like "I've noted your interest" or "I'll pass this on to the team" — just be human`;

// ─────────────────────────────────────────────
// EXTRACTION PROMPT — silent, separate API call
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
  "recommended_next_action": "specific next step for sales team",
  "follow_up_message": "short personalised email draft referencing PLAYBOOK offerings",
  "priority": "High" | "Medium" | "Low"
}`;
}

// ─────────────────────────────────────────────
// CLAUDE API CALL — proper multi-turn messages
// ─────────────────────────────────────────────
const CLAUDE_MODEL = 'claude-haiku-4-5-20251001';
const FALLBACK_MODELS = ['claude-3-5-haiku-20241022', 'claude-sonnet-4-5-20251001'];

async function callClaude(systemPrompt, messages, maxTokens = 600) {
  const models = [CLAUDE_MODEL, ...FALLBACK_MODELS];

  for (const model of models) {
    try {
      const response = await axios.post('https://api.anthropic.com/v1/messages', {
        model,
        max_tokens: maxTokens,
        system: systemPrompt,  // ← system prompt in the correct field
        messages               // ← proper multi-turn array
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
// MAIN CHAT ENDPOINT
// ─────────────────────────────────────────────
app.post('/api/chat', async (req, res) => {
  const { message, history = [] } = req.body;

  console.log('\n📨 User:', message);
  console.log(`📚 History length: ${history.length} messages`);

  if (!message) return res.status(400).json({ success: false, error: 'No message provided' });
  if (!CLAUDE_API_KEY) return res.status(500).json({ success: false, error: 'Claude API key not configured' });

  try {
    // ── Step 1: Conversational reply using full history ──
    // Build the messages array Claude expects: [{role, content}, ...]
    const conversationMessages = [
      ...history.map(m => ({ role: m.role, content: m.content })),
      { role: 'user', content: message }
    ];

    const { text: botReply, model } = await callClaude(SYSTEM_PROMPT, conversationMessages, 600);
    console.log('💬 Raya:', botReply);

    // ── Step 2: Silent extraction call (separate, doesn't affect conversation) ──
    let leadData = null;
    let salesOutput = null;

    try {
      const extractionPrompt = buildExtractionPrompt(history, message);
      const { text: extractionText } = await callClaude(
        EXTRACTION_SYSTEM,
        [{ role: 'user', content: extractionPrompt }],
        500
      );

      const jsonMatch = extractionText.match(/\{[\s\S]*\}/);
      const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : extractionText);

      leadData = {
        name: parsed.name || null,
        email: parsed.email || null,
        lead_type: parsed.lead_type || 'Community',
        main_interest: parsed.main_interest || null,
        intent_level: parsed.intent_level || 'Low'
      };

      salesOutput = {
        recommended_next_action: parsed.recommended_next_action || '',
        follow_up_message: parsed.follow_up_message || '',
        priority: parsed.priority || 'Low'
      };

      console.log('📊 Extracted:', leadData);
    } catch (extractErr) {
      console.warn('⚠️ Extraction failed (non-fatal):', extractErr.message);
      leadData = { name: null, email: null, lead_type: 'Community', main_interest: null, intent_level: 'Low' };
      salesOutput = { recommended_next_action: 'Review conversation manually', follow_up_message: '', priority: 'Low' };
    }

    // ── Step 3: HubSpot sync (only if email captured) ──
    let hubspotResult = { success: false, message: 'No email yet — continuing conversation' };

    if (leadData.email) {
      console.log('📤 Syncing to HubSpot:', leadData.email);

      try {
        let contactId = null;
        let existingContact = false;

        // Search for existing contact
        try {
          const searchRes = await axios.post('https://api.hubapi.com/crm/v3/objects/contacts/search', {
            filterGroups: [{ filters: [{ propertyName: 'email', operator: 'EQ', value: leadData.email }] }]
          }, { headers: { 'Authorization': `Bearer ${HUBSPOT_TOKEN}`, 'Content-Type': 'application/json' } });

          if (searchRes.data.results?.length > 0) {
            contactId = searchRes.data.results[0].id;
            existingContact = true;
          }
        } catch (_) {}

        // Create contact if new
        if (!contactId) {
          const props = { email: leadData.email };
          if (leadData.name) {
            props.firstname = leadData.name.split(' ')[0];
            props.lastname = leadData.name.split(' ').slice(1).join(' ') || '';
          }
          props.lifecyclestage = leadData.intent_level === 'High' ? 'lead' : 'subscriber';

          const contactRes = await axios.post('https://api.hubapi.com/crm/v3/objects/contacts',
            { properties: props },
            { headers: { 'Authorization': `Bearer ${HUBSPOT_TOKEN}`, 'Content-Type': 'application/json' } }
          );
          contactId = contactRes.data.id;
        }

        // Build full conversation transcript for the note
        const transcript = [
          ...history.map(m => `${m.role === 'user' ? 'User' : 'Raya'}: ${m.content}`),
          `User: ${message}`,
          `Raya: ${botReply}`
        ].join('\n');

        const noteContent = `🤖 AI Sales Copilot — Raya (${model})

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
💬 FULL CONVERSATION TRANSCRIPT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${transcript}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 LEAD INTELLIGENCE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Type: ${leadData.lead_type}
Intent: ${leadData.intent_level}
Interest: ${leadData.main_interest || 'Not yet determined'}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎯 SALES RECOMMENDATIONS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Next Action: ${salesOutput.recommended_next_action}
Priority: ${salesOutput.priority}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✉️ SUGGESTED FOLLOW-UP
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${salesOutput.follow_up_message}

Timestamp: ${new Date().toLocaleString()}`;

        await axios.post('https://api.hubapi.com/crm/v3/objects/notes', {
          properties: { hs_timestamp: new Date().toISOString(), hs_note_body: noteContent },
          associations: [{ to: { id: contactId }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 202 }] }]
        }, { headers: { 'Authorization': `Bearer ${HUBSPOT_TOKEN}`, 'Content-Type': 'application/json' } });

        hubspotResult = {
          success: true,
          contactId,
          existing: existingContact,
          message: existingContact ? '✅ Note added to existing contact' : '✅ New contact created'
        };
        console.log('✅ HubSpot synced');

      } catch (hsErr) {
        console.error('❌ HubSpot error:', hsErr.response?.data?.message || hsErr.message);
        hubspotResult = { success: false, message: hsErr.response?.data?.message || hsErr.message };
      }
    }

    res.json({
      success: true,
      response: botReply,
      lead_data: leadData,
      sales_output: salesOutput,
      hubspot: hubspotResult,
      model_used: model,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Server error:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
      details: error.response?.data?.error?.message || null
    });
  }
});

// Test endpoint
app.get('/test', (req, res) => {
  res.json({ status: 'OK', message: 'Raya is online', time: new Date().toISOString() });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('\n' + '='.repeat(50));
  console.log('✅ PLAYBOOK AI Copilot — Raya');
  console.log('='.repeat(50));
  console.log(`📍 http://localhost:${PORT}`);
  console.log('='.repeat(50));
});
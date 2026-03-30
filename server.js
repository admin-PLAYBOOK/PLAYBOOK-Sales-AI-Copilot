require('dotenv').config();
const express = require('express');
const axios = require('axios');
const app = express();

app.use(express.json());
app.use(express.static('public'));

const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY;
const HUBSPOT_TOKEN = process.env.HUBSPOT_ACCESS_TOKEN;

console.log('🚀 Starting AI Sales Copilot Server...');
console.log('📡 Claude API Key:', CLAUDE_API_KEY ? '✅ Found' : '❌ Missing');
console.log('📡 HubSpot Token:', HUBSPOT_TOKEN ? '✅ Found' : '❌ Missing');

// Test endpoint to verify server is working
app.get('/test', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'Server is running',
    time: new Date().toISOString()
  });
});

// Main chat endpoint
app.post('/api/chat', async (req, res) => {
  console.log('📨 Received request:', req.body);
  
  try {
    const userMessage = req.body.message;
    
    if (!userMessage) {
      return res.status(400).json({ 
        success: false, 
        error: 'No message provided' 
      });
    }
    
    // Step 1: Extract lead data using Claude
    const extractPrompt = `Extract lead information from this message: "${userMessage}"
    
Return ONLY valid JSON. No other text. No explanation. Just the JSON.
{
  "name": "extracted name or null",
  "email": "extracted email or null",
  "lead_type": "Membership or Learning or Community or Partnerships or Founders or Investors or Corporate",
  "main_interest": "short 5-10 word phrase",
  "intent_level": "High or Medium or Low"
}

Rules:
- High intent = "want to join", "ready", "sign me up", "interested in investing"
- Medium intent = "tell me more", "what can you tell me"
- Low intent = "just looking", "maybe", "curious"`;

    console.log('🤖 Calling Claude API for extraction...');
    
    const extractResponse = await axios.post('https://api.anthropic.com/v1/messages', {
      model: 'claude-3-sonnet-20240229',  // Updated model name
      max_tokens: 500,
      temperature: 0.1,
      messages: [{ 
        role: 'user', 
        content: extractPrompt 
      }]
    }, {
      headers: {
        'x-api-key': CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      }
    });
    
    const extractContent = extractResponse.data.content[0].text;
    console.log('📝 Claude extraction response:', extractContent);
    
    // Parse the JSON from Claude's response
    const jsonMatch = extractContent.match(/\{[\s\S]*\}/);
    const leadData = JSON.parse(jsonMatch ? jsonMatch[0] : extractContent);
    console.log('✅ Extracted lead:', leadData);
    
    // Step 2: Generate sales recommendations
    const recPrompt = `As an AI Sales Copilot, analyze this lead:
    
Lead Data: ${JSON.stringify(leadData)}
Original Message: "${userMessage}"

Return ONLY valid JSON. No other text.
{
  "recommended_next_action": "specific action for sales rep",
  "follow_up_message": "short 2-3 sentence email draft",
  "priority": "High or Medium or Low"
}`;

    console.log('🤖 Calling Claude for recommendations...');
    
    const recResponse = await axios.post('https://api.anthropic.com/v1/messages', {
      model: 'claude-3-sonnet-20240229',  // Updated model name
      max_tokens: 500,
      temperature: 0.3,
      messages: [{ 
        role: 'user', 
        content: recPrompt 
      }]
    }, {
      headers: {
        'x-api-key': CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      }
    });
    
    const recContent = recResponse.data.content[0].text;
    const recJsonMatch = recContent.match(/\{[\s\S]*\}/);
    const salesOutput = JSON.parse(recJsonMatch ? recJsonMatch[0] : recContent);
    console.log('✅ Sales recommendations:', salesOutput);
    
    // Step 3: Send to HubSpot if email exists
    let hubspotResult = null;
    
    if (leadData.email && leadData.email !== 'null' && leadData.email !== null) {
      console.log('📤 Sending to HubSpot for email:', leadData.email);
      
      try {
        // Create contact
        const contact = await axios.post('https://api.hubapi.com/crm/v3/objects/contacts', {
          properties: {
            email: leadData.email,
            firstname: leadData.name && leadData.name !== 'null' ? leadData.name.split(' ')[0] : 'Unknown',
            lastname: leadData.name && leadData.name !== 'null' && leadData.name.includes(' ') ? leadData.name.split(' ').slice(1).join(' ') : '',
            lead_type: leadData.lead_type,
            lead_source: 'AI Sales Copilot',
            lead_intent: leadData.intent_level
          }
        }, {
          headers: { 
            'Authorization': `Bearer ${HUBSPOT_TOKEN}`, 
            'Content-Type': 'application/json' 
          }
        });
        
        console.log('✅ HubSpot contact created:', contact.data.id);
        
        // Add note to contact
        await axios.post('https://api.hubapi.com/crm/v3/objects/notes', {
          properties: {
            hs_timestamp: new Date().toISOString(),
            hs_note_body: `🤖 AI Sales Copilot Analysis

📋 Lead Type: ${leadData.lead_type}
🎯 Intent Level: ${leadData.intent_level}
💡 Main Interest: ${leadData.main_interest}

📝 Recommended Next Action: ${salesOutput.recommended_next_action}

✉️ Suggested Follow-up:
${salesOutput.follow_up_message}

Priority: ${salesOutput.priority}
---
Auto-generated by Playbook AI Sales Copilot`
          },
          associations: [{
            to: { id: contact.data.id },
            types: [{ 
              associationCategory: "HUBSPOT_DEFINED", 
              associationTypeId: 202 
            }]
          }]
        }, {
          headers: { 
            'Authorization': `Bearer ${HUBSPOT_TOKEN}`, 
            'Content-Type': 'application/json' 
          }
        });
        
        hubspotResult = { 
          success: true, 
          contactId: contact.data.id, 
          message: '✅ Contact created in HubSpot with note' 
        };
        
      } catch (err) {
        console.error('❌ HubSpot error:', err.response?.data || err.message);
        hubspotResult = { 
          success: false, 
          message: err.response?.data?.message || err.message 
        };
      }
    } else {
      console.log('⚠️ No email provided - skipping HubSpot');
      hubspotResult = { 
        success: false, 
        message: 'No email provided - HubSpot contact not created' 
      };
    }
    
    // Return complete response
    res.json({ 
      success: true, 
      lead_data: leadData, 
      sales_output: salesOutput, 
      hubspot: hubspotResult,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ Server error:', error.message);
    
    if (error.response) {
      console.error('API error details:', error.response.data);
    }
    
    res.status(500).json({ 
      success: false, 
      error: error.message,
      details: error.response?.data || null
    });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log('\n' + '='.repeat(50));
  console.log('✅ AI Sales Copilot Server Running');
  console.log('='.repeat(50));
  console.log(`📍 URL: http://localhost:${PORT}`);
  console.log(`🧪 Test: http://localhost:${PORT}/test`);
  console.log(`💬 Chat: http://localhost:${PORT}/api/chat`);
  console.log(`❤️ Health: http://localhost:${PORT}/health`);
  console.log('='.repeat(50) + '\n');
});
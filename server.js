require('dotenv').config();
const express = require('express');
const axios = require('axios');
const app = express();

app.use(express.json());
app.use(express.static('public'));

const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY;
const HUBSPOT_TOKEN = process.env.HUBSPOT_ACCESS_TOKEN;

// Real Playbook context from website
const PLAYBOOK_CONTEXT = `
PLAYBOOK is a women's professional network focused on MENA region with:
- 8,340+ members across 100+ countries
- 170+ expert coaches and mentors
- 15,819+ learning minutes of content

Three core offerings:
1. CONNECT: Find mentors and collaborators across 100+ countries
2. LEARN: Masterclasses, bootcamps, and expert sessions
3. INVEST: Investor education and startup opportunities through Women Spark

Membership tiers:
- PLAYBOOK Core: $45.84/month (VAT exclusive) includes 200+ masterclasses, bootcamps, community events, learning paths

Key people:
- Founded by Wafa AlObaidat and co-founders
- Built for women, led by women

Awards: Recognized as award-winning private network for women
`;

// Claude models to try (in order of preference)
const CLAUDE_MODELS = [
  'claude-haiku-4-5-20251001',
  'claude-sonnet-4-5-20251001',
  'claude-3-5-haiku-20241022',
  'claude-2.1'
];

console.log('🚀 Starting AI Sales Copilot Server...');
console.log('📡 Claude API Key:', CLAUDE_API_KEY ? '✅ Found' : '❌ Missing');
console.log('📡 HubSpot Token:', HUBSPOT_TOKEN ? '✅ Found' : '❌ Missing');

// Test endpoint
app.get('/test', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'Server is running with Claude API',
    time: new Date().toISOString()
  });
});

// Helper function to call Claude with Playbook context
async function callClaudeWithContext(userMessage) {
  let lastError = null;
  
  for (const model of CLAUDE_MODELS) {
    try {
      console.log(`   🤖 Trying model: ${model}...`);
      
      const extractResponse = await axios.post('https://api.anthropic.com/v1/messages', {
        model: model,
        max_tokens: 1024,
        temperature: 0.1,
        messages: [{
          role: 'user',
          content: `You are an AI Sales Copilot for PLAYBOOK (https://www.get-playbook.com). Here's what PLAYBOOK offers:

${PLAYBOOK_CONTEXT}

User message: "${userMessage}"

Extract lead information. Return ONLY valid JSON. No other text, no explanation.
{
  "name": "extracted name or null",
  "email": "email address or null",  
  "lead_type": "Membership" or "Learning" or "Investing" or "Partnerships" or "Community" or "Mentorship",
  "main_interest": "specific thing they want from PLAYBOOK based on their message",
  "intent_level": "High" or "Medium" or "Low"
}`
        }]
      }, {
        headers: {
          'x-api-key': CLAUDE_API_KEY,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json'
        }
      });
      
      const extractContent = extractResponse.data.content[0].text;
      const jsonMatch = extractContent.match(/\{[\s\S]*\}/);
      const leadData = JSON.parse(jsonMatch ? jsonMatch[0] : extractContent);
      
      // Second API call for personalized sales recommendations
      const recResponse = await axios.post('https://api.anthropic.com/v1/messages', {
        model: model,
        max_tokens: 1024,
        temperature: 0.3,
        messages: [{
          role: 'user',
          content: `You are a sales representative for PLAYBOOK. Use this REAL context about PLAYBOOK:
${PLAYBOOK_CONTEXT}

Lead wants: ${leadData.main_interest}
Lead type: ${leadData.lead_type}
Original message: "${userMessage}"

Return ONLY valid JSON. No other text.
{
  "recommended_next_action": "specific, actionable next step for the sales team",
  "follow_up_message": "personalized email draft that references PLAYBOOK's actual offerings (use real data: 8,340+ members, $45.84/month for Core, Women Spark, 200+ masterclasses, etc.)",
  "priority": "High" or "Medium" or "Low"
}

The follow_up_message should be professional, warm, and specific to PLAYBOOK.`
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
      
      console.log(`   ✅ Success with model: ${model}`);
      return { leadData, salesOutput, model };
      
    } catch (error) {
      lastError = error;
      const errorMsg = error.response?.data?.error?.message || error.message;
      console.log(`   ❌ Failed with ${model}: ${errorMsg}`);
      
      // If authentication error, stop trying
      if (errorMsg.includes('authentication') || errorMsg.includes('api_key')) {
        throw error;
      }
    }
  }
  
  throw lastError || new Error('All Claude models failed');
}

// Main chat endpoint
app.post('/api/chat', async (req, res) => {
  console.log('\n📨 Received message:', req.body.message);
  
  try {
    const userMessage = req.body.message;
    
    if (!userMessage) {
      return res.status(400).json({ success: false, error: 'No message provided' });
    }
    
    if (!CLAUDE_API_KEY || CLAUDE_API_KEY === 'sk-ant-your-working-key-here') {
      return res.status(500).json({ 
        success: false, 
        error: 'Claude API key not configured. Please add your API key to .env file.' 
      });
    }
    
    console.log('🤖 Calling Claude API with PLAYBOOK context...');
    const result = await callClaudeWithContext(userMessage);
    
    console.log('✅ Claude API successful!');
    console.log('📊 Extracted:', result.leadData);
    console.log('💡 Recommendations:', result.salesOutput);
    
    // Send to HubSpot if email exists
    let hubspotResult = null;
    
    if (result.leadData.email && result.leadData.email !== 'null') {
      console.log('📤 Sending to HubSpot for:', result.leadData.email);
      
      try {
        // Search for existing contact
        let contactId = null;
        let existingContact = false;
        
        try {
          const searchResponse = await axios.post('https://api.hubapi.com/crm/v3/objects/contacts/search', {
            filterGroups: [{
              filters: [{
                propertyName: 'email',
                operator: 'EQ',
                value: result.leadData.email
              }]
            }]
          }, {
            headers: { 
              'Authorization': `Bearer ${HUBSPOT_TOKEN}`, 
              'Content-Type': 'application/json' 
            }
          });
          
          if (searchResponse.data.results && searchResponse.data.results.length > 0) {
            contactId = searchResponse.data.results[0].id;
            existingContact = true;
            console.log('📌 Found existing contact:', contactId);
          }
        } catch (searchError) {
          console.log('Searching for existing contact...');
        }
        
        // Create contact if doesn't exist
        if (!contactId) {
          const contactProperties = {
            email: result.leadData.email,
            firstname: result.leadData.name ? result.leadData.name.split(' ')[0] : 'Lead',
            lastname: result.leadData.name && result.leadData.name.includes(' ') ? result.leadData.name.split(' ').slice(1).join(' ') : '',
            lifecyclestage: result.leadData.intent_level === 'High' ? 'lead' : 'subscriber'
          };
          
          // Remove empty values
          Object.keys(contactProperties).forEach(key => {
            if (!contactProperties[key] || contactProperties[key] === 'null') {
              delete contactProperties[key];
            }
          });
          
          const contact = await axios.post('https://api.hubapi.com/crm/v3/objects/contacts', {
            properties: contactProperties
          }, {
            headers: { 
              'Authorization': `Bearer ${HUBSPOT_TOKEN}`, 
              'Content-Type': 'application/json' 
            }
          });
          
          contactId = contact.data.id;
          console.log('✅ Created new contact:', contactId);
        }
        
        // Add detailed note with Claude's analysis
        const noteContent = `🤖 AI Sales Copilot Analysis (Claude AI - ${result.model})

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 LEAD INFORMATION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Type: ${result.leadData.lead_type}
Intent: ${result.leadData.intent_level}
Interest: ${result.leadData.main_interest}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎯 SALES RECOMMENDATIONS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Next Action: ${result.salesOutput.recommended_next_action}
Priority: ${result.salesOutput.priority}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✉️ SUGGESTED FOLLOW-UP EMAIL
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${result.salesOutput.follow_up_message}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Original Message: "${userMessage.substring(0, 300)}"
Source: Claude AI (${result.model})
Timestamp: ${new Date().toLocaleString()}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;
        
        await axios.post('https://api.hubapi.com/crm/v3/objects/notes', {
          properties: {
            hs_timestamp: new Date().toISOString(),
            hs_note_body: noteContent
          },
          associations: [{
            to: { id: contactId },
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
          contactId: contactId,
          existing: existingContact,
          message: existingContact ? '✅ Note added to existing contact' : '✅ New contact created with note'
        };
        console.log('✅ HubSpot sync complete');
        
      } catch (err) {
        console.error('❌ HubSpot error:', err.response?.data?.message || err.message);
        hubspotResult = { 
          success: false, 
          message: err.response?.data?.message || err.message 
        };
      }
    } else {
      hubspotResult = { success: false, message: 'No email provided - HubSpot contact not created' };
      console.log('⚠️ No email found in message');
    }
    
    res.json({ 
      success: true, 
      lead_data: result.leadData, 
      sales_output: result.salesOutput, 
      hubspot: hubspotResult,
      model_used: result.model,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ Server error:', error.message);
    if (error.response?.data) {
      console.error('API Error Details:', JSON.stringify(error.response.data, null, 2));
    }
    
    res.status(500).json({ 
      success: false, 
      error: error.message,
      details: error.response?.data?.error?.message || null
    });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log('\n' + '='.repeat(50));
  console.log('✅ AI Sales Copilot Server Running');
  console.log('='.repeat(50));
  console.log(`📍 URL: http://localhost:${PORT}`);
  console.log(`🧪 Test: http://localhost:${PORT}/test`);
  console.log(`💬 Chat: http://localhost:${PORT}`);
  console.log('='.repeat(50));
  console.log('\n🌟 Claude API Mode: ACTIVE');
  console.log('✅ Using REAL Claude AI with PLAYBOOK context');
  console.log('❌ No mock data - everything comes from Claude');
  console.log('✅ HubSpot integration: READY\n');
});

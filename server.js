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

// Test endpoint
app.get('/test', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'Server is running',
    time: new Date().toISOString()
  });
});

// Main chat endpoint
app.post('/api/chat', async (req, res) => {
  console.log('📨 Received:', req.body.message);
  
  try {
    const userMessage = req.body.message;
    
    if (!userMessage) {
      return res.status(400).json({ success: false, error: 'No message provided' });
    }
    
    let leadData, salesOutput;
    
    // Try Claude API
    try {
      console.log('🤖 Calling Claude API...');
      
      const extractResponse = await axios.post('https://api.anthropic.com/v1/messages', {
        model: 'claude-3-haiku-20240307',
        max_tokens: 1024,
        messages: [{
          role: 'user',
          content: `Extract lead info from: "${userMessage}"
Return ONLY JSON: {"name":"name or null","email":"email or null","lead_type":"Membership/Learning/Community/Partnerships/Founders/Investors/Corporate","main_interest":"short phrase","intent_level":"High/Medium/Low"}`
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
      leadData = JSON.parse(jsonMatch ? jsonMatch[0] : extractContent);
      
      const recResponse = await axios.post('https://api.anthropic.com/v1/messages', {
        model: 'claude-3-haiku-20240307',
        max_tokens: 1024,
        messages: [{
          role: 'user',
          content: `Lead: ${JSON.stringify(leadData)}. Return JSON: {"recommended_next_action":"action","follow_up_message":"email","priority":"High/Medium/Low"}`
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
      salesOutput = JSON.parse(recJsonMatch ? recJsonMatch[0] : recContent);
      
      console.log('✅ Claude API successful');
      
    } catch (claudeError) {
      console.log('⚠️ Using mock data:', claudeError.message);
      
      const emailMatch = userMessage.match(/[\w.-]+@[\w.-]+\.\w+/);
      const nameMatch = userMessage.match(/(?:my name is |i'm |i am |name is )([A-Za-z\s]+?)(?: and|\.|$)/i);
      
      leadData = {
        name: nameMatch ? nameMatch[1].trim() : null,
        email: emailMatch ? emailMatch[0] : null,
        lead_type: userMessage.match(/join|member/i) ? "Membership" : 
                   userMessage.match(/invest/i) ? "Investors" :
                   userMessage.match(/bootcamp|learn/i) ? "Learning" :
                   userMessage.match(/partner/i) ? "Partnerships" : "Community",
        main_interest: userMessage.substring(0, 50),
        intent_level: userMessage.match(/want|ready|interested|join|invest/i) ? "High" : "Medium"
      };
      
      salesOutput = {
        recommended_next_action: leadData.email ? "Send follow-up email" : "Request contact information",
        follow_up_message: `Thanks for your interest in Playbook! We'll follow up soon.`,
        priority: leadData.intent_level === "High" ? "High" : "Medium"
      };
    }
    
    // Handle HubSpot - search or create
    let hubspotResult = null;
    
    if (leadData.email && leadData.email !== 'null') {
      console.log('📤 Processing HubSpot for:', leadData.email);
      
      try {
        // First, search for existing contact
        let contactId = null;
        let existingContact = false;
        
        try {
          const searchResponse = await axios.post('https://api.hubapi.com/crm/v3/objects/contacts/search', {
            filterGroups: [{
              filters: [{
                propertyName: 'email',
                operator: 'EQ',
                value: leadData.email
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
          console.log('Search error, will create new contact');
        }
        
        // If contact doesn't exist, create it
        if (!contactId) {
          const contactProperties = {
            email: leadData.email,
            firstname: leadData.name ? leadData.name.split(' ')[0] : 'Lead',
            lastname: leadData.name && leadData.name.includes(' ') ? leadData.name.split(' ').slice(1).join(' ') : '',
            lifecyclestage: leadData.intent_level === 'High' ? 'lead' : 'subscriber'
          };
          
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
        
        // Add note to contact (always add note even for existing contacts)
        const noteContent = `🤖 AI Sales Copilot Analysis

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 LEAD INFORMATION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Type: ${leadData.lead_type}
Intent: ${leadData.intent_level}
Interest: ${leadData.main_interest}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎯 SALES RECOMMENDATIONS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Next Action: ${salesOutput.recommended_next_action}
Priority: ${salesOutput.priority}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✉️ FOLLOW-UP MESSAGE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${salesOutput.follow_up_message}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Source: AI Sales Copilot
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
        console.log('✅ HubSpot success - Note added');
        
      } catch (err) {
        console.error('❌ HubSpot error:', err.response?.data?.message || err.message);
        hubspotResult = { 
          success: false, 
          message: err.response?.data?.message || err.message 
        };
      }
    } else {
      hubspotResult = { success: false, message: 'No email provided' };
      console.log('⚠️ No email provided');
    }
    
    res.json({ 
      success: true, 
      lead_data: leadData, 
      sales_output: salesOutput, 
      hubspot: hubspotResult,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ Server error:', error.message);
    res.status(500).json({ 
      success: false, 
      error: error.message
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
  console.log('='.repeat(50) + '\n');
});

require('dotenv').config();
const express = require('express');
const axios = require('axios');
const app = express();

app.use(express.json());
app.use(express.static('public'));

const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY;
const HUBSPOT_TOKEN = process.env.HUBSPOT_ACCESS_TOKEN;

// Claude model selection - try different ones if needed
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'claude-2.1'; // Options: claude-2.1, claude-instant-1.2

console.log('🚀 Starting AI Sales Copilot Server...');
console.log('📡 Claude API Key:', CLAUDE_API_KEY ? '✅ Found' : '❌ Missing');
console.log('📡 Claude Model:', CLAUDE_MODEL);
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
    let usedClaude = false;
    
    // Try Claude API if key exists
    if (CLAUDE_API_KEY && CLAUDE_API_KEY !== 'sk-ant-your-working-key-here') {
      try {
        console.log(`🤖 Calling Claude API (${CLAUDE_MODEL})...`);
        usedClaude = true;
        
        // First API call - Extract lead data
        const extractResponse = await axios.post('https://api.anthropic.com/v1/messages', {
          model: CLAUDE_MODEL,
          max_tokens: 1024,
          temperature: 0.1,
          messages: [{
            role: 'user',
            content: `Extract lead information from this message: "${userMessage}"
            
Return ONLY valid JSON. No other text. No markdown. Just the JSON object.
Required fields:
- name: string or null
- email: string or null  
- lead_type: "Membership" or "Learning" or "Community" or "Partnerships" or "Founders" or "Investors" or "Corporate"
- main_interest: string (short phrase)
- intent_level: "High" or "Medium" or "Low"

Example: {"name":"John Doe","email":"john@example.com","lead_type":"Membership","main_interest":"joining Playbook","intent_level":"High"}`
          }]
        }, {
          headers: {
            'x-api-key': CLAUDE_API_KEY,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json'
          }
        });
        
        const extractContent = extractResponse.data.content[0].text;
        console.log('📝 Claude extract:', extractContent.substring(0, 200));
        
        const jsonMatch = extractContent.match(/\{[\s\S]*\}/);
        leadData = JSON.parse(jsonMatch ? jsonMatch[0] : extractContent);
        
        // Second API call - Generate recommendations
        const recResponse = await axios.post('https://api.anthropic.com/v1/messages', {
          model: CLAUDE_MODEL,
          max_tokens: 1024,
          temperature: 0.3,
          messages: [{
            role: 'user',
            content: `As an AI Sales Copilot, analyze this lead:
            
Lead Data: ${JSON.stringify(leadData)}
Original Message: "${userMessage}"

Return ONLY valid JSON. No other text.
Required fields:
- recommended_next_action: string (specific action for sales rep)
- follow_up_message: string (short 2-3 sentence email draft)
- priority: "High" or "Medium" or "Low"

Example: {"recommended_next_action":"Schedule discovery call","follow_up_message":"Thanks for your interest! Let's connect.","priority":"High"}`
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
        
        console.log('✅ REAL Claude API successful!');
        
      } catch (claudeError) {
        console.log('⚠️ Claude API error, using mock data:', claudeError.response?.data?.error?.message || claudeError.message);
        usedClaude = false;
        
        // Fall back to mock data
        const mockResult = generateMockData(userMessage);
        leadData = mockResult.leadData;
        salesOutput = mockResult.salesOutput;
      }
    } else {
      console.log('📝 No valid Claude API key, using intelligent mock data');
      const mockResult = generateMockData(userMessage);
      leadData = mockResult.leadData;
      salesOutput = mockResult.salesOutput;
    }
    
    // Send to HubSpot
    let hubspotResult = null;
    
    if (leadData.email && leadData.email !== 'null') {
      console.log('📤 Processing HubSpot for:', leadData.email);
      
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
        
        // Create contact if doesn't exist
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
        
        // Add note
        const aiSource = usedClaude ? `Claude AI (${CLAUDE_MODEL})` : 'Intelligent Mock Data';
        const noteContent = `🤖 AI Sales Copilot Analysis (${aiSource})

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
✉️ SUGGESTED FOLLOW-UP EMAIL
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${salesOutput.follow_up_message}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Original Message: "${userMessage.substring(0, 200)}"
Source: ${aiSource}
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
          usedClaude: usedClaude,
          message: existingContact ? '✅ Note added to existing contact' : '✅ New contact created with note'
        };
        console.log('✅ HubSpot success');
        
      } catch (err) {
        console.error('❌ HubSpot error:', err.response?.data?.message || err.message);
        hubspotResult = { 
          success: false, 
          message: err.response?.data?.message || err.message 
        };
      }
    } else {
      hubspotResult = { success: false, message: 'No email provided - add email to create contact' };
      console.log('⚠️ No email provided');
    }
    
    res.json({ 
      success: true, 
      lead_data: leadData, 
      sales_output: salesOutput, 
      hubspot: hubspotResult,
      used_claude: usedClaude,
      model_used: usedClaude ? CLAUDE_MODEL : 'mock-data',
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

// Mock data generator function
function generateMockData(userMessage) {
  const emailMatch = userMessage.match(/[\w.-]+@[\w.-]+\.\w+/);
  
  let name = null;
  const namePatterns = [
    /my name is ([A-Za-z\s]+?)(?:\.|,| and| my email|$)/i,
    /i'm ([A-Za-z\s]+?)(?:\.|,| and| my email|$)/i,
    /i am ([A-Za-z\s]+?)(?:\.|,| and| my email|$)/i
  ];
  
  for (const pattern of namePatterns) {
    const match = userMessage.match(pattern);
    if (match && match[1].trim().length < 30) {
      name = match[1].trim();
      break;
    }
  }
  
  const lowerMessage = userMessage.toLowerCase();
  let leadType = "Community";
  let followUpMessage = "";
  let nextAction = "";
  
  if (lowerMessage.match(/join|member/i)) {
    leadType = "Membership";
    followUpMessage = `Thanks ${name || 'there'} for your interest in joining Playbook! I'd love to schedule a quick call to walk you through membership benefits.`;
    nextAction = "Schedule membership onboarding call";
  } 
  else if (lowerMessage.match(/invest/i)) {
    leadType = "Investors";
    followUpMessage = `Thank you for your interest in investing! Our team would be happy to share our pitch deck.`;
    nextAction = "Send investor deck and schedule call";
  }
  else if (lowerMessage.match(/bootcamp|learn/i)) {
    leadType = "Learning";
    followUpMessage = `Thanks for your interest in our bootcamps! I'll send you our upcoming schedule.`;
    nextAction = "Send bootcamp schedule";
  }
  else if (lowerMessage.match(/partner/i)) {
    leadType = "Partnerships";
    followUpMessage = `Thanks for exploring partnerships! Let's set up a time to discuss.`;
    nextAction = "Schedule partnership discovery call";
  }
  else {
    followUpMessage = `Thanks ${name || 'for reaching out'}! Could you tell me more about what you're looking for?`;
    nextAction = "Qualify lead with follow-up questions";
  }
  
  const intentLevel = lowerMessage.match(/want|ready|interested|join|invest/i) ? "High" : "Medium";
  
  return {
    leadData: {
      name: name,
      email: emailMatch ? emailMatch[0] : null,
      lead_type: leadType,
      main_interest: userMessage.substring(0, 50),
      intent_level: intentLevel
    },
    salesOutput: {
      recommended_next_action: nextAction,
      follow_up_message: followUpMessage,
      priority: intentLevel === "High" ? "High" : "Medium"
    }
  };
}

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log('\n' + '='.repeat(50));
  console.log('✅ AI Sales Copilot Server Running');
  console.log('='.repeat(50));
  console.log(`📍 URL: http://localhost:${PORT}`);
  console.log(`🧪 Test: http://localhost:${PORT}/test`);
  console.log(`💬 Chat: http://localhost:${PORT}`);
  console.log('='.repeat(50));
  
  if (CLAUDE_API_KEY && CLAUDE_API_KEY !== 'sk-ant-your-working-key-here') {
    console.log(`\n🌟 Claude API mode: ACTIVE (${CLAUDE_MODEL})`);
    console.log('✅ Using Claude AI for lead extraction');
  } else {
    console.log('\n📝 Mock data mode: ACTIVE');
    console.log('💡 To enable Claude AI, add a valid API key to .env');
  }
  console.log('✅ HubSpot integration: READY\n');
});

require('dotenv').config();
const express = require('express');
const axios = require('axios');
const app = express();

app.use(express.json());
app.use(express.static('public'));

const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY;
const HUBSPOT_TOKEN = process.env.HUBSPOT_ACCESS_TOKEN;

// Playbook context from the website
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

Testimonials mention: mentorship, career growth, connections, learning, personal development, investment opportunities
`;

// Claude models to try
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
    message: 'Server is running with Playbook context',
    time: new Date().toISOString()
  });
});

// Helper function to call Claude with Playbook context
async function callClaudeWithContext(userMessage) {
  let lastError = null;
  
  for (const model of CLAUDE_MODELS) {
    try {
      console.log(`   Trying model: ${model}...`);
      
      const extractResponse = await axios.post('https://api.anthropic.com/v1/messages', {
        model: model,
        max_tokens: 1024,
        temperature: 0.1,
        messages: [{
          role: 'user',
          content: `You are an AI Sales Copilot for PLAYBOOK (https://www.get-playbook.com). Here's what PLAYBOOK offers:

${PLAYBOOK_CONTEXT}

User message: "${userMessage}"

Extract lead information. Return ONLY valid JSON:
{
  "name": "extracted name or null",
  "email": "email or null",  
  "lead_type": "Membership" or "Learning" or "Investing" or "Partnerships" or "Community" or "Mentorship",
  "main_interest": "specific thing they want from PLAYBOOK",
  "intent_level": "High/Medium/Low"
}

Example: {"name":"Sarah","email":"sarah@example.com","lead_type":"Membership","main_interest":"Join PLAYBOOK Core membership","intent_level":"High"}`
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
      
      // Second API call for personalized recommendations
      const recResponse = await axios.post('https://api.anthropic.com/v1/messages', {
        model: model,
        max_tokens: 1024,
        temperature: 0.3,
        messages: [{
          role: 'user',
          content: `You are a sales representative for PLAYBOOK. Use this context:
${PLAYBOOK_CONTEXT}

Lead wants: ${leadData.main_interest}
Lead type: ${leadData.lead_type}
Original message: "${userMessage}"

Return ONLY valid JSON:
{
  "recommended_next_action": "specific next step for sales team",
  "follow_up_message": "personalized email draft referencing PLAYBOOK's offerings (pricing, features, benefits)",
  "priority": "High/Medium/Low"
}

Make the follow-up message specific to PLAYBOOK's actual offerings (Core membership at $45.84, masterclasses, Women Spark investing, global community of 8,340+ members).`
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
      
      console.log(`   ✅ SUCCESS with model: ${model}`);
      return { leadData, salesOutput, model };
      
    } catch (error) {
      lastError = error;
      const errorMsg = error.response?.data?.error?.message || error.message;
      console.log(`   ❌ Failed with ${model}: ${errorMsg}`);
      
      if (errorMsg.includes('authentication') || errorMsg.includes('api_key')) {
        throw error;
      }
    }
  }
  
  throw lastError || new Error('All Claude models failed');
}

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
    let modelUsed = null;
    
    // Try Claude with Playbook context
    if (CLAUDE_API_KEY && CLAUDE_API_KEY !== 'sk-ant-your-working-key-here') {
      try {
        console.log('🤖 Calling Claude API with PLAYBOOK context...');
        const result = await callClaudeWithContext(userMessage);
        leadData = result.leadData;
        salesOutput = result.salesOutput;
        modelUsed = result.model;
        usedClaude = true;
        console.log('✅ Claude API successful with Playbook context!');
        
      } catch (claudeError) {
        console.log('⚠️ Claude failed, using mock data:', claudeError.message);
        usedClaude = false;
        const mockResult = generateMockData(userMessage);
        leadData = mockResult.leadData;
        salesOutput = mockResult.salesOutput;
      }
    } else {
      console.log('📝 Using mock data');
      const mockResult = generateMockData(userMessage);
      leadData = mockResult.leadData;
      salesOutput = mockResult.salesOutput;
    }
    
    // Send to HubSpot
    let hubspotResult = null;
    
    if (leadData.email && leadData.email !== 'null') {
      console.log('📤 Processing HubSpot for:', leadData.email);
      
      try {
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
        
        const aiSource = usedClaude ? `Claude AI (${modelUsed})` : 'Mock Data';
        const noteContent = `🤖 AI Sales Copilot Analysis (${aiSource}) - PLAYBOOK

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
Original: "${userMessage.substring(0, 200)}"
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
      hubspotResult = { success: false, message: 'No email provided' };
      console.log('⚠️ No email provided');
    }
    
    res.json({ 
      success: true, 
      lead_data: leadData, 
      sales_output: salesOutput, 
      hubspot: hubspotResult,
      used_claude: usedClaude,
      model_used: modelUsed || 'mock-data',
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

// Mock data with Playbook context
function generateMockData(userMessage) {
  const emailMatch = userMessage.match(/[\w.-]+@[\w.-]+\.\w+/);
  
  let name = null;
  const namePatterns = [
    /my name is ([A-Za-z\s]+?)(?:\.|,| and| my email|$)/i,
    /i'm ([A-Za-z\s]+?)(?:\.|,| and| my email|$)/i
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
  
  if (lowerMessage.match(/join|member|core/i)) {
    leadType = "Membership";
    followUpMessage = `Hi ${name || 'there'}! Thanks for your interest in PLAYBOOK Core membership ($$45.84/month). You'll get access to 200+ masterclasses, bootcamps, and our global community of 8,340+ women across 100+ countries. I'd love to schedule a quick call to walk you through the benefits!`;
    nextAction = "Schedule membership onboarding call - highlight Core membership benefits";
  } 
  else if (lowerMessage.match(/invest|women spark|deal flow/i)) {
    leadType = "Investing";
    followUpMessage = `Thank you for your interest in Women Spark, PLAYBOOK's investment arm! We offer investor education, startup deal flow, and portfolio tracking. Our next investor session is coming up - would you like me to share the details?`;
    nextAction = "Send Women Spark investor education package and session schedule";
  }
  else if (lowerMessage.match(/bootcamp|learn|masterclass/i)) {
    leadType = "Learning";
    followUpMessage = `Thanks for your interest in PLAYBOOK's learning programs! We offer 200+ expert-led masterclasses and bootcamps. The next bootcamp starts soon. Want me to send you the curriculum and schedule?`;
    nextAction = "Send bootcamp schedule and masterclass catalog";
  }
  else if (lowerMessage.match(/partner|collaborat|corporate/i)) {
    leadType = "Partnerships";
    followUpMessage = `Thanks for exploring partnerships with PLAYBOOK! We work with 1,900+ companies. Let's set up a call to discuss how we can collaborate - whether it's corporate memberships, event sponsorships, or expert partnerships.`;
    nextAction = "Schedule partnership discovery call with corporate team";
  }
  else if (lowerMessage.match(/mentor|connect|network/i)) {
    leadType = "Mentorship";
    followUpMessage = `PLAYBOOK's mentorship program connects you with 170+ experts across industries. Our smart matching system helps you find the right mentor. Would you like to learn more about how it works?`;
    nextAction = "Share mentorship program details and matching process";
  }
  else {
    followUpMessage = `Thanks ${name || 'for reaching out'}! PLAYBOOK offers professional networking, masterclasses, and investment opportunities for women. Could you share what you're most interested in - connecting, learning, or investing?`;
    nextAction = "Qualify lead on CONNECT/LEARN/INVEST priorities";
  }
  
  const intentLevel = lowerMessage.match(/want|ready|interested|join|invest|sign up/i) ? "High" : "Medium";
  
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
    console.log(`\n🌟 Claude API mode: ACTIVE with PLAYBOOK context`);
    console.log('✅ Using real PLAYBOOK data (8,340+ members, $45.84/month, Women Spark)');
  } else {
    console.log('\n📝 Mock data mode: ACTIVE with PLAYBOOK context');
  }
  console.log('✅ HubSpot integration: READY\n');
});

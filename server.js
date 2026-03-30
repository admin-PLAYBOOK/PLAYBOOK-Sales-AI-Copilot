require('dotenv').config();
const express = require('express');
const axios = require('axios');
const app = express();

app.use(express.json());
app.use(express.static('public'));

const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY;
const HUBSPOT_TOKEN = process.env.HUBSPOT_ACCESS_TOKEN;

console.log('Starting server...');
console.log('Claude API Key exists:', !!CLAUDE_API_KEY);
console.log('HubSpot Token exists:', !!HUBSPOT_TOKEN);

app.post('/api/chat', async (req, res) => {
  console.log('Received request:', req.body);
  
  try {
    const userMessage = req.body.message;
    
    // Step 1: Extract lead data with Claude
    const extractPrompt = `Extract lead information from this message: "${userMessage}"
    
Return ONLY valid JSON (no other text or explanation):
{
  "name": "extracted name or null if not mentioned",
  "email": "extracted email or null if not mentioned",
  "lead_type": "Membership or Learning or Community or Partnerships or Founders or Investors or Corporate",
  "main_interest": "short 5-10 word phrase describing their interest",
  "intent_level": "High or Medium or Low"
}

Rules:
- High intent: uses words like "want to join", "ready", "sign me up"
- Medium intent: "interested in", "tell me more"  
- Low intent: "just looking", "maybe", "curious"`;

    const extractResponse = await axios.post('https://api.anthropic.com/v1/messages', {
      model: 'claude-3-haiku-20240307',
      max_tokens: 500,
      temperature: 0.1,
      messages: [{ role: 'user', content: extractPrompt }]
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
    console.log('Extracted lead:', leadData);
    
    // Step 2: Generate sales recommendations
    const recPrompt = `As an AI Sales Copilot, analyze this lead:
    
Lead Data: ${JSON.stringify(leadData)}
Original Message: "${userMessage}"

Return ONLY valid JSON:
{
  "recommended_next_action": "specific action for sales rep (e.g., Schedule call, Send email, Add to nurture sequence)",
  "follow_up_message": "short 2-3 sentence email draft to send this lead",
  "priority": "High or Medium or Low"
}

Priority rules:
- High: High intent + has email
- Medium: Medium intent or missing email
- Low: Low intent`;

    const recResponse = await axios.post('https://api.anthropic.com/v1/messages', {
      model: 'claude-3-haiku-20240307',
      max_tokens: 500,
      temperature: 0.3,
      messages: [{ role: 'user', content: recPrompt }]
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
    console.log('Sales recommendations:', salesOutput);
    
    // Step 3: Send to HubSpot if email exists
    let hubspotResult = null;
    if (leadData.email && leadData.email !== 'null') {
      try {
        const contact = await axios.post('https://api.hubapi.com/crm/v3/objects/contacts', {
          properties: {
            email: leadData.email,
            firstname: leadData.name && leadData.name !== 'null' ? leadData.name.split(' ')[0] : 'Unknown',
            lastname: leadData.name && leadData.name !== 'null' && leadData.name.includes(' ') ? leadData.name.split(' ').slice(1).join(' ') : '',
            lead_type: leadData.lead_type,
            lead_source: 'AI Sales Copilot'
          }
        }, {
          headers: { 
            'Authorization': `Bearer ${HUBSPOT_TOKEN}`, 
            'Content-Type': 'application/json' 
          }
        });
        
        await axios.post('https://api.hubapi.com/crm/v3/objects/notes', {
          properties: {
            hs_timestamp: new Date().toISOString(),
            hs_note_body: `AI Sales Copilot Analysis\n\nLead Type: ${leadData.lead_type}\nIntent: ${leadData.intent_level}\nInterest: ${leadData.main_interest}\n\nRecommended Next Action: ${salesOutput.recommended_next_action}\nPriority: ${salesOutput.priority}\n\nSuggested Follow-up:\n${salesOutput.follow_up_message}`
          },
          associations: [{
            to: { id: contact.data.id },
            types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 202 }]
          }]
        }, {
          headers: { 
            'Authorization': `Bearer ${HUBSPOT_TOKEN}`, 
            'Content-Type': 'application/json' 
          }
        });
        
        hubspotResult = { success: true, contactId: contact.data.id, message: 'Contact created in HubSpot' };
        console.log('HubSpot success:', contact.data.id);
      } catch(err) {
        console.error('HubSpot error:', err.response?.data || err.message);
        hubspotResult = { success: false, message: err.response?.data?.message || err.message };
      }
    } else {
      hubspotResult = { success: false, message: 'No email provided - skipping HubSpot' };
      console.log('Skipping HubSpot - no email');
    }
    
    res.json({ 
      success: true, 
      lead_data: leadData, 
      sales_output: salesOutput, 
      hubspot: hubspotResult 
    });
    
  } catch (error) {
    console.error('Server error:', error.message);
    if (error.response) {
      console.error('API response:', error.response.data);
    }
    res.status(500).json({ 
      success: false, 
      error: error.message,
      details: error.response?.data 
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
  console.log(`Test with: curl -X POST http://localhost:${PORT}/api/chat -H "Content-Type: application/json" -d '{"message":"test"}'`);
});
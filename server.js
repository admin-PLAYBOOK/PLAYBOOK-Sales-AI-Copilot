require('dotenv').config();
const express = require('express');
const axios = require('axios');
const app = express();

app.use(express.json());
app.use(express.static('public'));

const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY;
const HUBSPOT_TOKEN = process.env.HUBSPOT_ACCESS_TOKEN;

app.post('/api/chat', async (req, res) => {
  try {
    const userMessage = req.body.message;
    console.log('Message:', userMessage);
    
    // Extract lead data
    const extractPrompt = `Extract from: "${userMessage}"
Return ONLY JSON: {"name": "name or null", "email": "email or null", "lead_type": "Membership/Learning/Community/Partnerships/Founders/Investors/Corporate", "main_interest": "short phrase", "intent_level": "High/Medium/Low"}`;

    const extractResponse = await axios.post('https://api.anthropic.com/v1/messages', {
      model: 'claude-3-haiku-20240307',
      max_tokens: 500,
      messages: [{ role: 'user', content: extractPrompt }]
    }, {
      headers: {
        'x-api-key': CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      }
    });
    
    const leadData = JSON.parse(extractResponse.data.content[0].text.match(/\{[\s\S]*\}/)[0]);
    
    // Generate recommendations
    const recPrompt = `Lead: ${JSON.stringify(leadData)}. Return JSON: {"recommended_next_action": "action", "follow_up_message": "email draft", "priority": "High/Medium/Low"}`;
    
    const recResponse = await axios.post('https://api.anthropic.com/v1/messages', {
      model: 'claude-3-haiku-20240307',
      max_tokens: 500,
      messages: [{ role: 'user', content: recPrompt }]
    }, {
      headers: {
        'x-api-key': CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      }
    });
    
    const salesOutput = JSON.parse(recResponse.data.content[0].text.match(/\{[\s\S]*\}/)[0]);
    
    // Send to HubSpot if email exists
    let hubspotResult = null;
    if (leadData.email) {
      try {
        const contact = await axios.post('https://api.hubapi.com/crm/v3/objects/contacts', {
          properties: {
            email: leadData.email,
            firstname: leadData.name?.split(' ')[0] || 'Unknown',
            lead_type: leadData.lead_type,
            lead_source: 'AI Sales Copilot'
          }
        }, {
          headers: { 'Authorization': `Bearer ${HUBSPOT_TOKEN}`, 'Content-Type': 'application/json' }
        });
        
        await axios.post('https://api.hubapi.com/crm/v3/objects/notes', {
          properties: {
            hs_timestamp: new Date().toISOString(),
            hs_note_body: `Next Action: ${salesOutput.recommended_next_action}\n\nFollow-up: ${salesOutput.follow_up_message}`
          },
          associations: [{
            to: { id: contact.data.id },
            types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 202 }]
          }]
        }, {
          headers: { 'Authorization': `Bearer ${HUBSPOT_TOKEN}`, 'Content-Type': 'application/json' }
        });
        
        hubspotResult = { success: true, contactId: contact.data.id };
      } catch (err) {
        hubspotResult = { success: false, message: err.message };
      }
    } else {
      hubspotResult = { success: false, message: 'No email provided' };
    }
    
    res.json({ success: true, lead_data: leadData, sales_output: salesOutput, hubspot: hubspotResult });
    
  } catch (error) {
    console.error('Error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});

// API endpoint
const API_URL = '/api/chat';

// Send message function
async function sendMessage() {
    const input = document.getElementById('messageInput');
    const message = input.value.trim();
    const sendBtn = document.getElementById('sendBtn');
    
    if (!message) return;
    
    // Disable button and show loading
    sendBtn.disabled = true;
    sendBtn.textContent = 'Sending...';
    
    // Add user message
    addMessage(message, 'user');
    input.value = '';
    
    // Show loading in chat
    const loadingId = addLoadingMessage();
    
    try {
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: message })
        });
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const data = await response.json();
        
        // Remove loading message
        removeLoadingMessage(loadingId);
        
        if (data.success) {
            addMessage('✅ Lead processed successfully! Check the analysis panel on the right.', 'ai');
            displayAnalysis(data);
            updateConnectionStatus(true);
        } else {
            addMessage(`❌ Error: ${data.error}`, 'ai');
            displayError(data.error);
        }
    } catch (error) {
        console.error('Error:', error);
        removeLoadingMessage(loadingId);
        addMessage(`❌ Connection error: ${error.message}. Make sure the server is running.`, 'ai');
        displayError(error.message);
        updateConnectionStatus(false);
    } finally {
        // Re-enable button
        sendBtn.disabled = false;
        sendBtn.textContent = 'Send →';
    }
}

// Add message to chat
function addMessage(text, sender) {
    const messagesDiv = document.getElementById('messages');
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${sender === 'user' ? 'user-message' : 'ai-message'}`;
    messageDiv.innerHTML = `<div class="message-bubble">${escapeHtml(text)}</div>`;
    messagesDiv.appendChild(messageDiv);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
    return messageDiv;
}

// Add loading message
function addLoadingMessage() {
    const messagesDiv = document.getElementById('messages');
    const loadingDiv = document.createElement('div');
    loadingDiv.className = 'message ai-message';
    loadingDiv.id = 'loading-' + Date.now();
    loadingDiv.innerHTML = `<div class="message-bubble"><div class="loading loading-dark"></div> Analyzing with AI...</div>`;
    messagesDiv.appendChild(loadingDiv);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
    return loadingDiv.id;
}

// Remove loading message
function removeLoadingMessage(id) {
    const element = document.getElementById(id);
    if (element) element.remove();
}

// Display analysis results
function displayAnalysis(data) {
    const analysisDiv = document.getElementById('analysisContent');
    
    let hubspotStatus = '';
    if (data.hubspot.success) {
        hubspotStatus = `<div class="status-badge status-success">✅ ${data.hubspot.message || 'HubSpot contact created'}</div>`;
    } else if (data.hubspot.message && data.hubspot.message.includes('No email')) {
        hubspotStatus = `<div class="status-badge status-warning">⚠️ ${data.hubspot.message}</div>`;
    } else {
        hubspotStatus = `<div class="status-badge status-error">❌ HubSpot: ${data.hubspot.message || 'Error'}</div>`;
    }
    
    const priorityColor = data.sales_output.priority === 'High' ? '🔴' : data.sales_output.priority === 'Medium' ? '🟡' : '🟢';
    const priorityBg = data.sales_output.priority === 'High' ? '#fee' : data.sales_output.priority === 'Medium' ? '#ffeaa7' : '#d4edda';
    
    analysisDiv.innerHTML = `
        <div class="analysis-section">
            <div class="analysis-title">
                <span>📋</span>
                <span>Extracted Lead Data</span>
            </div>
            <div class="analysis-box">
                <pre>${JSON.stringify(data.lead_data, null, 2)}</pre>
            </div>
        </div>
        
        <div class="analysis-section">
            <div class="analysis-title">
                <span>🎯</span>
                <span>Sales Copilot Recommendations</span>
            </div>
            <div class="analysis-box">
                <strong>📌 Recommended Next Action:</strong>
                <div style="margin: 8px 0 12px 0; padding: 8px; background: white; border-radius: 8px;">
                    ${escapeHtml(data.sales_output.recommended_next_action)}
                </div>
                
                <strong>✉️ Suggested Follow-up Message:</strong>
                <div style="margin: 8px 0 12px 0; padding: 8px; background: white; border-radius: 8px; font-style: italic;">
                    "${escapeHtml(data.sales_output.follow_up_message)}"
                </div>
                
                <strong>⚡ Priority:</strong>
                <div style="margin-top: 8px;">
                    <span class="status-badge" style="background: ${priorityBg}">
                        ${priorityColor} ${data.sales_output.priority}
                    </span>
                </div>
            </div>
        </div>
        
        <div class="analysis-section">
            <div class="analysis-title">
                <span>🔄</span>
                <span>HubSpot Integration</span>
            </div>
            <div class="analysis-box">
                ${hubspotStatus}
                <div style="margin-top: 10px; font-size: 0.8rem; color: #666;">
                    🕐 ${new Date(data.timestamp).toLocaleString()}
                </div>
            </div>
        </div>
    `;
}

// Display error message
function displayError(error) {
    const analysisDiv = document.getElementById('analysisContent');
    analysisDiv.innerHTML = `
        <div class="analysis-section">
            <div class="analysis-title">
                <span>❌</span>
                <span>Error</span>
            </div>
            <div class="analysis-box">
                <div class="status-badge status-error">Error: ${escapeHtml(error)}</div>
                <div style="margin-top: 15px; font-size: 0.85rem; color: #666;">
                    Troubleshooting:<br>
                    • Is the server running? Run <code>npm start</code><br>
                    • Check API keys in <code>.env</code> file<br>
                    • View terminal for error details
                </div>
            </div>
        </div>
    `;
}

// Update connection status
function updateConnectionStatus(connected) {
    const statusDiv = document.getElementById('connectionStatus');
    if (connected) {
        statusDiv.innerHTML = '✅ Connected to server';
        statusDiv.className = 'connection-status connected';
    } else {
        statusDiv.innerHTML = '❌ Disconnected - Check if server is running';
        statusDiv.className = 'connection-status disconnected';
    }
}

// Set example message
function setExample(text) {
    document.getElementById('messageInput').value = text;
    sendMessage();
}

// Escape HTML
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Test connection on page load
async function testConnection() {
    try {
        const response = await fetch('/test');
        if (response.ok) {
            updateConnectionStatus(true);
        } else {
            updateConnectionStatus(false);
        }
    } catch (error) {
        updateConnectionStatus(false);
    }
}

// Test connection when page loads
testConnection();

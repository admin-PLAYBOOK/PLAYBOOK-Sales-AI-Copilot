// API endpoint
const API_URL = '/api/chat';

// Send message function
async function sendMessage() {
    const input = document.getElementById('messageInput');
    const message = input.value.trim();
    const sendBtn = document.getElementById('sendBtn');
    
    if (!message) return;
    
    sendBtn.disabled = true;
    sendBtn.textContent = 'Sending...';
    
    addMessage(message, 'user');
    input.value = '';
    
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
        sendBtn.disabled = false;
        sendBtn.textContent = 'Send →';
    }
}

function addMessage(text, sender) {
    const messagesDiv = document.getElementById('messages');
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${sender === 'user' ? 'user-message' : 'ai-message'}`;
    messageDiv.innerHTML = `<div class="message-bubble">${escapeHtml(text)}</div>`;
    messagesDiv.appendChild(messageDiv);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
    return messageDiv;
}

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

function removeLoadingMessage(id) {
    const element = document.getElementById(id);
    if (element) element.remove();
}

function displayAnalysis(data) {
    const analysisDiv = document.getElementById('analysisContent');
    const priorityClass = data.sales_output.priority === 'High' ? 'priority-high' : 
                          data.sales_output.priority === 'Medium' ? 'priority-medium' : 'priority-low';
    
    let hubspotStatus = '';
    if (data.hubspot.success) {
        hubspotStatus = `<div class="status-badge status-success">✅ ${data.hubspot.message || 'HubSpot contact created'}</div>`;
    } else if (data.hubspot.message && data.hubspot.message.includes('No email')) {
        hubspotStatus = `<div class="status-badge status-warning">⚠️ ${data.hubspot.message}</div>`;
    } else {
        hubspotStatus = `<div class="status-badge status-error">❌ HubSpot: ${data.hubspot.message || 'Error'}</div>`;
    }
    
    const priorityColor = data.sales_output.priority === 'High' ? '🔴' : data.sales_output.priority === 'Medium' ? '🟡' : '🟢';
    
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
                <div class="recommendation-box">
                    ${escapeHtml(data.sales_output.recommended_next_action)}
                </div>
                
                <strong>✉️ Suggested Follow-up Message:</strong>
                <div class="recommendation-box">
                    "${escapeHtml(data.sales_output.follow_up_message)}"
                </div>
                
                <strong>⚡ Priority:</strong>
                <div style="margin-top: 8px;">
                    <span class="priority-badge ${priorityClass}">
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
                <div class="meta-text">
                    🕐 ${new Date(data.timestamp).toLocaleString()}
                </div>
                ${data.model_used ? `<div class="meta-text" style="margin-top: 8px;">🤖 Model: ${data.model_used}</div>` : ''}
            </div>
        </div>
    `;
}

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
                <div class="meta-text" style="margin-top: 15px;">
                    Troubleshooting:<br>
                    • Is the server running? Run <code>npm start</code><br>
                    • Check API keys in <code>.env</code> file<br>
                    • View terminal for error details
                </div>
            </div>
        </div>
    `;
}

function updateConnectionStatus(connected) {
    const statusDiv = document.getElementById('connectionStatus');
    if (connected) {
        statusDiv.innerHTML = '✅ Connected';
        statusDiv.classList.remove('disconnected');
    } else {
        statusDiv.innerHTML = '❌ Disconnected';
        statusDiv.classList.add('disconnected');
    }
}

function setExample(text) {
    document.getElementById('messageInput').value = text;
    sendMessage();
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

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

// Theme Toggle
function initTheme() {
    const themeToggle = document.getElementById('themeToggle');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)');
    
    function getInitialTheme() {
        const savedTheme = localStorage.getItem('theme');
        if (savedTheme) return savedTheme;
        return prefersDark.matches ? 'dark-mode' : 'light-mode';
    }
    
    function setTheme(theme) {
        document.body.className = theme;
        localStorage.setItem('theme', theme);
        if (themeToggle) {
            themeToggle.textContent = theme === 'dark-mode' ? '☀️' : '🌙';
        }
    }
    
    function toggleTheme() {
        const currentTheme = document.body.className;
        const newTheme = currentTheme === 'dark-mode' ? 'light-mode' : 'dark-mode';
        setTheme(newTheme);
    }
    
    setTheme(getInitialTheme());
    
    if (themeToggle) {
        themeToggle.addEventListener('click', toggleTheme);
    }
    
    prefersDark.addEventListener('change', (e) => {
        if (!localStorage.getItem('theme')) {
            setTheme(e.matches ? 'dark-mode' : 'light-mode');
        }
    });
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    testConnection();
    initTheme();
    
    document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'D') {
            e.preventDefault();
            const themeToggle = document.getElementById('themeToggle');
            if (themeToggle) themeToggle.click();
        }
    });
});
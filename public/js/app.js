// API endpoint
const API_URL = '/api/chat';

// Conversation history
let conversationHistory = [];

// Add to conversation history
function addToHistory(role, content) {
    conversationHistory.push({ role, content });
    // Keep last 20 messages for context
    if (conversationHistory.length > 20) {
        conversationHistory = conversationHistory.slice(-20);
    }
}

// Clear conversation history
function clearConversationHistory() {
    conversationHistory = [];
}

// Send message function
async function sendMessage() {
    const input = document.getElementById('messageInput');
    const message = input.value.trim();
    const sendBtn = document.getElementById('sendBtn');
    
    if (!message) return;
    
    // Check connection before sending
    const isConnected = await checkConnectionBeforeSend();
    if (!isConnected) {
        addMessage('❌ Cannot send message: Server is disconnected. Please check if the server is running.', 'ai');
        return;
    }
    
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
            body: JSON.stringify({ 
                message: message,
                history: conversationHistory 
            })
        });
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const data = await response.json();
        
        // Remove loading message
        removeLoadingMessage(loadingId);
        
        if (data.success) {
            // Add AI's conversational response
            addMessage(data.response, 'ai');
            
            // Add to conversation history
            addToHistory('user', message);
            addToHistory('assistant', data.response);
            
            // Show the analysis summary
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
    const isDarkMode = document.body.classList.contains('dark-mode');
    
    let hubspotStatus = '';
    if (data.hubspot.success) {
        hubspotStatus = `<div class="status-badge status-success">✅ ${data.hubspot.message || 'HubSpot contact created'}</div>`;
    } else if (data.hubspot.message && data.hubspot.message.includes('No email')) {
        hubspotStatus = `<div class="status-badge status-warning">⚠️ ${data.hubspot.message}</div>`;
    } else {
        hubspotStatus = `<div class="status-badge status-error">❌ HubSpot: ${data.hubspot.message || 'Error'}</div>`;
    }
    
    const priorityColor = data.sales_output.priority === 'High' ? '🔴' : data.sales_output.priority === 'Medium' ? '🟡' : '🟢';
    const priorityClass = data.sales_output.priority === 'High' ? 'priority-high' : 
                          data.sales_output.priority === 'Medium' ? 'priority-medium' : 'priority-low';
    
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

// Display error message
function displayError(error) {
    const analysisDiv = document.getElementById('analysisContent');
    const isDarkMode = document.body.classList.contains('dark-mode');
    
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

// Update connection status
function updateConnectionStatus(connected) {
    const statusDiv = document.getElementById('connectionStatus');
    const statusIndicator = document.querySelector('.status-indicator span');
    
    if (connected) {
        statusDiv.innerHTML = '✅ Connected';
        statusDiv.classList.remove('disconnected');
        
        // Update the main status indicator text
        if (statusIndicator) {
            statusIndicator.textContent = 'AI Sales Copilot Active';
        }
        
        // Change status dot color to green
        const statusDot = document.querySelector('.status-dot');
        if (statusDot) {
            statusDot.style.background = '#D1FC51';
            statusDot.style.boxShadow = '0 0 8px #D1FC51';
        }
    } else {
        statusDiv.innerHTML = '❌ Disconnected';
        statusDiv.classList.add('disconnected');
        
        // Update the main status indicator text
        if (statusIndicator) {
            statusIndicator.textContent = 'Disconnected - Check Server';
        }
        
        // Change status dot color to red
        const statusDot = document.querySelector('.status-dot');
        if (statusDot) {
            statusDot.style.background = '#EF4444';
            statusDot.style.boxShadow = '0 0 8px #EF4444';
        }
    }
}

// Check connection before sending
async function checkConnectionBeforeSend() {
    try {
        const response = await fetch('/test');
        if (!response.ok) {
            updateConnectionStatus(false);
            return false;
        }
        updateConnectionStatus(true);
        return true;
    } catch (error) {
        updateConnectionStatus(false);
        return false;
    }
}

// Set example message
function setExample(text) {
    document.getElementById('messageInput').value = text;
    sendMessage();
}

// Clear chat
function clearChat() {
    const messagesDiv = document.getElementById('messages');
    messagesDiv.innerHTML = `
        <div class="message ai-message">
            <div class="message-bubble">
                👋 Welcome to PLAYBOOK! I'm your AI Sales Copilot.<br><br>
                Tell me what brings you here today:<br>
                • ✨ Join as a member<br>
                • 💰 Invest through Women Spark<br>
                • 📚 Learn via masterclasses<br>
                • 🤝 Explore partnerships<br><br>
                <span style="font-size: 0.85rem; opacity: 0.7;">↓ Type your message below ↓</span>
            </div>
        </div>
    `;
    clearConversationHistory();
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
        console.error('Connection test failed:', error);
        updateConnectionStatus(false);
    }
}

// Connection monitoring
let connectionInterval;

function startConnectionMonitoring() {
    testConnection();
    connectionInterval = setInterval(() => {
        testConnection();
    }, 30000);
}

function stopConnectionMonitoring() {
    if (connectionInterval) {
        clearInterval(connectionInterval);
    }
}

// ============================================
// THEME TOGGLE FUNCTIONALITY
// ============================================

// Theme toggle function
function initTheme() {
    const themeToggle = document.getElementById('themeToggle');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)');
    
    // Check saved theme or system preference
    function getInitialTheme() {
        const savedTheme = localStorage.getItem('theme');
        if (savedTheme) {
            return savedTheme;
        }
        return prefersDark.matches ? 'dark-mode' : 'light-mode';
    }
    
    // Apply theme
    function setTheme(theme) {
        document.body.className = theme;
        localStorage.setItem('theme', theme);
        
        // Update button icon
        if (themeToggle) {
            themeToggle.textContent = theme === 'dark-mode' ? '☀️' : '🌙';
        }
        
        // Refresh analysis display colors if there's data
        const analysisContent = document.getElementById('analysisContent');
        if (analysisContent && analysisContent.innerHTML && !analysisContent.innerHTML.includes('empty-state')) {
            // The displayAnalysis function will handle colors on next message
            console.log('Theme changed');
        }
    }
    
    // Toggle theme
    function toggleTheme() {
        const currentTheme = document.body.className;
        const newTheme = currentTheme === 'dark-mode' ? 'light-mode' : 'dark-mode';
        setTheme(newTheme);
    }
    
    // Initialize theme
    setTheme(getInitialTheme());
    
    // Listen for theme toggle click
    if (themeToggle) {
        themeToggle.addEventListener('click', toggleTheme);
    }
    
    // Listen for system preference changes
    prefersDark.addEventListener('change', (e) => {
        if (!localStorage.getItem('theme')) {
            setTheme(e.matches ? 'dark-mode' : 'light-mode');
        }
    });
}

// ============================================
// INITIALIZATION
// ============================================

// Run everything when page loads
document.addEventListener('DOMContentLoaded', () => {
    testConnection();
    startConnectionMonitoring();
    initTheme();
    
    // Add keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        // Ctrl/Cmd + Shift + D for theme toggle
        if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'D') {
            e.preventDefault();
            const themeToggle = document.getElementById('themeToggle');
            if (themeToggle) themeToggle.click();
        }
        
        // Ctrl/Cmd + K to clear chat
        if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
            e.preventDefault();
            clearChat();
        }
        
        // Ctrl/Cmd + L to focus input
        if ((e.ctrlKey || e.metaKey) && e.key === 'l') {
            e.preventDefault();
            document.getElementById('messageInput').focus();
        }
        
        // Ctrl/Cmd + Enter to send
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            sendMessage();
        }
    });
});

// Clean up interval when page unloads
window.addEventListener('beforeunload', () => {
    stopConnectionMonitoring();
});
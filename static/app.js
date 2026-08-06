// State Management
const state = {
    documents: [],
    chatHistory: [],
    apiKey: '',
    hasGlobalKey: false,
    ragLimit: parseInt(localStorage.getItem('docagent_rag_limit')) || 4,
    chatbotId: '',
    username: '',
    sessionToken: localStorage.getItem('docagent_session_token') || '',
    isTyping: false,
    authMode: 'login' // 'login' or 'register'
};

// DOM Elements
const landingContainer = document.getElementById('landingContainer');
const authContainer = document.getElementById('authContainer');
const appContainer = document.getElementById('appContainer');
const authForm = document.getElementById('authForm');
const authEmail = document.getElementById('authEmail');
const authPassword = document.getElementById('authPassword');
const authConfirmPassword = document.getElementById('authConfirmPassword');
const confirmPasswordGroup = document.getElementById('confirmPasswordGroup');
const closeAuthBtn = document.getElementById('closeAuthBtn');
const authSubmitBtn = document.getElementById('authSubmitBtn');
const toggleAuthModeBtn = document.getElementById('toggleAuthModeBtn');
const authFormTitle = document.getElementById('authFormTitle');
const authFormSubtitle = document.getElementById('authFormSubtitle');
const authToggleText = document.getElementById('authToggleText');
const headerUsername = document.getElementById('headerUsername');
const logoutBtn = document.getElementById('logoutBtn');

const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
const uploadProgressContainer = document.getElementById('uploadProgressContainer');
const uploadFileName = document.getElementById('uploadFileName');
const uploadPercentage = document.getElementById('uploadPercentage');
const uploadProgressFill = document.getElementById('uploadProgressFill');
const docsList = document.getElementById('docsList');
const docCountBadge = document.getElementById('docCountBadge');
const statChunks = document.getElementById('statChunks');
const statDbSize = document.getElementById('statDbSize');
const chatWindow = document.getElementById('chatWindow');
const chatInput = document.getElementById('chatInput');
const sendBtn = document.getElementById('sendBtn');
const modelSelector = document.getElementById('modelSelector');

// Settings Modal Elements
const settingsModal = document.getElementById('settingsModal');
const openSettingsBtn = document.getElementById('openSettingsBtn');
const closeSettingsBtn = document.getElementById('closeSettingsBtn');
const cancelSettingsBtn = document.getElementById('cancelSettingsBtn');
const saveSettingsBtn = document.getElementById('saveSettingsBtn');
const apiKeyInput = document.getElementById('apiKeyInput');
const ragLimitSlider = document.getElementById('ragLimitSlider');
const sliderVal = document.getElementById('sliderVal');
const chatbotIdInput = document.getElementById('chatbotIdInput');
const widgetChatbotIdInput = document.getElementById('widgetChatbotIdInput');

// Analysis Modal Elements
const analysisModal = document.getElementById('analysisModal');
const analysisModalTitle = document.getElementById('analysisModalTitle');
const analysisModalBody = document.getElementById('analysisModalBody');
const closeAnalysisBtn = document.getElementById('closeAnalysisBtn');
const closeAnalysisBtnFooter = document.getElementById('closeAnalysisBtnFooter');

// Integration Modal Elements
const integrateModal = document.getElementById('integrateModal');
const openIntegrateBtn = document.getElementById('openIntegrateBtn');
const closeIntegrateBtn = document.getElementById('closeIntegrateBtn');
const closeIntegrateBtnFooter = document.getElementById('closeIntegrateBtnFooter');

// Integration Customization Elements
const widgetBotNameInput = document.getElementById('widgetBotNameInput');
const widgetColorInput = document.getElementById('widgetColorInput');
const widgetColorText = document.getElementById('widgetColorText');
const widgetGreetingInput = document.getElementById('widgetGreetingInput');
const widgetApiUrlInput = document.getElementById('widgetApiUrlInput');

// Mock Widget Preview Elements
const mockWidgetPanel = document.getElementById('mockWidgetPanel');
const mockWidgetLauncher = document.getElementById('mockWidgetLauncher');
const mockWidgetName = document.getElementById('mockWidgetName');
const mockWidgetGreeting = document.getElementById('mockWidgetGreeting');
const mockWidgetHeader = document.getElementById('mockWidgetHeader');
const mockWidgetSendBtn = document.getElementById('mockWidgetSendBtn');

// Code Snippet Elements
const embedCodeSnippet = document.getElementById('embedCodeSnippet');
const btnCopyEmbedCode = document.getElementById('btnCopyEmbedCode');

// ==========================================================================
// INITIALIZATION & SESSION MANAGEMENT
// ==========================================================================

// Setup global fetch wrapper to handle auth tokens and 401s
async function authFetch(url, options = {}) {
    options.headers = options.headers || {};
    if (state.sessionToken) {
        options.headers['Authorization'] = `Bearer ${state.sessionToken}`;
    }
    
    try {
        const response = await fetch(url, options);
        if (response.status === 401) {
            handleLogout();
            throw new Error("Session expired. Please log in again.");
        }
        return response;
    } catch (e) {
        throw e;
    }
}

// Fetch currently logged in user info
async function checkAuthSession() {
    if (!state.sessionToken) {
        showLandingScreen();
        return;
    }

    try {
        const res = await fetch('/api/auth/me', {
            headers: {
                'Authorization': `Bearer ${state.sessionToken}`
            }
        });

        if (res.ok) {
            const data = await res.json();
            state.username = data.email ? data.email.split('@')[0] : 'User';
            state.chatbotId = data.chatbotId;
            
            // Fetch configuration settings to sync state API Key
            await loadSettings();
            
            showDashboardScreen();
        } else {
            handleLogout();
        }
    } catch (e) {
        console.error("Auth session check failed:", e);
        showLandingScreen();
    }
}

function showLandingScreen() {
    landingContainer.style.display = 'block';
    authContainer.style.display = 'none';
    appContainer.style.display = 'none';
    document.body.classList.remove('dashboard-active');
}

function showAuthScreen(mode = 'login') {
    state.authMode = mode;
    authContainer.style.display = 'flex';
    
    // Sync forms UI based on mode
    if (mode === 'register') {
        authFormTitle.textContent = "Create an account.";
        authFormSubtitle.textContent = "Sign up below to launch your own custom AI chatbot.";
        authSubmitBtn.querySelector('span').textContent = "Create Account";
        authToggleText.textContent = "Already have an account?";
        toggleAuthModeBtn.textContent = "Log in here";
        confirmPasswordGroup.style.display = 'flex';
        authConfirmPassword.required = true;
    } else {
        authFormTitle.textContent = "Let's start a conversation.";
        authFormSubtitle.textContent = "Enter your details below to log in to your dashboard.";
        authSubmitBtn.querySelector('span').textContent = "Login to Dashboard";
        authToggleText.textContent = "Don't have an account?";
        toggleAuthModeBtn.textContent = "Create an account";
        confirmPasswordGroup.style.display = 'none';
        authConfirmPassword.required = false;
    }

    // Clear fields
    authEmail.value = '';
    authPassword.value = '';
    authConfirmPassword.value = '';
}

function closeAuthScreen() {
    authContainer.style.display = 'none';
}

function showDashboardScreen() {
    landingContainer.style.display = 'none';
    authContainer.style.display = 'none';
    appContainer.style.display = 'flex';
    document.body.classList.add('dashboard-active');
    
    headerUsername.textContent = state.username;
    
    // Load initial list and analytics
    refreshStats();
    refreshDocuments();
}

async function handleLogout() {
    try {
        if (state.sessionToken) {
            await fetch('/api/auth/logout', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${state.sessionToken}`
                }
            });
        }
    } catch (e) {
        console.error("Logout request failed:", e);
    }

    state.sessionToken = '';
    state.username = '';
    state.chatbotId = '';
    state.apiKey = '';
    state.chatHistory = [];
    
    localStorage.removeItem('docagent_session_token');
    
    // Reset Chat Box
    chatWindow.innerHTML = `
        <div class="chat-welcome-container">
            <div class="welcome-card">
                <div class="welcome-icon">
                    <i class="mdi mdi-robot-happy-outline"></i>
                </div>
                <h3>Welcome to DocAgent AI</h3>
                <p>I can analyze and answer detailed queries about your organization's employee handbooks, operational procedures, or legal policies. Upload files in the sidebar and ask away!</p>
            </div>
        </div>
    `;

    showLandingScreen();
}

// ==========================================================================
// REGISTER / LOGIN SUBMISSIONS
// ==========================================================================

async function handleAuthFormSubmit() {
    const email = authEmail.value.trim().toLowerCase();
    const password = authPassword.value;

    if (!email || !password) return;

    // Simple email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        alert("Please enter a valid email address.");
        return;
    }

    if (state.authMode === 'register') {
        const confirmPassword = authConfirmPassword.value;
        if (password !== confirmPassword) {
            alert("Passwords do not match!");
            return;
        }
        if (password.length < 4) {
            alert("Password must be at least 4 characters long.");
            return;
        }
    }

    authSubmitBtn.disabled = true;
    const originalText = authSubmitBtn.innerHTML;
    authSubmitBtn.innerHTML = `<i class="mdi mdi-loading mdi-spin"></i> Processing...`;

    const endpoint = state.authMode === 'login' ? '/api/auth/login' : '/api/auth/register';
    const requestBody = state.authMode === 'login' 
        ? { email, password }
        : { email, password, confirm_password: authConfirmPassword.value };

    try {
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestBody)
        });

        if (response.ok) {
            const data = await response.json();
            
            // Save state
            state.sessionToken = data.token;
            state.username = data.email ? data.email.split('@')[0] : 'User';
            state.chatbotId = data.chatbotId;
            localStorage.setItem('docagent_session_token', data.token);

            // Sync user settings
            await loadSettings();

            showDashboardScreen();
        } else {
            const err = await response.json();
            alert(err.detail || "Authentication failed. Check your inputs.");
        }
    } catch (e) {
        console.error("Authentication request failed:", e);
        alert("Unable to connect to backend server.");
    } finally {
        authSubmitBtn.disabled = false;
        authSubmitBtn.innerHTML = originalText;
    }
}

function toggleAuthMode() {
    if (state.authMode === 'login') {
        showAuthScreen('register');
    } else {
        showAuthScreen('login');
    }
}

// ==========================================================================
// DOM LISTENERS SETUP
// ==========================================================================

document.addEventListener('DOMContentLoaded', async () => {
    // Check initial session
    await checkAuthSession();

    // Auth listeners
    authForm.addEventListener('submit', (e) => {
        e.preventDefault();
        handleAuthFormSubmit();
    });
    toggleAuthModeBtn.addEventListener('click', (e) => {
        e.preventDefault();
        toggleAuthMode();
    });
    closeAuthBtn.addEventListener('click', closeAuthScreen);
    logoutBtn.addEventListener('click', handleLogout);

    // Landing navigation / CTA listeners
    document.getElementById('landingLoginBtn').addEventListener('click', () => showAuthScreen('login'));
    document.getElementById('landingRegisterBtn').addEventListener('click', () => showAuthScreen('register'));
    document.getElementById('heroStartBtn').addEventListener('click', () => showAuthScreen('register'));
    
    // Pricing cards CTAs
    document.querySelector('.select-free-plan').addEventListener('click', () => showAuthScreen('register'));
    document.querySelector('.select-pro-plan').addEventListener('click', () => showAuthScreen('register'));
    document.querySelector('.select-enterprise-plan').addEventListener('click', () => showAuthScreen('register'));

    // Setup input listeners
    chatInput.addEventListener('input', handleChatInputResize);
    chatInput.addEventListener('keydown', handleChatInputKeydown);
    sendBtn.addEventListener('click', handleSendMessage);

    // Setup drag-and-drop listeners
    setupDragAndDrop();

    // Setup Settings Modal listeners
    openSettingsBtn.addEventListener('click', () => {
        apiKeyInput.value = state.apiKey;
        chatbotIdInput.value = state.chatbotId;
        settingsModal.classList.add('open');
    });
    closeSettingsBtn.addEventListener('click', () => settingsModal.classList.remove('open'));
    cancelSettingsBtn.addEventListener('click', () => settingsModal.classList.remove('open'));
    saveSettingsBtn.addEventListener('click', saveSettings);
    
    ragLimitSlider.addEventListener('input', (e) => {
        sliderVal.textContent = `${e.target.value} Chunks`;
    });

    // Setup Analysis Modal listeners
    closeAnalysisBtn.addEventListener('click', () => analysisModal.classList.remove('open'));
    closeAnalysisBtnFooter.addEventListener('click', () => analysisModal.classList.remove('open'));

    // Setup Integration Modal listeners
    openIntegrateBtn.addEventListener('click', openIntegrationModal);
    closeIntegrateBtn.addEventListener('click', () => integrateModal.classList.remove('open'));
    closeIntegrateBtnFooter.addEventListener('click', () => integrateModal.classList.remove('open'));

    // Listen to changes in customization inputs to update snippet and preview
    widgetBotNameInput.addEventListener('input', updateWidgetIntegrationPreview);
    widgetColorInput.addEventListener('input', updateWidgetIntegrationPreview);
    widgetGreetingInput.addEventListener('input', updateWidgetIntegrationPreview);
    widgetApiUrlInput.addEventListener('input', updateWidgetIntegrationPreview);

    // Mock Widget Launcher click
    mockWidgetLauncher.addEventListener('click', () => toggleMockWidget());
    const mockCloseBtn = document.querySelector('.mock-widget-close-btn-mock');
    if (mockCloseBtn) {
        mockCloseBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleMockWidget(false);
        });
    }

    btnCopyEmbedCode.addEventListener('click', copyEmbedSnippet);
});

// ==========================================================================
// API CLIENT CALLS & STATS
// ==========================================================================

async function refreshStats() {
    if (!state.sessionToken) return;
    try {
        const res = await authFetch('/api/stats');
        if (res.ok) {
            const data = await res.json();
            statChunks.textContent = data.chunk_count.toLocaleString();
            
            // Format DB Size
            const totalBytes = data.uploads_size_bytes || 0;
            if (totalBytes < 1024 * 1024) {
                statDbSize.textContent = `${(totalBytes / 1024).toFixed(1)} KB`;
            } else {
                statDbSize.textContent = `${(totalBytes / (1024 * 1024)).toFixed(1)} MB`;
            }
        }
    } catch (e) {
        console.error("Failed to load statistics:", e);
    }
}

async function refreshDocuments() {
    if (!state.sessionToken) return;
    try {
        const res = await authFetch('/api/documents');
        if (res.ok) {
            state.documents = await res.json();
            renderDocuments();
        }
    } catch (e) {
        console.error("Failed to load documents list:", e);
    }
}

function renderDocuments() {
    docCountBadge.textContent = state.documents.length;
    
    if (state.documents.length === 0) {
        docsList.innerHTML = `
            <div class="empty-docs">
                <i class="mdi mdi-file-question-outline"></i>
                <p>No documents uploaded yet</p>
            </div>
        `;
        return;
    }

    docsList.innerHTML = '';
    state.documents.forEach(doc => {
        const card = document.createElement('div');
        card.className = 'doc-card';
        
        // Format size
        let sizeStr = `${(doc.file_size / 1024).toFixed(1)} KB`;
        if (doc.file_size > 1024 * 1024) {
            sizeStr = `${(doc.file_size / (1024 * 1024)).toFixed(1)} MB`;
        }

        const cardHtml = `
            <div class="doc-info-row">
                <div class="doc-icon">
                    <i class="mdi mdi-file-document-outline"></i>
                </div>
                <div class="doc-details">
                    <div class="doc-name" title="${escapeHtml(doc.filename)}">${escapeHtml(doc.filename)}</div>
                    <div class="doc-meta">
                        <span>${sizeStr}</span>
                        <span>•</span>
                        <span>${doc.chunk_count} chunks</span>
                    </div>
                </div>
            </div>
            <div class="doc-actions">
                ${doc.has_analysis ? `
                <button class="btn-small btn-view-analysis" onclick="viewAnalysisReport('${doc.id}', '${escapeHtml(doc.filename)}')">
                    <i class="mdi mdi-text-box-search-outline"></i> View Analysis
                </button>
                ` : ''}
                <button class="btn-small btn-delete-doc" onclick="deleteDocument('${doc.id}')">
                    <i class="mdi mdi-delete-outline"></i> Remove
                </button>
            </div>
        `;
        card.innerHTML = cardHtml;
        docsList.appendChild(card);
    });
}

async function deleteDocument(docId) {
    if (!confirm("Are you sure you want to delete this document? All embedded search chunks will be permanently removed.")) {
        return;
    }
    
    try {
        const res = await authFetch(`/api/documents/${docId}`, { method: 'DELETE' });
        if (res.ok) {
            refreshStats();
            refreshDocuments();
        } else {
            const err = await res.json();
            alert(`Error: ${err.detail || "Could not delete document."}`);
        }
    } catch (e) {
        alert("Failed to connect to the backend server.");
    }
}

async function viewAnalysisReport(docId, filename) {
    analysisModalBody.innerHTML = `
        <div class="loading-report">
            <i class="mdi mdi-loading mdi-spin"></i>
            <p>Fetching analysis report...</p>
        </div>
    `;
    analysisModalTitle.textContent = `Analysis: ${filename}`;
    analysisModal.classList.add('open');

    try {
        const res = await authFetch(`/api/documents/${docId}/analysis`);
        if (res.ok) {
            const data = await res.json();
            analysisModalBody.innerHTML = formatMarkdown(data.analysis_report);
        } else {
            analysisModalBody.innerHTML = `<p class="error-msg">⚠️ Report could not be retrieved.</p>`;
        }
    } catch (e) {
        analysisModalBody.innerHTML = `<p class="error-msg">⚠️ Failed to connect to server.</p>`;
    }
}

// ==========================================================================
// FILE UPLOADING FLOW
// ==========================================================================

function setupDragAndDrop() {
    dropZone.addEventListener('click', (e) => {
        if (!state.apiKey && !state.hasGlobalKey) {
            e.preventDefault();
            e.stopPropagation();
            alert("Gemini API Key is missing. Please configure your API Key in Settings (gear icon in top-right) before uploading documents.");
            return;
        }
        fileInput.click();
    });
    
    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            uploadFile(e.target.files[0]);
        }
    });

    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('hover');
    });

    dropZone.addEventListener('dragleave', () => {
        dropZone.classList.remove('hover');
    });

    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('hover');
        if (e.dataTransfer.files.length > 0) {
            uploadFile(e.dataTransfer.files[0]);
        }
    });
}

function uploadFile(file) {
    // Intercept upload if no Gemini API key is configured
    if (!state.apiKey && !state.hasGlobalKey) {
        alert("Gemini API Key is missing. Please configure your API Key in Settings (gear icon in top-right) before uploading documents.");
        fileInput.value = ''; // Reset file input
        return;
    }

    // Show progress panel
    uploadFileName.textContent = file.name;
    uploadPercentage.textContent = "0%";
    uploadProgressFill.style.width = "0%";
    uploadProgressContainer.style.display = "block";
    
    const formData = new FormData();
    formData.append("file", file);
    if (state.apiKey) {
        formData.append("api_key", state.apiKey);
    }

    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/upload", true);
    if (state.sessionToken) {
        xhr.setRequestHeader("Authorization", `Bearer ${state.sessionToken}`);
    }

    // Track upload progress
    xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
            const percentComplete = Math.round((e.loaded / e.total) * 100);
            const displayPercent = percentComplete >= 100 ? 99 : percentComplete;
            uploadPercentage.textContent = `${displayPercent}%`;
            uploadProgressFill.style.width = `${displayPercent}%`;
        }
    };

    xhr.onload = () => {
        uploadProgressContainer.style.display = "none";
        if (xhr.status === 200) {
            refreshStats();
            refreshDocuments();
            if (state.documents.length === 0) {
                appendAgentWelcome(file.name);
            }
        } else if (xhr.status === 401) {
            handleLogout();
            alert("Your session has expired. Please log in again.");
        } else {
            let errorMsg = "Could not upload document.";
            try {
                const response = JSON.parse(xhr.responseText);
                errorMsg = response.detail || errorMsg;
            } catch (e) {}
            alert(`Error: ${errorMsg}`);
        }
    };

    xhr.onerror = () => {
        uploadProgressContainer.style.display = "none";
        alert("A network error occurred while uploading.");
    };

    xhr.send(formData);
}

function appendAgentWelcome(filename) {
    const welcome = document.querySelector('.chat-welcome-container');
    if (welcome) welcome.style.display = 'none';

    appendMessage('agent', `I have successfully parsed, vectorized, and compiled an initial summary report for **${filename}**. I am now ready to answer any detailed policy questions about it! 📑`);
}

// ==========================================================================
// CHAT PLAYGROUND FLOW
// ==========================================================================

function handleChatInputResize() {
    chatInput.style.height = 'auto';
    chatInput.style.height = `${Math.min(chatInput.scrollHeight, 120)}px`;
    sendBtn.disabled = chatInput.value.trim() === '';
}

function handleChatInputKeydown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSendMessage();
    }
}

function applySuggestion(text) {
    chatInput.value = text;
    handleChatInputResize();
    handleSendMessage();
}

async function handleSendMessage() {
    const text = chatInput.value.trim();
    if (!text || state.isTyping) return;

    chatInput.value = '';
    handleChatInputResize();
    
    const welcome = document.querySelector('.chat-welcome-container');
    if (welcome) welcome.style.display = 'none';

    appendMessage('user', text);
    state.chatHistory.push({ role: 'user', text: text });
    
    const typingBubbleId = appendTypingIndicator();
    state.isTyping = true;

    try {
        const headers = {
            'Content-Type': 'application/json'
        };
        if (state.apiKey) {
            headers['X-API-Key'] = state.apiKey;
        }

        const res = await fetch('/api/chat', {
            method: 'POST',
            headers: headers,
            body: JSON.stringify({
                query: text,
                chat_history: state.chatHistory.slice(-10),
                model: modelSelector.value,
                chatbot_id: state.chatbotId
            })
        });

        removeTypingIndicator(typingBubbleId);
        state.isTyping = false;

        if (res.ok) {
            const data = await res.json();
            appendMessage('agent', data.answer, data.context);
            state.chatHistory.push({ role: 'model', text: data.answer });
        } else {
            const err = await res.json();
            appendMessage('agent', `⚠️ **Error matching query:** ${err.detail || "An internal error occurred."}`);
        }
    } catch (e) {
        removeTypingIndicator(typingBubbleId);
        state.isTyping = false;
        appendMessage('agent', `⚠️ **Connection Error:** Failed to communicate with the FastAPI backend. Check that the server is running.`);
    }
}

function appendMessage(sender, text, context = []) {
    const msg = document.createElement('div');
    msg.className = `chat-msg chat-msg-${sender}`;
    
    const avatar = document.createElement('div');
    avatar.className = 'msg-avatar';
    avatar.innerHTML = sender === 'user' ? '<i class="mdi mdi-account"></i>' : '<i class="mdi mdi-robot-outline"></i>';
    
    const bubble = document.createElement('div');
    bubble.className = 'msg-bubble';
    
    if (sender === 'user') {
        bubble.textContent = text;
    } else {
        const textContainer = document.createElement('div');
        textContainer.className = 'markdown-content';
        textContainer.innerHTML = formatMarkdown(text);
        bubble.appendChild(textContainer);
        
        if (context && context.length > 0) {
            const sourcesId = `sources_${Date.now()}`;
            const sourcesCard = document.createElement('div');
            sourcesCard.className = 'sources-card';
            sourcesCard.innerHTML = `
                <button class="sources-trigger" onclick="toggleSources('${sourcesId}')">
                    <i class="mdi mdi-chevron-down"></i> Referenced ${context.length} Source Document(s)
                </button>
                <div class="sources-content" id="${sourcesId}" style="display: none;">
                    ${context.map((chunk, idx) => `
                        <div class="source-item">
                            <div class="source-item-header">
                                <span>[${idx+1}] ${escapeHtml(chunk.filename)} (Chunk #${chunk.chunk_index})</span>
                                <span class="source-score">Match: ${(chunk.score * 100).toFixed(0)}%</span>
                            </div>
                            <p>${escapeHtml(chunk.text.substring(0, 150))}...</p>
                        </div>
                    `).join('')}
                </div>
            `;
            bubble.appendChild(sourcesCard);
        }
    }

    msg.appendChild(avatar);
    msg.appendChild(bubble);
    chatWindow.appendChild(msg);
    scrollChatToBottom();
}

function appendTypingIndicator() {
    const id = `typing_${Date.now()}`;
    const msg = document.createElement('div');
    msg.className = 'chat-msg chat-msg-agent';
    msg.id = id;
    
    const avatar = document.createElement('div');
    avatar.className = 'msg-avatar';
    avatar.innerHTML = '<i class="mdi mdi-robot-outline"></i>';
    
    const bubble = document.createElement('div');
    bubble.className = 'msg-bubble';
    
    bubble.innerHTML = `
        <div class="typing-indicator">
            <span class="typing-dot"></span>
            <span class="typing-dot"></span>
            <span class="typing-dot"></span>
        </div>
    `;
    
    msg.appendChild(avatar);
    msg.appendChild(bubble);
    chatWindow.appendChild(msg);
    scrollChatToBottom();
    return id;
}

function removeTypingIndicator(id) {
    const elem = document.getElementById(id);
    if (elem) elem.remove();
}

function toggleSources(id) {
    const container = document.getElementById(id);
    const trigger = container.previousElementSibling;
    const isHidden = container.style.display === 'none';
    
    container.style.display = isHidden ? 'flex' : 'none';
    trigger.classList.toggle('active', isHidden);
}

function scrollChatToBottom() {
    chatWindow.scrollTop = chatWindow.scrollHeight;
}

// ==========================================================================
// CONFIGURATION & SETTINGS SAVING
// ==========================================================================

async function loadSettings() {
    try {
        const res = await authFetch('/api/settings');
        if (res.ok) {
            const data = await res.json();
            state.apiKey = data.api_key;
            state.chatbotId = data.chatbot_id;
            state.hasGlobalKey = data.has_global_key;
            
            apiKeyInput.value = state.apiKey;
            chatbotIdInput.value = state.chatbotId;
        }
    } catch (e) {
        console.error("Failed to load settings from server:", e);
    }
}

async function saveSettings() {
    const key = apiKeyInput.value.trim();
    state.apiKey = key;

    try {
        const res = await authFetch('/api/settings', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ api_key: key })
        });

        if (res.ok) {
            alert("Configurations saved in your secure SaaS account!");
            settingsModal.classList.remove('open');
        } else {
            const err = await res.json();
            alert(`Error saving configurations: ${err.detail || "Unknown error"}`);
        }
    } catch (e) {
        console.error("Failed to save settings:", e);
        alert("Failed to reach server to save configurations.");
    }
}

// ==========================================================================
// UTILITY FUNCTIONS & FORMATTERS
// ==========================================================================

function escapeHtml(text) {
    if (!text) return '';
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function formatMarkdown(text) {
    if (!text) return '';
    
    let html = escapeHtml(text);

    // Headers: ### Header
    html = html.replace(/^### (.*?)$/gm, '<h3>$1</h3>');
    html = html.replace(/^## (.*?)$/gm, '<h2>$1</h2>');
    html = html.replace(/^# (.*?)$/gm, '<h1>$1</h1>');

    // Bold: **text** -> <strong>text</strong>
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

    // Italics: *text* or _text_ -> <em>text</em>
    html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');
    html = html.replace(/_(.*?)_/g, '<em>$1</em>');

    // Code: `code` -> <code>code</code>
    html = html.replace(/`(.*?)`/g, '<code>$1</code>');

    // Bullet Lists: - item -> <li>item</li>
    html = html.replace(/^-\s+(.*)$/gm, '<li>$1</li>');
    html = html.replace(/(<li>.*?<\/li>)+/gs, '<ul>$&</ul>');

    // Numbered Lists: 1. item -> <li>item</li>
    html = html.replace(/^\d+\.\s+(.*)$/gm, '<li>$1</li>');
    html = html.replace(/(<li>.*?<\/li>)+/gs, '<ul>$&</ul>');

    // Paragraphs: Split on double newlines
    html = html.replace(/\n\n/g, '</p><p>');
    
    // Convert remaining single newlines to line breaks (if not inside list tag)
    html = html.replace(/\n/g, '<br>');
    
    // Wrap text in paragraphs if not wrapped by headers
    if (!html.startsWith('<h') && !html.startsWith('<p>')) {
        html = '<p>' + html + '</p>';
    }

    return html;
}

// ==========================================================================
// INTEGRATION WIDGET LOGIC
// ==========================================================================

function openIntegrationModal() {
    if (!widgetApiUrlInput.value) {
        widgetApiUrlInput.value = window.location.origin;
    }
    updateWidgetIntegrationPreview();
    integrateModal.classList.add('open');
}

function updateWidgetIntegrationPreview() {
    const name = widgetBotNameInput.value.trim() || 'DocAgent AI';
    const color = widgetColorInput.value || '#8B5CF6';
    const greeting = widgetGreetingInput.value.trim() || 'Hello! How can I help you today?';
    const apiUrl = widgetApiUrlInput.value.trim() || window.location.origin;

    widgetChatbotIdInput.value = state.chatbotId;
    widgetColorText.textContent = color.toUpperCase();

    mockWidgetName.textContent = name;
    mockWidgetGreeting.textContent = greeting;
    mockWidgetHeader.style.background = color;
    mockWidgetLauncher.style.backgroundColor = color;
    mockWidgetSendBtn.style.backgroundColor = color;

    const escName = name.replace(/"/g, '&quot;');
    const escGreeting = greeting.replace(/"/g, '&quot;');
    
    const codeSnippet = `<script \n  src="${apiUrl}/widget.js" \n  data-api-url="${apiUrl}"\n  data-chatbot-id="${state.chatbotId}"\n  data-bot-name="${escName}"\n  data-color="${color}"\n  data-greeting="${escGreeting}"\n  defer>\n</script>`;
    embedCodeSnippet.textContent = codeSnippet;
}

let mockWidgetOpen = false;
function toggleMockWidget(forceOpen = null) {
    mockWidgetOpen = forceOpen !== null ? forceOpen : !mockWidgetOpen;
    if (mockWidgetOpen) {
        mockWidgetPanel.classList.add('open');
        mockWidgetLauncher.innerHTML = '<i class="mdi mdi-close"></i>';
    } else {
        mockWidgetPanel.classList.remove('open');
        mockWidgetLauncher.innerHTML = '<i class="mdi mdi-comment-text-multiple-outline"></i>';
    }
}

async function copyEmbedSnippet() {
    const snippetText = embedCodeSnippet.textContent;
    try {
        await navigator.clipboard.writeText(snippetText);
        
        const originalHtml = btnCopyEmbedCode.innerHTML;
        btnCopyEmbedCode.innerHTML = '<i class="mdi mdi-check"></i> Copied!';
        btnCopyEmbedCode.style.background = 'var(--secondary)';
        
        setTimeout(() => {
            btnCopyEmbedCode.innerHTML = originalHtml;
            btnCopyEmbedCode.style.background = '';
        }, 2000);
    } catch (err) {
        alert('Failed to copy the snippet. Please select and copy manually.');
    }
}

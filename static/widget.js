(function() {
    // 1. Resolve configuration from script data-attributes
    const currentScript = document.currentScript || (() => {
        const scripts = document.getElementsByTagName('script');
        return scripts[scripts.length - 1];
    })();

    const apiUrl = (currentScript.getAttribute('data-api-url') || window.location.origin).replace(/\/$/, '');
    const chatbotId = currentScript.getAttribute('data-chatbot-id') || 'default';
    const botName = currentScript.getAttribute('data-bot-name') || 'DocAgent AI';
    const themeColor = currentScript.getAttribute('data-color') || '#8B5CF6';
    const greetingMsg = currentScript.getAttribute('data-greeting') || 'Hello! How can I help you with our company policies today? 📑';

    // State
    const state = {
        chatHistory: [],
        isOpen: false,
        isTyping: false,
        hasGreeted: false
    };

    // Helper to escape HTML to prevent XSS
    function escapeHtml(text) {
        if (!text) return '';
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    // Helper to format basic markdown (bold, italic, lists, paragraphs)
    function formatMarkdown(text) {
        if (!text) return '';
        let html = escapeHtml(text);

        // Bold: **text** -> <strong>text</strong>
        html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

        // Italics: *text* or _text_ -> <em>text</em>
        html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');
        html = html.replace(/_(.*?)_/g, '<em>$1</em>');

        // Inline Code: `code` -> <code>code</code>
        html = html.replace(/`(.*?)`/g, '<code>$1</code>');

        // Bullet lists
        html = html.replace(/^-\s+(.*)$/gm, '<li>$1</li>');
        html = html.replace(/(<li>.*?<\/li>)+/gs, '<ul>$&</ul>');

        // Numbered lists
        html = html.replace(/^\d+\.\s+(.*)$/gm, '<li>$1</li>');
        html = html.replace(/(<li>.*?<\/li>)+/gs, '<ul>$&</ul>');

        // Paragraphs
        html = html.replace(/\n\n/g, '</p><p>');
        html = html.replace(/\n/g, '<br>');

        if (!html.startsWith('<p>') && !html.startsWith('<ul>')) {
            html = '<p>' + html + '</p>';
        }
        return html;
    }

    // Hex to RGBA utility for glow/shadow effects
    function hexToRgbA(hex, alpha) {
        let c;
        if (/^#([A-Fa-f0-9]{3}){1,2}$/.test(hex)) {
            c = hex.substring(1).split('');
            if (c.length === 3) {
                c = [c[0], c[0], c[1], c[1], c[2], c[2]];
            }
            c = '0x' + c.join('');
            return `rgba(${[(c >> 16) & 255, (c >> 8) & 255, c & 255].join(',')},${alpha})`;
        }
        return `rgba(139, 92, 246, ${alpha})`; // fallback
    }

    const glowColor = hexToRgbA(themeColor, 0.3);
    const borderHoverColor = hexToRgbA(themeColor, 0.25);

    // 2. Inject Styles
    const styleTag = document.createElement('style');
    styleTag.innerHTML = `
        /* Main Container scoped classes to avoid page conflicts */
        .docagent-widget-container {
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            position: fixed;
            bottom: 24px;
            right: 24px;
            z-index: 2147483647;
            display: flex;
            flex-direction: column;
            align-items: flex-end;
        }

        /* Floating Launcher Bubble */
        .docagent-widget-launcher {
            width: 60px;
            height: 60px;
            border-radius: 50%;
            background: linear-gradient(135deg, ${themeColor} 0%, rgba(99, 102, 241, 0.95) 100%);
            box-shadow: 0 8px 24px ${glowColor}, 0 2px 8px rgba(0,0,0,0.2);
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            border: 1px solid rgba(255, 255, 255, 0.1);
        }

        .docagent-widget-launcher:hover {
            transform: scale(1.08) translateY(-2px);
            box-shadow: 0 12px 28px ${glowColor}, 0 4px 12px rgba(0,0,0,0.2);
        }

        .docagent-widget-launcher:active {
            transform: scale(0.95);
        }

        .docagent-widget-launcher svg {
            width: 28px;
            height: 28px;
            fill: #ffffff;
            transition: transform 0.3s ease;
        }

        .docagent-widget-launcher.open svg {
            transform: rotate(90deg);
        }

        /* Chat Panel/Window */
        .docagent-widget-panel {
            width: 380px;
            height: 520px;
            max-height: calc(100vh - 120px);
            max-width: calc(100vw - 48px);
            background: #111827; /* sleek dark theme background */
            border: 1px solid rgba(255, 255, 255, 0.08);
            border-radius: 20px;
            box-shadow: 0 16px 40px rgba(0,0,0,0.4), 0 0 2px rgba(255,255,255,0.1);
            display: flex;
            flex-direction: column;
            overflow: hidden;
            margin-bottom: 16px;
            opacity: 0;
            transform: translateY(20px) scale(0.95);
            pointer-events: none;
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            transform-origin: bottom right;
        }

        .docagent-widget-panel.open {
            opacity: 1;
            transform: translateY(0) scale(1);
            pointer-events: auto;
        }

        /* Header */
        .docagent-widget-header {
            background: linear-gradient(135deg, ${themeColor} 0%, rgba(99, 102, 241, 0.9) 100%);
            padding: 16px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            color: #ffffff;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            border-bottom: 1px solid rgba(255,255,255,0.1);
        }

        .docagent-widget-header-info {
            display: flex;
            align-items: center;
            gap: 12px;
        }

        .docagent-widget-header-avatar {
            width: 36px;
            height: 36px;
            border-radius: 50%;
            background: rgba(255,255,255,0.15);
            display: flex;
            align-items: center;
            justify-content: center;
            border: 1px solid rgba(255,255,255,0.2);
        }

        .docagent-widget-header-avatar svg {
            width: 20px;
            height: 20px;
            fill: #ffffff;
        }

        .docagent-widget-header-details {
            display: flex;
            flex-direction: column;
        }

        .docagent-widget-header-name {
            font-size: 15px;
            font-weight: 600;
            letter-spacing: 0.2px;
            margin: 0;
        }

        .docagent-widget-header-status {
            font-size: 11px;
            opacity: 0.85;
            display: flex;
            align-items: center;
            gap: 4px;
            margin-top: 1px;
        }

        .docagent-widget-header-dot {
            width: 6px;
            height: 6px;
            background: #10B981; /* green dot */
            border-radius: 50%;
            display: inline-block;
            box-shadow: 0 0 6px #10B981;
        }

        .docagent-widget-header-close {
            background: none;
            border: none;
            cursor: pointer;
            color: rgba(255, 255, 255, 0.8);
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 4px;
            border-radius: 50%;
            transition: background 0.2s;
        }

        .docagent-widget-header-close:hover {
            background: rgba(255, 255, 255, 0.1);
            color: #ffffff;
        }

        .docagent-widget-header-close svg {
            width: 20px;
            height: 20px;
            fill: currentColor;
        }

        /* Message List */
        .docagent-widget-chat-history {
            flex: 1;
            padding: 16px;
            overflow-y: auto;
            display: flex;
            flex-direction: column;
            gap: 12px;
            background-color: #0f172a;
        }

        /* Scrollbar */
        .docagent-widget-chat-history::-webkit-scrollbar {
            width: 5px;
        }
        .docagent-widget-chat-history::-webkit-scrollbar-track {
            background: transparent;
        }
        .docagent-widget-chat-history::-webkit-scrollbar-thumb {
            background: rgba(255, 255, 255, 0.1);
            border-radius: 4px;
        }

        /* Message bubble structure */
        .docagent-widget-msg {
            display: flex;
            align-items: flex-start;
            gap: 8px;
            max-width: 85%;
        }

        .docagent-widget-msg-user {
            align-self: flex-end;
            flex-direction: row-reverse;
        }

        .docagent-widget-msg-agent {
            align-self: flex-start;
        }

        .docagent-widget-msg-avatar {
            width: 28px;
            height: 28px;
            border-radius: 50%;
            background: rgba(255, 255, 255, 0.05);
            display: flex;
            align-items: center;
            justify-content: center;
            flex-shrink: 0;
            border: 1px solid rgba(255, 255, 255, 0.08);
            margin-top: 2px;
        }

        .docagent-widget-msg-avatar svg {
            width: 14px;
            height: 14px;
            fill: #9CA3AF;
        }

        .docagent-widget-msg-bubble {
            padding: 10px 14px;
            border-radius: 16px;
            font-size: 13.5px;
            line-height: 1.5;
            color: #E2E8F0;
            word-break: break-word;
        }

        .docagent-widget-msg-user .docagent-widget-msg-bubble {
            background: ${themeColor};
            color: #ffffff;
            border-bottom-right-radius: 4px;
            box-shadow: 0 4px 10px ${glowColor};
        }

        .docagent-widget-msg-agent .docagent-widget-msg-bubble {
            background: rgba(255, 255, 255, 0.04);
            border: 1px solid rgba(255, 255, 255, 0.06);
            border-bottom-left-radius: 4px;
        }

        /* Markdown styling inside bubbles */
        .docagent-widget-msg-bubble p {
            margin: 0 0 8px 0;
        }
        .docagent-widget-msg-bubble p:last-child {
            margin-bottom: 0;
        }
        .docagent-widget-msg-bubble strong {
            color: #ffffff;
            font-weight: 600;
        }
        .docagent-widget-msg-bubble code {
            background: rgba(255, 255, 255, 0.1);
            padding: 2px 4px;
            border-radius: 4px;
            font-family: monospace;
            font-size: 12px;
            color: #FF79C6;
        }
        .docagent-widget-msg-bubble ul, .docagent-widget-msg-bubble ol {
            margin: 4px 0 8px 16px;
            padding: 0;
        }
        .docagent-widget-msg-bubble li {
            margin-bottom: 4px;
        }

        /* Sources Card */
        .docagent-widget-sources {
            margin-top: 8px;
            border-top: 1px solid rgba(255, 255, 255, 0.08);
            padding-top: 6px;
        }

        .docagent-widget-sources-btn {
            background: none;
            border: none;
            color: #9CA3AF;
            font-size: 11px;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 4px;
            padding: 0;
            font-weight: 500;
            transition: color 0.2s;
        }

        .docagent-widget-sources-btn:hover {
            color: ${themeColor};
        }

        .docagent-widget-sources-btn svg {
            width: 12px;
            height: 12px;
            fill: currentColor;
            transition: transform 0.2s;
        }

        .docagent-widget-sources-btn.active svg {
            transform: rotate(180deg);
        }

        .docagent-widget-sources-content {
            display: none;
            flex-direction: column;
            gap: 6px;
            margin-top: 6px;
        }

        .docagent-widget-source-item {
            background: rgba(255, 255, 255, 0.02);
            border: 1px solid rgba(255, 255, 255, 0.04);
            border-radius: 6px;
            padding: 6px;
            font-size: 10.5px;
        }

        .docagent-widget-source-title {
            font-weight: 600;
            color: #CBD5E1;
            margin-bottom: 2px;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        .docagent-widget-source-text {
            color: #94A3B8;
            margin: 0;
        }

        /* Typing indicator */
        .docagent-widget-typing {
            display: flex;
            align-items: center;
            gap: 4px;
            padding: 4px 6px;
        }

        .docagent-widget-typing-dot {
            width: 6px;
            height: 6px;
            background: #9CA3AF;
            border-radius: 50%;
            animation: docagent-typing 1.4s infinite both;
        }

        .docagent-widget-typing-dot:nth-child(1) { animation-delay: 0s; }
        .docagent-widget-typing-dot:nth-child(2) { animation-delay: 0.2s; }
        .docagent-widget-typing-dot:nth-child(3) { animation-delay: 0.4s; }

        @keyframes docagent-typing {
            0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; }
            40% { transform: scale(1); opacity: 1; }
        }

        /* Footer Input Area */
        .docagent-widget-footer {
            padding: 12px;
            background: #111827;
            border-top: 1px solid rgba(255, 255, 255, 0.08);
            display: flex;
            flex-direction: column;
            gap: 6px;
        }

        .docagent-widget-input-row {
            display: flex;
            align-items: center;
            background: rgba(255, 255, 255, 0.03);
            border: 1px solid rgba(255, 255, 255, 0.08);
            border-radius: 12px;
            padding: 4px 6px 4px 12px;
            transition: border-color 0.2s, box-shadow 0.2s;
        }

        .docagent-widget-input-row:focus-within {
            border-color: ${themeColor};
            box-shadow: 0 0 0 2px ${glowColor};
        }

        .docagent-widget-input {
            flex: 1;
            background: transparent;
            border: none;
            color: #F3F4F6;
            font-size: 13px;
            outline: none;
            padding: 8px 0;
            resize: none;
            font-family: inherit;
            max-height: 80px;
        }

        .docagent-widget-input::placeholder {
            color: #6B7280;
        }

        .docagent-widget-send-btn {
            background: ${themeColor};
            border: none;
            width: 32px;
            height: 32px;
            border-radius: 8px;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            color: #ffffff;
            transition: all 0.2s;
            flex-shrink: 0;
        }

        .docagent-widget-send-btn:hover:not(:disabled) {
            transform: scale(1.05);
            background: rgba(99, 102, 241, 0.95);
        }

        .docagent-widget-send-btn:disabled {
            background: rgba(255, 255, 255, 0.04);
            color: rgba(255, 255, 255, 0.15);
            cursor: not-allowed;
            border: 1px solid rgba(255, 255, 255, 0.02);
        }

        .docagent-widget-send-btn svg {
            width: 14px;
            height: 14px;
            fill: currentColor;
        }

        .docagent-widget-brand-link {
            font-size: 10px;
            color: #4B5563;
            text-align: center;
            text-decoration: none;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 2px;
            margin-top: 2px;
        }
        
        .docagent-widget-brand-link:hover {
            color: #9CA3AF;
        }

        .docagent-widget-brand-link svg {
            width: 8px;
            height: 8px;
            fill: currentColor;
        }
    `;
    document.head.appendChild(styleTag);

    // 3. SVG Constants
    const SVGS = {
        robot: `<svg viewBox="0 0 24 24"><path d="M12 2A2 2 0 0 1 14 4V5.07A8 8 0 0 1 21 13V15A3 3 0 0 1 18 18H17.82A6 6 0 0 1 16 21H14A2 2 0 0 1 12 19A2 2 0 0 1 10 21H8A6 6 0 0 1 6.18 18H6A3 3 0 0 1 3 15V13A8 8 0 0 1 10 5.07V4A2 2 0 0 1 12 2M12 7A6 6 0 0 0 6 13V15A1 1 0 0 0 7 16H17A1 1 0 0 0 18 15V13A6 6 0 0 0 12 7M9 10A1.5 1.5 0 1 1 7.5 11.5A1.5 1.5 0 0 1 9 10M15 10A1.5 1.5 0 1 1 13.5 11.5A1.5 1.5 0 0 1 15 10Z"/></svg>`,
        user: `<svg viewBox="0 0 24 24"><path d="M12,4A4,4 0 0,1 16,8A4,4 0 0,1 12,12A4,4 0 0,1 8,8A4,4 0 0,1 12,4M12,14C16.42,14 20,15.79 20,18V20H4V18C4,15.79 7.58,14 12,14Z"/></svg>`,
        chat: `<svg viewBox="0 0 24 24"><path d="M20,2H4A2,2 0 0,0 2,4V22L6,18H20A2,2 0 0,0 22,16V4A2,2 0 0,0 20,2M20,16H5.17L4,17.17V4H20V16Z"/></svg>`,
        close: `<svg viewBox="0 0 24 24"><path d="M19,6.41L17.59,5L12,10.59L6.41,5L5,6.41L10.59,12L5,17.59L6.41,19L12,13.41L17.59,19L19,17.59L13.41,12L19,6.41Z"/></svg>`,
        send: `<svg viewBox="0 0 24 24"><path d="M2,21L23,12L2,3V10L17,12L2,14V21Z"/></svg>`,
        chevron: `<svg viewBox="0 0 24 24"><path d="M7.41,8.58L12,13.17L16.59,8.58L18,10L12,16L6,10L7.41,8.58Z"/></svg>`,
        shield: `<svg viewBox="0 0 24 24"><path d="M12,22C17.07,18.76 20,14.07 20,10V4L12,1L4,4V10C4,14.07 6.93,18.76 12,22Z"/></svg>`
    };

    // 4. Create DOM elements
    const widgetContainer = document.createElement('div');
    widgetContainer.className = 'docagent-widget-container';

    // Panel
    const panel = document.createElement('div');
    panel.className = 'docagent-widget-panel';
    panel.innerHTML = `
        <div class="docagent-widget-header">
            <div class="docagent-widget-header-info">
                <div class="docagent-widget-header-avatar">
                    ${SVGS.robot}
                </div>
                <div class="docagent-widget-header-details">
                    <span class="docagent-widget-header-name">${escapeHtml(botName)}</span>
                    <span class="docagent-widget-header-status">
                        <span class="docagent-widget-header-dot"></span>
                        Active Assistant
                    </span>
                </div>
            </div>
            <button class="docagent-widget-header-close" title="Close chat">
                ${SVGS.close}
            </button>
        </div>
        <div class="docagent-widget-chat-history"></div>
        <div class="docagent-widget-footer">
            <div class="docagent-widget-input-row">
                <textarea class="docagent-widget-input" placeholder="Type a message..." rows="1"></textarea>
                <button class="docagent-widget-send-btn" disabled>
                    ${SVGS.send}
                </button>
            </div>
            <a href="${apiUrl}" target="_blank" class="docagent-widget-brand-link">
                Powered by ${SVGS.shield} DocAgent AI
            </a>
        </div>
    `;

    // Launcher
    const launcher = document.createElement('div');
    launcher.className = 'docagent-widget-launcher';
    launcher.innerHTML = SVGS.chat;

    widgetContainer.appendChild(panel);
    widgetContainer.appendChild(launcher);
    document.body.appendChild(widgetContainer);

    // Dom elements references
    const chatHistoryEl = panel.querySelector('.docagent-widget-chat-history');
    const inputEl = panel.querySelector('.docagent-widget-input');
    const sendBtnEl = panel.querySelector('.docagent-widget-send-btn');
    const closeBtnEl = panel.querySelector('.docagent-widget-header-close');

    // 5. Message rendering functions
    function appendMessage(sender, text, context = null) {
        const msgWrapper = document.createElement('div');
        msgWrapper.className = `docagent-widget-msg docagent-widget-msg-${sender}`;

        const avatar = document.createElement('div');
        avatar.className = 'docagent-widget-msg-avatar';
        avatar.innerHTML = sender === 'user' ? SVGS.user : SVGS.robot;

        const bubble = document.createElement('div');
        bubble.className = 'docagent-widget-msg-bubble';

        if (sender === 'user') {
            bubble.textContent = text;
        } else {
            bubble.innerHTML = formatMarkdown(text);

            // Sources/RAG dropdown
            if (context && context.length > 0) {
                const sourcesContainer = document.createElement('div');
                sourcesContainer.className = 'docagent-widget-sources';

                const toggleBtn = document.createElement('button');
                toggleBtn.className = 'docagent-widget-sources-btn';
                toggleBtn.innerHTML = `${SVGS.chevron} View ${context.length} references`;

                const contentList = document.createElement('div');
                contentList.className = 'docagent-widget-sources-content';

                context.forEach((chunk, index) => {
                    const item = document.createElement('div');
                    item.className = 'docagent-widget-source-item';
                    item.innerHTML = `
                        <div class="docagent-widget-source-title">[${index + 1}] ${escapeHtml(chunk.filename)}</div>
                        <p class="docagent-widget-source-text">"${escapeHtml(chunk.text.substring(0, 100))}..."</p>
                    `;
                    contentList.appendChild(item);
                });

                toggleBtn.addEventListener('click', () => {
                    const isHidden = contentList.style.display === 'none' || contentList.style.display === '';
                    contentList.style.display = isHidden ? 'flex' : 'none';
                    toggleBtn.classList.toggle('active', isHidden);
                });

                sourcesContainer.appendChild(toggleBtn);
                sourcesContainer.appendChild(contentList);
                bubble.appendChild(sourcesContainer);
            }
        }

        msgWrapper.appendChild(avatar);
        msgWrapper.appendChild(bubble);
        chatHistoryEl.appendChild(msgWrapper);
        chatHistoryEl.scrollTop = chatHistoryEl.scrollHeight;
    }

    function appendTypingIndicator() {
        const indicatorId = 'docagent-typing-' + Date.now();
        const msgWrapper = document.createElement('div');
        msgWrapper.className = 'docagent-widget-msg docagent-widget-msg-agent';
        msgWrapper.id = indicatorId;

        const avatar = document.createElement('div');
        avatar.className = 'docagent-widget-msg-avatar';
        avatar.innerHTML = SVGS.robot;

        const bubble = document.createElement('div');
        bubble.className = 'docagent-widget-msg-bubble';
        bubble.innerHTML = `
            <div class="docagent-widget-typing">
                <span class="docagent-widget-typing-dot"></span>
                <span class="docagent-widget-typing-dot"></span>
                <span class="docagent-widget-typing-dot"></span>
            </div>
        `;

        msgWrapper.appendChild(avatar);
        msgWrapper.appendChild(bubble);
        chatHistoryEl.appendChild(msgWrapper);
        chatHistoryEl.scrollTop = chatHistoryEl.scrollHeight;
        return indicatorId;
    }

    function removeTypingIndicator(indicatorId) {
        const el = document.getElementById(indicatorId);
        if (el) el.remove();
    }

    // 6. Action handlers
    function toggleChat(forceOpen = null) {
        state.isOpen = forceOpen !== null ? forceOpen : !state.isOpen;
        if (state.isOpen) {
            panel.classList.add('open');
            launcher.classList.add('open');
            launcher.innerHTML = SVGS.close;
            inputEl.focus();

            // Greet on first open
            if (!state.hasGreeted) {
                appendMessage('agent', greetingMsg);
                state.hasGreeted = true;
            }
        } else {
            panel.classList.remove('open');
            launcher.classList.remove('open');
            launcher.innerHTML = SVGS.chat;
        }
    }

    async function handleSendMessage() {
        const text = inputEl.value.trim();
        if (!text || state.isTyping) return;

        // Clear input
        inputEl.value = '';
        inputEl.style.height = 'auto';
        sendBtnEl.disabled = true;

        // Render user message
        appendMessage('user', text);
        state.chatHistory.push({ role: 'user', text: text });

        // Show typing indicator
        state.isTyping = true;
        const typingId = appendTypingIndicator();

        try {
            const response = await fetch(`${apiUrl}/api/chat`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    query: text,
                    chat_history: state.chatHistory.slice(-10), // last 10 rounds
                    chatbot_id: chatbotId
                })
            });

            removeTypingIndicator(typingId);
            state.isTyping = false;

            if (response.ok) {
                const data = await response.json();
                appendMessage('agent', data.answer, data.context);
                state.chatHistory.push({ role: 'model', text: data.answer });
            } else {
                appendMessage('agent', '⚠️ Sorry, there was an issue processing your query. Please try again.');
            }
        } catch (error) {
            removeTypingIndicator(typingId);
            state.isTyping = false;
            console.error('Chat error:', error);
            appendMessage('agent', '⚠️ Connection error. Could not reach the chatbot service.');
        }
    }

    // 7. Event listeners
    launcher.addEventListener('click', () => toggleChat());
    closeBtnEl.addEventListener('click', () => toggleChat(false));

    inputEl.addEventListener('input', () => {
        inputEl.style.height = 'auto';
        inputEl.style.height = (inputEl.scrollHeight) + 'px';
        sendBtnEl.disabled = inputEl.value.trim() === '';
    });

    inputEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSendMessage();
        }
    });

    sendBtnEl.addEventListener('click', handleSendMessage);
})();

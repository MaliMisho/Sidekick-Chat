const messagesDiv = document.getElementById('messages');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');

// Config - loaded from server
let config = {
  botName: 'Sidekick',
  botAvatar: '/avatars/sidekick.jpg',
  userName: 'You',
  userAvatar: ''
};

// Track displayed messages to avoid duplicates
const displayedMessages = new Set();

// Format timestamp
function formatTime(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// Create message element
function createMessageEl(msg) {
  const div = document.createElement('div');
  div.className = `message ${msg.sender}`;
  div.dataset.id = msg.id;
  
  let avatarHTML;
  if (msg.sender === 'sidekick') {
    avatarHTML = `<img src="${config.botAvatar}" class="avatar sidekick" onerror="this.textContent='🐱'">`;
  } else if (config.userAvatar) {
    avatarHTML = `<img src="${config.userAvatar}" class="avatar king" onerror="this.textContent='👑'">`;
  } else {
    avatarHTML = `<div class="avatar king">👑</div>`;
  }
  
  // Simple markdown-like formatting
  let content = escapeHtml(msg.content);
  content = content.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  content = content.replace(/`([^`]+)`/g, '<code>$1</code>');
  content = content.replace(/\n/g, '<br>');
  
  div.innerHTML = `
    ${avatarHTML}
    <div class="bubble-wrap">
      <div class="bubble">${content}</div>
      <div class="time">${formatTime(msg.timestamp)}</div>
    </div>
  `;
  
  return div;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Load config from server
async function loadConfig() {
  try {
    const res = await fetch('/api/config');
    config = await res.json();
    
    // Update header with bot name and avatar
    const headerTitle = document.querySelector('.chat-header h1');
    const headerAvatar = document.querySelector('.header-avatar');
    const pageTitle = document.querySelector('title');
    
    if (headerTitle) headerTitle.textContent = `${config.botName} Chat`;
    if (headerAvatar) headerAvatar.src = config.botAvatar;
    if (pageTitle) pageTitle.textContent = `${config.botName} Chat`;
  } catch (err) {
    console.error('Failed to load config:', err);
  }
}

// Load all messages
async function loadMessages() {
  try {
    const res = await fetch('/api/messages');
    const messages = await res.json();
    
    // Clear empty state if present
    const emptyState = messagesDiv.querySelector('.empty-state');
    if (emptyState && messages.length > 0) {
      emptyState.remove();
    }
    
    if (messages.length === 0 && !messagesDiv.querySelector('.empty-state')) {
      messagesDiv.innerHTML = `
        <div class="empty-state">
          <div class="emoji">🔒</div>
          <p>Private chat ready</p>
          <p class="subtitle">Messages stay local. No Telegram. No middleman.</p>
        </div>
      `;
      return;
    }
    
    // Add only new messages
    messages.forEach(msg => {
      if (!displayedMessages.has(msg.id)) {
        displayedMessages.add(msg.id);
        
        // Remove any pending version of this message
        const pendingMsg = messagesDiv.querySelector(`[data-id="pending-${msg.timestamp}"]`);
        if (pendingMsg) pendingMsg.remove();
        
        messagesDiv.appendChild(createMessageEl(msg));
      }
    });
    
    scrollToBottom();
  } catch (err) {
    console.error('Failed to load messages:', err);
  }
}

function scrollToBottom() {
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

// Add message to UI immediately (optimistic update)
function addMessageToUI(content, sender, timestamp) {
  // Remove empty state if present
  const emptyState = messagesDiv.querySelector('.empty-state');
  if (emptyState) emptyState.remove();
  
  const msg = {
    id: `pending-${timestamp}`,
    sender,
    content,
    timestamp
  };
  
  messagesDiv.appendChild(createMessageEl(msg));
  scrollToBottom();
}

// Send message (as user)
async function sendMessage() {
  const content = messageInput.value.trim();
  if (!content) return;
  
  const timestamp = Date.now();
  
  messageInput.value = '';
  messageInput.style.height = 'auto';
  sendBtn.disabled = true;
  sendBtn.textContent = '...';
  
  // Immediately show the message in UI
  addMessageToUI(content, 'king', timestamp);
  
  try {
    const res = await fetch('/api/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content })
    });
    
    const data = await res.json();
    if (!data.success) {
      console.error('Send failed:', data.error);
    }
    // Reply will appear via SSE
  } catch (err) {
    console.error('Send failed:', err);
  } finally {
    sendBtn.disabled = false;
    sendBtn.textContent = 'Send';
  }
}

// SSE for live updates
function connectSSE() {
  const es = new EventSource('/events');
  
  es.addEventListener('newMessage', () => {
    loadMessages();
  });
  
  es.onerror = () => {
    console.log('SSE reconnecting...');
    es.close();
    setTimeout(connectSSE, 3000);
  };
}

// Event listeners
sendBtn.addEventListener('click', sendMessage);

messageInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

// Auto-resize textarea
messageInput.addEventListener('input', () => {
  messageInput.style.height = 'auto';
  messageInput.style.height = Math.min(messageInput.scrollHeight, 120) + 'px';
});

// Init
loadConfig().then(() => {
  loadMessages();
  connectSSE();
});

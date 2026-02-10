const messagesDiv = document.getElementById('messages');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');

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
  
  const avatarHTML = msg.sender === 'sidekick' 
    ? `<img src="/avatars/sidekick.jpg" class="avatar sidekick" onerror="this.textContent='🐱'">`
    : `<div class="avatar king">👑</div>`;
  
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

// Load all messages
async function loadMessages() {
  try {
    const res = await fetch('/api/messages');
    const messages = await res.json();
    
    messagesDiv.innerHTML = '';
    
    if (messages.length === 0) {
      messagesDiv.innerHTML = `
        <div class="empty-state">
          <div class="emoji">🔒</div>
          <p>Private chat ready</p>
          <p class="subtitle">Messages stay local. No Telegram. No middleman.</p>
        </div>
      `;
      return;
    }
    
    messages.forEach(msg => {
      messagesDiv.appendChild(createMessageEl(msg));
    });
    
    scrollToBottom();
  } catch (err) {
    console.error('Failed to load messages:', err);
  }
}

function scrollToBottom() {
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

// Send message (as King)
async function sendMessage() {
  const content = messageInput.value.trim();
  if (!content) return;
  
  messageInput.value = '';
  messageInput.style.height = 'auto';
  sendBtn.disabled = true;
  sendBtn.textContent = '...';
  
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
    // Message + reply will appear via SSE
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
loadMessages();
connectSSE();

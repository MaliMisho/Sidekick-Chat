// Sidekick Chat v2 - Frontend Application

// DOM Elements
const elements = {
  sidebar: document.getElementById('sidebar'),
  mobileMenuBtn: document.getElementById('mobileMenuBtn'),
  muteBtn: document.getElementById('muteBtn'),
  channelList: document.getElementById('channelList'),
  dmList: document.getElementById('dmList'),
  botList: document.getElementById('botList'),
  channelHeader: document.getElementById('channelHeader'),
  messages: document.getElementById('messages'),
  messageInput: document.getElementById('messageInput'),
  sendBtn: document.getElementById('sendBtn'),
  mentionPopup: document.getElementById('mentionPopup'),
  typingContainer: document.getElementById('typingContainer')
};

// State
const state = {
  channels: [],
  bots: [],
  currentChannel: null,
  isMuted: false,
  displayedMessages: new Set(),
  mentionIndex: -1,
  mentionQuery: '',
  mentionStart: -1,
  typingBots: new Map() // botId -> { botName, channel }
};

// ============ Utilities ============

function formatTime(timestamp) {
  const date = new Date(timestamp);
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function formatMessageText(text) {
  let html = escapeHtml(text);
  
  // Code blocks (inline)
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  
  // Bold
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  
  // @mentions - highlight them
  html = html.replace(/@(\w+)/g, '<span class="mention">@$1</span>');
  
  return html;
}

// ============ API Functions ============

async function fetchChannels() {
  try {
    const res = await fetch('/api/channels');
    return await res.json();
  } catch (err) {
    console.error('Failed to fetch channels:', err);
    return [];
  }
}

async function fetchBots() {
  try {
    const res = await fetch('/api/bots');
    const data = await res.json();
    return data.bots || [];
  } catch (err) {
    console.error('Failed to fetch bots:', err);
    return [];
  }
}

async function fetchBotStatus(botId) {
  try {
    const res = await fetch(`/api/bots/${botId}/status`);
    const data = await res.json();
    return data.online ?? false;
  } catch {
    return false;
  }
}

async function fetchMessages(channelId) {
  try {
    // Handle DM channels - use the DM endpoint for history
    if (channelId.startsWith('dm-')) {
      const botId = channelId.replace('dm-', '');
      const res = await fetch(`/api/dm/${botId}`);
      if (!res.ok) return [];
      return await res.json();
    }
    
    const res = await fetch(`/api/channels/${channelId}/messages`);
    return await res.json();
  } catch (err) {
    console.error('Failed to fetch messages:', err);
    return [];
  }
}

async function sendMessage(channelId, content) {
  try {
    // Handle DM channels differently - use the DM endpoint
    if (channelId.startsWith('dm-')) {
      const botId = channelId.replace('dm-', '');
      const res = await fetch(`/api/dm/${botId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content })
      });
      return await res.json();
    }
    
    // Regular channel message
    const res = await fetch(`/api/channels/${channelId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content })
    });
    return await res.json();
  } catch (err) {
    console.error('Failed to send message:', err);
    return { success: false, error: err.message };
  }
}

async function fetchMuteStatus() {
  try {
    const res = await fetch('/api/status');
    const data = await res.json();
    return data.muted ?? false;
  } catch {
    return false;
  }
}

async function toggleMute() {
  try {
    const endpoint = state.isMuted ? '/api/unmute' : '/api/mute';
    const res = await fetch(endpoint, { method: 'POST' });
    const data = await res.json();
    return data.muted ?? !state.isMuted;
  } catch (err) {
    console.error('Failed to toggle mute:', err);
    return state.isMuted;
  }
}

// ============ Render Functions ============

function renderChannels() {
  // Filter out DM channels (they appear in the DM section)
  const regularChannels = state.channels.filter(c => !c.id.startsWith('dm-') && !c.isDm);
  
  elements.channelList.innerHTML = regularChannels.map(channel => `
    <li class="channel-item ${channel.id === state.currentChannel?.id ? 'active' : ''}" 
        data-channel-id="${channel.id}">
      <span class="hash">#</span>
      <span class="channel-name">${escapeHtml(channel.name)}</span>
    </li>
  `).join('');
  
  // Add click handlers
  elements.channelList.querySelectorAll('.channel-item').forEach(item => {
    item.addEventListener('click', () => {
      const channelId = item.dataset.channelId;
      switchChannel(channelId);
      closeMobileSidebar();
    });
  });
}

function renderDmList() {
  // Create DM entries for each bot
  elements.dmList.innerHTML = state.bots.map(bot => {
    const dmChannelId = `dm-${bot.id}`;
    const avatarValue = bot.avatar || '🤖';
    const isImageAvatar = avatarValue.startsWith('/') || avatarValue.startsWith('http');
    const avatarHtml = isImageAvatar
      ? `<img src="${avatarValue}" alt="${escapeHtml(bot.name)}" onerror="this.style.display='none'; this.parentElement.textContent='🤖';">`
      : avatarValue;
    
    return `
    <li class="dm-item ${dmChannelId === state.currentChannel?.id ? 'active' : ''}" 
        data-channel-id="${dmChannelId}"
        data-bot-id="${bot.id}">
      <span class="dm-avatar" style="background: ${bot.color || 'var(--bg-light)'}">${avatarHtml}</span>
      <span class="dm-name">${escapeHtml(bot.name)}</span>
    </li>
  `;
  }).join('');
  
  // Add click handlers
  elements.dmList.querySelectorAll('.dm-item').forEach(item => {
    item.addEventListener('click', () => {
      const channelId = item.dataset.channelId;
      switchChannel(channelId);
      closeMobileSidebar();
    });
  });
}

function renderBots() {
  elements.botList.innerHTML = state.bots.map(bot => {
    const avatarValue = bot.avatar || '🤖';
    const isImageAvatar = avatarValue.startsWith('/') || avatarValue.startsWith('http');
    const avatarHtml = isImageAvatar
      ? `<img src="${avatarValue}" alt="${escapeHtml(bot.name)}" onerror="this.style.display='none'; this.parentElement.textContent='🤖';">`
      : avatarValue;
    
    return `
    <li class="bot-item" data-bot-id="${bot.id}" title="Click to DM ${bot.name}">
      <span class="status-dot ${bot.online ? 'online' : 'offline'}"></span>
      <span class="bot-avatar">${avatarHtml}</span>
      <span class="bot-name">${escapeHtml(bot.name)}</span>
    </li>
  `;
  }).join('');
  
  // Add click handlers for DM
  elements.botList.querySelectorAll('.bot-item').forEach(item => {
    item.addEventListener('click', () => {
      const botId = item.dataset.botId;
      openDmModal(botId);
    });
  });
}

function renderMuteButton() {
  const btn = elements.muteBtn;
  const icon = btn.querySelector('.mute-icon');
  const text = btn.querySelector('.mute-text');
  
  if (state.isMuted) {
    btn.classList.add('muted');
    icon.textContent = '🔇';
    text.textContent = 'BOTS MUTED';
  } else {
    btn.classList.remove('muted');
    icon.textContent = '🔊';
    text.textContent = 'Bots Active';
  }
}

function renderChannelHeader() {
  if (state.currentChannel) {
    if (state.currentChannel.isDm) {
      // DM channel - show bot info
      const bot = state.bots.find(b => b.id === state.currentChannel.botId);
      const avatarValue = bot?.avatar || '🤖';
      const isImageAvatar = avatarValue.startsWith('/') || avatarValue.startsWith('http');
      const avatarHtml = isImageAvatar
        ? `<img src="${avatarValue}" alt="${escapeHtml(bot?.name || 'Bot')}" style="width: 24px; height: 24px; border-radius: 50%;">`
        : `<span style="font-size: 18px;">${avatarValue}</span>`;
      
      elements.channelHeader.innerHTML = `
        <span class="channel-name" style="display: flex; align-items: center; gap: 8px;">
          ${avatarHtml}
          ${escapeHtml(state.currentChannel.name)}
        </span>
        <span class="dm-hint" style="color: var(--text-muted); font-size: 13px;">Direct Message</span>
      `;
    } else {
      // Regular channel
      const memberCount = state.currentChannel.members?.length || 0;
      elements.channelHeader.innerHTML = `
        <span class="channel-name">#${escapeHtml(state.currentChannel.name)}</span>
        <button class="members-btn" id="membersBtn" onclick="toggleMembersPanel()" title="Channel members">👥 ${memberCount} Members</button>
      `;
    }
  }
}

function createMessageElement(msg) {
  const div = document.createElement('div');
  div.className = 'message';
  div.dataset.messageId = msg.id;
  
  // Find sender info - support both flat (senderId) and nested (sender.id) formats
  const senderId = msg.senderId || msg.sender?.id;
  const senderName = msg.senderName || msg.sender?.name || 'Unknown';
  
  const sender = state.bots.find(b => b.id === senderId) || {
    name: senderName,
    avatar: msg.senderAvatar || msg.sender?.avatar || '👤',
    color: msg.senderColor || msg.sender?.color || '#b5bac1'
  };
  
  // For king, use his info
  if (senderId === 'king') {
    sender.name = 'King';
    sender.avatar = '👑';
    sender.color = '#fbbf24';
  }
  
  // Determine if avatar is an image URL or emoji
  const avatarValue = sender.avatarUrl || sender.avatar || '👤';
  const isImageAvatar = avatarValue.startsWith('/') || avatarValue.startsWith('http');
  const avatarHtml = isImageAvatar
    ? `<img src="${avatarValue}" alt="${escapeHtml(sender.name)}" onerror="this.style.display='none'; this.parentElement.textContent='👤';">`
    : avatarValue;
  
  div.innerHTML = `
    <div class="message-avatar" style="background: ${sender.color || 'var(--bg-light)'}">
      ${avatarHtml}
    </div>
    <div class="message-content">
      <div class="message-header">
        <span class="message-author" style="color: ${sender.color || 'var(--text-primary)'}">${escapeHtml(sender.name)}</span>
        <span class="message-timestamp">${formatTime(msg.timestamp)}</span>
      </div>
      <div class="message-text">${formatMessageText(msg.content)}</div>
    </div>
  `;
  
  return div;
}

function renderMessages(messages) {
  elements.messages.innerHTML = '';
  state.displayedMessages.clear();
  
  if (messages.length === 0) {
    elements.messages.innerHTML = `
      <div class="empty-state">
        <div class="emoji">💬</div>
        <h3>Welcome to #${escapeHtml(state.currentChannel?.name || 'general')}</h3>
        <p>This is the start of the conversation.</p>
      </div>
    `;
    return;
  }
  
  messages.forEach(msg => {
    if (!state.displayedMessages.has(msg.id)) {
      state.displayedMessages.add(msg.id);
      elements.messages.appendChild(createMessageElement(msg));
    }
  });
  
  scrollToBottom();
}

function addMessage(msg) {
  // Remove empty state if present
  const emptyState = elements.messages.querySelector('.empty-state');
  if (emptyState) emptyState.remove();
  
  if (!state.displayedMessages.has(msg.id)) {
    state.displayedMessages.add(msg.id);
    elements.messages.appendChild(createMessageElement(msg));
    scrollToBottom();
  }
}

function scrollToBottom() {
  elements.messages.scrollTop = elements.messages.scrollHeight;
}

// ============ Typing Indicators ============

function showTypingIndicator(botId, botName, channel) {
  // Only show for current channel
  if (channel !== state.currentChannel?.id) return;
  
  // Already showing for this bot?
  if (state.typingBots.has(botId)) return;
  
  // Track when indicator was shown (for minimum display time)
  state.typingBots.set(botId, { botName, channel, shownAt: Date.now() });
  
  // Find bot info for avatar
  const bot = state.bots.find(b => b.id === botId) || { avatar: '🤖', color: '#b5bac1' };
  const avatarValue = bot.avatarUrl || bot.avatar || '🤖';
  const isImageAvatar = avatarValue.startsWith('/') || avatarValue.startsWith('http');
  const avatarHtml = isImageAvatar
    ? `<img src="${avatarValue}" alt="${escapeHtml(botName)}">`
    : avatarValue;
  
  const indicator = document.createElement('div');
  indicator.className = 'typing-indicator';
  indicator.dataset.botId = botId;
  indicator.innerHTML = `
    <div class="typing-avatar" style="background: ${bot.color || 'var(--bg-light)'}">
      ${avatarHtml}
    </div>
    <div class="typing-content">
      <span class="typing-name">${escapeHtml(botName)}</span>
      <span>is thinking</span>
      <div class="typing-dots">
        <span></span>
        <span></span>
        <span></span>
      </div>
    </div>
  `;
  
  elements.typingContainer.appendChild(indicator);
}

function hideTypingIndicator(botId) {
  const typingInfo = state.typingBots.get(botId);
  if (!typingInfo) return;
  
  const MIN_DISPLAY_MS = 800; // Show for at least 800ms
  const elapsed = Date.now() - (typingInfo.shownAt || 0);
  
  if (elapsed < MIN_DISPLAY_MS) {
    // Delay hiding until minimum time has passed
    setTimeout(() => {
      state.typingBots.delete(botId);
      const indicator = elements.typingContainer.querySelector(`[data-bot-id="${botId}"]`);
      if (indicator) indicator.remove();
    }, MIN_DISPLAY_MS - elapsed);
  } else {
    state.typingBots.delete(botId);
    const indicator = elements.typingContainer.querySelector(`[data-bot-id="${botId}"]`);
    if (indicator) indicator.remove();
  }
}

function clearTypingIndicators() {
  state.typingBots.clear();
  elements.typingContainer.innerHTML = '';
}

// ============ Mention Autocomplete ============

function getMentionables() {
  // Combine bots and add King
  const mentionables = [
    { id: 'king', name: 'King', avatar: '👑', role: 'Human' },
    ...state.bots.map(b => ({ ...b, role: 'Bot' }))
  ];
  return mentionables;
}

function showMentionPopup(query) {
  const mentionables = getMentionables();
  const filtered = mentionables.filter(m => 
    m.name.toLowerCase().includes(query.toLowerCase())
  );
  
  if (filtered.length === 0) {
    hideMentionPopup();
    return;
  }
  
  state.mentionIndex = 0;
  
  elements.mentionPopup.innerHTML = filtered.map((m, i) => `
    <div class="mention-item ${i === 0 ? 'selected' : ''}" data-name="${escapeHtml(m.name)}">
      <span class="avatar">${m.avatar || '🤖'}</span>
      <span class="name">${escapeHtml(m.name)}</span>
      <span class="role">${m.role}</span>
    </div>
  `).join('');
  
  elements.mentionPopup.classList.add('visible');
  
  // Add click handlers
  elements.mentionPopup.querySelectorAll('.mention-item').forEach(item => {
    item.addEventListener('click', () => {
      insertMention(item.dataset.name);
    });
  });
}

function hideMentionPopup() {
  elements.mentionPopup.classList.remove('visible');
  state.mentionIndex = -1;
  state.mentionStart = -1;
}

function insertMention(name) {
  const input = elements.messageInput;
  const text = input.value;
  const before = text.substring(0, state.mentionStart);
  const after = text.substring(input.selectionStart);
  
  input.value = before + '@' + name + ' ' + after;
  input.focus();
  
  const newPos = before.length + name.length + 2;
  input.setSelectionRange(newPos, newPos);
  
  hideMentionPopup();
}

function navigateMention(direction) {
  const items = elements.mentionPopup.querySelectorAll('.mention-item');
  if (items.length === 0) return;
  
  items[state.mentionIndex]?.classList.remove('selected');
  
  state.mentionIndex += direction;
  if (state.mentionIndex < 0) state.mentionIndex = items.length - 1;
  if (state.mentionIndex >= items.length) state.mentionIndex = 0;
  
  items[state.mentionIndex]?.classList.add('selected');
  items[state.mentionIndex]?.scrollIntoView({ block: 'nearest' });
}

function selectCurrentMention() {
  const selected = elements.mentionPopup.querySelector('.mention-item.selected');
  if (selected) {
    insertMention(selected.dataset.name);
    return true;
  }
  return false;
}

// ============ Event Handlers ============

async function switchChannel(channelId) {
  let channel = state.channels.find(c => c.id === channelId);
  
  // Handle DM channels (dm-botId pattern)
  if (!channel && channelId.startsWith('dm-')) {
    const botId = channelId.replace('dm-', '');
    const bot = state.bots.find(b => b.id === botId);
    if (bot) {
      // Create virtual channel object for DM
      channel = {
        id: channelId,
        name: `DM: ${bot.name}`,
        description: `Direct messages with ${bot.name}`,
        isDm: true,
        botId: botId
      };
    }
  }
  
  if (!channel) return;
  
  state.currentChannel = channel;
  renderChannels();
  renderDmList();
  renderChannelHeader();
  clearTypingIndicators();
  
  // Load messages for this channel
  elements.messages.innerHTML = '<div class="loading">Loading messages</div>';
  const messages = await fetchMessages(channelId);
  renderMessages(messages);
}

async function handleSend() {
  const content = elements.messageInput.value.trim();
  if (!content || !state.currentChannel) return;
  
  elements.messageInput.value = '';
  elements.messageInput.style.height = 'auto';
  elements.sendBtn.disabled = true;
  
  // For DMs, add optimistic update since SSE broadcast may have timing issues
  if (state.currentChannel.isDm) {
    const optimisticMsg = {
      id: `temp-${Date.now()}`,
      channel: state.currentChannel.id,
      sender: { id: 'king', name: 'King', type: 'human' },
      content: content,
      timestamp: Date.now()
    };
    addMessage(optimisticMsg);
  }
  
  // Send and wait for SSE to show it (regular channels rely on SSE)
  await sendMessage(state.currentChannel.id, content);
  
  elements.sendBtn.disabled = false;
  elements.messageInput.focus();
}

async function handleMuteToggle() {
  state.isMuted = await toggleMute();
  renderMuteButton();
}

function handleInputKeydown(e) {
  // Mention popup navigation
  if (elements.mentionPopup.classList.contains('visible')) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      navigateMention(1);
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      navigateMention(-1);
      return;
    }
    if (e.key === 'Tab' || e.key === 'Enter') {
      if (selectCurrentMention()) {
        e.preventDefault();
        return;
      }
    }
    if (e.key === 'Escape') {
      hideMentionPopup();
      return;
    }
  }
  
  // Send on Enter (not Shift+Enter)
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    handleSend();
  }
}

function handleInputChange() {
  const input = elements.messageInput;
  const text = input.value;
  const cursorPos = input.selectionStart;
  
  // Auto-resize
  input.style.height = 'auto';
  input.style.height = Math.min(input.scrollHeight, 200) + 'px';
  
  // Check for @ mention trigger
  const textBeforeCursor = text.substring(0, cursorPos);
  const atMatch = textBeforeCursor.match(/@(\w*)$/);
  
  if (atMatch) {
    state.mentionStart = atMatch.index;
    state.mentionQuery = atMatch[1];
    showMentionPopup(state.mentionQuery);
  } else {
    hideMentionPopup();
  }
}

function handleGlobalKeydown(e) {
  // Ctrl+Shift+M to toggle mute
  if (e.ctrlKey && e.shiftKey && e.key === 'M') {
    e.preventDefault();
    handleMuteToggle();
  }
}

// Mobile sidebar
function toggleMobileSidebar() {
  elements.sidebar.classList.toggle('open');
  
  // Create/remove overlay
  let overlay = document.querySelector('.sidebar-overlay');
  if (elements.sidebar.classList.contains('open')) {
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.className = 'sidebar-overlay visible';
      overlay.addEventListener('click', closeMobileSidebar);
      document.body.appendChild(overlay);
    } else {
      overlay.classList.add('visible');
    }
  } else if (overlay) {
    overlay.classList.remove('visible');
  }
}

function closeMobileSidebar() {
  elements.sidebar.classList.remove('open');
  const overlay = document.querySelector('.sidebar-overlay');
  if (overlay) overlay.classList.remove('visible');
}

// ============ SSE Connection ============

function connectSSE() {
  const eventSource = new EventSource('/events');
  
  eventSource.addEventListener('connected', (e) => {
    try {
      const data = JSON.parse(e.data);
      state.isMuted = data.muted;
      renderMuteButton();
      console.log('SSE connected, muted:', data.muted);
    } catch (err) {
      console.error('Failed to parse connected event:', err);
    }
  });
  
  eventSource.addEventListener('message', (e) => {
    try {
      const data = JSON.parse(e.data);
      // Only add if for current channel
      if (data.channel === state.currentChannel?.id) {
        addMessage(data);
      }
      // Hide typing indicator when bot sends a message
      const senderId = data.senderId || data.sender?.id;
      if (senderId) {
        hideTypingIndicator(senderId);
      }
    } catch (err) {
      console.error('Failed to parse SSE message:', err);
    }
  });
  
  eventSource.addEventListener('botStatus', (e) => {
    try {
      const data = JSON.parse(e.data);
      const bot = state.bots.find(b => b.id === data.botId);
      if (bot) {
        bot.online = data.online;
        renderBots();
      }
    } catch (err) {
      console.error('Failed to parse bot status:', err);
    }
  });
  
  eventSource.addEventListener('muteChanged', (e) => {
    try {
      const data = JSON.parse(e.data);
      state.isMuted = data.muted;
      renderMuteButton();
    } catch (err) {
      console.error('Failed to parse mute status:', err);
    }
  });
  
  eventSource.addEventListener('typing', (e) => {
    try {
      const data = JSON.parse(e.data);
      console.log('Typing event received:', data, 'Current channel:', state.currentChannel?.id);
      showTypingIndicator(data.botId, data.botName, data.channel);
    } catch (err) {
      console.error('Failed to parse typing event:', err);
    }
  });
  
  eventSource.addEventListener('typingStop', (e) => {
    try {
      const data = JSON.parse(e.data);
      hideTypingIndicator(data.botId);
    } catch (err) {
      console.error('Failed to parse typingStop event:', err);
    }
  });
  
  eventSource.onerror = () => {
    console.log('SSE connection lost, reconnecting...');
    eventSource.close();
    setTimeout(connectSSE, 3000);
  };
}

// ============ Channel Members Panel ============

function toggleMembersPanel() {
  const panel = document.getElementById('membersPanel');
  if (panel.classList.contains('visible')) {
    closeMembersPanel();
  } else {
    openMembersPanel();
  }
}

function openMembersPanel() {
  const panel = document.getElementById('membersPanel');
  renderMembersList();
  renderAddMemberSelect();
  panel.classList.add('visible');
}

function closeMembersPanel() {
  const panel = document.getElementById('membersPanel');
  panel.classList.remove('visible');
}

function renderMembersList() {
  const list = document.getElementById('membersList');
  const channel = state.currentChannel;
  if (!channel || !channel.members) {
    list.innerHTML = '<div style="padding: 16px; color: var(--text-muted);">No members</div>';
    return;
  }
  
  // King is always a member
  const allParticipants = ['king', ...state.bots.map(b => b.id)];
  const members = channel.members.filter(m => allParticipants.includes(m));
  
  list.innerHTML = members.map(memberId => {
    const isKing = memberId === 'king';
    const bot = state.bots.find(b => b.id === memberId);
    const name = isKing ? 'King' : (bot?.name || memberId);
    const avatar = isKing ? '👑' : (bot?.avatar || '🤖');
    const color = isKing ? '#fbbf24' : (bot?.color || '#5865f2');
    
    const isImageAvatar = avatar.startsWith('/') || avatar.startsWith('http');
    const avatarHtml = isImageAvatar
      ? `<img src="${avatar}" alt="${name}">`
      : avatar;
    
    // Can't remove King
    const removeBtn = isKing ? '' : `<button class="member-remove" onclick="removeMemberFromChannel('${memberId}')" title="Remove from channel">✕</button>`;
    
    return `
      <div class="member-item" data-member-id="${memberId}">
        <div class="member-info">
          <div class="member-avatar" style="background: ${color}">${avatarHtml}</div>
          <span class="member-name">${escapeHtml(name)}</span>
        </div>
        ${removeBtn}
      </div>
    `;
  }).join('');
}

function renderAddMemberSelect() {
  const select = document.getElementById('addMemberSelect');
  const channel = state.currentChannel;
  if (!channel) return;
  
  const currentMembers = channel.members || [];
  const availableBots = state.bots.filter(b => !currentMembers.includes(b.id));
  
  select.innerHTML = '<option value="">Add bot to channel...</option>' +
    availableBots.map(b => `<option value="${b.id}">${escapeHtml(b.name)}</option>`).join('');
}

async function addMemberToChannel() {
  const select = document.getElementById('addMemberSelect');
  const botId = select.value;
  if (!botId || !state.currentChannel) return;
  
  try {
    const res = await fetch(`/api/channels/${state.currentChannel.id}/members`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ botId })
    });
    
    if (res.ok) {
      const data = await res.json();
      state.currentChannel.members = data.members;
      renderMembersList();
      renderAddMemberSelect();
    }
  } catch (err) {
    console.error('Failed to add member:', err);
  }
}

async function removeMemberFromChannel(botId) {
  if (!state.currentChannel) return;
  
  try {
    const res = await fetch(`/api/channels/${state.currentChannel.id}/members/${botId}`, {
      method: 'DELETE'
    });
    
    if (res.ok) {
      const data = await res.json();
      state.currentChannel.members = data.members;
      renderMembersList();
      renderAddMemberSelect();
    }
  } catch (err) {
    console.error('Failed to remove member:', err);
  }
}

// ============ DM Modal ============

// DM history cache (loaded from server)
let dmHistory = {};

async function openDmModal(botId) {
  const bot = state.bots.find(b => b.id === botId);
  if (!bot) return;
  
  // Load history from server
  try {
    const res = await fetch(`/api/dm/${botId}`);
    const messages = await res.json();
    dmHistory[botId] = messages.map(m => ({
      type: m.sender?.id === 'king' ? 'dm-user' : 'dm-bot',
      html: `<span class="dm-sender" style="color: ${m.sender?.id === 'king' ? '#fbbf24' : (bot.color || '#10b981')}">${escapeHtml(m.sender?.name || 'Unknown')}:</span> ${escapeHtml(m.content)}`,
      timestamp: m.timestamp
    }));
  } catch {
    dmHistory[botId] = [];
  }
  
  // Create modal if it doesn't exist
  let modal = document.getElementById('dmModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'dmModal';
    modal.className = 'dm-modal';
    document.body.appendChild(modal);
  }
  
  // Determine avatar HTML
  const avatarValue = bot.avatar || '🤖';
  const isImageAvatar = avatarValue.startsWith('/') || avatarValue.startsWith('http');
  const avatarHtml = isImageAvatar
    ? `<img src="${avatarValue}" alt="${escapeHtml(bot.name)}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" onerror="this.style.display='none'; this.parentElement.textContent='🤖';">`
    : avatarValue;
  
  modal.innerHTML = `
    <div class="dm-modal-content">
      <div class="dm-modal-header">
        <span class="dm-bot-avatar" style="background: ${bot.color}">${avatarHtml}</span>
        <span class="dm-bot-name">DM with ${escapeHtml(bot.name)}</span>
        <button class="dm-close" onclick="closeDmModal()">×</button>
      </div>
      <div class="dm-messages" id="dmMessages"></div>
      <div class="dm-input-area">
        <input type="text" id="dmInput" placeholder="Type a message..." autocomplete="off">
        <button id="dmSendBtn" onclick="sendDm('${botId}')">Send</button>
      </div>
    </div>
  `;
  
  // Render existing history
  const messagesDiv = document.getElementById('dmMessages');
  if (dmHistory[botId].length === 0) {
    messagesDiv.innerHTML = `<div class="dm-hint">Send a direct message to ${escapeHtml(bot.name)}</div>`;
  } else {
    messagesDiv.innerHTML = '';
    dmHistory[botId].forEach(msg => {
      const msgDiv = document.createElement('div');
      msgDiv.className = `dm-message ${msg.type}`;
      msgDiv.innerHTML = msg.html;
      messagesDiv.appendChild(msgDiv);
    });
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
  }
  
  modal.classList.add('visible');
  modal.dataset.currentBotId = botId;
  
  // Focus input
  setTimeout(() => document.getElementById('dmInput')?.focus(), 100);
  
  // Enter to send
  document.getElementById('dmInput')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendDm(botId);
    }
  });
}

function closeDmModal() {
  const modal = document.getElementById('dmModal');
  if (modal) modal.classList.remove('visible');
}

async function sendDm(botId) {
  const input = document.getElementById('dmInput');
  const messagesDiv = document.getElementById('dmMessages');
  const content = input?.value?.trim();
  
  if (!content) return;
  
  // Remove hint if present
  const hint = messagesDiv.querySelector('.dm-hint');
  if (hint) hint.remove();
  
  // Show user message and save to history
  const userHtml = `<span class="dm-sender">You:</span> ${escapeHtml(content)}`;
  const userMsg = document.createElement('div');
  userMsg.className = 'dm-message dm-user';
  userMsg.innerHTML = userHtml;
  messagesDiv.appendChild(userMsg);
  dmHistory[botId].push({ type: 'dm-user', html: userHtml });
  
  
  // Clear input and show loading
  input.value = '';
  const loadingMsg = document.createElement('div');
  loadingMsg.className = 'dm-message dm-loading';
  loadingMsg.textContent = 'Thinking...';
  messagesDiv.appendChild(loadingMsg);
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
  
  try {
    const res = await fetch(`/api/dm/${botId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content })
    });
    
    const data = await res.json();
    loadingMsg.remove();
    
    const bot = state.bots.find(b => b.id === botId);
    let botHtml;
    
    if (data.response) {
      botHtml = `<span class="dm-sender" style="color: ${bot?.color || '#10b981'}">${escapeHtml(bot?.name || botId)}:</span> ${escapeHtml(data.response)}`;
    } else {
      botHtml = `<span class="dm-sender" style="color: ${bot?.color || '#10b981'}">${escapeHtml(bot?.name || botId)}:</span> <em>(no response)</em>`;
    }
    
    const botMsg = document.createElement('div');
    botMsg.className = 'dm-message dm-bot';
    botMsg.innerHTML = botHtml;
    messagesDiv.appendChild(botMsg);
    dmHistory[botId].push({ type: 'dm-bot', html: botHtml });
    
    
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
  } catch (err) {
    loadingMsg.remove();
    const errorHtml = `Error: ${err.message}`;
    const errorMsg = document.createElement('div');
    errorMsg.className = 'dm-message dm-error';
    errorMsg.textContent = errorHtml;
    messagesDiv.appendChild(errorMsg);
    dmHistory[botId].push({ type: 'dm-error', html: errorHtml });
    
  }
}

// ============ Initialization ============

async function init() {
  // Bind event listeners
  elements.sendBtn.addEventListener('click', handleSend);
  elements.messageInput.addEventListener('keydown', handleInputKeydown);
  elements.messageInput.addEventListener('input', handleInputChange);
  elements.muteBtn.addEventListener('click', handleMuteToggle);
  elements.mobileMenuBtn.addEventListener('click', toggleMobileSidebar);
  document.getElementById('membersBtn')?.addEventListener('click', toggleMembersPanel);
  document.addEventListener('keydown', handleGlobalKeydown);
  
  // Click outside mention popup to close
  document.addEventListener('click', (e) => {
    if (!elements.mentionPopup.contains(e.target) && e.target !== elements.messageInput) {
      hideMentionPopup();
    }
  });
  
  // Load initial data
  elements.messages.innerHTML = '<div class="loading">Loading</div>';
  
  const [channels, bots, isMuted] = await Promise.all([
    fetchChannels(),
    fetchBots(),
    fetchMuteStatus()
  ]);
  
  state.channels = channels;
  state.bots = bots;
  state.isMuted = isMuted;
  
  // Update bot status
  for (const bot of state.bots) {
    bot.online = await fetchBotStatus(bot.id);
  }
  
  renderChannels();
  renderBots();
  renderDmList();
  renderMuteButton();
  
  // Select first channel by default
  if (state.channels.length > 0) {
    await switchChannel(state.channels[0].id);
  } else {
    elements.messages.innerHTML = `
      <div class="empty-state">
        <div class="emoji">📭</div>
        <h3>No channels available</h3>
        <p>Channels will appear here once configured.</p>
      </div>
    `;
  }
  
  // Connect to SSE for real-time updates
  connectSSE();
}

// Start the app
init();


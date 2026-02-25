const express = require('express');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Load .env file if present
const envPath = path.join(process.cwd(), '.env');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf-8').split('\n').forEach(line => {
    const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2]?.replace(/^['"]|['"]$/g, '') || '';
    }
  });
}

const app = express();
const PORT = process.env.PORT || 3847;

// Paths
const PROJECT_DIR = process.env.PROJECT_DIR || process.cwd();
const CLAWD_DIR = process.env.CLAWD_DIR || path.join(process.env.HOME, 'clawd');
const CHANNELS_DIR = path.join(PROJECT_DIR, 'channels');
const AVATARS_DIR = process.env.AVATARS_DIR || path.join(CLAWD_DIR, 'avatars');
const BOTS_FILE = path.join(PROJECT_DIR, 'bots.json');
const CONFIG_FILE = path.join(PROJECT_DIR, 'config.json');

// Defaults
const DEFAULT_COOLDOWN_MS = 5000;
const DEFAULT_MAX_BOTS_PER_TURN = 10; // Allow all bots to respond
const CONTEXT_MESSAGE_COUNT = 20;
const RESPONSE_BATCH_WINDOW_MS = 2500;
const BOT_TIMEOUT_SECONDS = 120;

// In-memory state
let botsRegistry = { bots: [], king: { id: 'king', name: 'King', avatar: '👑', color: '#fbbf24' } };
let globalConfig = { muted: false, mutedAt: null, mutedBy: null };
const botCooldowns = new Map(); // Map<`${botId}-${channelId}`, timestamp>
const turnTracking = new Map(); // Map<channelId, { triggerMsgId, respondedBots: Set, timestamp }>

// SSE clients
let clients = [];

// ─────────────────────────────────────────────────────────────────────────────
// Initialization
// ─────────────────────────────────────────────────────────────────────────────

function ensureDirectories() {
  if (!fs.existsSync(CHANNELS_DIR)) {
    fs.mkdirSync(CHANNELS_DIR, { recursive: true });
  }
  
  // Create default channels if they don't exist
  const defaultChannels = [
    { id: 'general', name: 'General', description: 'Main hangout, coordination', members: ['king', 'veliki', 'scriptkitty', 'viralphreak', 'vectorvandal', 'bitwriter', 'junktester'] },
    { id: 'dev', name: 'Development', description: 'Code, bugs, and tech discussions', members: ['king', 'veliki', 'scriptkitty', 'vectorvandal', 'junktester'] },
    { id: 'marketing', name: 'Marketing', description: 'Content & growth', members: ['king', 'veliki', 'viralphreak', 'bitwriter'] },
    { id: 'private', name: 'Private', description: 'Private 1:1 with Veliki', members: ['king', 'veliki'] }
  ];
  
  for (const channel of defaultChannels) {
    const channelDir = path.join(CHANNELS_DIR, channel.id);
    const messagesDir = path.join(channelDir, 'messages');
    const channelFile = path.join(channelDir, 'channel.json');
    
    if (!fs.existsSync(channelDir)) {
      fs.mkdirSync(channelDir, { recursive: true });
    }
    if (!fs.existsSync(messagesDir)) {
      fs.mkdirSync(messagesDir, { recursive: true });
    }
    if (!fs.existsSync(channelFile)) {
      fs.writeFileSync(channelFile, JSON.stringify({
        id: channel.id,
        name: channel.name,
        description: channel.description,
        members: channel.members,
        created: Date.now(),
        settings: {
          botResponseMode: 'natural',
          maxBotsPerTurn: DEFAULT_MAX_BOTS_PER_TURN,
          cooldownMs: DEFAULT_COOLDOWN_MS
        }
      }, null, 2));
    }
  }
}

function loadBotsRegistry() {
  if (fs.existsSync(BOTS_FILE)) {
    try {
      botsRegistry = JSON.parse(fs.readFileSync(BOTS_FILE, 'utf-8'));
    } catch (e) {
      console.error('Error loading bots.json:', e.message);
    }
  } else {
    // Create default bots.json
    botsRegistry = {
      bots: [
        { id: 'veliki', name: 'Veliki', avatar: '/avatars/sidekick.jpg', type: 'local', workdir: CLAWD_DIR, color: '#7c3aed' },
        { id: 'scriptkitty', name: 'ScriptKitty', avatar: '/avatars/scriptkitty.png', type: 'http', endpoint: 'http://localhost:18791', color: '#10b981' },
        { id: 'viralphreak', name: 'ViralPhreak', avatar: '/avatars/viralphreak.png', type: 'http', endpoint: 'http://localhost:18790', color: '#f59e0b' },
        { id: 'vectorvandal', name: 'VectorVandal', avatar: '/avatars/vectorvandal.png', type: 'http', endpoint: 'http://localhost:18792', color: '#ec4899' },
        { id: 'bitwriter', name: 'BitWriter', avatar: '/avatars/bitwriter.png', type: 'http', endpoint: 'http://localhost:18793', color: '#3b82f6' },
        { id: 'junktester', name: 'JunkTester', avatar: '/avatars/junktester.png', type: 'http', endpoint: 'http://localhost:18794', color: '#6366f1' }
      ],
      king: { id: 'king', name: 'King', avatar: '👑', color: '#fbbf24' }
    };
    fs.writeFileSync(BOTS_FILE, JSON.stringify(botsRegistry, null, 2));
  }
}

function loadConfig() {
  if (fs.existsSync(CONFIG_FILE)) {
    try {
      globalConfig = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
    } catch (e) {
      console.error('Error loading config.json:', e.message);
    }
  } else {
    saveConfig();
  }
}

function saveConfig() {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(globalConfig, null, 2));
}

// ─────────────────────────────────────────────────────────────────────────────
// SSE Broadcasting
// ─────────────────────────────────────────────────────────────────────────────

function broadcast(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  clients.forEach(c => {
    try {
      c.write(payload);
    } catch (e) {
      // Client disconnected
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Channel Helpers
// ─────────────────────────────────────────────────────────────────────────────

function getChannelInfo(channelId) {
  const channelFile = path.join(CHANNELS_DIR, channelId, 'channel.json');
  if (!fs.existsSync(channelFile)) return null;
  return JSON.parse(fs.readFileSync(channelFile, 'utf-8'));
}

function getAllChannels() {
  if (!fs.existsSync(CHANNELS_DIR)) return [];
  
  return fs.readdirSync(CHANNELS_DIR)
    .filter(d => fs.statSync(path.join(CHANNELS_DIR, d)).isDirectory())
    .map(d => getChannelInfo(d))
    .filter(Boolean);
}

function getChannelMessages(channelId, limit = 50, before = null) {
  const messagesDir = path.join(CHANNELS_DIR, channelId, 'messages');
  if (!fs.existsSync(messagesDir)) return [];
  
  let files = fs.readdirSync(messagesDir)
    .filter(f => f.endsWith('.json'))
    .sort((a, b) => b.localeCompare(a)); // Newest first
  
  if (before) {
    files = files.filter(f => {
      const ts = parseInt(f.split('-')[1]) || 0;
      return ts < before;
    });
  }
  
  const messages = [];
  for (const file of files.slice(0, limit)) {
    try {
      const msg = JSON.parse(fs.readFileSync(path.join(messagesDir, file), 'utf-8'));
      messages.push(msg);
    } catch (e) {
      // Skip corrupted files
    }
  }
  
  return messages.reverse(); // Return oldest first for display
}

function saveMessage(channelId, message) {
  const messagesDir = path.join(CHANNELS_DIR, channelId, 'messages');
  if (!fs.existsSync(messagesDir)) {
    fs.mkdirSync(messagesDir, { recursive: true });
  }
  
  const filename = `${message.id}.json`;
  fs.writeFileSync(path.join(messagesDir, filename), JSON.stringify(message, null, 2));
  return message;
}

function deleteMessage(channelId, messageId) {
  const messagesDir = path.join(CHANNELS_DIR, channelId, 'messages');
  const filepath = path.join(messagesDir, `${messageId}.json`);
  if (fs.existsSync(filepath)) {
    fs.unlinkSync(filepath);
    return true;
  }
  return false;
}

function generateMessageId() {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return `msg-${timestamp}-${random}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Mention Parsing
// ─────────────────────────────────────────────────────────────────────────────

function extractMentions(content) {
  const mentions = [];
  const regex = /@(\w+)/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    const mentionedId = match[1].toLowerCase();
    // Check if it's a valid bot or king
    const isBot = botsRegistry.bots.some(b => b.id.toLowerCase() === mentionedId || b.name.toLowerCase() === mentionedId);
    const isKing = mentionedId === 'king' || mentionedId === botsRegistry.king?.name?.toLowerCase();
    if (isBot || isKing) {
      mentions.push(mentionedId);
    }
  }
  return [...new Set(mentions)];
}

// ─────────────────────────────────────────────────────────────────────────────
// Context Building
// ─────────────────────────────────────────────────────────────────────────────

function buildBotContext(channelId, botId, botName) {
  const messages = getChannelMessages(channelId, CONTEXT_MESSAGE_COUNT);
  
  const formattedMessages = messages.map(m => {
    const time = new Date(m.timestamp).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    const senderName = m.sender?.name || m.sender?.id || 'Unknown';
    return `[${time}] ${senderName}: ${m.content}`;
  }).join('\n');
  
  return `[Sidekick Chat - #${channelId}]
This is the local Sidekick Chat workspace (NOT Discord). King and bots can chat here.

Recent messages:
---
${formattedMessages}
---

You are ${botName} in #${channelId}. If you have something useful to contribute, respond briefly. If not, respond with exactly: NO_REPLY`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Bot Invocation
// ─────────────────────────────────────────────────────────────────────────────

async function invokeBot(bot, channelId, context) {
  const sessionId = `sidekick-chat-${channelId}`;
  
  if (bot.type === 'local') {
    // Local bot via clawdbot CLI
    const workdir = bot.workdir || CLAWD_DIR;
    const tmpFile = path.join(PROJECT_DIR, `.tmp-${bot.id}-${Date.now()}.txt`);
    
    try {
      fs.writeFileSync(tmpFile, context);
      
      const result = execSync(
        `clawdbot agent --session-id "${sessionId}" --message "$(cat '${tmpFile}')" --json --timeout ${BOT_TIMEOUT_SECONDS}`,
        {
          encoding: 'utf-8',
          timeout: (BOT_TIMEOUT_SECONDS + 60) * 1000,
          cwd: workdir,
          shell: '/bin/bash',
          maxBuffer: 10 * 1024 * 1024
        }
      );
      
      fs.unlinkSync(tmpFile);
      return parseClawdbotResponse(result);
    } catch (e) {
      if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
      console.error(`Error invoking local bot ${bot.id}:`, e.message);
      return null;
    }
  } else if (bot.type === 'http') {
    // HTTP bot via Gateway OpenAI-compatible API
    try {
      const headers = { 
          'Content-Type': 'application/json',
          'x-clawdbot-session-key': sessionId
        };
        
        // Add auth token if configured for this bot
        if (bot.token) {
          headers['Authorization'] = `Bearer ${bot.token}`;
        }
        
        const response = await fetch(`${bot.endpoint}/v1/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: 'clawdbot',
          messages: [{ role: 'user', content: context }],
          stream: false
        }),
        signal: AbortSignal.timeout((BOT_TIMEOUT_SECONDS + 30) * 1000)
      });
      
      if (!response.ok) {
        console.error(`HTTP bot ${bot.id} returned ${response.status}`);
        return null;
      }
      
      const data = await response.json();
      // OpenAI format: { choices: [{ message: { content: "..." } }] }
      const content = data.choices?.[0]?.message?.content;
      return content?.trim() || null;
    } catch (e) {
      console.error(`Error invoking HTTP bot ${bot.id}:`, e.message);
      return null;
    }
  }
  
  return null;
}

function parseClawdbotResponse(result) {
  if (!result || typeof result !== 'string') return null;
  
  const trimmed = result.trim();
  if (!trimmed) return null;
  
  // Try to find JSON at end of output (might have log lines before it)
  const jsonMatch = trimmed.match(/\{[\s\S]*\}$/);
  
  if (jsonMatch) {
    try {
      const json = JSON.parse(jsonMatch[0]);
      
      // Extract text from payloads array (clawdbot --json format)
      if (json.result?.payloads?.length > 0) {
        const text = json.result.payloads
          .map(p => p.text)
          .filter(Boolean)
          .join('\n\n')
          .trim();
        if (text) return text;
      }
      
      // Check result.text or result.content directly
      if (json.result?.text) return json.result.text.trim();
      if (json.result?.content) return json.result.content.trim();
      if (json.result?.response) return json.result.response.trim();
      
      // Check summary field (clawdbot may put the response here)
      if (json.summary && typeof json.summary === 'string') return json.summary.trim();
      
      // Try other common response fields
      if (json.reply) return json.reply.trim();
      if (json.content) return json.content.trim();
      if (json.text) return json.text.trim();
      if (json.message) return json.message.trim();
      
      // Check for nested output field
      if (json.output) return json.output.trim();
      if (json.response) return json.response.trim();
      
      // Log full structure for debugging
      console.warn('Unrecognized JSON format:');
      console.warn('  top keys:', Object.keys(json));
      console.warn('  result type:', typeof json.result);
      console.warn('  result keys:', json.result && typeof json.result === 'object' ? Object.keys(json.result) : 'N/A');
      console.warn('  result.payloads:', json.result?.payloads ? `array of ${json.result.payloads.length}` : 'missing');
      console.warn('  summary:', json.summary ? json.summary.substring(0, 100) : 'missing');
    } catch (e) {
      console.warn('JSON parse failed:', e.message);
    }
  }
  
  // Fall back to raw text (strip any leading non-text lines)
  const lines = trimmed.split('\n');
  const textLines = lines.filter(line => 
    !line.startsWith('{') && 
    !line.startsWith('🔍') && 
    !line.startsWith('→') &&
    !line.includes('tokens') &&
    line.trim().length > 0
  );
  
  if (textLines.length > 0) {
    return textLines.join('\n').trim();
  }
  
  // Last resort: return trimmed if it looks like text
  if (trimmed.length > 0 && trimmed.length < 50000 && !trimmed.startsWith('{')) {
    return trimmed;
  }
  
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Bot Response Processing
// ─────────────────────────────────────────────────────────────────────────────

async function processBotResponses(channelId, triggerMessage) {
  const channel = getChannelInfo(channelId);
  if (!channel) return;
  
  const settings = channel.settings || {};
  const maxBots = settings.maxBotsPerTurn || DEFAULT_MAX_BOTS_PER_TURN;
  const cooldownMs = settings.cooldownMs || DEFAULT_COOLDOWN_MS;
  
  // Check mute state (bypass if message has @mention)
  const mentions = triggerMessage.mentions || [];
  const isMentionBypass = mentions.length > 0;
  
  if (globalConfig.muted && !isMentionBypass) {
    console.log('Bots muted, skipping responses');
    return;
  }
  
  // Get bots in this channel
  const channelBots = botsRegistry.bots.filter(b => channel.members.includes(b.id));
  
  // If muted but there's a mention, only invoke mentioned bots
  const botsToInvoke = globalConfig.muted && isMentionBypass
    ? channelBots.filter(b => mentions.includes(b.id.toLowerCase()) || mentions.includes(b.name.toLowerCase()))
    : channelBots;
  
  // Track this turn
  const turnKey = channelId;
  if (!turnTracking.has(turnKey) || Date.now() - turnTracking.get(turnKey).timestamp > 30000) {
    turnTracking.set(turnKey, {
      triggerMsgId: triggerMessage.id,
      respondedBots: new Set(),
      timestamp: Date.now()
    });
  }
  const turn = turnTracking.get(turnKey);
  
  // Check how many bots have already responded this turn
  if (turn.respondedBots.size >= maxBots) {
    console.log(`Max bots (${maxBots}) already responded this turn`);
    return;
  }
  
  // Filter bots by cooldown
  const now = Date.now();
  const eligibleBots = botsToInvoke.filter(bot => {
    const cooldownKey = `${bot.id}-${channelId}`;
    const lastSpoke = botCooldowns.get(cooldownKey) || 0;
    return now - lastSpoke >= cooldownMs;
  });
  
  if (eligibleBots.length === 0) {
    console.log('No eligible bots (all on cooldown)');
    return;
  }
  
  // Invoke bots in parallel, collect responses
  const botResponses = [];
  const remaining = maxBots - turn.respondedBots.size;
  
  const invocations = eligibleBots.slice(0, remaining + 2).map(async bot => {
    const context = buildBotContext(channelId, bot.id, bot.name);
    const response = await invokeBot(bot, channelId, context);
    
    // Filter out NO_REPLY and variations (bot might say "NO_REPLY" or explain why it's staying quiet)
    const trimmedResponse = response?.trim() || '';
    const normalizedResponse = trimmedResponse.toUpperCase();
    
    // Check for JSON-formatted silence signals
    const looksLikeInternalJson = trimmedResponse.startsWith('{') && 
      (trimmedResponse.includes('"silent"') || 
       trimmedResponse.includes('"no_reply"') || 
       trimmedResponse.includes('"action"') ||
       trimmedResponse.includes('"NO_REPLY"'));
    
    const shouldSkip = !response || 
      looksLikeInternalJson ||
      normalizedResponse === 'NO_REPLY' ||
      normalizedResponse === 'NOREPLY' ||
      normalizedResponse.startsWith('NO_REPLY') ||
      normalizedResponse.includes('STAY QUIET') ||
      normalizedResponse.includes('NOTHING TO ADD') ||
      normalizedResponse.includes("DON'T NEED TO RESPOND") ||
      normalizedResponse.includes("STAYING SILENT") ||
      normalizedResponse.includes("NO RESPONSE NEEDED") ||
      trimmedResponse.length === 0;
    
    if (response && !shouldSkip) {
      return { bot, response };
    }
    return null;
  });
  
  // Wait for all invocations
  const results = await Promise.allSettled(invocations);
  
  for (const result of results) {
    if (result.status === 'fulfilled' && result.value) {
      botResponses.push(result.value);
    }
  }
  
  // Batch responses (wait a bit to collect)
  await new Promise(resolve => setTimeout(resolve, RESPONSE_BATCH_WINDOW_MS));
  
  // Post responses (up to remaining slots)
  for (const { bot, response } of botResponses.slice(0, remaining)) {
    // Update cooldown
    const cooldownKey = `${bot.id}-${channelId}`;
    botCooldowns.set(cooldownKey, Date.now());
    turn.respondedBots.add(bot.id);
    
    // Create and save message
    const message = {
      id: generateMessageId(),
      channel: channelId,
      sender: { id: bot.id, name: bot.name, type: 'bot' },
      content: response,
      timestamp: Date.now(),
      replyTo: null,
      mentions: extractMentions(response),
      reactions: []
    };
    
    saveMessage(channelId, message);
    broadcast('message', message);
    console.log(`Bot ${bot.name} responded in #${channelId}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Bot Status Check
// ─────────────────────────────────────────────────────────────────────────────

async function checkBotStatus(bot) {
  if (bot.type === 'local') {
    // Local bots are always "online" if clawdbot is available
    try {
      execSync('which clawdbot', { encoding: 'utf-8', timeout: 5000 });
      return { online: true };
    } catch {
      return { online: false, reason: 'clawdbot not found' };
    }
  } else if (bot.type === 'http') {
    try {
      const response = await fetch(`${bot.endpoint}/api/status`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000)
      });
      return { online: response.ok };
    } catch (e) {
      return { online: false, reason: e.message };
    }
  }
  return { online: false, reason: 'unknown type' };
}

// ─────────────────────────────────────────────────────────────────────────────
// Express Middleware
// ─────────────────────────────────────────────────────────────────────────────

app.use(express.json());
app.use(express.static('public'));
app.use('/avatars', express.static(AVATARS_DIR));

// ─────────────────────────────────────────────────────────────────────────────
// API Routes: Channels
// ─────────────────────────────────────────────────────────────────────────────

app.get('/api/channels', (req, res) => {
  res.json(getAllChannels());
});

app.get('/api/channels/:id', (req, res) => {
  const channel = getChannelInfo(req.params.id);
  if (!channel) return res.status(404).json({ error: 'Channel not found' });
  res.json(channel);
});

app.get('/api/channels/:id/messages', (req, res) => {
  const { id } = req.params;
  const limit = Math.min(parseInt(req.query.limit) || 50, 100);
  const before = req.query.before ? parseInt(req.query.before) : null;
  
  const channel = getChannelInfo(id);
  if (!channel) return res.status(404).json({ error: 'Channel not found' });
  
  const messages = getChannelMessages(id, limit, before);
  res.json(messages);
});

app.post('/api/channels/:id/messages', async (req, res) => {
  const { id } = req.params;
  const { content, sender } = req.body;
  
  if (!content?.trim()) {
    return res.status(400).json({ error: 'Empty message' });
  }
  
  const channel = getChannelInfo(id);
  if (!channel) return res.status(404).json({ error: 'Channel not found' });
  
  // Build sender info
  const senderInfo = sender || { id: 'king', name: botsRegistry.king?.name || 'King', type: 'human' };
  
  // Create message
  const message = {
    id: generateMessageId(),
    channel: id,
    sender: senderInfo,
    content: content.trim(),
    timestamp: Date.now(),
    replyTo: req.body.replyTo || null,
    mentions: extractMentions(content),
    reactions: []
  };
  
  // Save and broadcast
  saveMessage(id, message);
  broadcast('message', message);
  
  res.json(message);
  
  // Trigger bot responses asynchronously (only for human messages)
  if (senderInfo.type === 'human') {
    setImmediate(() => {
      processBotResponses(id, message).catch(e => {
        console.error('Error processing bot responses:', e);
      });
    });
  }
});

app.delete('/api/channels/:id/messages/:msgId', (req, res) => {
  const { id, msgId } = req.params;
  
  const success = deleteMessage(id, msgId);
  if (!success) return res.status(404).json({ error: 'Message not found' });
  
  broadcast('messageDeleted', { channel: id, messageId: msgId });
  res.json({ success: true });
});

// Channel member management
app.post('/api/channels/:id/members', (req, res) => {
  const { id } = req.params;
  const { botId } = req.body;
  
  if (!botId) return res.status(400).json({ error: 'botId required' });
  
  const channelFile = path.join(CHANNELS_DIR, id, 'channel.json');
  if (!fs.existsSync(channelFile)) {
    return res.status(404).json({ error: 'Channel not found' });
  }
  
  const channel = JSON.parse(fs.readFileSync(channelFile, 'utf-8'));
  if (!channel.members.includes(botId)) {
    channel.members.push(botId);
    fs.writeFileSync(channelFile, JSON.stringify(channel, null, 2));
  }
  
  res.json({ success: true, members: channel.members });
});

app.delete('/api/channels/:id/members/:botId', (req, res) => {
  const { id, botId } = req.params;
  
  const channelFile = path.join(CHANNELS_DIR, id, 'channel.json');
  if (!fs.existsSync(channelFile)) {
    return res.status(404).json({ error: 'Channel not found' });
  }
  
  const channel = JSON.parse(fs.readFileSync(channelFile, 'utf-8'));
  channel.members = channel.members.filter(m => m !== botId);
  fs.writeFileSync(channelFile, JSON.stringify(channel, null, 2));
  
  res.json({ success: true, members: channel.members });
});

// ─────────────────────────────────────────────────────────────────────────────
// API Routes: Bots
// ─────────────────────────────────────────────────────────────────────────────

app.get('/api/bots', (req, res) => {
  res.json({
    bots: botsRegistry.bots,
    king: botsRegistry.king
  });
});

app.get('/api/bots/:id/status', async (req, res) => {
  const bot = botsRegistry.bots.find(b => b.id === req.params.id);
  if (!bot) return res.status(404).json({ error: 'Bot not found' });
  
  const status = await checkBotStatus(bot);
  res.json({ id: bot.id, name: bot.name, ...status });
});

// DM system - saves to files like channel messages
function getDmChannelId(botId) {
  return `dm-${botId}`;
}

function ensureDmChannel(botId) {
  const channelId = getDmChannelId(botId);
  const channelDir = path.join(CHANNELS_DIR, channelId);
  const messagesDir = path.join(channelDir, 'messages');
  const channelFile = path.join(channelDir, 'channel.json');
  
  if (!fs.existsSync(channelDir)) {
    fs.mkdirSync(channelDir, { recursive: true });
  }
  if (!fs.existsSync(messagesDir)) {
    fs.mkdirSync(messagesDir, { recursive: true });
  }
  if (!fs.existsSync(channelFile)) {
    const bot = botsRegistry.bots.find(b => b.id === botId);
    fs.writeFileSync(channelFile, JSON.stringify({
      id: channelId,
      name: `DM with ${bot?.name || botId}`,
      description: `Direct messages with ${bot?.name || botId}`,
      members: ['king', botId],
      created: Date.now(),
      isDm: true,
      settings: { maxBotsPerTurn: 1, cooldownMs: 0 }
    }, null, 2));
  }
}

// Get DM history
app.get('/api/dm/:botId', (req, res) => {
  const { botId } = req.params;
  const channelId = getDmChannelId(botId);
  const messages = getChannelMessages(channelId, 100);
  res.json(messages);
});

// Send DM to a specific bot
app.post('/api/dm/:botId', async (req, res) => {
  const { botId } = req.params;
  const { content } = req.body;
  
  if (!content?.trim()) {
    return res.status(400).json({ error: 'Empty message' });
  }
  
  const bot = botsRegistry.bots.find(b => b.id === botId);
  if (!bot) {
    return res.status(404).json({ error: 'Bot not found' });
  }
  
  // Ensure DM channel exists
  ensureDmChannel(botId);
  const channelId = getDmChannelId(botId);
  
  // Save King's message
  const kingMessage = {
    id: generateMessageId(),
    channel: channelId,
    sender: { id: 'king', name: 'King', type: 'human' },
    content: content.trim(),
    timestamp: Date.now(),
    replyTo: null,
    mentions: [],
    reactions: []
  };
  saveMessage(channelId, kingMessage);
  
  // Build context from recent DM history
  const recentMessages = getChannelMessages(channelId, 10);
  const formattedMessages = recentMessages.map(m => {
    const name = m.sender?.name || 'Unknown';
    return `${name}: ${m.content}`;
  }).join('\n');
  
  const context = `[Sidekick Chat - Direct Message with King]

Recent conversation:
---
${formattedMessages}
---

You are ${bot.name} in a private DM with King. Respond directly to King's message. If you have nothing to say, respond with exactly: NO_REPLY`;

  try {
    const response = await invokeBot(bot, channelId, context);
    
    // Apply NO_REPLY filter
    const trimmed = response?.trim() || '';
    const upper = trimmed.toUpperCase();
    const shouldSkip = !response || 
      upper === 'NO_REPLY' || upper.startsWith('NO_REPLY') || 
      upper.includes('STAY QUIET') || upper.includes('NOTHING TO ADD');
    
    if (!shouldSkip && trimmed) {
      // Save bot's response
      const botMessage = {
        id: generateMessageId(),
        channel: channelId,
        sender: { id: bot.id, name: bot.name, type: 'bot' },
        content: trimmed,
        timestamp: Date.now(),
        replyTo: null,
        mentions: [],
        reactions: []
      };
      saveMessage(channelId, botMessage);
      
      res.json({ success: true, botId, response: trimmed, messageId: botMessage.id });
    } else {
      res.json({ success: true, botId, response: null, note: 'Bot chose not to respond' });
    }
  } catch (e) {
    console.error(`DM to ${botId} failed:`, e.message);
    res.status(500).json({ error: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// API Routes: Control (Mute)
// ─────────────────────────────────────────────────────────────────────────────

app.get('/api/status', (req, res) => {
  res.json({
    muted: globalConfig.muted,
    mutedAt: globalConfig.mutedAt,
    mutedBy: globalConfig.mutedBy,
    botsCount: botsRegistry.bots.length,
    channelsCount: getAllChannels().length
  });
});

app.post('/api/mute', (req, res) => {
  globalConfig.muted = true;
  globalConfig.mutedAt = Date.now();
  globalConfig.mutedBy = req.body.by || 'king';
  saveConfig();
  
  broadcast('muteChanged', { muted: true });
  res.json({ success: true, muted: true });
});

app.post('/api/unmute', (req, res) => {
  globalConfig.muted = false;
  globalConfig.mutedAt = null;
  globalConfig.mutedBy = null;
  saveConfig();
  
  broadcast('muteChanged', { muted: false });
  res.json({ success: true, muted: false });
});

// ─────────────────────────────────────────────────────────────────────────────
// API Routes: SSE & Config
// ─────────────────────────────────────────────────────────────────────────────

app.get('/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  
  // Send initial status
  res.write(`event: connected\ndata: ${JSON.stringify({ muted: globalConfig.muted })}\n\n`);
  
  clients.push(res);
  console.log(`SSE client connected (total: ${clients.length})`);
  
  req.on('close', () => {
    clients = clients.filter(c => c !== res);
    console.log(`SSE client disconnected (total: ${clients.length})`);
  });
});

app.get('/api/config', (req, res) => {
  res.json({
    bots: botsRegistry.bots.map(b => ({
      id: b.id,
      name: b.name,
      avatar: b.avatar,
      color: b.color
    })),
    king: botsRegistry.king,
    channels: getAllChannels().map(c => ({
      id: c.id,
      name: c.name,
      description: c.description
    })),
    muted: globalConfig.muted
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Startup
// ─────────────────────────────────────────────────────────────────────────────

function getLocalIP() {
  const interfaces = require('os').networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

// Initialize
ensureDirectories();
loadBotsRegistry();
loadConfig();

app.listen(PORT, '0.0.0.0', () => {
  const localIP = getLocalIP();
  console.log(`
╔════════════════════════════════════════════════════════════════╗
║                    Sidekick Chat v2                             ║
╠════════════════════════════════════════════════════════════════╣
║  Local:     http://localhost:${PORT}                            ║
║  Network:   http://${localIP}:${PORT}                       ║
╠════════════════════════════════════════════════════════════════╣
║  Channels:  ${getAllChannels().length} configured                                     ║
║  Bots:      ${botsRegistry.bots.length} registered                                     ║
║  Muted:     ${globalConfig.muted ? 'YES' : 'NO'}                                           ║
╚════════════════════════════════════════════════════════════════╝
`);
});

const express = require('express');
const fs = require('fs');
const path = require('path');
const { spawn, execSync } = require('child_process');
const chokidar = require('chokidar');

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

// Paths - all configurable via environment
const PROJECT_DIR = process.env.PROJECT_DIR || process.cwd();
const CLAWD_DIR = process.env.CLAWD_DIR || path.join(process.env.HOME, 'clawd');
const INBOX_DIR = path.join(PROJECT_DIR, 'inbox');
const OUTBOX_DIR = path.join(PROJECT_DIR, 'outbox');
const AVATARS_DIR = process.env.AVATARS_DIR || path.join(CLAWD_DIR, 'avatars');
const SESSION_ID = process.env.CLAWDBOT_SESSION_ID || 'sidekick-chat';

// Ensure directories exist
[INBOX_DIR, OUTBOX_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

app.use(express.json());
app.use(express.static('public'));

// Serve avatars from clawd
app.use('/avatars', express.static(AVATARS_DIR));

// SSE for live updates
let clients = [];

app.get('/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  clients.push(res);
  req.on('close', () => {
    clients = clients.filter(c => c !== res);
  });
});

function broadcast(event, data) {
  clients.forEach(c => c.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
}

// Track processed messages to avoid duplicates
const processedMessages = new Set();

// Load previously processed messages
const processedPath = path.join(PROJECT_DIR, '.processed');
if (fs.existsSync(processedPath)) {
  fs.readFileSync(processedPath, 'utf-8').split('\n').filter(Boolean).forEach(f => processedMessages.add(f));
}

function markProcessed(filename) {
  processedMessages.add(filename);
  fs.appendFileSync(processedPath, filename + '\n');
}

// Call Clawdbot to process a message
async function processWithClawdbot(filepath, filename) {
  if (processedMessages.has(filename)) {
    console.log('Already processed:', filename);
    return;
  }
  
  console.log('Processing with Clawdbot:', filepath);
  markProcessed(filename);
  
  const content = fs.readFileSync(filepath, 'utf-8').trim();
  const timestamp = Date.now();
  
  try {
    // Write content to temp file to avoid shell escaping issues
    const tmpFile = path.join(PROJECT_DIR, '.tmp-message.txt');
    fs.writeFileSync(tmpFile, content);
    
    // Use clawdbot agent to process the message
    // Use a dedicated session ID for Sidekick Chat (separate from Telegram)
    const result = execSync(
      `clawdbot agent --session-id ${SESSION_ID} --message "$(cat '${tmpFile}')" --json --timeout 120`,
      {
        encoding: 'utf-8',
        timeout: 180000, // 3 min timeout
        cwd: CLAWD_DIR,
        shell: '/bin/bash',
        maxBuffer: 10 * 1024 * 1024 // 10MB buffer
      }
    );
    
    // Clean up temp file
    fs.unlinkSync(tmpFile);
    
    // Parse JSON response to get the actual reply text
    let replyText = result;
    try {
      const json = JSON.parse(result);
      // Extract text from payloads array
      if (json.result?.payloads?.length > 0) {
        replyText = json.result.payloads
          .map(p => p.text)
          .filter(Boolean)
          .join('\n\n');
      } else {
        replyText = json.reply || json.content || json.text || json.message || result;
      }
    } catch {
      // Not JSON, use raw result
    }
    
    // Save the response
    const replyFilename = `reply-${timestamp}.txt`;
    const replyPath = path.join(OUTBOX_DIR, replyFilename);
    fs.writeFileSync(replyPath, replyText.trim());
    
    console.log('Clawdbot replied:', replyFilename);
  } catch (error) {
    console.error('Clawdbot error:', error.message);
    // Save error as reply
    const replyFilename = `reply-${timestamp}.txt`;
    const replyPath = path.join(OUTBOX_DIR, replyFilename);
    fs.writeFileSync(replyPath, `[Error: ${error.message}]`);
  }
}

// Watch for new files
const watcher = chokidar.watch([INBOX_DIR, OUTBOX_DIR], { ignoreInitial: true });

watcher.on('add', filepath => {
  console.log('New file:', filepath);
  const filename = path.basename(filepath);
  
  // If it's a new inbox message, process with Clawdbot
  if (filepath.includes('/inbox/') && filename.startsWith('msg-')) {
    processWithClawdbot(filepath, filename);
  }
  
  setTimeout(() => broadcast('newMessage', { path: filepath }), 100);
});

// Get all messages
app.get('/api/messages', (req, res) => {
  const messages = [];
  
  // Read inbox (King's messages)
  if (fs.existsSync(INBOX_DIR)) {
    fs.readdirSync(INBOX_DIR)
      .filter(f => f.startsWith('msg-') && f.endsWith('.txt'))
      .forEach(file => {
        const filepath = path.join(INBOX_DIR, file);
        const content = fs.readFileSync(filepath, 'utf-8');
        const stat = fs.statSync(filepath);
        const timestamp = parseInt(file.match(/msg-(\d+)/)?.[1] || stat.mtimeMs);
        messages.push({
          id: file,
          type: 'inbox',
          sender: 'king',
          content,
          timestamp,
          file: `inbox/${file}`
        });
      });
  }
  
  // Read outbox (Sidekick's messages)
  if (fs.existsSync(OUTBOX_DIR)) {
    fs.readdirSync(OUTBOX_DIR)
      .filter(f => f.startsWith('reply-') && f.endsWith('.txt'))
      .forEach(file => {
        const filepath = path.join(OUTBOX_DIR, file);
        const content = fs.readFileSync(filepath, 'utf-8');
        const stat = fs.statSync(filepath);
        const timestamp = parseInt(file.match(/reply-(\d+)/)?.[1] || stat.mtimeMs);
        messages.push({
          id: file,
          type: 'outbox',
          sender: 'sidekick',
          content,
          timestamp,
          file: `outbox/${file}`
        });
      });
  }
  
  // Sort by timestamp
  messages.sort((a, b) => a.timestamp - b.timestamp);
  res.json(messages);
});

// King sends a message
app.post('/api/send', (req, res) => {
  const { content } = req.body;
  if (!content?.trim()) return res.status(400).json({ error: 'Empty message' });
  
  const timestamp = Date.now();
  const filename = `msg-${timestamp}.txt`;
  const filepath = path.join(INBOX_DIR, filename);
  
  fs.writeFileSync(filepath, content.trim());
  
  res.json({
    success: true,
    file: `inbox/${filename}`,
    timestamp
  });
});

// Get single message
app.get('/api/message/:folder/:file', (req, res) => {
  const { folder, file } = req.params;
  if (!['inbox', 'outbox'].includes(folder)) return res.status(400).json({ error: 'Invalid folder' });
  
  const dir = folder === 'inbox' ? INBOX_DIR : OUTBOX_DIR;
  const filepath = path.join(dir, file);
  
  if (!fs.existsSync(filepath)) return res.status(404).json({ error: 'Not found' });
  
  const content = fs.readFileSync(filepath, 'utf-8');
  res.json({ content, file: `${folder}/${file}` });
});

// Get local IP for network access
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

app.listen(PORT, '0.0.0.0', () => {
  const localIP = getLocalIP();
  console.log(`\n🐱 Sidekick Chat running at http://localhost:${PORT}`);
  console.log(`   Network: http://${localIP}:${PORT}\n`);
  console.log(`Session:  ${SESSION_ID}`);
  console.log(`Inbox:    ${INBOX_DIR}`);
  console.log(`Outbox:   ${OUTBOX_DIR}`);
  console.log(`Avatars:  ${AVATARS_DIR}`);
  console.log(`Clawd:    ${CLAWD_DIR}\n`);
});

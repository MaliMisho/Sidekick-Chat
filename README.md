# Sidekick Chat 🐱🔒

Private chat app where Telegram only sees file pointers, not message content.

## How It Works

**When King sends a message:**
1. Content saves to `~/clawd/inbox/msg-{timestamp}.txt`
2. Telegram shows: `read inbox/msg-{timestamp}.txt`

**When Sidekick replies:**
1. Content saves to `~/clawd/outbox/reply-{timestamp}.txt`  
2. Telegram shows: `reply ready outbox/reply-{timestamp}.txt`

**Result:** All actual message content stays local. Telegram is just a notification channel.

## Quick Start

```bash
cd ~/clawd/projects/sidekick-chat
npm install
npm start
```

Open: http://localhost:3847

## Features

- 💬 Clean chat UI with bubbles
- 👑 King's messages on right (blue)
- 🐱 Sidekick's messages on left (gray)
- 🔄 Live updates via SSE (no refresh needed)
- 👑 Simulate King's messages for testing
- 🔒 Privacy badge

## File Structure

```
~/clawd/
├── inbox/           # King's messages
│   └── msg-*.txt
├── outbox/          # Sidekick's replies
│   └── reply-*.txt
├── avatars/
│   └── sidekick.jpg
└── projects/sidekick-chat/
    ├── server.js
    └── public/
```

## Next Steps

- [ ] Integration with Clawdbot to auto-read inbox files
- [ ] King's avatar config
- [ ] Message encryption at rest
- [ ] Mobile-friendly PWA

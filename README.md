# Sidekick Chat 🐱🔒

Private chat interface for Clawdbot that bypasses Telegram/WhatsApp. Messages stay local on your machine.

## Why?

When you chat with Clawdbot via Telegram, both Telegram AND Anthropic see your messages. Sidekick Chat removes the middleman — messages go directly from your browser to Clawdbot on your local network.

**What's private:**
- ✅ Telegram/WhatsApp never sees your messages
- ✅ Messages stored locally on your machine
- ✅ Works on your LAN only (not exposed to internet)

**What's NOT private:**
- ❌ Anthropic still processes your messages (Clawdbot uses Claude)

## Prerequisites

- [Clawdbot](https://github.com/clawdbot/clawdbot) installed and running
- Node.js 18+

## Quick Start

```bash
# Clone the repo
git clone https://github.com/YOUR_USERNAME/sidekick-chat.git
cd sidekick-chat

# Run setup (installs deps, creates .env)
./setup.sh

# Start the server
npm start
```

Open `http://localhost:3847` in your browser.

**From another device on your network:** Use your machine's local IP (shown when server starts).

## Configuration

Edit `.env` to customize:

```bash
# Port (default: 3847)
PORT=3847

# Clawdbot session ID - keeps this chat separate from Telegram etc.
CLAWDBOT_SESSION_ID=sidekick-chat

# Clawdbot workspace directory (where SOUL.md lives)
# Default: ~/clawd
CLAWD_DIR=/path/to/your/clawd

# Avatar images (optional)
# Default: $CLAWD_DIR/avatars
AVATARS_DIR=/path/to/avatars
```

## How It Works

```
┌─────────────┐    HTTP     ┌─────────────┐   CLI    ┌─────────────┐
│   Browser   │ ──────────► │   Express   │ ───────► │  Clawdbot   │
│  (your LAN) │ ◄────────── │   Server    │ ◄─────── │   Agent     │
└─────────────┘    SSE      └─────────────┘          └─────────────┘
                                  │
                                  ▼
                            ┌─────────────┐
                            │ Local Files │
                            │ inbox/      │
                            │ outbox/     │
                            └─────────────┘
```

1. You type a message in the browser
2. Server saves it to `inbox/` and calls `clawdbot agent`
3. Clawdbot processes and replies
4. Server saves reply to `outbox/` and streams it back via SSE

## Message Storage

Messages are stored as plain text files:
- `inbox/msg-{timestamp}.txt` — Your messages
- `outbox/reply-{timestamp}.txt` — Sidekick's replies

Files never leave your machine unless you move them.

## Features

- 💬 Clean chat UI with message bubbles
- 🔄 Real-time updates via Server-Sent Events
- 🔒 Messages never leave your network
- 🎨 Dark theme
- 📱 Works on any device on your LAN
- 🐱 Custom avatars support

## Troubleshooting

**"clawdbot: command not found"**
- Make sure Clawdbot is installed globally: `npm install -g clawdbot`
- Or add it to your PATH

**Messages not sending**
- Check that Clawdbot is configured (`clawdbot status`)
- Make sure you have an active API key

**Can't access from phone/other device**
- Make sure you're on the same network
- Use the IP address shown when server starts, not localhost
- Check firewall isn't blocking port 3847

## License

MIT

## Credits

Built for use with [Clawdbot](https://github.com/clawdbot/clawdbot) 🦞

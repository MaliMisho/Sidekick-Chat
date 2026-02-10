# Sidekick Chat 🐱🔒

Private chat interface for Clawdbot that bypasses Telegram/WhatsApp. Messages stay local on your machine.

## Why?

When you chat with Clawdbot via Telegram, both Telegram AND Anthropic see your messages. Sidekick Chat removes the middleman - messages go directly from your browser to Clawdbot on your local network.

**What's private:**
- ✅ Telegram/WhatsApp never sees your messages
- ✅ Messages stored locally on your machine
- ✅ Works on your LAN only (not exposed to internet)

**What's NOT private:**
- ❌ Anthropic still processes your messages (Clawdbot uses Claude)

## Prerequisites

- [Clawdbot](https://github.com/clawdbot/clawdbot) installed and configured
- Node.js 18+
- A Clawdbot agent set up with API access

## Quick Start

```bash
# Clone the repo
git clone https://github.com/YOUR_USERNAME/sidekick-chat.git
cd sidekick-chat

# Install dependencies
npm install

# Configure (see Configuration below)
cp .env.example .env
# Edit .env with your settings

# Start the server
npm start
```

Open: `http://localhost:3847` (or your machine's IP on the same network)

## Configuration

Create a `.env` file or set environment variables:

```bash
# Port to run on (default: 3847)
PORT=3847

# Clawdbot session ID (creates isolated chat context)
CLAWDBOT_SESSION_ID=sidekick-chat

# Path to avatars (optional)
AVATARS_DIR=/path/to/your/avatars

# Clawdbot workspace directory
CLAWD_DIR=/path/to/your/clawdbot/workspace
```

## Features

- 💬 Clean chat UI with message bubbles
- 🔄 Real-time updates via Server-Sent Events
- 🔒 Messages never leave your network
- 🎨 Dark theme
- 📱 Works on any device on your LAN

## Architecture

```
┌─────────────┐    HTTP     ┌─────────────┐   CLI    ┌─────────────┐
│   Browser   │ ──────────> │   Express   │ ───────> │  Clawdbot   │
│  (your LAN) │ <────────── │   Server    │ <─────── │   Agent     │
└─────────────┘    SSE      └─────────────┘          └─────────────┘
                                  │
                                  ▼
                            ┌─────────────┐
                            │ Local Files │
                            │ inbox/      │
                            │ outbox/     │
                            └─────────────┘
```

## Roadmap

- [ ] Environment-based configuration
- [ ] Docker support
- [ ] Custom avatars via config
- [ ] Message encryption at rest
- [ ] Auto-start service (launchd/systemd)
- [ ] Mobile PWA support

## License

MIT

## Credits

Built with [Clawdbot](https://github.com/clawdbot/clawdbot) 🦞

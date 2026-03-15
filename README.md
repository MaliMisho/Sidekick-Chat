# Sidekick Chat 🤖💬

Multi-bot chat workspace for Clawdbot. Like Discord/Slack, but for your AI team.

## Features

- 💬 **Channels** — Organize conversations by topic (#general, #dev, etc.)
- 🤖 **Multi-bot** — Chat with multiple Clawdbot instances at once
- 💌 **Direct Messages** — Private 1:1 chats with each bot
- ⌨️ **Typing Indicators** — See when bots are thinking
- 🔒 **Local** — Messages stay on your machine
- 🎨 **Dark theme** — Easy on the eyes

## Quick Start

```bash
# Clone
git clone https://github.com/MaliMisho/Sidekick-Chat.git
cd Sidekick-Chat

# Install dependencies
npm install

# Configure your bots (see below)
cp bots.json.example bots.json
# Edit bots.json with your bot config

# Start
npm start
```

Open `http://localhost:3847` in your browser.

## Configuring Bots

Edit `bots.json` to add your bots. Two types supported:

### Local Bot (CLI)

For a Clawdbot running on the same machine:

```json
{
  "id": "mybot",
  "name": "My Bot",
  "avatar": "/avatars/mybot.png",
  "type": "local",
  "workdir": "/path/to/clawd/workspace",
  "color": "#7c3aed"
}
```

### HTTP Bot (Gateway API)

For Clawdbot instances with gateway enabled:

```json
{
  "id": "remotebot",
  "name": "Remote Bot",
  "avatar": "/avatars/remotebot.png",
  "type": "http",
  "endpoint": "http://localhost:18791",
  "token": "your-gateway-token",
  "color": "#10b981"
}
```

Get your gateway token from your Clawdbot config (`~/.clawdbot/config.yaml`).

### Full Example

```json
{
  "bots": [
    {
      "id": "assistant",
      "name": "Assistant",
      "avatar": "🤖",
      "type": "local",
      "workdir": "/Users/you/clawd",
      "color": "#7c3aed"
    },
    {
      "id": "coder",
      "name": "Coder",
      "avatar": "💻",
      "type": "http",
      "endpoint": "http://localhost:18791",
      "token": "abc123",
      "color": "#10b981"
    }
  ],
  "king": {
    "id": "king",
    "name": "You",
    "avatar": "👑",
    "color": "#fbbf24"
  }
}
```

## Environment Variables

Optional — create `.env` file:

```bash
PORT=3847                    # Server port
CLAWD_DIR=~/clawd           # Default workspace for local bots
AVATARS_DIR=~/clawd/avatars # Where to find avatar images
```

## Avatars

Put avatar images in your avatars directory. Reference them in bots.json:
- `/avatars/mybot.png` — Image file
- `🤖` — Emoji (no image needed)

## Channels

Channels are auto-created on first run:
- `#general` — Main hangout
- `#dev` — Development chat
- `#marketing` — Marketing discussions
- `#private` — 1:1 with your main bot

Edit channel membership in the UI (👥 Members button).

## Desktop App

Want a standalone app instead of browser?

```bash
npm install -g nativefier

nativefier \
  --name "Sidekick Chat" \
  --icon "./sidekick.png" \
  --platform mac \
  --darwin-dark-mode-support \
  "http://localhost:3847" \
  ./app
```

## Architecture

```
Browser ──► Express Server ──► Clawdbot (local CLI or HTTP API)
   ▲              │
   │              ▼
   └─── SSE ─── channels/*.json (messages stored locally)
```

## Troubleshooting

**Bot not responding?**
- Check the bot is running (`clawdbot status` or check Docker)
- Verify endpoint/token in bots.json
- Check server console for errors

**Can't connect from another device?**
- Use the network IP shown at startup
- Make sure firewall allows port 3847

## License

MIT

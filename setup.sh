#!/bin/bash
# Sidekick Chat Setup Script

set -e

echo "🐱 Sidekick Chat Setup"
echo "======================"
echo ""

# Check for Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js 18+ first."
    echo "   https://nodejs.org/"
    exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo "❌ Node.js version 18+ required. You have: $(node -v)"
    exit 1
fi
echo "✅ Node.js $(node -v)"

# Check for Clawdbot
if ! command -v clawdbot &> /dev/null; then
    echo "❌ Clawdbot is not installed. Please install Clawdbot first."
    echo "   npm install -g clawdbot"
    exit 1
fi
echo "✅ Clawdbot installed"

# Install dependencies
echo ""
echo "📦 Installing dependencies..."
npm install

# Create .env if it doesn't exist
if [ ! -f .env ]; then
    echo ""
    echo "📝 Creating .env from template..."
    cp .env.example .env
    echo "   Edit .env to customize your setup (optional)"
else
    echo ""
    echo "✅ .env already exists"
fi

# Create directories
mkdir -p inbox outbox

echo ""
echo "✅ Setup complete!"
echo ""
echo "To start Sidekick Chat:"
echo "  npm start"
echo ""
echo "Then open http://localhost:3847 in your browser"
echo ""

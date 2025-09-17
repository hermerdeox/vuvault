# VuVault Zero - Ngrok Tunnel Setup Guide

## 🌐 Overview

This guide will help you set up an ngrok tunnel to access your VuVault Zero development server from anywhere using a custom domain.

## 📋 Prerequisites

1. **Ngrok Account**: You need a paid ngrok account for custom domains
2. **Domain Configuration**: Your domain must be configured in the ngrok dashboard
3. **Ngrok CLI**: Installed and authenticated

## 🔧 Setup Steps

### Step 1: Configure Your Domain in Ngrok Dashboard

1. Go to https://dashboard.ngrok.com/domains
2. Add your custom domain: `vuvault.ngrok.io`
3. Note the exact domain name as configured

### Step 2: Verify Ngrok Installation

```bash
# Check if ngrok is installed
ngrok version

# Check if authenticated
ngrok config check
```

### Step 3: Start the Development Server

We have multiple options for starting the server:

#### Option A: Simple Setup (Recommended)
```bash
# Start dev server with ngrok config
bun run dev:ngrok

# In another terminal, start ngrok
ngrok http --domain=vuvault.ngrok.io 3005
```

#### Option B: Using the Script
```bash
# Run the automated script
bun run tunnel
```

#### Option C: Manual Setup
```bash
# Terminal 1: Start dev server
cd /Users/cybertouch/Documents/eoxvault/eoxvault-zero
bun run dev

# Terminal 2: Start ngrok tunnel
ngrok http --domain=vuvault.ngrok.io 3005
```

## 🚨 Troubleshooting

### Error: ERR_NGROK_8012
This means the domain isn't properly configured. Solutions:
1. Check domain spelling in dashboard
2. Ensure domain is active
3. Try with the exact domain format from dashboard

### Error: ERR_NGROK_15002
Your account requires domain registration. Solutions:
1. Register domain at https://dashboard.ngrok.com/domains
2. Use `--domain` flag instead of `--url`

### Port Already in Use
```bash
# Kill process on port 3005
lsof -ti:3005 | xargs kill -9
```

### Alternative: Use Ngrok's Generated URL

If custom domain isn't working, you can use ngrok's auto-generated URL:

```bash
# First, check your ngrok auth token
ngrok config edit

# Add or verify your authtoken:
# authtoken: YOUR_AUTH_TOKEN_HERE

# Then start tunnel without custom domain
ngrok http 3005 --host-header=rewrite
```

This will give you a URL like: `https://abc123.ngrok.io`

## 📝 Available Scripts

```bash
# Start dev server normally
bun run dev

# Start dev server with ngrok config
bun run dev:ngrok

# Run automated tunnel script
bun run tunnel

# Run tunnel script with sudo (for port 80)
bun run tunnel:sudo
```

## 🔐 Security Notes

1. **Development Only**: Never use ngrok tunnels for production
2. **Authentication**: The tunnel is publicly accessible - ensure auth is enabled
3. **HTTPS**: Ngrok provides HTTPS by default
4. **Rate Limits**: Be aware of ngrok rate limits on your plan

## 📊 Current Status

- **Dev Server**: Running on port 3005
- **Ngrok Tunnel**: Requires domain configuration
- **Alternative**: Use ngrok's auto-generated URL

## 🎯 Quick Start Commands

```bash
# Terminal 1
cd /Users/cybertouch/Documents/eoxvault/eoxvault-zero
bun run dev

# Terminal 2 (after domain is configured)
ngrok http --domain=vuvault.ngrok.io 3005

# OR use auto-generated URL
ngrok http 3005 --host-header=rewrite
```

## 📱 Accessing Your App

Once the tunnel is running, you can access VuVault Zero at:
- **Custom Domain**: https://vuvault.ngrok.io (requires configuration)
- **Generated URL**: Check ngrok terminal output for URL

## 🛠️ Configuration Files

- `vite.config.ts`: Standard Vite configuration
- `vite.config.ngrok.ts`: Ngrok-optimized configuration
- `start-tunnel.sh`: Automated startup script
- `start-ngrok.sh`: Sudo-based script for port 80

## 📚 Resources

- [Ngrok Dashboard](https://dashboard.ngrok.com)
- [Ngrok Domains](https://dashboard.ngrok.com/domains)
- [Ngrok Documentation](https://ngrok.com/docs)
- [Vite Server Options](https://vitejs.dev/config/server-options.html)

---

**Note**: The dev server is currently running on port 3005. Make sure this port is free before starting.

# Server Setup Guide — Cloudflare Domain + 24/7 Hosting

## What This Does
- Your Node.js server runs on `localhost:3000`
- Cloudflare Tunnel connects your domain → your PC (no port forwarding needed)
- pm2 keeps Node.js alive and restarts it if it crashes
- Both run as Windows services (auto-start on boot)

---

## Step 1 — Install Tools

Run **as Administrator**:
```
C:\SERVER\setup-cloudflare.bat
```

---

## Step 2 — Login to Cloudflare

Open a terminal and run:
```
cloudflared tunnel login
```
A browser window will open. Log in and **click your domain** to authorize.

---

## Step 3 — Create a Tunnel

```
cloudflared tunnel create my-server
```

This outputs a **Tunnel ID** like: `a1b2c3d4-e5f6-7890-abcd-ef1234567890`

Copy it — you need it in the next step.

---

## Step 4 — Edit the Config File

Open `C:\SERVER\cloudflared-config.yml` and fill in:

1. `YOUR-TUNNEL-ID-HERE` → your actual tunnel ID
2. `YOUR-USERNAME` → your Windows username (run `echo %USERNAME%` to check)
3. `yourdomain.com` → your actual domain

Example:
```yaml
tunnel: a1b2c3d4-e5f6-7890-abcd-ef1234567890
credentials-file: C:\Users\John\.cloudflared\a1b2c3d4-e5f6-7890-abcd-ef1234567890.json

ingress:
  - hostname: example.com
    service: http://localhost:3000
  - hostname: www.example.com
    service: http://localhost:3000
  - service: http_status:404
```

---

## Step 5 — Add DNS Records in Cloudflare

Run this to automatically add DNS records (replace with your values):
```
cloudflared tunnel route dns my-server yourdomain.com
cloudflared tunnel route dns my-server www.yourdomain.com
```

Or manually in the Cloudflare dashboard:
- Type: `CNAME`
- Name: `@` (for root domain) or `www`
- Target: `YOUR-TUNNEL-ID.cfargotunnel.com`
- Proxy: ON (orange cloud)

---

## Step 6 — Test It

Start manually first to test:
```
cloudflared tunnel --config C:\SERVER\cloudflared-config.yml run
```
In another terminal:
```
pm2 start C:\SERVER\server.js --name apps-server
```

Visit your domain in a browser — it should load your apps page!

---

## Step 7 — Install as Windows Services (Auto-Start on Boot)

Once tested and working, run **as Administrator**:
```
C:\SERVER\install-as-service.bat
```

---

## Managing Your Server

| Task | Command |
|------|---------|
| See Node.js status | `pm2 status` |
| See Node.js logs | `pm2 logs apps-server` |
| Restart Node.js | `pm2 restart apps-server` |
| Stop Node.js | `pm2 stop apps-server` |
| Tunnel status | `sc query cloudflared` |
| Stop tunnel | `sc stop cloudflared` |
| Start tunnel | `sc start cloudflared` |

---

## Adding Apps

Drop any folder with an `index.html` into `C:\SERVER\apps\`

Example:
```
C:\SERVER\apps\
  calculator\
    index.html
  todo-app\
    index.html
```

They'll appear on your homepage at `yourdomain.com`

---

## Troubleshooting

**Domain not loading:**
- Check tunnel is running: `cloudflared tunnel list`
- Check DNS in Cloudflare dashboard (orange cloud must be ON)
- Check Node.js is running: `pm2 status`

**Tunnel won't start:**
- Verify tunnel ID and credentials path in `cloudflared-config.yml`
- Re-run `cloudflared tunnel login`

**pm2 not found after reboot:**
- Run: `npm install -g pm2 pm2-windows-startup`
- Run: `pm2-startup install`

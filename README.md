# HAILIE — Housing AI Leadership & Implementation Exchange

This repository contains the static website codebase for HAILIE ([housingai.org](https://housingai.org)). 

HAILIE is an independent, vendor-neutral community for social housing leaders using Artificial Intelligence responsibly. It brings CEOs, boards, IT and digital teams, and senior service leaders together to share practical guidance, peer learning, and events.

---

## 🛠️ Tech Stack & Structure

- **Core**: Semantic HTML5 and Vanilla Javascript.
- **Styling**: Vanilla CSS (`css/style.css`).
- **Web Server**: Caddy (configured for Railway deployment).
- **Integrations**: Sentry Browser SDK (dynamic loader).

### Directory Map
```
├── js/
│   └── main.js             # General interactive logic & Sentry loader
├── css/
│   └── style.css           # Core styling system (tokens, components, utilities)
├── Images/                 # Logo and visual page assets
├── resources/              # HTML guides, checklists, and templates
├── Caddyfile               # Caddy server production configuration
├── nixpacks.toml           # Nixpacks environment configuration for Caddy
└── [pages].html            # Main site pages (index, about, events, for-leaders, join, resources)
```

---

## 🚀 Local Development

To run the site locally, you can use any static file server.

### Option 1: Live Server (VS Code Extension)
Right-click on `index.html` and select **"Open with Live Server"**.

### Option 2: Node.js (via `npx`)
In the root directory, run:
```bash
npx http-server .
```
Open the localhost URL shown in the terminal (usually `http://127.0.0.1:8080`).

---

## 🛰️ Production Deployment (Railway)

This site is optimized for deployment via **Railway** using **Nixpacks** and **Caddy**.

- **Caddy** automatically handles:
  - High-performance static file serving.
  - Automatic `gzip`/`zstd` compression on assets.
  - Security headers (`X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`).
  - Cache-Control headers for CSS, JS, and image assets.
  - Clean/pretty URLs (e.g., serving `/about` to `/about.html` without requiring the extension in the URL).
  
To deploy changes, simply push code to the repository branch connected to Railway. Nixpacks will automatically install Caddy, bind it to the correct port, and spin up the container.

---

## ⚙️ Sentry Error Monitoring

Sentry is integrated dynamically using Sentry's Browser CDN SDK (v8.x) with performance tracing and session replay features.

### Configuration
1. Open `js/main.js`.
2. Locate the `SENTRY_DSN` constant near the top:
   ```javascript
   const SENTRY_DSN = 'YOUR_DSN_HERE';
   ```
3. When `SENTRY_DSN` is populated, the Sentry script is dynamically appended to the page header, resolving dynamically for all site pages. If left empty, Sentry is completely disabled with zero runtime overhead.

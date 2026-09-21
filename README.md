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
├── apps-script/            # Google Apps Script that receives document submissions (deployed separately)
├── Caddyfile               # Caddy server production configuration
├── nixpacks.toml           # Nixpacks environment configuration for Caddy
└── [pages].html            # Main site pages (index, about, events, for-leaders, join, share-a-document, resources, privacy)
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

## 📄 Document Submission Form

`share-a-document.html` lets members upload a policy, DPIA, board paper or template (PDF or Word, max 10 MB) and choose how HAILIE may use it (publish with attribution, publish anonymised, members only, or internal use only).

The site is static, so submissions are handled by a free **Google Apps Script web app** (`apps-script/Code.gs`) running under a HAILIE Google account. It saves each file into the shared HAILIE Google Drive folder (sub-foldered by the permission chosen), logs the details in a Google Sheet in the same folder, emails HAILIE a notification and sends the submitter an acknowledgement. People submitting do not need a Google account.

Until the script is deployed and its URL added to the page, the form shows a notice asking people to email the document instead.

### One-time setup (about 10 minutes)
1. Sign in to the Google account that should own the documents (e.g. guy@housingai.org) and go to [script.google.com](https://script.google.com). Click **New project**.
2. Delete the default code, paste in the contents of `apps-script/Code.gs`, and save. Optionally rename the project "HAILIE document submissions".
3. Check the `CONFIG` block at the top. `FOLDER_ID` is pre-set to the shared HAILIE submissions folder (`drive.google.com/drive/folders/14FYgbQWJzabJkpsSaPnRF03dRA1U8qhV`); the account deploying the script needs edit access to it. Permission sub-folders and the log Sheet are created inside it on the first submission. You can also change the sheet name, set a different notification address, or point at an existing Sheet by ID.
4. Click **Deploy > New deployment**, choose type **Web app**, and set:
   - **Execute as**: Me
   - **Who has access**: Anyone
5. Click **Deploy** and authorise the permissions it asks for (Drive, Sheets, Gmail send). Copy the **Web app URL** ending in `/exec`.
6. Open `share-a-document.html` and replace the placeholder in the form's `action` attribute with that URL:
   ```html
   <form id="document-upload-form" action="https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec" ...>
   ```
7. Commit and push. Test with a small PDF; it should appear in Drive within a few seconds and you should receive an email.

If you later change `Code.gs`, redeploy with **Deploy > Manage deployments > Edit > Version: New version** so the same URL picks up the change.

### How it works
- The browser reads the chosen file, base64-encodes it, and POSTs a JSON body (all form fields plus the file) to the script. The request is sent as `text/plain` so no CORS preflight is needed, which Apps Script does not support.
- `doPost` validates the fields, file type and size, decodes the file, saves it as `YYYY-MM-DD - Organisation - original-name.pdf` in the matching permission sub-folder, appends a row to the log sheet, then emails.
- Fields sent: `name`, `email`, `organisation`, `role`, `document_title`, `document_type`, `document_status`, `description`, `data_use`, `use_conditions`, `confirm_authority`, `confirm_privacy`, `file` (`name`, `type`, `size`, `data`), plus the `_gotcha` honeypot.
- Limits: Apps Script accepts request bodies up to 50 MB and consumer Gmail accounts can send 100 emails a day, both well above expected volume. Change `data-max-size-mb` on the form, the help text on the page, and `MAX_FILE_BYTES` in the script together if you raise the file limit.

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

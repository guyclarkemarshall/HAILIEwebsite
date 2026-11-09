# HAILIE document submissions service

Receives uploads from `share-a-document.html` and stores them in Fuza's Microsoft 365:

- the file goes into the **HAILIE SharePoint site**, in `Documents / Document submissions / <permission level>/`
- a row is added to the **Document submissions log** list on the same site
- a notification goes to `NOTIFY_EMAIL` and a thank-you to the submitter, both sent from the **hailie@fuza.co.uk** shared mailbox

It replaces the Google Apps Script that used to do this (it saved to Google Drive and sent mail through Gmail).

## How it fits together

```
browser ──POST /api/submit──▶ housingai.org (Caddy, "web" service)
                                    │ reverse proxy, Railway private network
                                    ▼
                         submissions.railway.internal:8080 (this service)
                                    │ Microsoft Graph, app-only
                                    ▼
                    HAILIE SharePoint site + hailie@fuza.co.uk mailbox
```

The service has no public domain. Caddy forwards `/api/*` to it, so the form posts to the same origin and needs no CORS.

Node 20+, no dependencies. `npm test` runs the tests against a fake Graph.

## Environment variables (Railway service "submissions")

| Variable | Value |
|---|---|
| `AZURE_TENANT_ID` | Directory (tenant) ID of the Fuza tenant |
| `AZURE_CLIENT_ID` | Application (client) ID of the "HAILIE document submissions" app |
| `AZURE_CLIENT_SECRET` | Client secret value (expires: put a reminder in the diary) |
| `PORT` | `8080` |
| `SHAREPOINT_SITE` | optional, default `fuzaltd.sharepoint.com:/sites/HAILIE` |
| `SHAREPOINT_FOLDER` | optional, default `Document submissions` |
| `SHAREPOINT_LIST` | optional, default `Document submissions log` |
| `MAIL_SENDER` | optional, default `hailie@fuza.co.uk` |
| `NOTIFY_EMAIL` | optional, default `guy@fuza.co.uk` |

`GET /api/health?deep=1` checks the credentials and that the site can be reached.

## One-time Microsoft 365 setup

You need a Global admin account. The app is given the least access that works: write access to the HAILIE site only, and permission to send mail as hailie@fuza.co.uk only.

### 1. Shared mailbox
Exchange admin center → **Recipients → Mailboxes → Add a shared mailbox**. Name `HAILIE`, address `hailie@fuza.co.uk`. Add yourself as a member so you see replies.

### 2. App registration
Entra admin center → **App registrations → New registration**. Name `HAILIE document submissions`, single tenant, no redirect URI.
- Copy the **Application (client) ID** and **Directory (tenant) ID**.
- **Certificates & secrets → New client secret** (24 months). Copy the secret **Value**.
- **API permissions → Add → Microsoft Graph → Application permissions → `Sites.Selected`**, then **Grant admin consent**. Do not add Mail.Send here.

### 3. Give the app access to the HAILIE site, and create the log list
Open [Graph Explorer](https://developer.microsoft.com/graph/graph-explorer) signed in as an admin. Under **Modify permissions**, consent to `Sites.FullControl.All`. Then run:

```
POST https://graph.microsoft.com/v1.0/sites/fuzaltd.sharepoint.com:/sites/HAILIE:/permissions
{
  "roles": ["write"],
  "grantedToIdentities": [{ "application": { "id": "<CLIENT ID>", "displayName": "HAILIE document submissions" } }]
}
```

```
POST https://graph.microsoft.com/v1.0/sites/fuzaltd.sharepoint.com:/sites/HAILIE:/lists
<contents of sharepoint-list.json>
```

(With only "write" access the service can't create the list itself, so it is created once here.)

### 4. Let the app send mail as hailie@fuza.co.uk only
In PowerShell with the ExchangeOnlineManagement module:

```powershell
Connect-ExchangeOnline
# ObjectId is the Object ID on the app's *Enterprise application* page, not the App registration page
New-ServicePrincipal -AppId <CLIENT ID> -ObjectId <ENTERPRISE APP OBJECT ID> -DisplayName "HAILIE document submissions"
New-ManagementScope -Name "HAILIE mailbox only" -RecipientRestrictionFilter "PrimarySmtpAddress -eq 'hailie@fuza.co.uk'"
New-ManagementRoleAssignment -App <CLIENT ID> -Role "Application Mail.Send" -CustomResourceScope "HAILIE mailbox only"
Test-ServicePrincipalAuthorization -Identity <CLIENT ID> -Resource hailie@fuza.co.uk   # should show InScope: True
```

### 5. Railway
Set the three `AZURE_*` variables on the "submissions" service, then check `https://housingai.org/api/health?deep=1`.

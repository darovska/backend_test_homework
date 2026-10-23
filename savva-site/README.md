# Семейный дашборд занятий — GitHub + Render + Google Sheets

This is a **static web frontend**. No child's schedule or medical details are embedded in the public repository. All data stays in the existing private Google Sheet and is accessed via a collaborator's personal Google OAuth token. The web client does not have an API key, personal access token, service account key, or database.

## Configuration (once, by the owner)

1. In [Google Cloud Console](https://console.cloud.google.com/), create/select a project, enable **Google Sheets API** (APIs & Services > Library).
2. Configure OAuth consent for a limited personal app; if the consent status is `Testing`, add each family member's Google account under **Test users**. The requested permission is `https://www.googleapis.com/auth/spreadsheets`.
3. Under Credentials, create an **OAuth Client ID** of type **Web application**. In **Authorized JavaScript origins**, add the published Render origin `https://<site>.onrender.com` (without a trailing slash). In OAuth consent page, include the same application name.
4. Open the deployed site, paste the public OAuth client ID (the string ending in `.apps.googleusercontent.com`) and click **Войти через Google**. Each participant signs in with their own Google account.
5. Open the [original Google Sheet](https://docs.google.com/spreadsheets/d/1bucbwT6K6zg2-qjfLtOxjO-MLkJJuZ2OYgEW1zs9xaA/edit), choose **Share**, and invite only the intended people as **Editor**. A dashboard link alone never grants access to the Sheet.
6. Click **Поделиться ссылкой** in the dashboard. The public OAuth Client ID is appended to the link so invitees will not need to paste it; it is not a secret.

## Functionality

- The month calendar and activity details use live Google Sheets ranges for October 2026–September 2027.
- Mark attendance, modify duration in minutes, edit activity name, time, category and notes, add and remove activities, and adjust speech-therapy counts.
- Counted hours update immediately in the browser. Changes are written to Google Sheets after a short debounce (~850 ms). The status badge reports success/failure. Do not leave the page until the green saved status appears.
- Refresh fetches other collaborators' changes. An automatic refresh runs every minute when the local state is not being edited.
- The existing Google Sheet formulas remain authoritative for its totals. Added activity rows are written within the sum range (16–440) and receive the proper formulas.
- Web day notes are stored in a hidden tab `Веб_дневник`; the original monthly day sickness formula is extended to consider them.
- The CSV and JSON export options remain for backups; cloud data is not stored in GitHub or Render.

## Safety and limitations

- Login is not provided by Render; Google OAuth plus the Sheet's own ACL controls access. Never make the Sheet "Anyone with the link — Editor" for child information.
- The OAuth client must be configured in Google Cloud first. Until that happens, the site cannot synchronize. This is intentional; do not bypass it by embedding credentials or source data in `index.html`.
- When two people change **the same cell** at nearly the same time, the last completed write wins. Editing distinct fields is less likely to conflict. Refresh to see the latest record.
- When reauthorizing a session, edits remain in Google Sheets, not in an anonymous browser cache. Browser token expires periodically; use login again.
- Render static sites do not provide persistent backend storage; the existing Google Sheet is the database.
- OAuth consent for the `spreadsheets` scope may need further configuration or verification if you later distribute the app beyond a small set of authorized test users.

## Files

- `index.html` — public UI and calendar template with no personal records.
- `sync.js` — Google Identity Services and Google Sheets API synchronization.

No private data files or OAuth secrets should ever be committed to this repository.

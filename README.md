# ZIP Assignment App (Minimal Backend)

## What this does

- Serves `index.html`
- Accepts `POST /api/submit`
- Assigns nearest location from ZIP
- Appends submission to Google Sheets using a service account

## Files

- `index.html` - frontend form
- `server.js` - minimal Node backend
- `.env` - runtime config
- `service-account.json` - Google service account key file
- `package.json` - dependencies and start script

## Setup

1. Share your target Google Sheet with:
   - `abiola@abiola-489300.iam.gserviceaccount.com`
2. Check `.env` values:
   - `SHEET_ID`
   - `SHEET_NAME`
   - `SERVICE_ACCOUNT_FILE=service-account.json`
3. Install dependencies:
   - `npm install`
4. Start server:
   - `npm start`
5. Open:
   - `http://localhost:3000`

## Common errors

- `Google Sheets credentials are not configured`
  - Ensure `service-account.json` exists and `.env` has `SERVICE_ACCOUNT_FILE=service-account.json`.

- `Sheets append failed: ...`
  - Most often sheet is not shared with the service account email.

- `SHEET_ID is not configured`
  - Add valid `SHEET_ID` in `.env`.

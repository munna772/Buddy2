# Buddy AI — Gemini free-tier backend

This project connects a simple Buddy chat page to Google's Gemini API. The API key stays on the server, not in the browser or Android APK.

## Important security rule

**Never put your real Gemini API key in `public/app.js`, `public/index.html`, an APK, or a public GitHub repository.** Do not send the key to anyone. Add it only as a private environment variable on your backend host.

## Requirements

- Node.js 18 or newer
- A Gemini API key from Google AI Studio
- A Node.js hosting service to run this backend

Gemini free-tier availability, model access, quotas, and terms can change. Check Google AI Studio for your account's current limits. Avoid sending sensitive/private information to a free-tier service.

## Run locally

1. Install Node.js 18+.
2. Download and extract this project.
3. In this folder, install dependencies:

   ```bash
   npm install
   ```

4. Copy `.env.example` to a file named `.env`.
5. Open `.env` and replace the placeholder with your Gemini key:

   ```env
   GEMINI_API_KEY=your_real_key_here
   GEMINI_MODEL=gemini-2.5-flash
   PORT=3000
   ```

6. Start the server:

   ```bash
   npm start
   ```

7. Open `http://localhost:3000`.

Do not upload `.env` to GitHub. `.gitignore` excludes it.

## Deploy

Deploy this repository to a Node.js hosting provider that supports environment variables and persistent web services.

- Build/install command: `npm install`
- Start command: `npm start`
- Add environment variable `GEMINI_API_KEY` with your real key in the host's dashboard.
- Optional: add `GEMINI_MODEL` with a model available to your Google AI Studio account.
- After deployment, open the service URL. The `/api/health` endpoint should return a small JSON health response.

Free hosting plans may sleep, have usage limits, or change their terms. Check the host's current plan details.

## Connect an existing Buddy app

The frontend in this project sends chat requests to the relative endpoint `POST /api/chat`. If your Android app already has its own chat interface, point its backend request to your deployed service's full URL plus `/api/chat`, and send JSON:

```json
{
  "message": "Hello Buddy",
  "history": [
    { "role": "user", "text": "Hi" },
    { "role": "model", "text": "Hello!" }
  ]
}
```

The response is:

```json
{ "reply": "Hello! How can I help?" }
```

The Android app must call your deployed HTTPS backend. Do not embed the Gemini key in the Android app. If your current APK was built from a different starter project, you may need to update its API endpoint and rebuild the APK.

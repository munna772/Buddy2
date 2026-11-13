# Buddy AI

Buddy is a private, single-user, text-only AI assistant. It uses a Node.js/Express backend, Gemini for streamed replies, and Supabase for saved conversations and personal memories. The web interface is also wrapped into an Android debug APK by GitHub Actions.

## Features

- Streaming text conversations in English, Bangla, and Arabic.
- Primary and two backup Gemini API keys.
- Persistent conversation history and personal memories, including meaningful emotional context.
- Edit and delete controls for saved personal memories.
- Responsive, high-contrast interface for phones and desktops.
- Service-worker caching for public app files only. Chat, history, and memory API responses are never cached.
- Android APK build as a downloadable GitHub Actions artifact.

## Security

- Never commit `.env`, API keys, Supabase secret keys, or the Buddy access token.
- Keep Gemini and Supabase credentials only in the Render service's private environment variables.
- The app stores the single-user Buddy access token in this device's localStorage. Keep the device protected and use a long random token. This is not a multi-user authentication system.
- The Android APK contains the web app shell and the URL of the Buddy backend. It must never contain Gemini or Supabase secret keys.
- The GitHub repository is public, so assume all source code and committed files are visible to everyone.
- Revoke and replace any credential that has ever been pasted into a public file, issue, or chat.
- Do not use real sensitive information when testing.

## Requirements

- Node.js 22.x
- A Gemini API key
- A Render web service (or another host that runs a persistent Node.js process)
- A Supabase project with a `memories` table for persistent history and memory

## Environment variables

Set these in the hosting provider's private environment settings:

| Variable | Required | Purpose |
| --- | --- | --- |
| `GEMINI_API_KEY` | Yes | Primary Gemini API key |
| `BACKUP_GEMINI_API_KEY` | No | First backup Gemini key |
| `BACKUP_GEMINI_API_KEY_2` | No | Second backup Gemini key |
| `GEMINI_MODEL` | No | Gemini model name; defaults to `gemini-3.8-flash` in server code |
| `BUDDY_ACCESS_TOKEN` | Yes | Private app access token; minimum 32 bytes |
| `SUPABASE_URL` | No | Supabase project URL |
| `SUPABASE_SECRET_KEY` | No | Supabase secret key; keep server-side only |
| `PORT` | No | Hosting port; defaults to `3000` |

Both Supabase variables must be configured to enable saved conversations and memories. Without them, Buddy can still chat, but cannot promise durable memory or history.

`.env.example` contains placeholders only. Copy it to `.env` for local development, replace the placeholders on your own device, and never commit the real file.

## Run locally

1. Install Node.js 22.x.
2. Clone the repository and run `npm install`.
3. Copy `.env.example` to `.env` and set your private values.
4. Run `npm start`.
5. Open `http://localhost:3000`.

## Deploy the backend

For a Render Node web service, use:

- Build command: `npm install`
- Start command: `npm start`
- Configure the environment variables above in Render's private Environment settings.
- Check `/api/health` after deployment. It reports whether Gemini, database, and access protection are configured without returning secret values.

The API is rate-limited. Gemini quotas and model availability depend on the Google AI account and can change.

## Chat API

The frontend sends `POST /api/chat` with a Bearer token and JSON request body:

```json
{
  "message": "Hello Buddy",
  "history": [
    { "role": "user", "text": "Hi" },
    { "role": "model", "text": "Hello!" }
  ]
}
```

Successful replies are sent as Server-Sent Events (SSE). Each text event contains JSON such as `data: {"text":"Hello"}`; the final event is `data: [DONE]`. Errors are emitted as JSON `error` events if streaming has already started.

Conversation records are stored in a versioned `CHAT_V1:` JSON format so message text containing legacy separators does not break history restoration. Older `User: ... / Buddy: ...` records remain readable.

## Build and download the Android APK

GitHub Actions builds a debug APK on every push to `main`, and can also be started manually:

1. Open the repository's **Actions** tab.
2. Select **Build Buddy Android APK**.
3. Open the latest successful run.
4. Under **Artifacts**, download `Buddy-AI-Android-debug`.
5. Extract the ZIP and install `app-debug.apk` on the Android device.

The debug APK is for personal testing. It is not a Play Store release or a production-signed APK. The Android wrapper loads the existing HTTPS Buddy backend, so the Render service and its private environment variables must remain configured.

## PWA installation

On Android, open the HTTPS Buddy site in Chrome and choose **Install app** or **Add to Home screen** from the browser menu. The service worker caches only the public app shell. Chat, history, and personal memories need an internet connection and are never stored in the offline cache.

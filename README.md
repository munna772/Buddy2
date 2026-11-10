# Buddy AI — Gemini-powered chat backend

Buddy is a private, single-user chat app backed by a Node.js/Express server and Google's Gemini API. The browser sends requests to this server; the Gemini API key and Supabase secret key must remain on the server.

## Security first

- Never commit `.env`, real API keys, Supabase secret keys, or the Buddy access token.
- Set secrets as private environment variables in your hosting provider's dashboard.
- The browser stores the Buddy access token in `localStorage`. This is acceptable only for private testing on a device you control; it is not suitable for distributing a public APK or offering a public multi-user service.
- Keep this repository private. Making it public exposes the source code to everyone.
- Do not use real sensitive personal information when testing.

## Requirements

- Node.js 18 or newer
- A Gemini API key from Google AI Studio
- A hosting provider that can run a persistent Node.js web service
- Supabase project and a `memories` table if persistent conversation and extracted-fact memory is wanted

## Environment variables

Configure these in your hosting provider's private environment-variable settings:

| Variable | Required | Purpose |
| --- | --- | --- |
| `GEMINI_API_KEY` | Yes | Gemini API key |
| `GEMINI_MODEL` | No | Gemini model name; defaults to `gemini-3.8-flash` in the current server code |
| `BUDDY_ACCESS_TOKEN` | Yes | Private app access token; must contain at least 32 bytes |
| `SUPABASE_URL` | No | Supabase project URL; enables persistent memory when used with the secret key |
| `SUPABASE_SECRET_KEY` | No | Supabase secret key; keep it server-side only |
| `PORT` | No | Hosting port; defaults to `3000` |

If Supabase is not configured, the chat server can run without persistent memory. Configure both `SUPABASE_URL` and `SUPABASE_SECRET_KEY` to enable the database features.

`.env.example` is a placeholder template. Copy it to `.env` for local development and replace the placeholders locally. Never commit the real `.env` file.

## Run locally

1. Install Node.js 18 or newer.
2. Download the project.
3. Install dependencies:

   ```bash
   npm install
   ```

4. Copy `.env.example` to `.env` and fill in your real values locally.
5. Start the server:

   ```bash
   npm start
   ```

6. Open `http://localhost:3000`.

## Deploy

For a Node.js web service:

- Build/install command: `npm install`
- Start command: `npm start`
- Add the environment variables listed above in the host dashboard.
- Do not upload or paste secret values into GitHub files.
- After deployment, check `/api/health`. It reports whether Gemini, database, and access protection are configured; it does not reveal secret values.

The API is rate-limited. Gemini quotas and model availability depend on the Google AI Studio account and can change.

## Chat API

The frontend sends a JSON request to `POST /api/chat` with a Bearer access token:

```json
{
  "message": "Hello Buddy",
  "history": [
    { "role": "user", "text": "Hi" },
    { "role": "model", "text": "Hello!" }
  ]
}
```

The successful response is a Server-Sent Events (SSE) stream, not a single JSON reply. Text arrives in events shaped like:

```text
data: {"text":"Hello"}

data: {"text":"! How can I help?"}

data: [DONE]
```

An error event may contain a JSON `error` field. The frontend reads the stream progressively and builds Buddy's reply.

## Existing Android app

The Android app should call your deployed HTTPS backend at `/api/chat` and send the Buddy access token in the `Authorization: Bearer ...` header. Never embed the Gemini API key or Supabase secret key in an APK.

For a public app or multiple users, replace the current shared-token/localStorage approach with proper user authentication and server-side per-user data isolation before distributing it.

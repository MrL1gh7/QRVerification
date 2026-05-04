# Telegram Building Access MVP

Production-oriented scaffold for a Telegram bot and backend that manages QR-based building access for one building, five floors, and fifty offices.

## Included in this milestone

- Fastify app with `GET /healthz`, `GET /metrics`, `GET /app/qr`, `GET /api/v1/qr/current`, `POST /webhooks/telegram`, and `POST /api/v1/access/scan`
- grammY webhook-first bot bootstrap with `/start`, `/help`, `/status`, `/my_qr`, `/scan`, and demo role commands
- Telegram Web App QR screen with short-lived signed QR tokens
- Telegram Web App scanner screen with camera scanning and manual fallback
- In-memory MVP access policy engine for demo roles, floor permissions, scanner permissions, replay protection, and visitor pass transitions
- Prisma schema for core building, tenant, user, visitor-pass, scanner, and audit entities
- Zod request and response schemas for Telegram webhook and scanner flows
- Unit, integration, and Playwright test skeletons
- Project rules in `AGENTS.md`

## Quick start

1. Copy `.env.example` to `.env`.
2. Put your bot token in `TELEGRAM_BOT_TOKEN`.
3. Set `PUBLIC_BASE_URL` to your HTTPS URL for Telegram Web Apps and webhooks.
4. Install dependencies:

```bash
npm install
```

5. Generate the Prisma client:

```bash
npm run prisma:generate
```

6. Start PostgreSQL and Redis.
7. Run the server:

```bash
npm run dev
```

The QR placeholder app will be available at `http://localhost:3000/app/qr`.
The scanner app will be available at `http://localhost:3000/app/scanner`.

You can also boot the local stack with Docker:

```bash
docker compose -f docker/compose.yml up --build
```

## Useful scripts

```bash
npm run dev
npm run build
npm run lint
npm run typecheck
npm run test
npm run test:e2e
```

On this Windows workspace a portable Node.js runtime can live under `.tools/`.
If global `npm` is not available, run commands through:

```powershell
$env:Path=(Resolve-Path '.tools\node-v22.14.0-win-x64').Path + ';' + $env:Path
.tools\node-v22.14.0-win-x64\npm.cmd run test
```

## Telegram demo flow

In Telegram, open the bot and run:

```text
/demo_role operator
/demo_links
```

Use `Visitor QR` or `Employee F3 QR` on one device and `Scanner` on another device. In the scanner, choose:

- `Главный вход` for visitor enter
- `Лифт, этаж 3` for visitor or floor 3 employee movement
- `Лифт, этаж 2` to see a floor-denied employee case
- `Выход` for visitor exit

The visitor demo pass can be reset with:

```text
/demo_reset_visitor
```

## Telegram webhook setup

After `PUBLIC_BASE_URL` points to an HTTPS URL and `.env` contains
`TELEGRAM_BOT_TOKEN`, run:

```bash
npm run telegram:configure
```

This configures bot commands, the QR menu button, and the production webhook
with `X-Telegram-Bot-Api-Secret-Token`.

To remove the webhook:

```bash
npm run telegram:delete-webhook
```

## Demo process control

Start backend and ngrok, update `PUBLIC_BASE_URL`, and optionally configure
Telegram:

```powershell
.\scripts\start-demo.ps1 -ConfigureTelegram
```

Check status:

```powershell
.\scripts\status-demo.ps1
```

Stop backend and ngrok:

```powershell
.\scripts\stop-demo.ps1
```

## Suggested next milestone

- Implement visitor pass creation and binding flows
- Move the in-memory access store to Prisma/PostgreSQL
- Move replay protection from memory to Redis
- Add tenant admin conversations for employee and visitor lifecycle

## Sample requests

Health check:

```bash
curl http://localhost:3000/healthz
```

Scan endpoint:

```bash
curl -X POST http://localhost:3000/api/v1/access/scan \
  -H "content-type: application/json" \
  -d '{
    "request_id":"req_01",
    "scanner_id":"scn_main_a",
    "captured_at":"2026-04-23T10:52:03Z",
    "token":"tgac:v1:header.payload.signature"
  }'
```

## Current limitation

This repository now has a working in-memory MVP flow. It is enough for Telegram Web App demos and policy testing, but production still needs persistent Prisma/PostgreSQL storage, Redis-backed replay protection, real tenant admin workflows, and HTTPS webhook registration.

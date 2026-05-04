# AGENTS.md

Project: QR access control MVP for a single office building.
Stack: Node.js, TypeScript, Fastify, grammY, Prisma, PostgreSQL, Redis.

Rules:
- Use webhook-first architecture in production.
- Do not use long polling code in production bootstrap.
- All QR tokens are short-lived and server-validated.
- Never put full name, phone, or email inside JWT payload.
- Visitor pass state machine: scheduled -> entered -> exited/expired/revoked.
- Employee and internal staff QR is rolling and generated on demand.
- Write or update tests for every behavior change.
- Prefer small PR-sized changes.
- Keep files modular by domain: access, qr, visitor-passes, scanner, bot.
- Expose /healthz and /metrics.
- Use Zod for request validation.
- Use Redis for replay protection on jti.
- Run lint, typecheck, and tests before finishing when dependencies are installed.

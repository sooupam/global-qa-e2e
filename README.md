# global-qa-e2e

**Suíte de SMOKE TESTS E2E do GT ONE.**

Esta suíte **não busca cobertura**. Busca detectar **colapso crítico** rapidamente, com baixa manutenção e alta resiliência.

## Filosofia minimalista

A suíte parte de 4 princípios duros:

1. **Smoke ≠ regressão.** Esta suíte detecta "está vivo?", não "funciona corretamente?". Cobertura completa é trabalho de unit/adapter tests no repo principal (`apps/web/src/test/adapters/`).
2. **Menos é mais.** Cada teste adicionado vira manutenção a cada release. Smoke crescer = vira regressão = perde valor.
3. **Estabilidade > cobertura.** Um teste flaky é PIOR que não ter teste — destrói confiança no sinal.
4. **API > UI sempre que possível.** UI muda, contrato de API não. Quando UI for indispensável, usar `getByRole`/`data-testid`, NUNCA texto i18n, NUNCA `.nth()`, NUNCA `waitForTimeout`.

## Critérios para incluir um teste novo

Antes de adicionar qualquer spec, responder honestamente:

- [ ] **Detecta colapso crítico?** (Login broken, RLS broken, AI Hub down, deploy quebrado, white-screen)
- [ ] **Roda em < 30s?**
- [ ] **Não depende de timing/animação/CSS/i18n?**
- [ ] **Sobrevive a redesign de UI?** (usa role/testid/contract, não texto/css/posição)
- [ ] **Sobrevive a mudança de schema?** (não asserta forma específica de payload de domínio)
- [ ] **É independente** dos outros testes? (não compartilha estado entre tests)
- [ ] **Cobertura desse risco já existe** em adapter tests / unit / outro spec? Se sim → **não adicionar.**

Se qualquer resposta for não, **não automatizar como smoke**. Pode virar teste de regressão noutro repo, ou QA manual.

## O que NÃO automatizar nesta suíte

Decisões já tomadas (ver histórico em commit inicial):

- **Páginas CRUD individuais** (assets, work-orders, employees, equipment, etc.) — UI muda semanalmente, `data-testid` esparso. Risco coberto por adapter tests no repo principal.
- **Pipeline regulatório** (RAG devices/drugs/IFA) — feature recente em alta churn.
- **Output específico de agentes IA** (Copilot, Hospital Engineering, Comply, etc.) — não-determinístico por design.
- **Realtime subscriptions** — timing-dependent, propenso a flake mesmo com waits robustos.
- **Forms react-hook-form/Zod** em telas voláteis — schema muda → teste quebra.
- **i18n strings** — 3 idiomas com missing keys ainda em correção.
- **Detalhes visuais** — CSS, animações, layout, breakpoints, snapshots.
- **PWA / offline / sync** — feature complexa, pertence a teste de integração específico.
- **MFA / SSO** — dependem de provider externo, alta variabilidade.
- **Login UI fluxo completo** — frágil (subdomain de tenant, formato chave Supabase em localStorage, texto i18n). Cobrir auth via API.

## Estado atual da suíte

| Métrica | Origem (legado) | Atual |
|---------|-----------------|-------|
| Specs raiz | 60 ativos + 15 stubs | **12** |
| Specs IoT (`connectplus-*/`) | 29 (preservados — pipeline próprio) | **29** |
| `waitForTimeout` total | 385 | **20** (3 em specs + 17 em helpers preservados) |
| `networkidle` em specs raiz | distribuído | **0 nos curados (route-protection); ~10 em homolog-pamella-bugs (defensivo c/ `.catch`)** |
| `.nth()` | 26 | **2 (em helpers preservados)** |
| Linhas totais (`tests/`) | ~13.000 | **~6.300** (inclui helpers e IoT preservados) |
| Tempo estimado | 25–40 min | **5–10 min** (specs raiz somente) |

**Os 20 `waitForTimeout` remanescentes** estão concentrados em:
- `helpers/navigation.ts` (13) — workaround para onboarding/tour/LGPD modals
- `helpers/auth.ts` (3) — dismiss cascade
- `helpers/homolog-net.ts` (1) — best-effort
- `homolog-pamella-bugs.spec.ts` (2) — defensivos com `.catch`
- `permissions-basic.spec.ts` (1) — defensivo

Decisão: **não refatorar agora**. Fix de raiz é a flag `VITE_E2E_MODE` no app `effortone` (ver "Débito técnico" abaixo). Refatorar helpers sem o fix da raiz é trocar workaround por workaround.

## Como rodar

Pré-requisitos: Node 20+ (recomendado 24+).

```bash
cp .env.example .env  # preencha credenciais
npm install
npx playwright install chromium
npm test
```

Modos extras:

```bash
npm run test:headed   # browser visível
npm run test:ui       # UI interativa
npm run test:report   # abre relatório HTML do último run
npm run typecheck     # tsc --noEmit
```

Filtragem:

```bash
npx playwright test homolog-pamella-bugs           # 1 arquivo
npx playwright test tests/connectplus-codecs       # subdir IoT
npx playwright test --grep "Unauthenticated"       # describe específico
```

## Estrutura

```
tests/
├── helpers/                              # auth, navigation, homolog-net, iot-context
├── ai-hub.spec.ts                        # AI Hub edge function viva (não 5xx)
├── auth-flows.spec.ts                    # login UI: 2 tests (renderiza + erro em creds)
├── core-modules-functional.spec.ts       # GET /rest/v1/<tabela> nos 8 módulos CORE
├── connectplus-smoke.spec.ts             # IoT infra smoke
├── dashboard-kpis.spec.ts                # dashboard renderiza + 1 KPI core (2 tests)
├── homolog-login-rededor.spec.ts         # login Rede D'Or sem 4xx em user_active_company
├── homolog-pamella-bugs.spec.ts          # 5 P0 de regressão (RLS, triggers, cache)
├── modules-load.spec.ts                  # 9 módulos core CMMS booting sem error boundary
├── multi-tenancy.spec.ts                 # RLS + companies retornam tenant_id correto
├── permissions-basic.spec.ts             # RBAC consolidado: owner/manager/tech/viewer (4 tests)
├── public-routes.spec.ts                 # 5 rotas públicas (sign-portal, qr, vendor, request, install)
├── route-protection.spec.ts              # bloqueio sem sessão / por role (race waitForURL)
├── connectplus-automation/               # pipeline IoT (1 spec + helper)
├── connectplus-cadastro/                 # pipeline IoT (1 spec + helper)
├── connectplus-codecs/                   # codecs de dispositivos (6 specs + helper)
├── connectplus-dispatch/                 # webhook/email/alert (3 specs + helper)
└── connectplus-threshold/                # regras de threshold (16 specs + helper)
```

## Variáveis de ambiente

Ver `.env.example`. Em resumo:

- `BASE_URL` — URL do frontend a testar.
- `SUPABASE_URL`, `SUPABASE_ANON_KEY` — chamadas REST autenticadas.
- `SUPABASE_SERVICE_ROLE_KEY` — apenas para `connectplus-*` (factories via PostgREST).
- `E2E_ADMIN_EMAIL`, `E2E_PASSWORD`, `E2E_TENANT_SLUG` — usuário-robô.
- `E2E_TENANT_ID` — UUID de tenant para asserts de multi-tenancy.
- `HOMOLOG_*` — para `homolog-pamella-bugs` e `homolog-login-rededor`.

## Pendências

- [ ] **P3 — Pedir flag `VITE_E2E_MODE` no app `effortone`** que pula onboarding/LGPD/tour modais. Sem ela, `helpers/auth.ts` faz dismiss via cascata de 5 estratégias (workaround). Fix de ~20 linhas no app elimina ~17 dos 20 `waitForTimeout` que sobraram.
- [ ] **Bucket 5 — decidir** com o time se mantém ou remove: `wo-detail-permissions`, `sectors-permissions`, `permissions-overrides`, `settings`, `cross-cutting-full` (já removidos da suíte; decisão de re-incluir como smoke fica em aberto).
- [ ] **Migração de testes pendentes** — não há `test.skip` deliberado nesta suíte. Tests não-críticos foram **deletados** (não preservados como skip), por decisão consciente: zero ruído na suíte smoke.

## Débito técnico identificado no repo principal (`effortone`)

Para consertar lá, não aqui:

1. **Falta `VITE_E2E_MODE`** — flag para pular onboarding/LGPD/tour modais. Sem ela, helpers de teste fazem dismiss via cascata de 5 estratégias.
2. **`apps/web/playwright.config.ts` tem `webServer` hardcoded** para `npm run dev` — impede rodar contra prod sem hack.
3. **`baseURL: 'http://localhost:8080'` hardcoded** no mesmo config.
4. **Mistura de frameworks E2E**: `apps/web/e2e/` (Playwright) + `apps/web/src/test/e2e/` (Vitest+psql direto). Padronizar.
5. **365+ `waitForTimeout` ainda no legado** mesmo após esta cura — concentrados em arquivos não migrados (CRUDs redundantes que o time decide se mantém rodando).

## Princípio operacional

- Se um teste virar flaky → **remover**, não adicionar `retries`.
- Se o time precisa de cobertura nova → adicionar em adapter tests / unit, não aqui.
- Esta suíte é um **detector de respiração**, não uma rede de segurança completa.

## Documentos relacionados

- **`SMOKE_POLICY.md`** — política oficial: critérios de inclusão/exclusão, exemplos de "bom smoke" vs "regressão disfarçada", quando rejeitar pedido de novo teste.
- **`COVERAGE.md`** — auditoria de cobertura por blast radius (mapa completo do app, não só legado).
- **`IMPORTS_QUEBRADOS.md`** — auditoria de imports após curadoria.

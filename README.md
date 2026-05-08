# global-qa-e2e

Suíte E2E de smoke do GT ONE. Curada do legado em `effortone/apps/web/e2e/` (Pareto: 8 arquivos concentravam 73% do flake) para focar em sinal de sobrevivência crítica.

## Resumo da cura

| Métrica | Legado | Curado |
|---------|--------|--------|
| Arquivos `.spec.ts` (raiz) | 60 ativos + 15 stubs | 9 |
| Specs IoT (`connectplus-*/`) | 21 | 21 (preservados — pipeline próprio) |
| `waitForTimeout` | 368 | ~5 |
| `.nth()` | 26 | 0 (nos curados) |
| Linhas de teste | ~13.000 | ~2.000 |
| Tempo estimado | 25–40 min | 5–10 min |

## O que foi removido

- **8 arquivos com flake epidêmico** (P0): `gx-crud`, `gx-pages`, `sign-crud`, `sign-pages`, `crud-level2-complex`, `crud-level2-cadastros`, `crud-level2-crosscutting`, `maintenance-plan-templates`, `service-requests`. Concentravam 73% dos `waitForTimeout` da suíte.
- **15 stubs deprecados** (P0): arquivos com `// This file has been replaced by ...` esquecidos no repo.
- **20 specs CRUD redundantes** (P1): `assets-crud`, `employees-crud`, `equipment-crud`, etc. — risco coberto melhor por adapter unit tests existentes em `apps/web/src/test/adapters/`.
- **2 não-determinísticos** (P0): `responsive.spec.ts` (regressão visual, fora de smoke) e `copilot-ai.spec.ts` (output de IA não-determinístico).

## O que foi curado (P2)

- **`homolog-pamella-bugs.spec.ts`**: 18 → 5 testes. Mantidos os P0 que travam regressão de bugs reais reportados em produção (RLS 42501, column 42703, `record new no field name`, `uuid vs text`, ReferenceError, cache stale após delete). Removidos os com `.nth()` em form fields, os pendentes de fix, os visuais e os P1.
- **`route-protection.spec.ts`**: 5 `waitForTimeout` substituídos por `waitForLoadState('networkidle')` ou pela poll automática de `expect()`. 3 testes redundantes consolidados em loop sobre rotas.

## O que foi mantido sem mudança

Specs já saudáveis (poucos ou zero `waitForTimeout`, `getByRole` bem usado):

- `auth-flows.spec.ts`
- `connectplus-audit.spec.ts`
- `connectplus-smoke.spec.ts`
- `dashboard-kpis.spec.ts`
- `homolog-login-rededor.spec.ts`
- `navigation.spec.ts`
- `permissions-basic.spec.ts`

E os 21 specs de IoT em `tests/connectplus-{automation,cadastro,codecs,dispatch,threshold}/`. Esses já estavam isolados em pipeline próprio no legado e não fazem parte da cura — apenas foram movidos.

## Como rodar

Pré-requisitos: Node 20+ (recomendado 24+).

```bash
cp .env.example .env  # preencha as credenciais
npm install
npx playwright install chromium
npm test
```

Modos extras:

```bash
npm run test:ui         # UI interativa
npm run test:headed     # browser visível
npm run test:report     # abre último relatório HTML
npm run typecheck       # tsc --noEmit
```

Filtragem:

```bash
npx playwright test homolog-pamella-bugs   # 1 arquivo
npx playwright test --grep "@smoke"          # se houver tag
npx playwright test tests/connectplus-codecs # subdir IoT
```

## Variáveis de ambiente

Ver `.env.example`. Em resumo:

- `BASE_URL` — URL do frontend a testar.
- `SUPABASE_URL`, `SUPABASE_ANON_KEY` — chamadas REST autenticadas.
- `SUPABASE_SERVICE_ROLE_KEY` — apenas para a suíte `connectplus-*` (factories via PostgREST).
- `E2E_ADMIN_EMAIL`, `E2E_PASSWORD`, `E2E_TENANT_SLUG` — usuário-robô para `helpers/auth.ts`.
- `E2E_TENANT_ID` — UUID do tenant para asserções de multi-tenancy.
- `HOMOLOG_*` — para `homolog-pamella-bugs.spec.ts` e `homolog-login-rededor.spec.ts`.

## Princípio operacional

Esta suíte detecta **colapso crítico**, não cobertura. Regras duras:

1. Se um teste virar flaky e custo de manutenção > sinal: **remover**, não adicionar `retries`. Smoke flaky é veneno.
2. Não adicionar tests novos sem tirar outros. Smoke crescer = vira regressão.
3. Não usar `waitForTimeout`, `.nth()`, XPath, ou texto i18n como seletor.
4. Sempre preferir API > UI. UI só quando realmente necessário (boot, redirect, error boundary).

## Débito técnico identificado no repo principal (`effortone`)

Para consertar lá, não aqui:

1. **Falta `VITE_E2E_MODE`** no app — flag para pular onboarding/LGPD/tour modais. Sem isso, `helpers/auth.ts` faz dismiss de modal via cascata de 5 estratégias (workaround). Fix de 20 linhas no app elimina ~130 `waitForTimeout` no helper.
2. **`apps/web/playwright.config.ts` tem `webServer` hardcoded** para `npm run dev` — impede rodar contra prod sem hack.
3. **`baseURL: 'http://localhost:8080'` hardcoded** no mesmo config.
4. **Mistura de frameworks E2E**: `apps/web/e2e/` (Playwright) + `apps/web/src/test/e2e/` (Vitest+psql direto). Padronizar.
5. **368 `waitForTimeout` ainda no legado** mesmo após esta cura — concentrados em arquivos não migrados (CRUD redundantes que ainda rodam).

# SMOKE_POLICY — política oficial da suíte

> Esta suíte detecta **colapso crítico**, não regressão. Cobertura **não é prioridade**.

## Filosofia em 4 princípios

1. **Smoke ≠ regressão.** Cobre "está vivo?", não "funciona corretamente?".
2. **Menos é mais.** Cada teste vira manutenção a cada release. Smoke crescer = vira regressão = perde valor.
3. **Estabilidade > cobertura.** Um teste flaky é PIOR que não ter teste — destrói confiança no sinal.
4. **API > UI sempre que possível.** UI muda; contrato de API não.

---

## Critérios de inclusão (TODOS obrigatórios)

Um teste só entra na suíte se atender **todos** os 7 critérios abaixo:

- [ ] **Detecta colapso crítico** — falha em produção que bloqueia operação inteira (não apenas uma feature secundária).
- [ ] **Executa em < 30s** isoladamente.
- [ ] **Não depende de timing/animação/CSS/i18n** — sobrevive a redesign.
- [ ] **Sobrevive a mudança de schema de domínio** — não asserta forma específica de payload.
- [ ] **Independente** dos outros testes (sem state compartilhado).
- [ ] **Risco real de produção** — bug coberto já aconteceu OU tem alta probabilidade.
- [ ] **Cobertura desse risco NÃO existe** em adapter/unit tests no repo principal. Se existe, **não duplicar**.

Se qualquer caixa for não → **não automatizar como smoke**. Vira QA manual ou regressão noutro repo.

---

## Critérios de exclusão (NÃO automatizar)

| Categoria | Exemplos | Por quê |
|-----------|----------|---------|
| **CRUD completo** | Criar X, editar X, deletar X, validar form de X | Coberto por adapter tests; UI muda toda semana |
| **Validação cosmética** | Cor de botão, padding, animação, breakpoint, ícone | Não é colapso; é regressão visual (use Percy/Chromatic) |
| **Múltiplos asserts sem necessidade** | Validar 5 KPIs em sequência num smoke | Cada assert extra = ponto de flake |
| **Edge cases não-críticos** | "Quando o nome tem 256 caracteres..." | Regressão, não smoke |
| **IA não-determinística** | Validar texto gerado por LLM, ranking de recomendação, output de Copilot | Vai flakar — IA não retorna mesmo conteúdo |
| **Provider externo** | MFA TOTP, SSO/SAML, gov.br, A1/A3, gateways de pagamento | Estaria testando o provider, não o app |
| **Regressão completa** | Cobrir todos os campos de um form Zod | Schema muda → teste quebra |
| **Fluxos enormes** | Login → criar OS → atribuir → executar → fechar | Não-resiliente; fragmenta em 5 pontos de falha |
| **Builders/editors** | Procedure builder, Forms designer, GX | UIs ricas mudam constantemente |
| **Módulos em alta churn** | Compliance Engine recente, regulatório novo | Smoke vira lixo em dias |
| **Geração assíncrona** | Reports, BI dashboards, batch jobs | Timing-dependent → flake |
| **Realtime subscriptions** | WebSocket events de outros usuários | Timing externo → flake |

---

## Bom smoke vs. Regressão disfarçada (exemplos reais)

### ✅ BOM smoke — `ai-hub.spec.ts`
```js
const res = await request.post('/functions/v1/ai-hub', { data: {} });
expect(res.status()).toBeLessThan(500);
```
**Por quê:** 1 assert. Status code (contrato HTTP, estável). Detecta deploy quebrado, gateway down, container Agno fora. Zero UI, zero timing.

### ✅ BOM smoke — `multi-tenancy.spec.ts`
```js
const res = await request.get('/rest/v1/companies?limit=1');
expect(companies[0].tenant_id).toBe(EXPECTED_TENANT);
```
**Por quê:** Detecta RLS deny-all (length=0) e leak cross-tenant (id divergente). API contract.

### 🔴 REGRESSÃO disfarçada — exemplo descartado de `connectplus-audit.spec.ts` (deletado)
```js
test('Threshold profile edit — ProfileActionsSection presente', async ({ page }) => {
  await page.goto(`/connect/threshold-profiles/${HARDCODED_UUID}/edit`);
  await page.waitForLoadState('networkidle');
  await expect(page.getByText(/Editar perfil de threshold/i)).toBeVisible();  // i18n!
  await page.screenshot({ path: 'e2e-out/01-profile-edit.png', fullPage: true });  // visual!
});
```
**Por quê é ruim:** UUID hardcoded de tenant específico, texto i18n como seletor (3 idiomas o quebram), screenshot fullPage (regressão visual), `networkidle` em página com Realtime. **Tudo isso por teste, vezes 7 testes.** Foi **deletado**.

### 🔴 REGRESSÃO disfarçada — exemplo descartado de `auth-flows.spec.ts` (reduzido)
```js
test('forgot password page has email input and back link', async ({ page }) => {
  await page.goto('/forgot-password');
  await expect(page.locator('input[type="email"]')).toBeVisible();
  await expect(page.locator('a[href*="login"]')).toBeVisible();
});
```
**Por quê é ruim:** valida que UI da forgot-password tem campo email + link voltar. Isso não é colapso — se quebrar, é UI bug, não app down. Foi **removido**.

---

## Quando rejeitar pedido para "adicionar mais testes"

Resposta padrão:

> "Esta suíte é smoke, não regressão. Para o risco que você descreveu, considere:
> 1. Adapter test no repo principal (cobre lógica de domínio sem flake).
> 2. Unit test do componente.
> 3. QA manual antes do release.
> 4. Se for genuíno colapso crítico, tirar outro teste para entrar — smoke não cresce."

---

## Quando REMOVER um teste

Remover sem dó nem piedade quando:
- Falhou flaky 2x na mesma semana sem causa identificada → remover (não adicionar `retries`).
- Asserções foram sendo enfraquecidas para "fazer passar" → remover.
- Custo de manutenção > sinal extraído.
- Risco coberto agora existe em adapter/unit (consultar repo principal).

---

## Princípios de resiliência

Sempre:
- `data-testid`, `getByRole`, contratos REST.
- Waits orientados a estado: `waitForURL`, `waitFor({state:'visible'})`, `expect.poll`.
- Teste independente — login feito por teste, sem reuso de state.
- Fail fast: `Promise.any` para race entre estados aceitáveis.

Nunca:
- `waitForTimeout`, `setTimeout`, `sleep`.
- `networkidle` em fluxos com Realtime/WebSocket.
- XPath, CSS class, `.nth()`, posição.
- Texto i18n como seletor (3 idiomas — pt-BR/en/es).
- Snapshots visuais.
- `--retries=N>1` para mascarar flake.

---

## Decisão final em 1 frase

> **Se o teste cair em produção e o time não acordar para investigar, ele não é smoke.**

## Regra adicional (pós-pivot operacional)

> **Se o módulo quebrar em produção HOJE e o cliente NÃO sentir, o teste não pertence a essa suíte.**

Bugs históricos específicos (proteção de regressão de PG codes, triggers SQL,
ReferenceErrors históricos) **não são smoke**. São regressão. Pertencem a outra
camada (regression suite separada, adapter tests no repo principal, ou QA
manual antes de release). Esta suíte é guiada por **risco operacional atual**,
não por histórico de bugs.

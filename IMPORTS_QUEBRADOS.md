# IMPORTS_QUEBRADOS.md

Auditoria de imports após a curadoria. **Nenhum import quebrado de fato** — toda a suíte é self-contained.

## Checagens executadas

```bash
grep -rh "^import " tests/ --include='*.ts' | sort -u
grep -rn "from ['\"]\.\./\.\./" tests/ --include='*.ts'
grep -rn "from ['\"]@/" tests/ --include='*.ts'
```

## Resultado

| Tipo | Resultado |
|------|-----------|
| Imports apontando para `apps/web/src/` ou `@/...` (alias do app) | **Zero** |
| Imports relativos saindo de `tests/` (`../../...`) | **Zero** |
| Imports de specs deletados (gx-*, sign-*, crud-level2-*, etc.) | **Zero** |
| Imports de helpers fora desta árvore | **Zero** |

Conclusão: a suíte só importa de `@playwright/test`, `mqtt`, `node:crypto`, dos próprios helpers em `tests/helpers/`, e de helpers locais dentro de cada subdir `connectplus-*/`.

## Pontos cinzentos (não são imports quebrados, mas vale registrar)

### 1. `tests/navigation.spec.ts:125` — referência à rota `/service-requests`

```ts
await navigateTo(page, '/service-requests');
```

- **Não é import quebrado.** É string literal de URL passada como argumento.
- O spec `service-requests.spec.ts` foi removido na curadoria (P0/P1), mas a **rota no app continua existindo**. O smoke valida apenas se a navegação não dá 404/erro JS.
- **Impacto se a rota for removida no app:** este caso de teste de navegação falharia. Risco baixo (`/service-requests` é parte do core CMMS).
- **Ação:** nenhuma necessária agora. Se em algum momento a rota for removida do app, remover esta linha.

## Helpers compartilhados — verificação cruzada

Os 4 helpers em `tests/helpers/` foram copiados crus do legado:

- `auth.ts` — login via Supabase Auth API, injeção de session em localStorage. Self-contained.
- `homolog-net.ts` — `homologLogin`, `trackApiFailures`, `assertNoFailureCodes`. Self-contained.
- `navigation.ts` — `waitForApp`, `navigateTo`, `dismissTour`, etc. Self-contained.
- `iot-context.ts` — factories IoT via PostgREST + MQTT. Usa `mqtt` e `node:crypto` (deps externas legítimas).

Os helpers locais em `connectplus-*/` (codec-helpers.ts, threshold-helpers.ts, dispatch-helpers.ts, etc.) só importam entre si dentro do mesmo subsistema ou de `../helpers/iot-context`.

## Conclusão

**Nada a resolver.** A suíte ficou tecnicamente limpa após a curadoria — toda a remoção foi de arquivos isolados que não eram dependência de nenhum survivor.

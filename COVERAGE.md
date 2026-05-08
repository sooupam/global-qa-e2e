# COVERAGE — auditoria de cobertura por blast radius

> Cobertura mapeada a partir do app inteiro (~100 pastas em `pages/`, 25 route files), **não** a partir do legado de testes.

## Classificação por módulo

Estados:
- **COBERTO** — smoke ativo na suíte
- **SUFICIENTE** — coberto indiretamente, sem necessidade de spec próprio
- **EXCESSIVA** — havia cobertura demais, foi reduzida (já feito)
- **FALTA** — gap real de cobertura (nenhum aqui hoje)
- **NÃO AUTOMATIZAR** — risco coberto por outra prática (manual, adapter, monitoring)
- **SKIP** — fora de escopo de smoke (nicho, baixo blast radius)

## Tabela completa

| Módulo | Estado | Spec / Justificativa | Blast radius | Custo manutenção |
|--------|--------|---------------------|--------------|------------------|
| **Auth — login UI** | COBERTO | `auth-flows` (2 tests) | Alto — produto inutilizável | Baixo (input[type=email]/password é estável) |
| **Auth — login API** | COBERTO | `ai-hub` + `multi-tenancy` fazem login API | Alto | Zero |
| **Logout** | COBERTO | `route-protection` (logout limpa sessão) | Médio | Baixo |
| **Bloqueio sem sessão** | COBERTO | `route-protection` (race waitForURL) | Alto | Zero |
| **Permissão por role** | COBERTO | `permissions-basic` (4 tests: owner/manager/tech/viewer) | Alto — vazamento | Baixo |
| **Multi-tenant via REST** | COBERTO | `multi-tenancy` (companies + tenant_id) | Alto — RLS deny-all/leak | Zero |
| **Multi-tenant homolog específico** | COBERTO | `homolog-login-rededor` (regression de align_has_global_access) | Alto para Rede D'Or | Médio |
| **AI Hub gateway** | COBERTO | `ai-hub` (não 5xx) | Alto — 30% das features de IA | Zero |
| **Bundle/SPA boot** | COBERTO | `modules-load` + `public-routes` | Alto — white-screen | Baixo |
| **Dashboard core** | COBERTO | `dashboard-kpis` (renderiza + 1 KPI) | Alto — landing page | Baixo |
| **Módulos core CMMS — page boot** | COBERTO | `modules-load` (11 paths: home, cockpit, assets, os, MP, SR, employees, inventory, settings, sectors, notifications) | Alto — error boundary | Baixo (lista de strings) |
| **Módulos core CMMS — contrato funcional API** | COBERTO | `core-modules-functional` — GET REST nas tabelas base de assets, work-orders (view), maintenance-plans, service-requests, employees, inventory, automation, procedures | Alto — RLS deny-all, tabela renomeada, view quebrada, PostgREST 4xx | Médio (depende de nomes de tabelas) |
| **Rotas públicas** | COBERTO | `public-routes` (5 paths: sign-portal, request, qr, vendor, install) | Alto — usuário externo bloqueado | Zero (HTTP-only) |
| **Bugs P0 históricos** | COBERTO | `homolog-pamella-bugs` (5 PG codes específicos) | Alto se voltarem | Médio |
| **IoT pipeline (cadastro)** | COBERTO | `connectplus-cadastro/01-mqtt-bridges` | Alto p/ healthtech | Médio |
| **IoT pipeline (smoke)** | COBERTO | `connectplus-smoke` | Alto | Baixo |
| **IoT codecs** | COBERTO | 6 specs em `connectplus-codecs/` | Médio | Médio |
| **IoT dispatch** | COBERTO | 3 specs em `connectplus-dispatch/` | Médio | Médio |
| **IoT thresholds** | COBERTO | 16 specs em `connectplus-threshold/` | Médio | Médio |
| **IoT automation** | COBERTO | 1 spec em `connectplus-automation/` | Médio | Médio |
| **Settings — landing** | COBERTO | `modules-load` (`/settings`) | Alto | Zero |
| **Select Company** | SUFICIENTE | `multi-tenancy` API + `homolog-login-rededor` cobrem entry | Alto | — |
| **Master Dashboard** | SKIP | Niche super-admin | Baixo | — |
| **Cockpit** | SKIP | Overlap com `/` | Baixo | — |
| **Profile** | SKIP | Auto-edição, baixo blast | Baixo | — |
| **Onboarding (wizard)** | NÃO AUTOMATIZAR | Sequência longa + frágil; manual antes de release | Médio | Alto |
| **Vendors / Vendor mgmt** | SKIP | Tier 2 procurement | Baixo-médio | — |
| **Notifications** | SKIP | Sub-componente, não rota top-level | Médio | — |
| **Audit log** | SKIP | Compliance, baixa frequência de quebra | Médio | — |
| **Financial / Expenses** | SKIP | Domínio nicho dentro de CMMS | Médio | — |
| **Inspection Rounds** | SKIP | Uso restrito | Baixo | — |
| **Predictive (ML)** | NÃO AUTOMATIZAR | Output não-determinístico | Baixo | Alto |
| **FMEA** | SKIP | Análise especializada | Baixo | — |
| **Operations** | SKIP | Overlap com WO | Baixo | — |
| **BI** | NÃO AUTOMATIZAR | Geração assíncrona, async timing | Baixo | Alto |
| **ESG** | SKIP | Compliance específico | Baixo | — |
| **Integrations** | NÃO AUTOMATIZAR | Cada integração tem provider externo | Médio | Alto |
| **Compliance Engine** | NÃO AUTOMATIZAR | Release v3.29 ainda estabilizando | Alto | Alto (churn) |
| **Comply Regulatory** | NÃO AUTOMATIZAR | Idem | Alto | Alto (churn) |
| **Procedures Builder** | NÃO AUTOMATIZAR | Editor complexo | Médio | Alto |
| **Forms designer** | NÃO AUTOMATIZAR | Schema volátil | Médio | Alto |
| **Manuals** | SKIP | Conteúdo estático | Baixo | — |
| **GX (intelligence)** | NÃO AUTOMATIZAR | Output não-determinístico | Médio | Alto |
| **Sign (interno)** | NÃO AUTOMATIZAR | Provider externo (gov.br/A1/A3) | Alto | Alto (provider externo) |
| **Sign portal (público)** | COBERTO | `public-routes` (`/sign-portal/:token`) | Alto | Zero |
| **Voice agent** | NÃO AUTOMATIZAR | AI não-determinístico | Baixo | Alto |
| **MFA setup** | NÃO AUTOMATIZAR | Provider externo (TOTP) | Médio | Alto |
| **SSO/SAML setup** | NÃO AUTOMATIZAR | Provider externo (IdP) | Médio | Alto |
| **Settings — Business Hours** | SKIP | Cosmético | Baixo | — |
| **Settings — Users CRUD** | SUFICIENTE | `permissions-basic` cobre risco principal | Alto | — |
| **PWA install** | COBERTO | `public-routes` (`/install`) | Baixo | Zero |
| **Kiosk mode** | SKIP | `/kiosk`, `/sign/kiosk` — niche | Baixo | — |
| **Feedback respond** | SKIP | `/feedback/respond/:token` — baixo volume | Baixo | — |
| **Resource short-URL** | SKIP | `/r/:token` — baixo volume | Baixo | — |
| **GX share link** | SKIP | `/gx/s/:inviteToken` — niche | Baixo | — |
| **What's New / Changelog** | SKIP | Conteúdo | Baixo | — |
| **AR (augmented reality)** | SKIP | Niche, dispositivo dependente | Baixo | — |
| **Calibration** | SKIP | Domínio especializado | Baixo | — |
| **Tools** | SKIP | Domínio nicho | Baixo | — |
| **Contracts** | SKIP | Tier 2 | Baixo-médio | — |
| **Library** | SKIP | Conteúdo | Baixo | — |
| **Quality** | SKIP | Especializado | Baixo | — |
| **Workshops** | SKIP | Niche | Baixo | — |
| **ESG / Causes / Classifications / Holidays / etc.** | SKIP | Tabelas cadastrais isoladas | Baixo | — |

## Sumário

| Estado | Quantidade |
|--------|------------|
| COBERTO (raiz) | **10 specs** (todas justificadas pelo critério "cliente sente se quebrar?") |
| COBERTO (IoT subdirs) | 29 specs |
| SUFICIENTE | 2 módulos |
| SKIP intencional | ~30 módulos |
| NÃO AUTOMATIZAR | ~15 módulos |
| **FALTA** | **0 (zero gaps reais)** |

## Critério de "FALTA"

Para classificar como FALTA, o módulo precisa simultaneamente:
- ter blast radius ALTO (não só médio),
- não estar coberto por outro spec direta ou indiretamente,
- não cair em "NÃO AUTOMATIZAR" (provider externo, AI não-determinístico, alta churn),
- ter teste viável de implementar com < 50 linhas e < 15s de execução.

**Nada se enquadra hoje.** A suíte está em equilíbrio. Adicionar mais = inflar.

## Gatilhos para reabrir

Esta auditoria deve ser refeita quando:
- Aparecer novo módulo com blast radius alto (ex.: novo gateway de pagamento, novo módulo regulatório que vire core).
- Houver bug P0 em produção que nenhum smoke pegou — neste caso o gap é o bug, não a cobertura.
- Time decidir promover algum SKIP a COBERTO por evidência operacional (ex.: 3 incidentes de Vendors em 1 trimestre).

# Painel AV — V36 · Somente OpenAI no faturamento

## O que foi feito

Atualização **mínima** a partir do `index.html` da V35 que passou nos testes de seleção e salvamento dos prompts.

1. `index.html`: seção central agora é **OpenAI e Prompts · 3 CRMs** (o endereço interno `#gemini-real` foi mantido apenas para não quebrar navegação/links). Faturamento do Gemini foi retirado da interface. Os 3 cartões direcionam à recarga **oficial da OpenAI**. A área financeira antiga de Vendas foi ocultada e substituída por explicação da cobrança real OpenAI. Área Jurídico mostra apenas OpenAI. Prompts e seletores dos 3 CRMs permanecem intactos.
2. `js/creditos.js`: a aba de empresa consulta só os dados financeiros OpenAI; mantém rotina original de salvamento dos prompts para não perder informações.
3. `functions/api/billing/summary.js`: consulta **apenas a API de custos da OpenAI**; somente atribui gastos a uma empresa quando o projeto OpenAI dela for configurado. Não consulta mais BigQuery nem Google.

## Colocação no GitHub — ATENÇÃO AOS CAMINHOS

Substituir **apenas os 3 arquivos correspondentes**:

```
index.html
js/creditos.js
functions/api/billing/summary.js
```

Não envie o conteúdo de `js/` ou `functions/` para a raiz. Não delete arquivos do GitHub. Faça backup da versão atual ou use uma branch de teste antes de publicar.

## Vincular gastos oficiais do CRM Jurídico (empresa 5)

Na Cloudflare Pages > Configurações > Variáveis e segredos (produção):

- `OPENAI_PROJECT_ID_EMPRESA_5` = ID real do projeto OpenAI usado nas chamadas desse cliente, ex.: `proj_...` **(não invente este valor)**.
- `OPENAI_ADMIN_KEY_EMPRESA_5` = chave administrativa OpenAI, armazenada como **Secret**, com acesso aos relatórios de custos. Caso `OPENAI_ADMIN_KEY` geral já funcione, o código oferece fallback para empresa padrão 5.
- `OPENAI_ORG_ID_EMPRESA_5` = ID da organização, caso necessário para distinguir organizações. Use Secret quando apropriado.

O painel não coloca chaves no navegador. A API exige login administrativo e faz a consulta no servidor. Para outros IDs numéricos do Jurídico, use sufixos `_EMPRESA_N` específicos. **Agendamento e Vendas ainda precisam de integração de suas IDs/projetos à rota de custos para mostrar despesas individuais; a UI identifica esse estado como pendente.**

### Importante: créditos por empresa

**Créditos pré-pagos OpenAI pertencem à ORGANIZAÇÃO**, não ao projeto. Criar projetos separados permite identificar custos, mas não cria carteiras financeiras independentes. Para saldos realmente separados entre empresas, seriam necessárias organizações com faturamento próprio. O saldo pré-pago real é consultado no [painel oficial](https://platform.openai.com/settings/organization/billing/overview); NÃO apresentamos `saldo = US$ 0` quando não há consulta oficial autorizada. Custos são exibidos em **USD**, não como conversão fictícia para R$.

## Alterações do n8n feitas pelo usuário

A V36 é o **painel**, não altera nem testa seus workflows. Configure em cada workflow a credencial e o modelo OpenAI do projeto correto. No Jurídico, o salvamento dos prompts continua no armazenamento **legado** marcado `GEMINI` no backend (para preservar dados); configure o workflow migrado para ler o mesmo `prompt_sistema` existente, ou migre as linhas do banco conscientemente antes de alterar o filtro de provedor.

Não remova Secrets da Google Cloud, chaves, registros nem saldos históricos até confirmar que todos os workflows OpenAI estão ativos e sem dependência.

## Testes realizados

- Verificação de sintaxe do JS externo e do JS embutido no HTML.
- Verificação de IDs e estrutura HTML da central, com os componentes antigos preservados.
- Teste isolado da API com chamadas simuladas: só computa custos do projeto correto; recusa atribuir gastos sem ID do projeto; nenhuma consulta Google.
- Inspeção de layout em navegador headless com HTML local e estilos carregados.

**Ainda não foram feitos testes contra a conta OpenAI real, Cloudflare de produção ou banco vivo.** Depois da publicação, verificar seleção de empresa, leitura e salvamento de prompt e mensagens de finanças antes de alterar modelos no n8n.

# V35 · Central isolada e navegação preservada

**Instalação:** Faça backup do `index.html` publicado. Substitua somente `index.html` na raiz do GitHub (não apague outros arquivos). O ZIP possui apenas esse arquivo e este README. Aguarde o deploy e recarregue com Ctrl+F5.

**O que foi corrigido:** a central não depende de `/js/central-v31.js` (que recebia HTML), e não chama `change()` dos selects das abas originais (isso acionava `showSection('ia-empresa')` e desviava a navegação). Consulta empresas/prompts com as mesmas rotas já usadas pelos três módulos; o salvamento passa diretamente pelas APIs originais com credencial Supabase existente.

**O que não foi alterado:** `js/creditos.js`, `js/vendas-admin.js`, `functions`, login, bancos e Secrets. Os gastos oficiais não são mostrados como saldos pré-pagos. Não há recarga automática. Sem `maxlength` no editor central; backend/modelos podem impor limites.

**Verificações após deploy:** navegar entre 3 CRMs e voltar; selecionar empresa do Jurídico (ID 5), conferir prompt; agendamento e vendas devem listar suas próprias empresas (se conectados); verificar gastos sem inventar saldo. Antes de salvar algum prompt real, faça cópia do conteúdo. Esta correção não foi testada contra as APIs reais.

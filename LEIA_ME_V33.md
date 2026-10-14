# Painel Admin AV V33 — publicação

## Alterações
- Central V31 JavaScript e CSS instalados em `js/` e `css/` (evita resposta HTML no caminho da API estática).
- Aparência refinada por CSS adicional `css/av-visual-v33.css` sem refazer menus ou formulários.
- Observação do carregamento dos seletores originais e sincronização da central quando a lista mudar.
- O painel continua distinguindo saldos oficiais não consultados de gasto real e carteira interna.

## Para atualizar mantendo arquivos antigos no GitHub
Substitua/envie **apenas estes 4 arquivos** nos caminhos exatos:
- `index.html`
- `js/central-v31.js`
- `css/central-v31.css`
- `css/av-visual-v33.css`

**Não envie os arquivos soltos à raiz**, nem remova APIs ou arquivos antigos ativos. A pasta `functions` no pacote completo preserva as rotas originais.

## Validação
Testar no preview Cloudflare: login, empresas, Jurídico, Vendas, Agendamento, sync, edição e salvamento dos prompts. Arquivos estáticos devem retornar JavaScript/CSS, não HTML. A entrega não comprova testes ponta-a-ponta em produção. Não foram alterados bancos/segredos nem ativado faturamento.

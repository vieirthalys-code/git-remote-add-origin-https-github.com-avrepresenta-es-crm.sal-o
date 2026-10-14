# Gemini 3 CRMs — V29 (preparação segura)

Inclusão da seção “Gemini · 3 CRMs” no Painel Admin, preservando as integrações anteriores.

## O que está implementado
- Navegação central entre Jurídico, Vendas e Agendamento.
- Links para o faturamento oficial do Google AI Studio.
- Alertas explícitos de ausência de saldo oficial conectado.
- Roteiro por empresa para projetos, faturamento e chaves distintas.

## O que NÃO está implementado
- Compra de créditos no Google via API (não foi identificada API pública oficial para esta ação).
- Consulta automática de saldo pré-pago oficial ou separação financeira efetiva (dependem de contas Google ativas por empresa).
- Criação automática de projetos e chaves (o provisionador ainda não possui autenticação válida e as políticas impedem chaves JSON).
- Desconto do saldo interno representando pagamento real.

## Implantação
Faça backup do GitHub. Substitua index.html e adicione css/gemini-tres-crms.css à raiz correspondente. Os demais arquivos originais foram mantidos. Confirme deploy do Cloudflare Pages, login e navegação. Não ative cobrança automática nem migre chaves existentes.

## Próximos passos técnicos
1. Regularizar uma conta Google Billing por empresa; confirmar projeto vinculado.
2. Definir autenticação de provisionamento Google sem chaves permanentes.
3. Implantar endpoint autenticado para mapear empresa_id / projeto / billing_account_id.
4. Consultar custos reais com relatórios autorizados, distinguindo gastos de saldo pré-pago.
5. Testar segregação multiempresa e permissão do administrador.

# Admin SaaS AV — V32 (estrutura limpa)

## Conteúdo
Pacote do site com somente os arquivos referenciados e as funções Cloudflare em caminhos canônicos. Não substitui bancos nem configurações/segredos do Cloudflare.

## Publicação segura
1. Salve o ZIP do repositório atual e marque o commit como backup.
2. Publique esta pasta em uma branch de teste, configure o Preview da Cloudflare e teste login, empresas, jurídico, agenda, vendas, central V31 e chamadas /api.
3. Somente após os testes, substitua o conteúdo da branch de produção pelos arquivos *dentro* deste ZIP, sem pasta extra. Não basta enviar sobre os arquivos antigos: é necessário remover os antigos na substituição depois de validar a branch de teste.
4. Não apague segredos Cloudflare, banco, GitHub ou workflows n8n.

## Limitações honestas
Saldo pré-pago Google/OpenAI depende de provedor e faturamento oficiais. Removido apenas o limite de 12.000 caracteres da interface/JavaScript de agendamento, não limites de backend, n8n, Google ou modelo. A central usa os módulos existentes; salvar prompts deve ser testado com empresa de teste antes de uso real.

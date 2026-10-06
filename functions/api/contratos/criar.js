function json(status, body) {
  return new Response(JSON.stringify(body), {status, headers:{'Content-Type':'application/json; charset=UTF-8','Cache-Control':'no-store'}});
}
export const onRequestPost = () => json(410,{ok:false,erro:'FLUXO_DESATIVADO',mensagem:'O cadastro financeiro agora é feito primeiro no Asaas. Use Importar do Asaas no Painel Admin.'});

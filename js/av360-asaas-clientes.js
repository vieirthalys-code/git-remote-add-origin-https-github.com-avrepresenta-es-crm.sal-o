/* AV360: clientes Asaas no painel de Vendas; os dados e controles ficam no servidor. */
(() => {
  'use strict';
  const root=document.getElementById('crm-vendas');
  const anchor=root?.querySelector('.avv-panel .access-kpis');
  if(!root||!anchor||document.getElementById('av360-asaas-clientes'))return;
  const safe=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const box=document.createElement('section');
  box.id='av360-asaas-clientes';
  box.setAttribute('aria-label','Clientes Asaas no CRM Vendas');
  box.innerHTML='<div class="av360-asaas-head"><div><h3>Clientes cadastrados no Asaas</h3><p>Clientes do Asaas aparecem aqui ao consultar a conta. Para administrar o CRM, vincule somente a empresa com CPF/CNPJ conferido. Vincular não cria cobrança, não libera acesso e não distribui créditos.</p></div><button type="button" class="btn btn-secondary" id="av360-asaas-refresh">Atualizar clientes Asaas</button></div>'+
  '<div class="av360-asaas-toolbar"><input type="search" id="av360-asaas-busca" class="input" placeholder="Pesquisar nome, CPF/CNPJ, e-mail ou identificador" aria-label="Pesquisar clientes Asaas"><strong id="av360-asaas-total">—</strong></div>'+
  '<p id="av360-asaas-status" role="status" aria-live="polite">Aguardando consulta ao Asaas.</p>'+
  '<div class="av360-asaas-scroll"><table class="av360-asaas-table"><thead><tr><th>Cliente Asaas</th><th>CPF/CNPJ</th><th>Vínculo com o CRM</th><th>Ação</th></tr></thead><tbody id="av360-asaas-rows"><tr><td colspan="4">Atualize os clientes para consultar o Asaas.</td></tr></tbody></table></div>';
  anchor.parentNode.insertBefore(box,anchor);
  const style=document.createElement('style');
  style.textContent='#av360-asaas-clientes{margin:16px 0 22px;padding:17px;border:1px solid #dbe5f0;border-radius:14px;background:#fbfdff}'+
  '#av360-asaas-clientes .av360-asaas-head{display:flex;gap:12px;justify-content:space-between;align-items:start;flex-wrap:wrap}'+
  '#av360-asaas-clientes h3{margin:0 0 6px;font-size:19px}#av360-asaas-clientes p{line-height:1.45;color:#4d5f73}'+
  '#av360-asaas-clientes .av360-asaas-head p{max-width:730px;margin:0}'+
  '#av360-asaas-clientes .av360-asaas-toolbar{display:flex;gap:12px;justify-content:space-between;align-items:center;margin:15px 0 7px}'+
  '#av360-asaas-clientes .av360-asaas-toolbar input{flex:1;min-width:140px}'+
  '#av360-asaas-clientes .av360-asaas-scroll{overflow-x:auto}'+
  '#av360-asaas-clientes .av360-asaas-table{width:100%;border-collapse:collapse;font-size:13px}'+
  '#av360-asaas-clientes td,#av360-asaas-clientes th{text-align:left;padding:11px 9px;border-bottom:1px solid #e5ebf3;vertical-align:middle}'+
  '#av360-asaas-clientes td small{display:block;color:#68798a;margin-top:3px;overflow-wrap:anywhere}'+
  '#av360-asaas-clientes button[data-link],#av360-asaas-clientes button[data-open]{white-space:nowrap}'+
  '#av360-asaas-clientes [data-state="VINCULADO"]{color:#16744e;font-weight:650}'+
  '#av360-asaas-clientes [data-state="APTO_PARA_VINCULAR"]{color:#995700;font-weight:650}'+
  '@media(max-width:720px){#av360-asaas-clientes{padding:12px}#av360-asaas-clientes .av360-asaas-head button{width:100%}}';
  document.head.appendChild(style);
  const el=id=>document.getElementById(id);
  let clients=[],running=false,doneInitial=false;
  const notify=(message,error=false)=>{const s=el('av360-asaas-status');s.textContent=message;s.style.color=error?'#ad2525':'';};
  function render(){
    const search=el('av360-asaas-busca').value.trim().toLocaleLowerCase('pt-BR');
    const filtered=clients.filter(c=>!search||[c.nome,c.email,c.documento,c.asaas_customer_id,c.empresa_nome,c.possivel_empresa_nome].some(v=>String(v||'').toLocaleLowerCase('pt-BR').includes(search)));
    el('av360-asaas-total').textContent=filtered.length+' de '+clients.length+' cliente(s)';
    const rows=filtered.map(c=>{
      const isLinked=c.status_integracao==='VINCULADO';
      const mayLink=c.status_integracao==='APTO_PARA_VINCULAR'&&c.possivel_empresa_id;
      const status=isLinked?'Vinculado ao CRM: '+String(c.empresa_nome||'empresa')+(c.empresa_ativa===false?' (inativa)':''):mayLink?'Cadastro correspondente: '+String(c.possivel_empresa_nome||'empresa'):'Aguardando cadastro e conferência no CRM';
      const action=isLinked?'<button type="button" class="btn btn-secondary btn-small" data-open="'+safe(c.empresa_id)+'">Abrir gestão</button>':
        mayLink?'<button type="button" class="btn btn-primary btn-small" data-link="'+safe(c.asaas_customer_id)+'">Conferir e vincular</button>':'<small>Sem vínculo elegível</small>';
      return '<tr><td><strong>'+safe(c.nome||'Cliente sem nome')+'</strong><small>'+safe(c.email)+'</small><small>'+safe(c.asaas_customer_id)+'</small></td>'+
       '<td>'+safe(c.documento||'Não informado')+'</td><td data-state="'+safe(c.status_integracao)+'">'+safe(status)+
       (isLinked?'<small>Login: '+(c.acesso_real?'liberado':'pendente')+' · WhatsApp: '+(c.whatsapp_autorizado?'autorizado':'não autorizado')+'</small>':'')+
       '</td><td>'+action+'</td></tr>';
    });
    el('av360-asaas-rows').innerHTML=rows.length?rows.join(''):'<tr><td colspan="4">Nenhum cliente encontrado.</td></tr>';
  }
  async function token(){const t=await window.AV_ADMIN_AUTH?.getToken?.();if(!t)throw Error('Faça login na conta administrativa AV.');return t;}
  async function refresh(){
    if(running)return;
    running=true;el('av360-asaas-refresh').disabled=true;notify('Consultando os clientes da conta Asaas...');
    try{
      const res=await fetch('/api/vendas/asaas-clientes',{headers:{Authorization:'Bearer '+await token()},cache:'no-store',credentials:'same-origin'});
      const data=await res.json().catch(()=>({ok:false}));
      if(!res.ok||data.ok!==true||!Array.isArray(data.clientes))throw Error(data.error||'Não foi possível consultar o Asaas.');
      clients=data.clientes;doneInitial=true;render();
      notify('Lista atualizada: '+clients.length+' cliente(s). '+(data.parcial?'Atenção: existe mais conteúdo no Asaas do que o limite da consulta; solicite ampliação da paginação.':'Nenhuma liberação ou cobrança foi realizada.'));
    }catch(e){notify(e.message||'Falha na consulta ao Asaas.',true);}
    finally{running=false;el('av360-asaas-refresh').disabled=false;}
  }
  async function linkCustomer(c){
    if(running||!c?.possivel_empresa_id)return;
    const msg='Vincular '+c.nome+' ('+c.documento+') à empresa CRM "'+c.possivel_empresa_nome+'"?\n\nConfirme que os cadastros representam a mesma empresa. A ação NÃO libera login, não cria assinatura e não altera saldo OpenAI.';
    if(!window.confirm(msg))return;
    running=true;notify('Conferindo a vinculação...');el('av360-asaas-refresh').disabled=true;
    try{
      const res=await fetch('/api/vendas/asaas-vincular',{method:'POST',headers:{Authorization:'Bearer '+await token(),'Content-Type':'application/json'},cache:'no-store',credentials:'same-origin',body:JSON.stringify({empresa_id:c.possivel_empresa_id,asaas_customer_id:c.asaas_customer_id,confirmacao:'CONFERI_CADASTRO_ASAAS'})});
      const data=await res.json().catch(()=>({ok:false}));
      if(!res.ok||data.ok!==true)throw Error(data.error||'Não foi possível vincular o cliente.');
      notify('Vínculo registrado. Configure o plano e libere o teste na gestão da empresa.');
    }catch(e){notify(e.message||'Erro na vinculação.',true);}
    finally{running=false;el('av360-asaas-refresh').disabled=false;await refresh();el('avv-refresh')?.click();}
  }
  el('av360-asaas-refresh').addEventListener('click',refresh);
  el('av360-asaas-busca').addEventListener('input',render);
  el('av360-asaas-rows').addEventListener('click',event=>{
    const link=event.target.closest('[data-link]');
    if(link){const customer=clients.find(c=>c.asaas_customer_id===link.dataset.link);if(customer)linkCustomer(customer);return;}
    const open=event.target.closest('[data-open]');
    if(open){
      const id=open.dataset.open;
      el('avv-search').value='';el('avv-search').dispatchEvent(new Event('input'));
      const button=[...document.querySelectorAll('#avv-list [data-avv-id]')].find(x=>x.dataset.avvId===id);
      if(button){button.click();button.scrollIntoView({behavior:'smooth',block:'center'});notify('Empresa selecionada. Use os controles de teste, plano e prompt ao lado.');}
      else{el('avv-refresh')?.click();notify('Atualizando empresas do CRM. Clique em Abrir gestão novamente após carregar.');}
    }
  });
  document.querySelector('.nav-link[data-section="crm-vendas"]')?.addEventListener('click',()=>{if(!doneInitial)refresh();});
  if(location.hash==='#crm-vendas')setTimeout(refresh,600);
})();
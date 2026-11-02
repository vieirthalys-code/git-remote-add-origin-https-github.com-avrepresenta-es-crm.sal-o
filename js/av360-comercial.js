/* AV 360: modulo comercial no Painel AV. Sem cobrancas, sem segredos no navegador. */
(() => {
  'use strict';
  const el = id => document.getElementById(id);
  const root=el('crm-vendas'), editor=el('avv-editor'), label=el('avv-id'), prompt=el('avv-prompt-form');
  if (!root||!editor||!label||!prompt||el('av360-form')) return;
  const uuid=/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i;
  const brl=new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'});
  const style=document.createElement('style');
  style.textContent='#crm-vendas .av360-form {background:#fff;border:1px solid #dae6f8;border-radius:14px;padding:18px;margin:16px 0}'+
    '#crm-vendas .av360-form h4{color:#194b98;margin:0 0 8px}'+
    '#crm-vendas .av360-form p{color:#51647c;line-height:1.45}'+
    '#crm-vendas .av360-fields{display:grid;grid-template-columns:repeat(auto-fit,minmax(185px,1fr));gap:12px;margin:15px 0}'+
    '#crm-vendas .av360-fields label{display:flex;flex-direction:column;gap:7px;font-weight:600}'+
    '#crm-vendas .av360-fields input,#crm-vendas .av360-fields select{width:100%;min-height:42px}'+
    '#crm-vendas .av360-total{font-weight:700;color:#1854a9}'+
    '#crm-vendas .av360-message{font-size:13px;min-height:22px;margin-top:10px}'+
    '#crm-vendas .av360-message.error{color:#b42318}'+
    '#crm-vendas .av360-trial{display:flex;flex-wrap:wrap;align-items:end;gap:12px;margin-top:10px}';
  document.head.appendChild(style);
  const form=document.createElement('form');
  form.id='av360-form';form.className='av360-form';
  form.innerHTML='<h4>Plano e mensalidade por empresa</h4>'+
    '<p>Configure planos e valores do CRM Vendas 360. Não gera cobranças no Asaas e não altera contratos.</p>'+
    '<div class="av360-fields">'+
    '<label>Plano<select class="input" id="av360-plan"><option value="">Escolha uma empresa</option></select></label>'+
    '<label>Mensalidade personalizada (R$)<input class="input" id="av360-price" inputmode="decimal" maxlength="15" placeholder="Vazio = valor padrão" autocomplete="off"></label>'+
    '<label>Observação comercial<input class="input" id="av360-note" maxlength="2000" placeholder="Opcional" autocomplete="off"></label>'+
    '</div><p id="av360-total" class="av360-total">Selecione uma empresa.</p>'+
    '<button id="av360-save" type="submit" class="btn btn-primary" disabled>Salvar plano e mensalidade</button>'+
    '<p id="av360-message" class="av360-message" role="status" aria-live="polite"></p>';
  prompt.before(form);
  const trialActions=el('avv-trial-text')?.closest('.avv-block')?.querySelector('.avv-actions');
  if(trialActions&&!el('av360-days')){
    const trial=document.createElement('div');trial.className='av360-trial';
    trial.innerHTML='<label>Teste grátis personalizado (1 a 90 dias)<input class="input" id="av360-days" type="number" min="1" max="90" step="1" value="14" style="width:100px;min-height:42px"></label>'+
      '<button id="av360-grant" type="button" class="btn btn-secondary">Conceder teste</button>';
    trialActions.after(trial);
  }
  const id=()=>String(label.textContent||'').match(uuid)?.[0].toLowerCase()||null;
  let seq=0,busy=false;
  function message(text,error=false){el('av360-message').textContent=text;el('av360-message').classList.toggle('error',error);}
  function disable(value){el('av360-save').disabled=value;if(el('av360-grant'))el('av360-grant').disabled=value;}
  async function api(acao,body={}){
    const token=await window.AV_ADMIN_AUTH?.getToken?.();
    if(!token)throw new Error('Sua sessão administrativa expirou. Entre novamente.');
    const response=await fetch('/api/vendas/admin',{method:'POST',headers:{'Authorization':'Bearer '+token,'Content-Type':'application/json'},credentials:'same-origin',cache:'no-store',body:JSON.stringify({acao,...body})});
    const data=await response.json().catch(()=>null);
    if(!response.ok||data?.ok!==true)throw new Error(String(data?.error||data?.erro||'Falha na API administrativa (HTTP '+response.status+')'));
    return data;
  }
  async function load(){
    const tenant=id(),ticket=++seq;disable(true);
    if(!tenant){message('Selecione uma empresa.');return;}
    message('Consultando as configurações comerciais...');
    try{
      const data=await api('listar');
      if(ticket!==seq||id()!==tenant)return;
      const company=(Array.isArray(data.empresas)?data.empresas:[]).find(x=>String(x.id).toLowerCase()===tenant);
      if(!company)throw new Error('Empresa selecionada não encontrada.');
      const select=el('av360-plan'),com=company.comercial||{};
      select.replaceChildren();
      select.add(new Option('Sem plano definido',''));
      for(const p of Array.isArray(data.planos)?data.planos:[])select.add(new Option(String(p.nome||p.codigo),String(p.codigo)));
      select.value=com.plano_codigo||'';
      el('av360-price').value=com.mensalidade_personalizada??'';
      el('av360-note').value=com.observacao||'';
      el('av360-total').textContent=com.mensalidade_efetiva==null?'Mensalidade atual: não definida':'Mensalidade atual: '+brl.format(Number(com.mensalidade_efetiva));
      message('Valores de '+String(company.nome||'empresa')+' carregados.');
      disable(false);
    }catch(e){if(ticket===seq)message(e.message||'Não foi possível carregar.',true);}
  }
  form.addEventListener('submit',async e=>{
    e.preventDefault();if(busy)return;
    const tenant=id();if(!tenant)return message('Selecione uma empresa.',true);
    const raw=el('av360-price').value.trim().replace(',','.');
    if(raw&&!/^(?:0|[1-9][0-9]{0,9})(?:\.[0-9]{1,2})?$/.test(raw))return message('Use um valor válido com até duas casas decimais.',true);
    const amount=raw===''?null:Number(raw);
    if(amount!==null&&(!Number.isFinite(amount)||amount>9999999999.99))return message('Valor inválido.',true);
    busy=true;disable(true);message('Gravando plano e mensalidade...');
    try{
      await api('comercial',{empresa_id:tenant,plano_codigo:el('av360-plan').value||null,mensalidade_personalizada:amount,observacao:el('av360-note').value});
      if(id()!==tenant)return;
      await load();
      message('Plano e mensalidade registrados. Nenhuma cobrança foi gerada.');
    }catch(error){message(error.message||'Erro ao salvar.',true);}
    finally{busy=false;if(id()===tenant)disable(false);}
  });
  el('av360-grant')?.addEventListener('click',async()=>{
    if(busy)return;const tenant=id(),days=Number(el('av360-days').value);
    if(!tenant)return message('Selecione uma empresa.',true);
    if(!Number.isInteger(days)||days<1||days>90)return message('Informe de 1 a 90 dias.',true);
    busy=true;disable(true);
    try{await api('teste',{empresa_id:tenant,dias:days});message('Teste grátis de '+days+' dias registrado.');el('avv-refresh')?.click();}
    catch(error){message(error.message||'Falha ao conceder teste.',true);}
    finally{busy=false;disable(false);}
  });
  new MutationObserver(()=>{if(!busy)load();}).observe(label,{childList:true,characterData:true,subtree:true});
  if(id())load();
})();
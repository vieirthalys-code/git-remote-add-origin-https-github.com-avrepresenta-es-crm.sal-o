/* Carteira central OpenAI: mostra lastro manual e verba atribuida por empresa.
 * Nunca debita OpenAI nem cria cobrancas. Fonte PostgreSQL via Pages Function protegida. */
(() => {
  'use strict';
  const el=id=>document.getElementById(id), module=el('av360-form'),label=el('avv-id');
  if(!module||!label||el('av360-wallet')) return;
  const uuid=/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i;
  const brl=new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'});
  const id=()=>String(label.textContent||'').match(uuid)?.[0].toLowerCase()||null;
  const cents=n=>Math.round(Number(n||0));
  const money=n=>brl.format(cents(n)/100);
  const div=document.createElement('section');div.id='av360-wallet';div.className='av360-form';
  div.innerHTML='<h4>OpenAI · orçamento real em R$ por empresa</h4>'+
    '<p>Os créditos são comprados diretamente na OpenAI. Aqui você registra o saldo <strong>conferido manualmente</strong> e distribui orçamento em reais. O painel não deposita dinheiro nem consulta o saldo oficial ao vivo.</p>'+
    '<div class="av360-wallet-grid">'+
    '<div><small>Saldo global conferido</small><strong id="av360-last">—</strong></div>'+
    '<div><small>Verba livre para distribuir</small><strong id="av360-free">—</strong></div>'+
    '<div><small>Disponível para esta empresa</small><strong id="av360-company-balance">—</strong></div>'+
    '<div><small>Reservado para IA desta empresa</small><strong id="av360-company-reserved">—</strong></div>'+
    '</div><p id="av360-wallet-verified"></p>'+
    '<div class="av360-wallet-actions">'+
    '<label>Valor (R$)<input class="input" type="text" inputmode="decimal" id="av360-amount" placeholder="Ex.: 20,00"></label>'+
    '<button class="btn btn-primary" id="av360-add" type="button">Alocar saldo</button>'+
    '<button class="btn btn-secondary" id="av360-return" type="button">Devolver ao fundo</button>'+
    '<button class="btn btn-secondary" id="av360-create" type="button" hidden>Criar carteira da empresa</button>'+
    '<button class="btn btn-secondary" id="av360-wallet-refresh" type="button">Atualizar saldos</button>'+
    '</div>'+
    '<details class="av360-verify"><summary>Conferir saldo real na OpenAI e atualizar o valor em reais</summary>'+
    '<p>Confira o saldo <a href="https://platform.openai.com/settings/organization/billing/overview" target="_blank" rel="noopener noreferrer">diretamente na OpenAI</a>. Informe o saldo em dólares e a cotação USD/BRL utilizada, para registrar o equivalente em R$. Não use o valor de uma recarga passada como se fosse o saldo atual.</p>'+
    '<div class="av360-wallet-actions">'+
    '<label>Saldo atual (US$)<input class="input" type="text" inputmode="decimal" id="av360-usd" placeholder="Ex.: 10.00"></label>'+
    '<label>Cotação USD/BRL<input class="input" type="text" inputmode="decimal" id="av360-fx" placeholder="Ex.: 5.10"></label>'+
    '<button type="button" class="btn btn-secondary" id="av360-verify">Registrar saldo conferido</button></div></details>'+
    '<h4 style="margin-top:16px">Últimos movimentos desta empresa</h4>'+
    '<div id="av360-wallet-ledger" class="av360-ledger"><p>Selecione uma empresa.</p></div>'+
    '<p id="av360-wallet-msg" role="status" aria-live="polite"></p>';
  module.after(div);
  const style=document.createElement('style');style.textContent=
    '#av360-wallet .av360-wallet-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(155px,1fr));gap:12px;margin:12px 0}'+
    '#av360-wallet .av360-wallet-grid>div{padding:13px;border:1px solid #d8e4f4;border-radius:10px;background:#f8fbff}'+
    '#av360-wallet .av360-wallet-grid small{display:block;font-size:12px;color:#51647c}'+
    '#av360-wallet .av360-wallet-grid strong{display:block;font-size:22px;color:#174b94;margin-top:4px}'+
    '#av360-wallet .av360-wallet-actions{display:flex;flex-wrap:wrap;gap:10px;align-items:end;margin:12px 0}'+
    '#av360-wallet .av360-wallet-actions label{display:flex;flex-direction:column;gap:5px}'+
    '#av360-wallet .av360-wallet-actions input{width:126px;min-height:40px}'+
    '#av360-wallet .av360-verify{border-top:1px solid #e6eaf0;padding:12px 0;margin-top:12px}'+
    '#av360-wallet .av360-verify summary{cursor:pointer;color:#1855a0;font-weight:600}'+
    '#av360-wallet .av360-ledger>p{margin:6px 0}'+
    '#av360-wallet #av360-wallet-msg.error{color:#b42318}';
  document.head.appendChild(style);
  let busy=false,seq=0,latest=null,selectedWallet=null;
  const msg=(t,err=false)=>{el('av360-wallet-msg').textContent=t;el('av360-wallet-msg').classList.toggle('error',err);};
  const disable=b=>{for(const n of ['av360-add','av360-return','av360-create','av360-verify','av360-wallet-refresh'])if(el(n))el(n).disabled=b;};
  async function api(acao,fields={}){
    const token=await window.AV_ADMIN_AUTH?.getToken?.();
    if(!token)throw new Error('Entre novamente no Painel AV para acessar as finanças.');
    const response=await fetch('/api/openai-wallet/admin',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},cache:'no-store',body:JSON.stringify({acao,...fields})});
    const result=await response.json().catch(()=>null);
    if(!response.ok||result?.ok!==true)throw new Error(String(result?.erro||result?.error||'Erro ao consultar a carteira financeira.'));
    return result;
  }
  const formatInput=x=>{
    const s=String(x||'').trim().replace(/\s/g,'');
    const normalized=s.includes(',')?s.replace(/\./g,'').replace(',','.'):s;
    if(!/^(0|[1-9][0-9]{0,7})(?:\.[0-9]{1,2})?$/.test(normalized))throw new Error('Informe um valor em reais com até 2 casas decimais.');
    const v=Math.round(Number(normalized)*100);
    if(!Number.isSafeInteger(v)||v<1||v>100000000)throw new Error('Valor deve estar entre R$ 0,01 e R$ 1.000.000,00.');
    return v;
  };
  async function refresh(){
    const company=id(),ticket=++seq;if(!company){msg('Selecione uma empresa do CRM Vendas.');return;}
    msg('Consultando valores registrados no PostgreSQL...');
    try {
      const data=await api('resumo');if(ticket!==seq||id()!==company)return;
      latest=data;const wallets=Array.isArray(data.carteiras)?data.carteiras:[];
      selectedWallet=wallets.find(w=>w.crm==='vendas'&&String(w.empresa_id).toLowerCase()===company)||null;
      el('av360-last').textContent=money(data.lastro_centavos);
      el('av360-free').textContent=money(data.livre_centavos);
      el('av360-company-balance').textContent=selectedWallet?money(selectedWallet.saldo_centavos):'Sem carteira';
      el('av360-company-reserved').textContent=selectedWallet?money(selectedWallet.reservado_centavos):'—';
      el('av360-create').hidden=Boolean(selectedWallet);
      el('av360-add').disabled=!selectedWallet;
      el('av360-return').disabled=!selectedWallet;
      el('av360-wallet-verified').textContent=data.verificado_em?
        'Última conferência manual: '+new Date(data.verificado_em).toLocaleString('pt-BR')+
        '. Saldo informado '+Number(data.saldo_usd_informado||0).toFixed(2)+' USD · cotação '+Number(data.usd_brl||0).toFixed(4)+'.':
        'O saldo oficial ainda não foi conferido manualmente.';
      const movements=(Array.isArray(data.movimentos)?data.movimentos:[]).filter(m=>selectedWallet&&m.carteira_id===selectedWallet.id).slice(0,12);
      const led=el('av360-wallet-ledger');led.replaceChildren();
      if(!movements.length){const p=document.createElement('p');p.textContent='Nenhum movimento da empresa nos últimos 50 registros globais.';led.append(p);}
      for(const m of movements){
        const p=document.createElement('p');
        p.textContent=(m.criado_em?new Date(m.criado_em).toLocaleString('pt-BR')+' · ':'')+
          String(m.tipo||'Movimento')+' · '+money(m.valor_centavos)+
          (m.observacao?' · '+String(m.observacao).slice(0,120):'');
        led.append(p);
      }
      msg(selectedWallet?'Carteira da empresa e saldo central atualizados.':'Esta empresa ainda não possui carteira. Crie-a antes de alocar créditos.');
    }catch(e){if(ticket===seq)msg(e.message||'Erro na carteira.',true);}
  }
  async function act(action,payload,confirmText){
    if(busy)return;if(confirmText&&!confirm(confirmText))return;
    busy=true;disable(true);msg('Registrando operação financeira...');
    try{await api(action,payload);await refresh();msg('Operação registrada com sucesso no PostgreSQL.');}
    catch(e){msg(e.message||'Operação não concluída.',true);}
    finally{busy=false;disable(false);}
  }
  el('av360-wallet-refresh').addEventListener('click',refresh);
  el('av360-create').addEventListener('click',()=>{
    const company=id();if(!company)return msg('Selecione uma empresa.',true);
    const name=el('avv-name')?.textContent?.trim()||'Empresa CRM Vendas';
    act('cadastrar',{crm:'vendas',empresa_id:company,empresa_nome:name},'Criar carteira de IA para '+name+'?');
  });
  for(const [button,action] of [['av360-add','alocar'],['av360-return','devolver']]){
    el(button).addEventListener('click',()=>{
      const company=id();if(!company||!selectedWallet)return msg('Cadastre primeiro a carteira da empresa.',true);
      let amount;try{amount=formatInput(el('av360-amount').value);}catch(e){return msg(e.message,true);}
      act(action,{crm:'vendas',empresa_id:company,valor_centavos:amount,referencia:crypto.randomUUID()},
        (action==='alocar'?'Alocar ':'Devolver ')+money(amount)+' para '+String(el('avv-name')?.textContent||'empresa')+'? O saldo é orçamento interno, não um depósito na OpenAI.');
    });
  }
  el('av360-verify').addEventListener('click',()=>{
    const usd=Number(el('av360-usd').value.trim().replace(',','.'));
    const fx=Number(el('av360-fx').value.trim().replace(',','.'));
    if(!Number.isFinite(usd)||usd<0||usd>1000000||!Number.isFinite(fx)||fx<1||fx>30)return msg('Informe o saldo em USD e a cotação válidos.',true);
    act('conferir_lastro',{saldo_usd:usd,usd_brl:fx,confirmacao:'CONFIRMEI_NO_SITE_OPENAI'},
      'Você confirmou no site oficial o saldo ATUAL de US$ '+usd.toFixed(2)+'? Isso atualizará o saldo central de TODOS os CRMs, não representa compra ou pagamento.');
  });
  new MutationObserver(()=>{if(!busy)refresh();}).observe(label,{subtree:true,childList:true,characterData:true});
  if(id())refresh();
})();
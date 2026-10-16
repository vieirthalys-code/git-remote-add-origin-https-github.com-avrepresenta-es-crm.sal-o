(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const ui = $('crm-vendas');
  if (!ui) return;
  let companies = [], selected = null, loading = false, creditRequest = 0;
  const safe = x => String(x ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function feedback(message, error=false) { $('avv-status').textContent = message; $('avv-status').classList.toggle('error', error); }
  function until(s) { if (!s) return 'Sem data de teste'; const d = new Date(s); return Number.isNaN(+d) ? 'Data inválida' : d.toLocaleString('pt-BR'); }
  function isTrial(c) { return Boolean(c?.config?.teste_gratis_ate && new Date(c.config.teste_gratis_ate) > new Date()); }
  function allowed(c) { const x=c.config||{}; return !x.controle_acesso_ativo || x.acesso_manual_ativo || isTrial(c); }
  const getSelected = () => companies.find(c => c.id === selected);
  const brl = n => new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(n||0));
  const precise = n => new Intl.NumberFormat('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:6}).format(Number(n||0));
  function setCreditStatus(message,error=false){const el=$('avv-credit-status');if(!el)return;el.textContent=message;el.classList.toggle('error',error);}
  async function loadCredit() {
    const c = getSelected();if(!c)return;
    const id=c.id;const requestNum=++creditRequest;
    $('avv-credit-balance').textContent='Consultando...';
    $('avv-credit-refresh').disabled=true;
    setCreditStatus('Consultando apenas os movimentos da empresa selecionada...');
    try{
      const data=await api('saldo',{empresa_id:id});
      if(selected!==id||requestNum!==creditRequest)return;
      $('avv-credit-balance').textContent=brl(data.saldo_alocado_reais);
      $('avv-credit-updated').textContent='Última consulta: '+new Date().toLocaleString('pt-BR');
      const movements=Array.isArray(data.historico)?data.historico:[];
      $('avv-transactions').innerHTML=movements.length?movements.map(m=>{
        const day=m.criado_em?new Date(m.criado_em).toLocaleString('pt-BR'):'—';
        const negative=m.tipo==='CONSUMO';
        return `<div class="avv-transaction"><div><span>${safe(m.tipo)} · ${safe(day)}</span><span>${safe(m.modelo||m.origem||'')}${m.tokens_entrada!=null?' · '+safe(m.tokens_entrada)+' tokens entrada':''}</span><span>Ref.: ${safe(m.referencia)}</span></div><strong>${negative?'−':'+'} R$ ${precise(m.valor_reais)}</strong></div>`;
      }).join(''):'<p class="empty">Nenhum movimento cadastrado para esta empresa.</p>';
      setCreditStatus('Saldo interno por empresa atualizado. Valores oficiais são consultados no Google AI Studio.');
    }catch(e){if(selected===id&&requestNum===creditRequest){$('avv-credit-balance').textContent='—';$('avv-transactions').textContent='Não foi possível consultar os movimentos.';setCreditStatus(e.message,true);}}
    finally {if(requestNum===creditRequest)$('avv-credit-refresh').disabled=false;}
  }

  async function api(acao, params={}) {
    const token = await window.AV_ADMIN_AUTH?.getToken?.();
    if (!token) throw new Error('Entre no Admin AV novamente para administrar o CRM Vendas.');
    const response = await fetch('/api/vendas/admin', {
      method:'POST', headers:{'Authorization':'Bearer '+token, 'Content-Type':'application/json'},
      cache:'no-store', body:JSON.stringify({acao,...params})
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || data?.ok === false) throw new Error(data?.error || `Não foi possível acessar o módulo Vendas (HTTP ${response.status}).`);
    return data;
  }
  function renderList() {
    const q = $('avv-search').value.trim().toLocaleLowerCase('pt-BR');
    const matches = companies.filter(c => !q || `${c.nome} ${c.id}`.toLocaleLowerCase('pt-BR').includes(q));
    $('avv-total').textContent = companies.length;
    $('avv-trials').textContent = companies.filter(isTrial).length;
    $('avv-agents').textContent = companies.filter(c => c.config?.agente_ativo).length;
    $('avv-list').innerHTML = matches.length ? matches.map(c => {
      const status = isTrial(c) ? 'Teste ativo' : c.config?.acesso_manual_ativo ? 'Acesso manual' : c.config?.controle_acesso_ativo ? 'Sem liberação' : 'Acesso não controlado';
      return `<button type="button" class="avv-company ${selected === c.id ? 'selected' : ''}" data-avv-id="${safe(c.id)}"><strong>${safe(c.nome || 'Empresa sem nome')}</strong><small>${safe(c.id)}</small><span class="avv-chip ${isTrial(c) ? '' : 'off'}">${status}</span></button>`;
    }).join('') : '<p class="empty">Nenhuma empresa encontrada.</p>';
  }
  function renderEditor() {
    const c = getSelected(), panel = $('avv-editor');
    if (!c) { panel.hidden = true; return; }
    panel.hidden = false;
    $('avv-name').textContent = c.nome || 'Empresa'; $('avv-id').textContent = `empresa_id: ${c.id}`;
    $('avv-gate').checked = Boolean(c.config?.controle_acesso_ativo);
    $('avv-manual').checked = Boolean(c.config?.acesso_manual_ativo);
    $('avv-agent').checked = Boolean(c.config?.agente_ativo);
    $('avv-prompt').value = String(c.config?.prompt_sistema || '');
    $('avv-count').textContent = `${$('avv-prompt').value.length.toLocaleString('pt-BR')} caracteres`;
    $('avv-trial-text').textContent = `${isTrial(c) ? 'Teste em andamento' : 'Sem teste ativo'} · ${until(c.config?.teste_gratis_ate)}`;
    $('avv-tags').innerHTML = `<span class="avv-chip ${allowed(c) ? '' : 'off'}">${allowed(c) ? 'Acesso permitido' : 'Acesso bloqueado'}</span><span class="avv-chip ${c.config?.agente_ativo ? '' : 'off'}">Robô ${c.config?.agente_ativo ? 'habilitado' : 'desabilitado'}</span>`;
    $('avv-meta').textContent='Ainda não há conexão oficial com a Meta. A página WhatsApp do CRM Vendas está pronta para receber essa integração.';
    $('avv-credit-balance').textContent=brl(c.saldo_alocado_reais);
    $('avv-transactions').textContent='Clique em Atualizar saldo para consultar os movimentos.';
    setCreditStatus('Saldo individual da empresa; não é saldo bancário do Google.');
  }
  async function reload(preferred) {
    if (loading) return;
    loading = true; $('avv-refresh').disabled = true;
    feedback('Consultando empresas e configurações do CRM Vendas...');
    try {
      const res=await api('listar');
      companies = Array.isArray(res.empresas) ? res.empresas : [];
      const pick=preferred || selected;
      selected=companies.some(c => c.id === pick) ? pick : companies[0]?.id || null;
      renderList(); renderEditor();
      if(selected) loadCredit();
      feedback(`${companies.length} empresa(s) consultada(s) com autorização do servidor. Nenhuma conexão Meta foi ativada.`);
    } catch (e) { feedback(e.message, true); }
    finally { loading = false; $('avv-refresh').disabled = false; }
  }
  async function change(acao, values, confirmText='') {
    const c = getSelected(); if (!c) return;
    if (confirmText && !window.confirm(confirmText)) return;
    const buttons=[...$('avv-editor').querySelectorAll('button')]; buttons.forEach(b=>b.disabled=true);
    feedback('Salvando configuração da empresa...');
    try {
      await api(acao, {empresa_id:c.id, ...values});
      await reload(c.id);
      feedback('Configuração do CRM Vendas salva e recarregada com sucesso.');
    } catch(e) { feedback(e.message,true); }
    finally { buttons.forEach(b=>b.disabled=false); }
  }
  $('avv-refresh').addEventListener('click',()=>reload());
  $('avv-search').addEventListener('input',renderList);
  $('avv-list').addEventListener('click',e=>{const item=e.target.closest('[data-avv-id]'); if (!item) return; selected=item.dataset.avvId; renderList(); renderEditor(); loadCredit();});
  $('avv-credit-refresh').addEventListener('click',loadCredit);
  $('avv-topup').addEventListener('click',async()=>{
    const c=getSelected();if(!c)return;
    const value=Number($('avv-topup-amount').value);
    if(!Number.isFinite(value)||value<=0||value>1000000||Math.abs(value*100-Math.round(value*100))>1e-6){setCreditStatus('Informe um valor positivo em reais com até 2 casas decimais.',true);return;}
    const rounded=Math.round(value*100)/100;
    if(!window.confirm(`Registrar R$ ${rounded.toFixed(2).replace('.',',')} de crédito INTERNO para ${c.nome}? Isso NÃO deposita dinheiro no Google AI Studio.`))return;
    const reference=crypto.randomUUID(); // identificador único para prevenir duplicação em reenvios
    $('avv-topup').disabled=true;setCreditStatus('Registrando movimento no PostgreSQL...');
    try{
      await api('recarga',{empresa_id:c.id,valor_reais:rounded,referencia:reference});
      $('avv-topup-amount').value='';
      await reload(c.id);
      setCreditStatus('Recarga interna da empresa registrada com histórico e saldo atualizado.');
    }catch(e){setCreditStatus(e.message,true);}
    finally{$('avv-topup').disabled=false;}
  });
  $('avv-prompt').addEventListener('input',()=>{$('avv-count').textContent=`${$('avv-prompt').value.length.toLocaleString('pt-BR')} caracteres`;});
  $('avv-save-policy').addEventListener('click',()=>{
    const active=$('avv-gate').checked, manual=$('avv-manual').checked, c=getSelected();
    const ending = active && !manual && !isTrial(c);
    change('politica', {controle_acesso_ativo:active,acesso_manual_ativo:manual}, ending ? 'Sem teste vigente nem liberação manual: esta empresa ficará sem acesso ao CRM Vendas. Continuar?' : '');
  });
  $('avv-editor').addEventListener('click',e=>{
    const button=e.target.closest('[data-avv-days]');
    if (button) change('teste', {dias:Number(button.dataset.avvDays)});
  });
  $('avv-end-trial').addEventListener('click',()=>change('encerrar_teste',{},'Encerrar agora o teste gratuito desta empresa?'));
  $('avv-prompt-form').addEventListener('submit',e=>{e.preventDefault();change('prompt', {prompt_sistema:$('avv-prompt').value,agente_ativo:$('avv-agent').checked});});
  const nav = document.querySelector('.nav-link[data-section="crm-vendas"]');
  nav?.addEventListener('click',()=>{if (!companies.length) reload();});
  if (location.hash === '#crm-vendas') {
    // O script de login existente administra a autenticação; uma recarga manual também funciona.
    setTimeout(reload,250);
  }
})();

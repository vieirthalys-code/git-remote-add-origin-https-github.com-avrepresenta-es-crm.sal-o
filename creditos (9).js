(() => {
  'use strict';

  const SUPABASE_URL = 'https://eancpttjrcetmpyqwanw.supabase.co';
  const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_vaPoYvu7bfg7okcczhyetA_L4-dKvZD';
  const N8N_BASE = 'https://possessivebull-n8n.cloudfy.live/webhook/crm-juridico/admin';
  const IA_ADMIN_BASE = 'https://possessivebull-n8n.cloudfy.live/webhook/crm-juridico/ia-admin';
  const ALLOWED_ADMIN_EMAIL = 'avrep.tech@gmail.com';

  const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];

  let session = null;
  let empresas = [];
  let promptRows = [];
  let crmCache = new Map();
  let currentCrmModule = 'resumo';
  let toastTimer = null;
  let deleteCompanyTarget = null;
  let deleteSaasCompanyTarget = null;
  let accessRows = [];
  let trialTarget = null;
  let selectedTrialDays = 7;
  let contractData = {clientes:[], produtos:[], contratos:[], configuracao:{}, assinaturasAsaas:[]};
  let contractCancelTarget = null;
  let selectedAsaasSubscription = null;

  const fmt = new Intl.NumberFormat('pt-BR');
  const dateFmt = new Intl.DateTimeFormat('pt-BR', { dateStyle:'short', timeStyle:'short' });
  const dateOnlyFmt = new Intl.DateTimeFormat('pt-BR', { dateStyle:'short' });

  function toast(message, error=false) {
    const el = $('#toast');
    if (!el) return;
    el.textContent = message;
    el.className = `toast show${error ? ' error' : ''}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.className = 'toast'; }, 3500);
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[ch]));
  }

  function number(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }

  function date(value) {
    if (!value) return '—';
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? String(value) : dateFmt.format(d);
  }

  function dateOnly(value) {
    if (!value) return '—';
    const raw = String(value).slice(0,10);
    const d = new Date(`${raw}T12:00:00`);
    return Number.isNaN(d.getTime()) ? raw : dateOnlyFmt.format(d);
  }

  function addDaysIso(days) {
    const d = new Date();
    d.setHours(12,0,0,0);
    d.setDate(d.getDate() + Number(days || 0));
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }

  function money(value, currency='USD') {
    if (value === null || value === undefined || value === '') return '—';
    const n = Number(value);
    if (!Number.isFinite(n)) return String(value);
    try { return new Intl.NumberFormat('pt-BR',{style:'currency',currency:currency||'USD'}).format(n); }
    catch { return `${currency || ''} ${n.toFixed(2)}`.trim(); }
  }

  function showAuth(show=true) {
    $('#auth-screen').classList.toggle('hidden', !show);
    $('#app').classList.toggle('hidden', show);
  }

  async function getSession() {
    const {data,error} = await supabase.auth.getSession();
    if (error) throw error;
    session = data.session;
    if (!session) { showAuth(true); return false; }
    const email = String(session.user?.email || '').trim().toLowerCase();
    if (email !== ALLOWED_ADMIN_EMAIL) {
      await supabase.auth.signOut();
      session = null;
      showAuth(true);
      toast('Esta conta não é autorizada para o Admin SaaS.', true);
      return false;
    }
    $('#admin-email').textContent = session.user.email;
    showAuth(false);
    return true;
  }

  async function login(event) {
    event.preventDefault();
    const email = $('#login-email').value.trim().toLowerCase();
    const password = $('#login-password').value;
    const button = $('#login-submit');
    if (email !== ALLOWED_ADMIN_EMAIL) { toast('Use somente avrep.tech@gmail.com.', true); return; }
    button.disabled = true;
    try {
      const {data,error} = await supabase.auth.signInWithPassword({email,password});
      if (error) throw error;
      session = data.session;
      if (!session || String(session.user?.email || '').toLowerCase() !== ALLOWED_ADMIN_EMAIL) throw new Error('Conta não autorizada.');
      $('#login-password').value = '';
      showAuth(false);
      await bootData();
      toast('Login realizado.');
    } catch (error) { toast(error.message || 'Não foi possível entrar.', true); }
    finally { button.disabled = false; }
  }

  async function api(path, payload={}) {
    if (!session) throw new Error('Sessão expirada.');
    const response = await fetch(`${N8N_BASE}/${path}`, {
      method:'POST',
      headers:{'Content-Type':'application/json','Accept':'application/json'},
      body:JSON.stringify({...payload,access_token:session.access_token}),
      cache:'no-store'
    });
    const raw = await response.text();
    let data;
    try { data = JSON.parse(raw); } catch { throw new Error(`Resposta inválida do n8n (${response.status}).`); }
    if (!response.ok) throw new Error(data?.erro || data?.message || `HTTP ${response.status}`);
    if (data?.ok === false) throw new Error(data.erro || data.message || 'Operação não autorizada.');
    return data;
  }

  async function iaApi(path, payload={}) {
    if (!session) throw new Error('Sessão expirada.');
    const response = await fetch(`${IA_ADMIN_BASE}/${path}`, {
      method:'POST',
      headers:{
        'Content-Type':'application/json',
        'Accept':'application/json',
        'Authorization':`Bearer ${session.access_token}`
      },
      body:JSON.stringify({...payload,access_token:session.access_token}),
      cache:'no-store'
    });
    const raw = await response.text();
    let data;
    try { data = JSON.parse(raw); } catch { throw new Error(`Resposta inválida do IA Admin (${response.status}).`); }
    if (!response.ok) throw new Error(data?.erro || data?.message || `HTTP ${response.status}`);
    if (data?.ok === false) throw new Error(data.erro || data.message || 'Operação não autorizada.');
    return data;
  }


  async function contractsApi(path, {method='GET', body=null}={}) {
    if (!session) throw new Error('Sessão expirada.');
    const response = await fetch(`/api/contratos/${encodeURIComponent(path)}`, {
      method,
      headers:{
        'Accept':'application/json',
        'Authorization':`Bearer ${session.access_token}`,
        ...(body ? {'Content-Type':'application/json'} : {})
      },
      body: body ? JSON.stringify(body) : undefined,
      cache:'no-store'
    });
    const raw = await response.text();
    let data;
    try { data = raw ? JSON.parse(raw) : {}; }
    catch { throw new Error(`Resposta inválida do módulo de contratos (${response.status}).`); }
    if (!response.ok) throw new Error(data?.mensagem || data?.erro || data?.message || `HTTP ${response.status}`);
    if (data?.ok === false) throw new Error(data?.mensagem || data?.erro || 'Operação recusada.');
    return data;
  }

  function moneyBRL(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return '—';
    return new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(n);
  }

  function contractStatusClass(status) {
    const s = String(status || '').toUpperCase();
    if (['ATIVO','ENCERRADO'].includes(s)) return 'on';
    if (['EM_TOLERANCIA','AGUARDANDO_PAGAMENTO'].includes(s)) return 'neutral';
    return 'off';
  }

  function contractStatusLabel(status) {
    const labels = {
      AGUARDANDO_PAGAMENTO:'Aguardando pagamento',
      ATIVO:'Ativo',
      EM_TOLERANCIA:'Em tolerância',
      BLOQUEADO:'Bloqueado',
      ENCERRADO:'Encerrado',
      CANCELADO:'Cancelado'
    };
    const s = String(status || '').toUpperCase();
    return labels[s] || s || '—';
  }

  function renderContractStats() {
    const rows = contractData.contratos || [];
    const access = rows.filter(r => Boolean(r.acesso_liberado)).length;
    const waiting = rows.filter(r => String(r.status || '').toUpperCase() === 'AGUARDANDO_PAGAMENTO').length;
    const blocked = rows.filter(r => String(r.status || '').toUpperCase() === 'BLOQUEADO').length;
    if ($('#contract-stat-total')) $('#contract-stat-total').textContent = fmt.format(rows.length);
    if ($('#contract-stat-access')) $('#contract-stat-access').textContent = fmt.format(access);
    if ($('#contract-stat-waiting')) $('#contract-stat-waiting').textContent = fmt.format(waiting);
    if ($('#contract-stat-blocked')) $('#contract-stat-blocked').textContent = fmt.format(blocked);
  }

  function renderContractProducts() {
    const target = $('#contract-products-grid');
    if (!target) return;
    const products = contractData.produtos || [];
    target.innerHTML = products.length ? products.map(p => `
      <article class="contract-product-card">
        <div class="contract-product-top">
          <span class="contract-product-id">#${escapeHtml(p.id)}</span>
          <span class="badge ${p.ativo ? 'on' : 'off'}">${p.ativo ? 'Ativo' : 'Inativo'}</span>
        </div>
        <strong>${escapeHtml(p.nome)}</strong>
        <small>${escapeHtml(p.codigo)}</small>
      </article>
    `).join('') : '<div class="empty">Nenhum produto ativo encontrado.</div>';
  }

  function renderContractSelectors() {
    const company = $('#contract-company');
    const product = $('#contract-product');
    if (company) {
      const previous = company.value;
      company.innerHTML = '<option value="">Selecione o cliente</option>' + (contractData.clientes || []).map(c => `
        <option value="${escapeHtml(c.empresa_id)}">${escapeHtml(c.nome_fantasia || c.nome || c.empresa_id)} · ${escapeHtml(c.email || 'sem e-mail')}</option>
      `).join('');
      if ([...company.options].some(o => o.value === previous)) company.value = previous;
    }
    if (product) {
      const previous = product.value;
      product.innerHTML = '<option value="">Selecione o produto</option>' + (contractData.produtos || []).map(p => `
        <option value="${escapeHtml(p.codigo)}">${escapeHtml(p.nome)} · ${escapeHtml(p.codigo)}</option>
      `).join('');
      if ([...product.options].some(o => o.value === previous)) product.value = previous;
    }
  }

  function contractRow(r) {
    const cancelable = ['AGUARDANDO_PAGAMENTO','ATIVO','EM_TOLERANCIA','BLOQUEADO'].includes(String(r.status || '').toUpperCase());
    const access = Boolean(r.acesso_liberado);
    const extras = [
      r.agente_ia_liberado ? '<span class="feature-chip">IA</span>' : '',
      r.whatsapp_liberado ? '<span class="feature-chip">WhatsApp</span>' : ''
    ].filter(Boolean).join('');
    return `<tr>
      <td><strong>${escapeHtml(r.empresa_nome || r.empresa_id || '—')}</strong><small class="table-sub">${escapeHtml(r.empresa_id || '')}</small></td>
      <td><strong>${escapeHtml(r.produto_nome || r.produto_codigo || '—')}</strong><small class="table-sub">${escapeHtml(r.produto_codigo || '')}</small></td>
      <td>${moneyBRL(r.valor_parcela)}</td>
      <td>${escapeHtml(r.parcelas_pagas ?? 0)} / ${escapeHtml(r.quantidade_parcelas ?? '—')}</td>
      <td>${dateOnly(r.proximo_vencimento || r.primeiro_vencimento)}</td>
      <td><span class="badge ${contractStatusClass(r.status)}">${escapeHtml(contractStatusLabel(r.status))}</span></td>
      <td><div class="access-cell"><span class="badge ${access ? 'on' : 'off'}">${access ? 'Liberado' : 'Bloqueado'}</span>${extras}</div></td>
      <td>${cancelable ? `<button class="btn btn-danger btn-small" data-contract-action="cancel" data-contract-id="${escapeHtml(r.contrato_id)}">Cancelar</button>` : '<span class="muted-text">—</span>'}</td>
    </tr>`;
  }

  function renderContractsTable() {
    const body = $('#contracts-body');
    if (!body) return;
    const q = String($('#contract-search')?.value || '').trim().toLowerCase();
    const rows = (contractData.contratos || []).filter(r => !q || [r.empresa_nome,r.empresa_id,r.produto_nome,r.produto_codigo,r.status,r.forma_pagamento].some(v => String(v || '').toLowerCase().includes(q)));
    body.innerHTML = rows.length ? rows.map(contractRow).join('') : '<tr><td colspan="8" class="empty">Nenhum contrato encontrado.</td></tr>';
  }

  function renderContracts() {
    renderContractStats();
    renderContractProducts();
    renderContractSelectors();
    renderContractsTable();
    renderAsaasSubscriptions();
  }

  async function loadContracts({silent=false}={}) {
    if ($('#contracts-body') && !silent) $('#contracts-body').innerHTML = '<tr><td colspan="8" class="empty">Carregando contratos...</td></tr>';
    try {
      const data = await contractsApi('bootstrap');
      contractData = {
        clientes:Array.isArray(data.clientes) ? data.clientes : [],
        produtos:Array.isArray(data.produtos) ? data.produtos : [],
        contratos:Array.isArray(data.contratos) ? data.contratos : [],
        configuracao:data.configuracao || {},
        assinaturasAsaas:Array.isArray(contractData.assinaturasAsaas) ? contractData.assinaturasAsaas : []
      };
      renderContracts();
      return true;
    } catch (error) {
      if ($('#contracts-body')) $('#contracts-body').innerHTML = `<tr><td colspan="8" class="empty">${escapeHtml(error.message || 'Não foi possível carregar contratos.')}</td></tr>`;
      if (!silent) toast(error.message || 'Não foi possível carregar contratos.', true);
      console.warn('Contratos:', error);
      return false;
    }
  }

  function asaasStatusClass(status) {
    const s = String(status || '').toUpperCase();
    if (s === 'ACTIVE') return 'on';
    if (s === 'EXPIRED') return 'neutral';
    return 'off';
  }

  function asaasStatusLabel(status) {
    const s = String(status || '').toUpperCase();
    return ({ACTIVE:'Ativa',EXPIRED:'Expirada',INACTIVE:'Inativa'})[s] || s || '—';
  }

  function paymentTypeLabel(type) {
    const s = String(type || '').toUpperCase();
    return ({PIX:'PIX',BOLETO:'Boleto',CREDIT_CARD:'Cartão',UNDEFINED:'A definir',DEBIT_CARD:'Débito',TRANSFER:'Transferência',DEPOSIT:'Depósito'})[s] || s || '—';
  }

  function isAsaasSubscriptionLinked(id) {
    return (contractData.contratos || []).some(r => String(r.asaas_subscription_id || '') === String(id || ''));
  }

  function asaasSubscriptionRow(s) {
    const linked = isAsaasSubscriptionLinked(s.id);
    const active = String(s.status_asaas || '').toUpperCase() === 'ACTIVE';
    const compatible = ['PIX','BOLETO','CREDIT_CARD','UNDEFINED'].includes(String(s.forma_pagamento || '').toUpperCase()) && String(s.ciclo || '').toUpperCase() === 'MONTHLY';
    const disabled = linked || !active || !compatible;
    const actionLabel = linked ? 'Já vinculado' : (!active ? 'Indisponível' : (!compatible ? 'Não compatível' : 'Vincular'));
    return `<tr>
      <td><strong>${escapeHtml(s.cliente_nome || s.customer_id || '—')}</strong><small class="table-sub">${escapeHtml(s.cpf_cnpj || s.email || s.customer_id || '')}</small></td>
      <td><strong>${escapeHtml(s.descricao || 'Assinatura')}</strong><small class="table-sub">${escapeHtml(s.id || '')}</small></td>
      <td>${moneyBRL(s.valor)}</td>
      <td>${escapeHtml(paymentTypeLabel(s.forma_pagamento))}<small class="table-sub">${escapeHtml(s.ciclo || '—')}</small></td>
      <td>${dateOnly(s.proximo_vencimento)}</td>
      <td><span class="badge ${asaasStatusClass(s.status_asaas)}">${escapeHtml(asaasStatusLabel(s.status_asaas))}</span></td>
      <td><span class="badge ${linked ? 'on' : 'neutral'}">${linked ? 'Vinculado' : 'Pendente'}</span></td>
      <td><button class="btn ${disabled ? 'btn-secondary' : 'btn-primary'} btn-small" type="button" data-asaas-action="select" data-asaas-id="${escapeHtml(s.id)}" ${disabled ? 'disabled' : ''}>${actionLabel}</button></td>
    </tr>`;
  }

  function renderAsaasSubscriptions() {
    const body = $('#asaas-subscriptions-body');
    if (!body) return;
    const q = String($('#asaas-subscription-search')?.value || '').trim().toLowerCase();
    const rows = (contractData.assinaturasAsaas || []).filter(s => !q || [s.cliente_nome,s.cpf_cnpj,s.email,s.descricao,s.id,s.status_asaas,s.forma_pagamento].some(v => String(v || '').toLowerCase().includes(q)));
    body.innerHTML = rows.length ? rows.map(asaasSubscriptionRow).join('') : '<tr><td colspan="8" class="empty">Nenhuma assinatura encontrada no Asaas.</td></tr>';
  }

  async function loadAsaasSubscriptions({silent=false}={}) {
    const body = $('#asaas-subscriptions-body');
    if (body && !silent) body.innerHTML = '<tr><td colspan="8" class="empty">Consultando Asaas...</td></tr>';
    try {
      const data = await contractsApi('asaas');
      contractData.assinaturasAsaas = Array.isArray(data.assinaturas) ? data.assinaturas : [];
      renderAsaasSubscriptions();
      return true;
    } catch (error) {
      if (body) body.innerHTML = `<tr><td colspan="8" class="empty">${escapeHtml(error.message || 'Não foi possível consultar o Asaas.')}</td></tr>`;
      if (!silent) toast(error.message || 'Não foi possível consultar o Asaas.', true);
      console.warn('Asaas:', error);
      return false;
    }
  }

  function clearAsaasSelection() {
    selectedAsaasSubscription = null;
    if ($('#contract-asaas-id')) $('#contract-asaas-id').value = '';
    if ($('#contract-import-btn')) $('#contract-import-btn').disabled = true;
    const summary = $('#asaas-selected-summary');
    if (summary) summary.innerHTML = '<span>Nenhuma assinatura selecionada.</span><strong>Escolha “Vincular” em uma assinatura acima.</strong>';
  }

  function selectAsaasSubscription(id) {
    const row = (contractData.assinaturasAsaas || []).find(s => String(s.id) === String(id));
    if (!row) { toast('Assinatura do Asaas não encontrada.', true); return; }
    if (isAsaasSubscriptionLinked(row.id)) { toast('Essa assinatura já está vinculada a um contrato.', true); return; }
    selectedAsaasSubscription = row;
    $('#contract-asaas-id').value = row.id;
    $('#contract-import-btn').disabled = false;
    if (Number(row.quantidade_parcelas || 0) > 0) $('#contract-installments-fallback').value = String(row.quantidade_parcelas);
    const summary = $('#asaas-selected-summary');
    summary.innerHTML = `
      <div><span>Cliente no Asaas</span><strong>${escapeHtml(row.cliente_nome || row.customer_id || '—')}</strong><small>${escapeHtml(row.id)}</small></div>
      <div><span>Valor</span><strong>${moneyBRL(row.valor)}</strong><small>${escapeHtml(paymentTypeLabel(row.forma_pagamento))}</small></div>
      <div><span>Próximo vencimento</span><strong>${dateOnly(row.proximo_vencimento)}</strong><small>${escapeHtml(asaasStatusLabel(row.status_asaas))}</small></div>`;
    $('#asaas-selected-summary').scrollIntoView({behavior:'smooth',block:'center'});
  }

  async function importAsaasContract(event) {
    event.preventDefault();
    const button = $('#contract-import-btn');
    const payload = {
      empresa_id:$('#contract-company').value,
      produto_codigo:$('#contract-product').value,
      asaas_subscription_id:$('#contract-asaas-id').value,
      quantidade_parcelas_fallback:Number($('#contract-installments-fallback').value || 12),
      dias_tolerancia:Number($('#contract-tolerance').value || 3)
    };
    if (!payload.asaas_subscription_id) { toast('Primeiro selecione uma assinatura do Asaas.', true); return; }
    if (!payload.empresa_id || !payload.produto_codigo) { toast('Selecione a empresa e o produto que essa assinatura deve liberar.', true); return; }
    button.disabled = true;
    const previous = button.textContent;
    button.textContent = 'Importando...';
    try {
      const result = await contractsApi('importar',{method:'POST',body:payload});
      toast(result?.mensagem || 'Assinatura importada com sucesso.');
      $('#contract-form').reset();
      $('#contract-installments-fallback').value = '12';
      $('#contract-tolerance').value = '3';
      clearAsaasSelection();
      await loadContracts({silent:true});
      await loadAsaasSubscriptions({silent:true});
    } catch (error) {
      toast(error.message || 'Não foi possível importar a assinatura.', true);
      button.disabled = false;
    } finally {
      if (selectedAsaasSubscription) button.disabled = false;
      button.textContent = previous;
    }
  }

  function openContractCancel(id) {
    const row = (contractData.contratos || []).find(r => String(r.contrato_id) === String(id));
    if (!row) { toast('Contrato não encontrado.', true); return; }
    contractCancelTarget = row;
    $('#contract-cancel-company').textContent = row.empresa_nome || row.empresa_id || '—';
    $('#contract-cancel-product').textContent = `${row.produto_nome || row.produto_codigo || 'Produto'} · ${contractStatusLabel(row.status)}`;
    $('#contract-cancel-id').textContent = `Contrato #${row.contrato_id}`;
    $('#contract-cancel-dialog').showModal();
  }

  function closeContractCancel() {
    if ($('#contract-cancel-dialog')?.open) $('#contract-cancel-dialog').close();
    contractCancelTarget = null;
  }

  async function confirmContractCancel() {
    if (!contractCancelTarget) return;
    const button = $('#contract-cancel-confirm');
    const previous = button.textContent;
    button.disabled = true;
    button.textContent = 'Cancelando...';
    try {
      const result = await contractsApi('cancelar',{method:'POST',body:{contrato_id:Number(contractCancelTarget.contrato_id)}});
      closeContractCancel();
      toast(result?.mensagem || 'Contrato cancelado.');
      await loadContracts({silent:true});
    } catch (error) {
      toast(error.message || 'Não foi possível cancelar o contrato.', true);
    } finally {
      button.disabled = false;
      button.textContent = previous;
    }
  }

  function normalizePromptRows(data) {
    const out = [];
    const scan = value => {
      if (!value) return;
      if (Array.isArray(value)) { value.forEach(scan); return; }
      if (typeof value !== 'object') return;
      const empresaId = value.empresa_id ?? value.id_empresa ?? value.empresa?.id;
      const provedor = String(value.provedor || value.provider || '').toUpperCase();
      if (empresaId && provedor === 'GEMINI') {
        out.push({
          empresa_id:Number(empresaId),
          provedor:'GEMINI',
          prompt_sistema:String(value.prompt_sistema ?? value.prompt ?? '')
        });
      }
      if (value.gemini && empresaId) {
        out.push({
          empresa_id:Number(empresaId),
          provedor:'GEMINI',
          prompt_sistema:String(value.gemini.prompt_sistema ?? value.gemini.prompt ?? '')
        });
      }
      ['provedores','providers','ias','configuracoes','dados','data','empresas','resultados','rows'].forEach(k => {
        if (value[k] && value[k] !== value) scan(value[k]);
      });
    };
    scan(data);
    const unique = new Map();
    out.forEach(r => unique.set(String(r.empresa_id), r));
    return [...unique.values()];
  }

  function promptFor(empresaId) {
    return promptRows.find(r => String(r.empresa_id) === String(empresaId))?.prompt_sistema || '';
  }

  async function loadPrompts() {
    try {
      const data = await iaApi('listar',{});
      promptRows = normalizePromptRows(data);
    } catch (error) {
      promptRows = [];
      console.warn('Não foi possível carregar prompts:', error);
    }
    renderStats();
    renderCompanyLists();
  }

  async function loadEmpresas() {
    $('#empresas-body').innerHTML = '<tr><td colspan="5" class="empty">Carregando...</td></tr>';
    const data = await api('empresas',{});
    empresas = Array.isArray(data.empresas) ? data.empresas : [];
    renderCompanySelectors();
    renderCompanyLists();
    renderStats();
  }

  function normalizeAccessRows(data) {
    const rows = Array.isArray(data?.dados) ? data.dados : (Array.isArray(data?.rows) ? data.rows : []);
    return rows.map(row => ({
      id: row.id ?? null,
      empresa_id: String(row.empresa_id || ''),
      empresa_nome: String(row.empresa_nome || row.nome || ''),
      nome_fantasia: String(row.nome_fantasia || ''),
      empresa_status: String(row.empresa_status || row.status || ''),
      plano: String(row.plano || ''),
      assinatura_status: String(row.assinatura_status || ''),
      usuario_nome: String(row.usuario_nome || ''),
      usuario_email: String(row.usuario_email || row.email || ''),
      teste_gratis_ate: row.teste_gratis_ate || null,
      teste_ativo: Boolean(row.teste_ativo),
      dias_restantes: number(row.dias_restantes)
    })).filter(row => row.empresa_id);
  }

  function accessStatusBadge(row) {
    if (row.teste_ativo) {
      const days = Math.max(0, number(row.dias_restantes));
      return `<span class="badge on">Teste ativo · ${days} dia${days===1?'':'s'}</span>`;
    }
    if (row.teste_gratis_ate) return '<span class="badge neutral">Teste expirado</span>';
    return '<span class="badge off">Sem teste</span>';
  }

  function renderAccessRows(errorMessage='') {
    const container = $('#access-companies');
    if (!container) return;
    const active = accessRows.filter(row => row.teste_ativo).length;
    $('#access-total').textContent = fmt.format(accessRows.length);
    $('#access-active').textContent = fmt.format(active);
    $('#access-inactive').textContent = fmt.format(Math.max(0, accessRows.length - active));

    if (errorMessage) {
      container.innerHTML = `<div class="access-error"><strong>Controle de teste grátis ainda não conectado.</strong><span>${escapeHtml(errorMessage)}</span><small>Importe e ative o workflow "ADMIN SAAS - TESTE GRÁTIS" que acompanha este pacote.</small></div>`;
      renderStats();
      return;
    }
    if (!accessRows.length) {
      container.innerHTML = '<div class="empty">Nenhuma conta SaaS encontrada.</div>';
      renderStats();
      return;
    }

    container.innerHTML = accessRows.map(row => `
      <article class="access-company-card ${row.teste_ativo?'active-trial':''}">
        <div class="access-company-main">
          <div class="access-company-title">
            <strong>${escapeHtml(row.nome_fantasia || row.empresa_nome || 'Empresa')}</strong>
            <span>${escapeHtml(row.usuario_email || 'Sem e-mail vinculado')}</span>
          </div>
          ${accessStatusBadge(row)}
        </div>
        <div class="access-company-meta">
          <span><b>ID:</b> ${escapeHtml(row.empresa_id)}</span>
          <span><b>Plano:</b> ${escapeHtml(row.plano || '—')}</span>
          <span><b>Teste até:</b> ${row.teste_gratis_ate ? escapeHtml(dateOnly(row.teste_gratis_ate)) : '—'}</span>
        </div>
        <div class="access-company-actions">
          <button class="btn btn-primary btn-small" type="button" data-action="trial" data-id="${escapeHtml(row.empresa_id)}">${row.teste_ativo?'Alterar teste':'Liberar teste grátis'}</button>
          ${row.teste_ativo || row.teste_gratis_ate ? `<button class="btn btn-secondary btn-small" type="button" data-action="trial-end" data-id="${escapeHtml(row.empresa_id)}">Encerrar teste</button>` : ''}
          ${isProtectedSaasCompany(row)
            ? '<button class="btn btn-secondary btn-small btn-protected" type="button" disabled title="Empresa protegida">Protegida</button>'
            : `<button class="btn btn-danger btn-small" type="button" data-action="delete-saas-company" data-id="${escapeHtml(row.empresa_id)}">Excluir</button>`}
        </div>
      </article>`).join('');
    renderStats();
  }

  async function loadTrialAccess({silent=false}={}) {
    if (!silent && $('#access-companies')) {
      $('#access-companies').innerHTML = '<div class="access-loading"><span class="skeleton skeleton-line wide"></span><span class="skeleton skeleton-line"></span><span class="skeleton skeleton-line short"></span></div>';
    }
    try {
      const data = await api('teste-gratis',{acao:'listar'});
      accessRows = normalizeAccessRows(data);
      renderAccessRows();
      return accessRows;
    } catch (error) {
      accessRows = [];
      renderAccessRows(error.message || 'Falha ao carregar acessos.');
      if (!silent) console.warn('Teste grátis:', error);
      return [];
    }
  }

  function renderStats() {
    $('#stat-empresas').textContent = fmt.format(empresas.length);
    $('#stat-prompts').textContent = fmt.format(empresas.filter(e => promptFor(e.empresa_id).trim()).length);
    if ($('#stat-trials')) $('#stat-trials').textContent = fmt.format(accessRows.filter(row => row.teste_ativo).length);
  }

  function renderCompanySelectors() {
    ['#crm-company-select','#overview-company-select','#ia-company-select'].forEach(sel => {
      const el = $(sel);
      if (!el) return;
      const current = el.value;
      el.innerHTML = empresas.length
        ? empresas.map(e => `<option value="${escapeHtml(e.empresa_id)}">${escapeHtml(e.empresa_nome)} · #${escapeHtml(e.empresa_id)}</option>`).join('')
        : '<option value="">Nenhuma empresa</option>';
      if ([...el.options].some(o => o.value === current)) el.value = current;
    });
  }

  function companyRow(e) {
    const hasPrompt = Boolean(promptFor(e.empresa_id).trim());
    return `<tr>
      <td><div class="company-name">${escapeHtml(e.empresa_nome)}</div><div class="company-slug">${escapeHtml(e.empresa_slug||'')}</div></td>
      <td class="number">${escapeHtml(e.empresa_id)}</td>
      <td><span class="badge ${String(e.empresa_status).toUpperCase()==='ATIVO'?'on':'off'}">${escapeHtml(e.empresa_status||'')}</span></td>
      <td class="prompt-state"><span class="badge ${hasPrompt?'on':'off'}">${hasPrompt?'Configurado':'Vazio'}</span></td>
      <td><div class="company-actions">
        <button class="btn btn-secondary btn-small" data-action="crm" data-id="${e.empresa_id}">CRM</button>
        <button class="btn btn-primary btn-small" data-action="ia-real" data-id="${e.empresa_id}">IA real</button>
        <button class="btn btn-secondary btn-small" data-action="prompt" data-id="${e.empresa_id}">Prompt</button>
        ${Number(e.empresa_id) === 5 || String(e.empresa_nome || '').toLowerCase().startsWith('av representações')
          ? '<button class="btn btn-secondary btn-small btn-protected" type="button" disabled title="Empresa protegida">Protegida</button>'
          : `<button class="btn btn-danger btn-small" data-action="delete-company" data-id="${e.empresa_id}">Excluir</button>`}
      </div></td>
    </tr>`;
  }

  function renderCompanyLists() {
    const q = ($('#empresa-search')?.value || '').trim().toLowerCase();
    const list = empresas.filter(e => !q || [e.empresa_nome,e.empresa_slug,e.empresa_id].some(v => String(v||'').toLowerCase().includes(q)));
    $('#empresas-body').innerHTML = list.length ? list.map(companyRow).join('') : '<tr><td colspan="5" class="empty">Nenhuma empresa encontrada.</td></tr>';

    $('#overview-companies').innerHTML = empresas.length ? empresas.map(e => `
      <button class="overview-company-card" data-action="ia-real" data-id="${e.empresa_id}">
        <span>${escapeHtml(e.empresa_nome)}</span>
        <small>empresa_id ${escapeHtml(e.empresa_id)} · IA real</small>
      </button>`).join('') : '<div class="empty">Nenhuma empresa encontrada.</div>';
  }

  async function loadCrmData(empresaId, modulo='resumo') {
    if (!empresaId) return null;
    const key = `${empresaId}:${modulo}`;
    if (crmCache.has(key)) return crmCache.get(key);
    $('#crm-module-content').innerHTML = '<div class="panel loading-panel">Consultando PostgreSQL pelo n8n...</div>';
    const data = await api('crm-dados',{empresa_id:Number(empresaId),modulo});
    crmCache.set(key,data);
    return data;
  }

  function updateCrmHeader(data) {
    if (!data?.empresa) return;
    $('#crm-company-title').textContent = data.empresa.nome || 'CRM Jurídico';
    $('#crm-company-meta').textContent = `empresa_id ${data.empresa.id} · slug ${data.empresa.slug||'—'} · status ${data.empresa.status||'—'}`;
    const c = data.contagens || {};
    $('#crm-counts').innerHTML = [['Clientes',c.clientes],['Processos',c.processos],['Documentos',c.documentos],['Agenda',c.agenda],['Notificações',c.notificacoes],['Chunks',c.documento_chunks]]
      .map(([l,v]) => `<div class="mini-stat"><span>${l}</span><strong>${fmt.format(number(v))}</strong></div>`).join('');
  }

  function formatCell(value) {
    if (value===null || value===undefined || value==='') return '—';
    if (typeof value==='boolean') return `<span class="badge ${value?'on':'off'}">${value?'Sim':'Não'}</span>`;
    if (typeof value==='object') return escapeHtml(JSON.stringify(value));
    const s = String(value);
    if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return date(s);
    return escapeHtml(s.length>90 ? s.slice(0,90)+'…' : s);
  }

  function detailList(obj) {
    if (!obj || typeof obj!=='object' || !Object.keys(obj).length) return '<div class="empty">Nenhum dado cadastrado.</div>';
    return `<dl class="detail-list">${Object.entries(obj).map(([k,v])=>`<div><dt>${escapeHtml(k)}</dt><dd>${formatCell(v)}</dd></div>`).join('')}</dl>`;
  }

  function moduleRows(title, rows, columns) {
    if (!Array.isArray(rows) || !rows.length) return '<div class="panel"><div class="empty block-empty">Nenhum registro.</div></div>';
    const head = columns.map(c=>`<th>${escapeHtml(c.label)}</th>`).join('') + '<th></th>';
    const body = rows.map((row,i)=>`<tr>${columns.map(c=>`<td>${formatCell(row[c.key])}</td>`).join('')}<td><button class="btn btn-secondary btn-small" data-detail-index="${i}" data-detail-title="${escapeHtml(title)}">Ver tudo</button></td></tr>`).join('');
    $('#crm-module-content').dataset.rows = JSON.stringify(rows);
    return `<div class="panel"><div class="panel-head"><div><h2>${escapeHtml(title)}</h2><p>${fmt.format(rows.length)} registro(s).</p></div></div><div class="table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div></div>`;
  }

  function renderCrmModule(data, module) {
    updateCrmHeader(data);
    currentCrmModule = module;
    const rows = data[module] || [];
    let html = '';
    if (module==='resumo') {
      html = `<div class="detail-grid">
        <div class="panel"><h2>Empresa</h2>${detailList(data.empresa||{})}</div>
        <div class="panel"><h2>Configuração do CRM</h2>${detailList(data.configuracoes||{})}</div>
        <div class="panel"><h2>Notificações</h2>${detailList(data.notificacoes_config||{})}</div>
      </div>`;
    } else if (module==='configuracoes') {
      html = `<div class="detail-grid"><div class="panel"><h2>Configuração do CRM Jurídico</h2>${detailList(data.configuracoes||{})}</div><div class="panel"><h2>Configuração de notificações</h2>${detailList(data.notificacoes_config||{})}</div></div>`;
    } else if (module==='clientes') {
      html = moduleRows('Clientes',rows,[{key:'id',label:'ID'},{key:'nome',label:'Nome'},{key:'documento',label:'Documento'},{key:'whatsapp',label:'WhatsApp'},{key:'situacao',label:'Situação'},{key:'ia_ativa',label:'IA'},{key:'updated_at',label:'Atualizado'}]);
    } else if (module==='processos') {
      html = moduleRows('Processos',rows,[{key:'id',label:'ID'},{key:'numero_processo',label:'Processo'},{key:'cliente_id',label:'Cliente'},{key:'area_processo',label:'Área'},{key:'status_processo',label:'Status'},{key:'proximo_prazo',label:'Próximo prazo'},{key:'advogado_responsavel',label:'Responsável'}]);
    } else if (module==='documentos') {
      html = moduleRows('Documentos',rows,[{key:'id',label:'ID'},{key:'nome_documento',label:'Documento'},{key:'tipo_documento',label:'Tipo'},{key:'status_documento',label:'Status'},{key:'cliente_id',label:'Cliente'},{key:'processo_id',label:'Processo'},{key:'arquivo_nome',label:'Arquivo'},{key:'updated_at',label:'Atualizado'}]);
    } else if (module==='agenda') {
      html = moduleRows('Agenda / Prazos',rows,[{key:'id',label:'ID'},{key:'tipo_compromisso',label:'Tipo'},{key:'titulo_compromisso',label:'Título'},{key:'data_agenda',label:'Data'},{key:'hora_agenda',label:'Hora'},{key:'status_agenda',label:'Status'},{key:'responsavel_agenda',label:'Responsável'}]);
    } else if (module==='notificacoes') {
      html = moduleRows('Notificações',rows,[{key:'id',label:'ID'},{key:'tipo',label:'Tipo'},{key:'titulo',label:'Título'},{key:'lida',label:'Lida'},{key:'data_evento',label:'Evento'},{key:'created_at',label:'Criada'}]);
    } else if (module==='usuarios') {
      html = moduleRows('Usuários vinculados',rows,[{key:'usuario_id',label:'ID'},{key:'email',label:'E-mail'},{key:'papel',label:'Papel'},{key:'status',label:'Status'},{key:'created_at',label:'Criado'}]);
    }
    $('#crm-module-content').innerHTML = html;
    if (module==='resumo') $('#crm-module-content').dataset.rows = '';
  }

  async function openCrm(companyId, module='resumo') {
    $('#crm-company-select').value = String(companyId);
    showSection('crm-juridico');
    $$('.module-tab').forEach(b=>b.classList.toggle('active',b.dataset.module===module));
    try { renderCrmModule(await loadCrmData(Number(companyId),module),module); }
    catch(error) { $('#crm-module-content').innerHTML=`<div class="panel empty block-empty">${escapeHtml(error.message)}</div>`; toast(error.message,true); }
  }

  async function openOverviewCompany(companyId) {
    $('#overview-company-select').value = String(companyId);
    try {
      const data = await loadCrmData(Number(companyId),'resumo');
      const e = data.empresa || {}, c = data.contagens || {};
      $('#overview-company-details').innerHTML = [
        ['Empresa',e.nome],['ID',e.id],['Status',e.status],['Clientes',c.clientes],['Processos',c.processos],
        ['Documentos',c.documentos],['Agenda',c.agenda],['Notificações',c.notificacoes],['Chunks',c.documento_chunks]
      ].map(([l,v])=>`<div class="detail-card"><span>${escapeHtml(l)}</span><strong>${escapeHtml(v??'—')}</strong></div>`).join('');
    } catch(error) { $('#overview-company-details').innerHTML=`<div class="panel empty block-empty">${escapeHtml(error.message)}</div>`; }
  }

  function renderProviderBilling(provider, data) {
    const p = provider === 'openai' ? 'openai' : 'google';
    const ok = Boolean(data?.ok);
    const status = $(`#${p}-status`);
    status.textContent = ok ? 'Conectado' : (data?.configured === false ? 'Não configurado' : 'Indisponível');
    status.classList.toggle('on',ok);
    status.classList.toggle('off',!ok);
    $(`#${p}-spent`).textContent = money(data?.spent,data?.currency);
    $(`#${p}-updated`).textContent = data?.updated_at ? date(data.updated_at) : '—';
    $(`#${p}-message`).textContent = data?.message || (ok ? 'Dados reais consultados.' : 'Não configurado para esta empresa.');
    $(`#${p}-account-label`).textContent = data?.account_label || (p==='openai' ? 'Conta real da empresa' : 'Projeto real da empresa');
  }

  async function loadProviderBilling(companyId) {
    if (!companyId) return;
    renderProviderBilling('openai',{ok:false,configured:false,message:'Consultando...'});
    renderProviderBilling('google',{ok:false,configured:false,message:'Consultando...'});
    try {
      const response = await fetch(`/api/billing/summary?empresa_id=${encodeURIComponent(companyId)}`, {
        headers:{'Accept':'application/json','Authorization':`Bearer ${session.access_token}`},
        cache:'no-store'
      });
      const raw = await response.text();
      let data;
      try { data = JSON.parse(raw); } catch { throw new Error(`Resposta inválida do financeiro (${response.status}).`); }
      if (!response.ok && !data?.providers) throw new Error(data?.message || `HTTP ${response.status}`);
      renderProviderBilling('openai',data?.providers?.openai || {ok:false,configured:false,message:'OpenAI não configurada para esta empresa.'});
      renderProviderBilling('google',data?.providers?.google || {ok:false,configured:false,message:'Google não configurado para esta empresa.'});
    } catch(error) {
      renderProviderBilling('openai',{ok:false,message:error.message});
      renderProviderBilling('google',{ok:false,message:error.message});
      toast(error.message,true);
    }
  }

  async function openIaCompany(companyId) {
    const company = empresas.find(e => String(e.empresa_id) === String(companyId));
    if (!company) return;
    $('#ia-company-select').value = String(companyId);
    $('#prompt-company-meta').textContent = `${company.empresa_nome} · empresa_id ${company.empresa_id}`;
    $('#prompt-gemini').value = promptFor(companyId);
    $('#google-connect-link').href = `/api/google/oauth/start?empresa_id=${encodeURIComponent(companyId)}`;
    showSection('ia-empresa');
    await loadProviderBilling(companyId);
  }

  async function openPromptCompany(companyId) {
    await openIaCompany(companyId);
    const editor = $('#prompt-gemini');
    if (editor) {
      editor.scrollIntoView({behavior:'smooth', block:'center'});
      setTimeout(() => editor.focus(), 250);
    }
  }

  async function savePrompt(event) {
    event.preventDefault();
    const empresa_id = Number($('#ia-company-select').value);
    const prompt_sistema = $('#prompt-gemini').value.trim();
    if (!empresa_id) { toast('Selecione uma empresa.',true); return; }
    const button = $('#prompt-save-btn');
    button.disabled = true;
    try {
      await iaApi('configuracao',{empresa_id,provedor:'GEMINI',prompt_sistema});
      const existing = promptRows.find(r => String(r.empresa_id)===String(empresa_id));
      if (existing) existing.prompt_sistema = prompt_sistema;
      else promptRows.push({empresa_id,provedor:'GEMINI',prompt_sistema});
      renderStats();
      renderCompanyLists();
      toast('Prompt do Gemini salvo para esta empresa.');
    } catch(error) { toast(error.message,true); }
    finally { button.disabled = false; }
  }


  function findAccessCompany(companyId) {
    return accessRows.find(row => String(row.empresa_id) === String(companyId));
  }

  function syncTrialQuickButtons(days) {
    selectedTrialDays = Number(days || 0);
    $$('[data-trial-days]').forEach(button => button.classList.toggle('active', Number(button.dataset.trialDays) === selectedTrialDays));
  }

  function openTrialDialog(companyId) {
    const row = findAccessCompany(companyId);
    if (!row) { toast('Conta SaaS não encontrada.', true); return; }
    trialTarget = row;
    selectedTrialDays = 7;
    $('#trial-company-name').textContent = row.nome_fantasia || row.empresa_nome || 'Empresa';
    $('#trial-company-email').textContent = row.usuario_email || 'Sem e-mail vinculado';
    $('#trial-company-id').textContent = `empresa_id ${row.empresa_id}`;
    $('#trial-end-date').value = row.teste_ativo && row.teste_gratis_ate ? String(row.teste_gratis_ate).slice(0,10) : addDaysIso(7);
    $('#trial-current-status').textContent = row.teste_ativo
      ? `Teste ativo até ${dateOnly(row.teste_gratis_ate)} · ${Math.max(0,number(row.dias_restantes))} dia(s) restante(s).`
      : (row.teste_gratis_ate ? `O último teste terminou em ${dateOnly(row.teste_gratis_ate)}.` : 'Sem teste ativo.');
    $('#trial-end-now').disabled = !row.teste_ativo && !row.teste_gratis_ate;
    syncTrialQuickButtons(7);
    $('#trial-dialog').showModal();
  }

  function closeTrialDialog() {
    if ($('#trial-dialog')?.open) $('#trial-dialog').close();
    trialTarget = null;
    selectedTrialDays = 7;
  }

  async function applyTrial(event) {
    event.preventDefault();
    if (!trialTarget) { toast('Selecione uma empresa.', true); return; }
    const endDate = $('#trial-end-date').value;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate)) { toast('Escolha uma data final válida.', true); return; }
    const button = $('#trial-save');
    button.disabled = true;
    const previous = button.textContent;
    button.textContent = 'Liberando...';
    try {
      await api('teste-gratis',{acao:'definir',empresa_id:trialTarget.empresa_id,data_fim:endDate});
      await loadTrialAccess({silent:true});
      closeTrialDialog();
      toast(`Teste grátis liberado até ${dateOnly(endDate)}.`);
    } catch(error) {
      toast(error.message || 'Não foi possível liberar o teste.', true);
    } finally {
      button.disabled = false;
      button.textContent = previous;
    }
  }

  async function endTrialById(companyId, {closeDialog=false}={}) {
    const row = findAccessCompany(companyId);
    if (!row) { toast('Conta SaaS não encontrada.', true); return; }
    try {
      await api('teste-gratis',{acao:'encerrar',empresa_id:row.empresa_id});
      await loadTrialAccess({silent:true});
      if (closeDialog) closeTrialDialog();
      toast(`Teste grátis encerrado para ${row.nome_fantasia || row.empresa_nome || row.empresa_id}.`);
    } catch(error) {
      toast(error.message || 'Não foi possível encerrar o teste.', true);
    }
  }

  function isProtectedSaasCompany(company) {
    if (!company) return false;
    const name = String(company.nome_fantasia || company.empresa_nome || '').trim().toLowerCase();
    const email = String(company.usuario_email || '').trim().toLowerCase();
    return email === ALLOWED_ADMIN_EMAIL || name.startsWith('av representações') || name.startsWith('av representacoes');
  }

  function openDeleteSaasCompany(companyId) {
    const company = accessRows.find(row => String(row.empresa_id) === String(companyId));
    if (!company) { toast('Empresa SaaS não encontrada.', true); return; }
    if (isProtectedSaasCompany(company)) { toast('A AV Representações está protegida contra exclusão.', true); return; }
    deleteSaasCompanyTarget = company;
    $('#delete-saas-company-name').textContent = company.nome_fantasia || company.empresa_nome || '—';
    $('#delete-saas-company-email').textContent = company.usuario_email || 'Sem e-mail vinculado';
    $('#delete-saas-company-id').textContent = `empresa_id ${company.empresa_id}`;
    $('#delete-saas-company-confirmation').value = '';
    $('#delete-saas-company-submit').disabled = true;
    $('#delete-saas-company-dialog').showModal();
    setTimeout(() => $('#delete-saas-company-confirmation').focus(), 100);
  }

  function closeDeleteSaasCompany() {
    if ($('#delete-saas-company-dialog')?.open) $('#delete-saas-company-dialog').close();
    deleteSaasCompanyTarget = null;
    if ($('#delete-saas-company-confirmation')) $('#delete-saas-company-confirmation').value = '';
    if ($('#delete-saas-company-submit')) $('#delete-saas-company-submit').disabled = true;
  }

  async function deleteSaasCompany(event) {
    event.preventDefault();
    const company = deleteSaasCompanyTarget;
    if (!company || isProtectedSaasCompany(company)) { toast('Empresa protegida ou inválida.', true); return; }
    const expected = String(company.nome_fantasia || company.empresa_nome || '').trim();
    const typed = $('#delete-saas-company-confirmation').value.trim();
    if (typed !== expected) { toast('Digite exatamente o nome da empresa para confirmar.', true); return; }
    const button = $('#delete-saas-company-submit');
    const previous = button.textContent;
    button.disabled = true;
    button.textContent = 'Excluindo...';
    try {
      const result = await api('empresa-saas/excluir', {
        empresa_id: String(company.empresa_id || '').trim(),
        confirmacao: typed
      });
      if (result?.ok === false) throw new Error(result?.mensagem || result?.erro || 'Não foi possível excluir a empresa.');
      closeDeleteSaasCompany();
      crmCache.clear();
      await Promise.allSettled([
        loadTrialAccess({silent:true}),
        loadEmpresas(),
        loadPrompts(),
        loadContracts({silent:true}),
        loadAsaasSubscriptions({silent:true})
      ]);
      toast(result?.mensagem || `${expected} excluída permanentemente.`);
    } catch(error) {
      toast(error.message || 'Falha ao excluir empresa SaaS.', true);
    } finally {
      button.textContent = previous;
      button.disabled = false;
    }
  }

  function isProtectedCompany(company) {
    if (!company) return false;
    return Number(company.empresa_id) === 5 || String(company.empresa_nome || '').trim().toLowerCase().startsWith('av representações');
  }

  function openDeleteCompany(companyId) {
    const company = empresas.find(e => String(e.empresa_id) === String(companyId));
    if (!company) { toast('Empresa não encontrada.', true); return; }
    if (isProtectedCompany(company)) { toast('A AV Representações está protegida contra exclusão.', true); return; }
    deleteCompanyTarget = company;
    $('#delete-company-name').textContent = company.empresa_nome || '—';
    $('#delete-company-id').textContent = `empresa_id ${company.empresa_id}`;
    $('#delete-company-confirmation').value = '';
    $('#delete-company-submit').disabled = true;
    $('#delete-company-dialog').showModal();
    setTimeout(() => $('#delete-company-confirmation').focus(), 100);
  }

  function closeDeleteCompany() {
    if ($('#delete-company-dialog').open) $('#delete-company-dialog').close();
    deleteCompanyTarget = null;
    $('#delete-company-confirmation').value = '';
    $('#delete-company-submit').disabled = true;
  }

  async function deleteCompany(event) {
    event.preventDefault();
    const company = deleteCompanyTarget;
    if (!company || isProtectedCompany(company)) { toast('Empresa protegida ou inválida.', true); return; }
    const typed = $('#delete-company-confirmation').value.trim();
    if (typed !== String(company.empresa_nome || '').trim()) {
      toast('Digite exatamente o nome da empresa para confirmar.', true);
      return;
    }
    const button = $('#delete-company-submit');
    button.disabled = true;
    button.textContent = 'Excluindo...';
    try {
      const result = await api('empresa/excluir', {
        empresa_id: Number(company.empresa_id),
        confirmacao: typed
      });
      if (result?.ok === false) throw new Error(result?.mensagem || result?.erro || 'Não foi possível excluir a empresa.');
      closeDeleteCompany();
      crmCache.clear();
      promptRows = promptRows.filter(r => String(r.empresa_id) !== String(company.empresa_id));
      await Promise.allSettled([loadEmpresas(),loadPrompts(),loadTrialAccess({silent:true}),loadContracts({silent:true})]);
      if (empresas.length) {
        await openOverviewCompany(empresas[0].empresa_id);
        $('#ia-company-select').value = String(empresas[0].empresa_id);
      } else {
        $('#overview-company-details').innerHTML = '<div class="empty">Nenhuma empresa cadastrada.</div>';
      }
      const deleted = Number(result?.registros_excluidos || 0);
      toast(`${company.empresa_nome} excluída permanentemente${deleted ? ` · ${deleted} registro(s) removido(s)` : ''}.`);
    } catch(error) {
      toast(error.message || 'Falha ao excluir empresa.', true);
    } finally {
      button.textContent = 'Excluir permanentemente';
      button.disabled = false;
    }
  }

  function showSection(name) {
    $$('.section').forEach(s=>s.classList.toggle('active',s.id===name));
    $$('.nav-link').forEach(l=>l.classList.toggle('active',l.dataset.section===name));
    const titles = {'visao-geral':'Visão geral','empresas':'Empresas','contratos':'Contratos & Planos','crm-juridico':'CRM Jurídico','ia-empresa':'IA por Empresa'};
    $('#page-title').textContent = titles[name] || 'Admin SaaS';
    if (window.innerWidth<900) $('#sidebar').classList.remove('open');
  }

  function bindEvents() {
    $('#login-form').addEventListener('submit',login);
    $('#refresh-btn').addEventListener('click',async()=>{
      const button = $('#refresh-btn');
      const previous = button.textContent;
      button.disabled = true;
      button.textContent = 'Atualizando...';
      try {
        crmCache.clear();
        const results = await Promise.allSettled([loadEmpresas(),loadPrompts(),loadTrialAccess({silent:true}),loadContracts({silent:true}),loadAsaasSubscriptions({silent:true})]);
        const coreError = results[0].status === 'rejected' ? results[0].reason : null;
        if (coreError) throw coreError;
        const current = $('#ia-company-select').value;
        if ($('#ia-empresa').classList.contains('active') && current) await openIaCompany(current);
        if ($('#visao-geral').classList.contains('active') && $('#overview-company-select').value) {
          await openOverviewCompany($('#overview-company-select').value);
        }
        toast('Dados atualizados.');
      } catch(e) { toast(e.message,true); }
      finally { button.disabled = false; button.textContent = previous; }
    });
    $('#empresa-search').addEventListener('input',renderCompanyLists);
    $('#access-refresh-btn').addEventListener('click',async e=>{
      const button = e.currentTarget;
      const previous = button.textContent;
      button.disabled = true;
      button.textContent = 'Atualizando...';
      await loadTrialAccess();
      button.disabled = false;
      button.textContent = previous;
    });
    $('#contracts-refresh-btn').addEventListener('click',async e=>{
      const button = e.currentTarget;
      const previous = button.textContent;
      button.disabled = true;
      button.textContent = 'Atualizando...';
      await loadContracts();
      button.disabled = false;
      button.textContent = previous;
    });
    $('#contract-search').addEventListener('input',renderContractsTable);
    $('#asaas-subscription-search').addEventListener('input',renderAsaasSubscriptions);
    $('#asaas-refresh-btn').addEventListener('click',async e=>{
      const button=e.currentTarget; const previous=button.textContent; button.disabled=true; button.textContent='Consultando...';
      await loadAsaasSubscriptions(); button.disabled=false; button.textContent=previous;
    });
    $('#contract-form').addEventListener('submit',importAsaasContract);
    $('#contract-cancel-close').addEventListener('click',closeContractCancel);
    $('#contract-cancel-back').addEventListener('click',closeContractCancel);
    $('#contract-cancel-confirm').addEventListener('click',confirmContractCancel);
    $('#crm-company-select').addEventListener('change',e=>openCrm(e.target.value,currentCrmModule));
    $('#overview-company-select').addEventListener('change',e=>openOverviewCompany(e.target.value));
    $('#ia-company-select').addEventListener('change',e=>openIaCompany(e.target.value));
    $('#prompt-form').addEventListener('submit',savePrompt);
    $('#crm-module-tabs').addEventListener('click',e=>{
      const b=e.target.closest('.module-tab');
      if(b) openCrm($('#crm-company-select').value,b.dataset.module);
    });

    document.body.addEventListener('click',e=>{
      const go=e.target.closest('[data-go]');
      if(go){ showSection(go.dataset.go); return; }
      const b=e.target.closest('[data-action]');
      if(b){
        if(b.dataset.action==='crm') openCrm(b.dataset.id);
        if(b.dataset.action==='ia-real') openIaCompany(b.dataset.id);
        if(b.dataset.action==='prompt') openPromptCompany(b.dataset.id);
        if(b.dataset.action==='trial') openTrialDialog(b.dataset.id);
        if(b.dataset.action==='trial-end') endTrialById(b.dataset.id);
        if(b.dataset.action==='delete-company') openDeleteCompany(b.dataset.id);
        if(b.dataset.action==='delete-saas-company') openDeleteSaasCompany(b.dataset.id);
        return;
      }
      const asaasAction=e.target.closest('[data-asaas-action]');
      if(asaasAction){
        if(asaasAction.dataset.asaasAction==='select') selectAsaasSubscription(asaasAction.dataset.asaasId);
        return;
      }
      const contractAction=e.target.closest('[data-contract-action]');
      if(contractAction){
        if(contractAction.dataset.contractAction==='cancel') openContractCancel(contractAction.dataset.contractId);
        return;
      }
      const detail=e.target.closest('[data-detail-index]');
      if(detail){
        const rows=JSON.parse($('#crm-module-content').dataset.rows||'[]');
        const row=rows[Number(detail.dataset.detailIndex)];
        if(row){ $('#detail-title').textContent=detail.dataset.detailTitle||'Detalhes'; $('#detail-json').textContent=JSON.stringify(row,null,2); $('#detail-dialog').showModal(); }
      }
    });

    $('#detail-close').addEventListener('click',()=>$('#detail-dialog').close());
    $('#trial-close').addEventListener('click', closeTrialDialog);
    $('#trial-cancel').addEventListener('click', closeTrialDialog);
    $('#trial-form').addEventListener('submit', applyTrial);
    $('#trial-end-now').addEventListener('click', async()=>{
      if (!trialTarget) return;
      const button = $('#trial-end-now');
      const previous = button.textContent;
      button.disabled = true;
      button.textContent = 'Encerrando...';
      await endTrialById(trialTarget.empresa_id,{closeDialog:true});
      button.disabled = false;
      button.textContent = previous;
    });
    $$('[data-trial-days]').forEach(button => button.addEventListener('click',()=>{
      const days = Number(button.dataset.trialDays);
      syncTrialQuickButtons(days);
      $('#trial-end-date').value = addDaysIso(days);
    }));
    $('#trial-end-date').addEventListener('input',()=>syncTrialQuickButtons(0));
    $('#delete-company-close').addEventListener('click', closeDeleteCompany);
    $('#delete-company-cancel').addEventListener('click', closeDeleteCompany);
    $('#delete-company-form').addEventListener('submit', deleteCompany);
    $('#delete-company-confirmation').addEventListener('input', e => {
      const expected = String(deleteCompanyTarget?.empresa_nome || '').trim();
      $('#delete-company-submit').disabled = e.target.value.trim() !== expected;
    });
    $('#delete-saas-company-close').addEventListener('click', closeDeleteSaasCompany);
    $('#delete-saas-company-cancel').addEventListener('click', closeDeleteSaasCompany);
    $('#delete-saas-company-form').addEventListener('submit', deleteSaasCompany);
    $('#delete-saas-company-confirmation').addEventListener('input', e => {
      const expected = String(deleteSaasCompanyTarget?.nome_fantasia || deleteSaasCompanyTarget?.empresa_nome || '').trim();
      $('#delete-saas-company-submit').disabled = e.target.value.trim() !== expected;
    });
    $$('.nav-link').forEach(link=>link.addEventListener('click',e=>{
      e.preventDefault();
      const section=link.dataset.section;
      showSection(section);
      history.replaceState(null,'','#'+section);
      if(section==='ia-empresa' && $('#ia-company-select').value) openIaCompany($('#ia-company-select').value);
      if(section==='contratos'){
        if (!(contractData.contratos || []).length) loadContracts();
        if (!(contractData.assinaturasAsaas || []).length) loadAsaasSubscriptions();
      }
    }));
    $('#logout-btn').addEventListener('click',async()=>{ await supabase.auth.signOut(); session=null; crmCache.clear(); showAuth(true); toast('Sessão encerrada.'); });
    $('#menu-btn').addEventListener('click',()=>$('#sidebar').classList.toggle('open'));
  }

  async function syncCompaniesSilently() {
    if (!session) return;
    try {
      const before = new Set(empresas.map(e => String(e.empresa_id)));
      const data = await api('empresas',{});
      const next = Array.isArray(data.empresas) ? data.empresas : [];
      const added = next.filter(e => !before.has(String(e.empresa_id)));
      empresas = next;
      renderCompanySelectors();
      renderCompanyLists();
      renderStats();
      if (added.length) {
        await loadPrompts();
        toast(`${added.length} nova empresa adicionada automaticamente à IA por Empresa.`);
      }
    } catch (error) {
      console.warn('Sincronização automática de empresas:', error);
    }
  }

  async function bootData() {
    const results = await Promise.allSettled([loadEmpresas(),loadPrompts(),loadTrialAccess({silent:true}),loadContracts({silent:true}),loadAsaasSubscriptions({silent:true})]);
    if (results[0].status === 'rejected') throw results[0].reason;

    const initial=location.hash.replace('#','');
    if(initial && $('#'+initial)) showSection(initial);

    if(empresas.length){
      const firstId = empresas[0].empresa_id;
      $('#ia-company-select').value = String(firstId);
      $('#prompt-company-meta').textContent = `${empresas[0].empresa_nome} · empresa_id ${firstId}`;
      $('#prompt-gemini').value = promptFor(firstId);
      $('#google-connect-link').href = `/api/google/oauth/start?empresa_id=${encodeURIComponent(firstId)}`;

      if(initial==='ia-empresa') {
        await openIaCompany($('#ia-company-select').value);
      } else {
        $('#overview-company-details').innerHTML = '<div class="detail-card skeleton-card"><span class="skeleton skeleton-line"></span><strong class="skeleton skeleton-line wide"></strong></div>';
        const runOverview = () => openOverviewCompany($('#overview-company-select').value || firstId);
        if ('requestIdleCallback' in window) requestIdleCallback(runOverview,{timeout:700});
        else setTimeout(runOverview,60);
      }
    }
  }

  async function init() {
    bindEvents();
    window.addEventListener('focus', syncCompaniesSilently);
    setInterval(syncCompaniesSilently, 60000);
    try { if(await getSession()) await bootData(); }
    catch(error){ showAuth(true); toast(error.message,true); }
  }

  supabase.auth.onAuthStateChange(async (_event,newSession)=>{
    if(!newSession){ session=null; showAuth(true); return; }
    if(String(newSession.user?.email||'').toLowerCase()!==ALLOWED_ADMIN_EMAIL){ await supabase.auth.signOut(); return; }
    session=newSession; $('#admin-email').textContent=newSession.user.email; showAuth(false);
  });

  init();
})();

(() => {
  'use strict';

  const SUPABASE_URL = 'https://eancpttjrcetmpyqwanw.supabase.co';
  const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_vaPoYvu7bfg7okcczhyetA_L4-dKvZD';
  const N8N_BASE = 'https://possessivebull-n8n.cloudfy.live/webhook/crm-juridico/admin';
  const IA_ADMIN_BASE = 'https://possessivebull-n8n.cloudfy.live/webhook/crm-juridico/ia-admin';
  const ALLOWED_ADMIN_EMAIL = 'avrep.tech@gmail.com';

  const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];

  let session = null;
  let empresas = [];
  let iaRows = [];
  let crmCache = new Map();
  let toastTimer = null;
  let currentCrmModule = 'resumo';

  const fmt = new Intl.NumberFormat('pt-BR');
  const dateFmt = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

  function toast(message, error = false) {
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
    return Number.isNaN(d.getTime()) ? escapeHtml(value) : dateFmt.format(d);
  }

  function showAuth(show = true) {
    $('#auth-screen').classList.toggle('hidden', !show);
    $('#app').classList.toggle('hidden', show);
  }

  async function getSession() {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    session = data.session;
    if (!session) {
      showAuth(true);
      return false;
    }
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
    if (email !== ALLOWED_ADMIN_EMAIL) {
      toast('Use somente avrep.tech@gmail.com.', true);
      return;
    }
    button.disabled = true;
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      session = data.session;
      if (!session || String(session.user?.email || '').toLowerCase() !== ALLOWED_ADMIN_EMAIL) {
        await supabase.auth.signOut();
        throw new Error('Conta não autorizada.');
      }
      $('#login-password').value = '';
      showAuth(false);
      await bootData();
      toast('Login realizado.');
    } catch (error) {
      toast(error.message || 'Não foi possível entrar.', true);
    } finally {
      button.disabled = false;
    }
  }

  async function api(path, payload = {}) {
    if (!session) throw new Error('Sessão expirada.');
    const response = await fetch(`${N8N_BASE}/${path}`, {
      method: 'POST',
      headers: {'Content-Type':'application/json','Accept':'application/json'},
      body: JSON.stringify({...payload, access_token: session.access_token}),
      cache: 'no-store'
    });
    const raw = await response.text();
    let data;
    try { data = JSON.parse(raw); } catch { throw new Error(`Resposta inválida do n8n (${response.status}).`); }
    if (!response.ok) throw new Error(data?.erro || data?.message || `HTTP ${response.status}`);
    if (data?.ok === false) throw new Error(data.erro || 'Operação não autorizada.');
    return data;
  }

  async function iaApi(path, payload = {}) {
    if (!session) throw new Error('Sessão expirada.');
    const response = await fetch(`${IA_ADMIN_BASE}/${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': `Bearer ${session.access_token}`
      },
      body: JSON.stringify({...payload, access_token: session.access_token}),
      cache: 'no-store'
    });
    const raw = await response.text();
    let data;
    try { data = JSON.parse(raw); } catch { throw new Error(`Resposta inválida do IA Admin (${response.status}).`); }
    if (!response.ok) throw new Error(data?.erro || data?.message || `HTTP ${response.status}`);
    if (data?.ok === false) throw new Error(data.erro || data.message || 'Operação não autorizada.');
    return data;
  }

  function brl(value) {
    return new Intl.NumberFormat('pt-BR', {style:'currency', currency:'BRL'}).format(number(value));
  }

  function firstItem(data) {
    if (Array.isArray(data)) return data[0] || {};
    return data && typeof data === 'object' ? data : {};
  }

  function normalizeIaRows(data) {
    const out = [];
    const push = (row, parent = {}) => {
      if (!row || typeof row !== 'object') return;
      const merged = {...parent, ...row};
      const empresaId = merged.empresa_id ?? merged.id_empresa ?? merged.empresa?.id;
      const provedor = String(merged.provedor || merged.provider || '').toUpperCase();
      if (empresaId && provedor) out.push({...merged, empresa_id:Number(empresaId), provedor});
    };
    const scan = (value, parent = {}) => {
      if (!value) return;
      if (Array.isArray(value)) { value.forEach(v => scan(v, parent)); return; }
      if (typeof value !== 'object') return;
      const empresaId = value.empresa_id ?? value.id_empresa ?? value.empresa?.id;
      const base = empresaId ? {...parent, ...value} : parent;
      if (empresaId && (value.provedor || value.provider)) push(value, parent);
      ['provedores','providers','ias','configuracoes'].forEach(k => {
        if (Array.isArray(value[k])) value[k].forEach(v => push(v, base));
      });
      if (value.gemini && typeof value.gemini === 'object') push({...value.gemini, provedor:'GEMINI'}, base);
      if (value.openai && typeof value.openai === 'object') push({...value.openai, provedor:'OPENAI'}, base);
      ['dados','data','empresas','resultados','rows'].forEach(k => {
        if (value[k] && value[k] !== value) scan(value[k], base);
      });
    };
    scan(data);
    const unique = new Map();
    for (const row of out) unique.set(`${row.empresa_id}:${row.provedor}`, row);
    return [...unique.values()].sort((a,b) => Number(a.empresa_id)-Number(b.empresa_id) || String(a.provedor).localeCompare(String(b.provedor)));
  }

  function iaCompanyName(row) {
    const local = selectedEmpresa(row.empresa_id);
    return row.empresa_nome || row.nome_empresa || row.empresa?.nome || local?.empresa_nome || `Empresa #${row.empresa_id}`;
  }

  function iaField(row, ...keys) {
    for (const key of keys) if (row?.[key] !== undefined && row?.[key] !== null) return row[key];
    return null;
  }

  function iaRowHtml(row) {
    const saldo = number(iaField(row,'saldo','saldo_atual'));
    const creditado = number(iaField(row,'total_creditado','creditado'));
    const consumido = number(iaField(row,'total_consumido','consumido'));
    const prompt = String(iaField(row,'prompt_sistema','prompt') || '').trim();
    const agente = Boolean(iaField(row,'agente_ativo'));
    const saldoAtivo = Boolean(iaField(row,'saldo_ativo'));
    const liberado = Boolean(iaField(row,'uso_liberado'));
    return `<tr>
      <td><div class="company-name">${escapeHtml(iaCompanyName(row))}</div></td>
      <td class="number">${escapeHtml(row.empresa_id)}</td>
      <td><span class="provider-chip ${row.provedor==='GEMINI'?'gemini':'openai'}">${escapeHtml(row.provedor)}</span></td>
      <td class="number"><strong>${brl(saldo)}</strong></td>
      <td class="number">${brl(creditado)}</td>
      <td class="number">${brl(consumido)}</td>
      <td><span class="badge ${prompt?'on':'off'}">${prompt?'Configurado':'Vazio'}</span></td>
      <td><span class="badge ${agente&&liberado?'on':'off'}">${agente ? (saldoAtivo ? (liberado?'Ativo':'Bloqueado') : 'Ativo') : 'Inativo'}</span></td>
      <td><div class="actions money-actions">
        <button class="btn btn-primary btn-small" data-ia-action="add" data-id="${row.empresa_id}" data-provider="${row.provedor}">Adicionar</button>
        <button class="btn btn-danger btn-small" data-ia-action="remove" data-id="${row.empresa_id}" data-provider="${row.provedor}">Retirar</button>
        <button class="btn btn-secondary btn-small" data-ia-action="define" data-id="${row.empresa_id}" data-provider="${row.provedor}">Definir</button>
        <button class="btn btn-secondary btn-small" data-ia-action="agent" data-id="${row.empresa_id}" data-provider="${row.provedor}">Configurar IA</button>
        <button class="btn btn-secondary btn-small" data-ia-action="history" data-id="${row.empresa_id}" data-provider="${row.provedor}">Histórico</button>
      </div></td>
    </tr>`;
  }

  function renderIaStats() {
    const ids = new Set(iaRows.map(r => Number(r.empresa_id)).filter(Boolean));
    const saldo = iaRows.reduce((s,r)=>s+number(iaField(r,'saldo','saldo_atual')),0);
    const creditado = iaRows.reduce((s,r)=>s+number(iaField(r,'total_creditado','creditado')),0);
    const consumido = iaRows.reduce((s,r)=>s+number(iaField(r,'total_consumido','consumido')),0);
    $('#credit-stat-empresas').textContent = fmt.format(ids.size || empresas.length);
    $('#credit-stat-saldo-money').textContent = brl(saldo);
    $('#credit-stat-creditado').textContent = brl(creditado);
    $('#credit-stat-consumido-money').textContent = brl(consumido);
    $('#stat-saldo').textContent = brl(saldo);
    $('#stat-consumidos').textContent = brl(consumido);
    $('#stat-agentes').textContent = fmt.format(iaRows.filter(r => Boolean(iaField(r,'agente_ativo'))).length);
    renderCompanyLists();
  }

  async function loadIaAdminData() {
    $('#creditos-body').innerHTML = '<tr><td colspan="9" class="empty">Carregando saldos em reais...</td></tr>';
    try {
      const data = await iaApi('listar', {});
      iaRows = normalizeIaRows(data);
      renderCreditTable();
      renderIaStats();
    } catch (error) {
      iaRows = [];
      $('#creditos-body').innerHTML = `<tr><td colspan="9" class="empty">${escapeHtml(error.message)}</td></tr>`;
      renderIaStats();
      throw error;
    }
  }

  async function loadEmpresas() {
    $('#empresas-body').innerHTML = '<tr><td colspan="8" class="empty">Carregando...</td></tr>';
    const data = await api('empresas', {});
    empresas = Array.isArray(data.empresas) ? data.empresas : [];
    renderCompanySelectors();
    renderCompanyLists();
    renderStats();
    renderEmpresaFilter();
    renderCreditTable();
  }

  function renderStats() {
    const saldo = empresas.reduce((sum, e) => sum + number(e.saldo_tokens), 0);
    const consumidos = empresas.reduce((sum, e) => sum + number(e.tokens_consumidos), 0);
    const agentes = empresas.filter(e => Boolean(e.agente_ativo) && Boolean(e.credito_ativo)).length;
    $('#stat-empresas').textContent = fmt.format(empresas.length);
    $('#stat-saldo').textContent = fmt.format(saldo);
    $('#stat-consumidos').textContent = fmt.format(consumidos);
    $('#stat-agentes').textContent = fmt.format(agentes);
    $('#credit-stat-empresas').textContent = fmt.format(empresas.length);
  }

  function renderCompanySelectors() {
    const selectors = ['#crm-company-select','#overview-company-select'];
    selectors.forEach(sel => {
      const el = $(sel);
      if (!el) return;
      const current = el.value;
      el.innerHTML = empresas.length
        ? empresas.map(e => `<option value="${escapeHtml(e.empresa_id)}">${escapeHtml(e.empresa_nome)} · #${escapeHtml(e.empresa_id)}</option>`).join('')
        : '<option value="">Nenhuma empresa</option>';
      if ([...el.options].some(o => o.value === current)) el.value = current;
    });
  }

  function renderEmpresaFilter() {
    const select = $('#historico-filtro');
    const current = select.value;
    select.innerHTML = '<option value="0">Todas as empresas</option>' + empresas.map(e => `<option value="${escapeHtml(e.empresa_id)}">${escapeHtml(e.empresa_nome)}</option>`).join('');
    if ([...select.options].some(o => o.value === current)) select.value = current;
  }

  function renderCompanyLists() {
    const q = ($('#empresa-search')?.value || '').trim().toLowerCase();
    const list = empresas.filter(e => !q || [e.empresa_nome,e.empresa_slug,e.empresa_id].some(v => String(v||'').toLowerCase().includes(q)));
    const html = list.length ? list.map(companyRow).join('') : '<tr><td colspan="8" class="empty">Nenhuma empresa encontrada.</td></tr>';
    $('#empresas-body').innerHTML = html;
  }

  function companyRow(e) {
    const configs = iaRows.filter(r => String(r.empresa_id) === String(e.empresa_id));
    const saldo = configs.reduce((s,r)=>s+number(iaField(r,'saldo','saldo_atual')),0);
    const consumido = configs.reduce((s,r)=>s+number(iaField(r,'total_consumido','consumido')),0);
    const credito = configs.some(r => Boolean(iaField(r,'saldo_ativo')));
    const agente = configs.some(r => Boolean(iaField(r,'agente_ativo')));
    return `<tr>
      <td><div class="company-name">${escapeHtml(e.empresa_nome)}</div><div class="company-slug">${escapeHtml(e.empresa_slug||'')}</div></td>
      <td class="number">${escapeHtml(e.empresa_id)}</td>
      <td><span class="badge ${String(e.empresa_status).toUpperCase()==='ATIVO'?'on':'off'}">${escapeHtml(e.empresa_status||'')}</span></td>
      <td class="number"><strong>${configs.length?brl(saldo):'—'}</strong></td>
      <td class="number">${configs.length?brl(consumido):'—'}</td>
      <td><span class="badge ${credito?'on':'off'}">${credito?'Ativo':'Inativo'}</span></td>
      <td><span class="badge ${agente?'on':'off'}">${agente?'Ativo':'Inativo'}</span></td>
      <td><div class="actions">
        <button class="btn btn-secondary btn-small" data-action="crm" data-id="${e.empresa_id}">CRM</button>
        <button class="btn btn-primary btn-small" data-go="creditos">Gerenciar IA</button>
      </div></td>
    </tr>`;
  }

  function renderCreditTable() {
    $('#creditos-body').innerHTML = iaRows.length ? iaRows.map(iaRowHtml).join('') : '<tr><td colspan="9" class="empty">Nenhuma configuração monetária de IA encontrada.</td></tr>';
  }

  function selectedEmpresa(id) { return empresas.find(e => String(e.empresa_id) === String(id)); }
  function selectedIaRow(id, provider) { return iaRows.find(r => String(r.empresa_id) === String(id) && String(r.provedor).toUpperCase() === String(provider).toUpperCase()); }

  function openCreditDialog(id, provider, operation) {
    const row = selectedIaRow(id, provider); if (!row) return;
    const empresa = iaCompanyName(row);
    $('#form-empresa-id').value = id;
    $('#form-operation').value = operation;
    $('#form-provedor').value = row.provedor;
    $('#form-provedor-view').value = row.provedor;
    $('#form-saldo-atual').value = number(iaField(row,'saldo','saldo_atual'));
    $('#form-valor').value = '';
    $('#form-observacao').value = operation === 'add' ? 'Recarga administrativa em reais' : 'Retirada administrativa em reais';
    $('#dialog-title').textContent = operation === 'add' ? 'Adicionar saldo' : 'Retirar saldo';
    $('#dialog-company').textContent = `${empresa} · empresa_id ${row.empresa_id}`;
    $('#dialog-submit').textContent = operation === 'add' ? 'Adicionar saldo' : 'Retirar saldo';
    $('#credit-dialog').showModal();
  }

  function openDefineDialog(id, provider) {
    const row = selectedIaRow(id, provider); if (!row) return;
    const atual = number(iaField(row,'saldo','saldo_atual'));
    $('#define-empresa-id').value = id;
    $('#define-provedor').value = row.provedor;
    $('#define-provedor-view').value = row.provedor;
    $('#define-saldo-atual').value = atual;
    $('#define-saldo').value = atual.toFixed(2);
    $('#define-observacao').value = 'Definição administrativa do saldo em reais';
    $('#define-company').textContent = `${iaCompanyName(row)} · empresa_id ${row.empresa_id}`;
    $('#define-dialog').showModal();
  }

  function openAgentDialog(id, provider) {
    const row = selectedIaRow(id, provider); if (!row) return;
    $('#agent-empresa-id').value = id;
    $('#agent-provider').value = row.provedor;
    $('#agent-company').textContent = `${iaCompanyName(row)} · empresa_id ${row.empresa_id}`;
    $('#agent-prompt').value = String(iaField(row,'prompt_sistema','prompt') || '');
    $('#agent-active').checked = Boolean(iaField(row,'agente_ativo'));
    $('#balance-active').checked = Boolean(iaField(row,'saldo_ativo'));
    $('#agent-dialog').showModal();
  }

  function uniqueReference(prefix, empresaId, provider) {
    const uid = (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`).replace(/[^a-zA-Z0-9-]/g,'');
    return `${prefix}_${provider}_${empresaId}_${uid}`.slice(0,180);
  }

  async function submitCredit(event) {
    event.preventDefault();
    const empresa_id = Number($('#form-empresa-id').value);
    const provider = $('#form-provedor').value;
    const operation = $('#form-operation').value;
    const valor = Number($('#form-valor').value);
    const observacao = $('#form-observacao').value.trim();
    if (!Number.isFinite(valor) || valor <= 0) { toast('Informe um valor em reais maior que zero.', true); return; }
    $('#dialog-submit').disabled = true;
    try {
      const payload = {
        empresa_id,
        provedor: provider,
        operacao: operation === 'add' ? 'ADICIONAR' : 'RETIRAR',
        valor: Number(valor.toFixed(2)),
        observacao,
        referencia_externa: uniqueReference(operation === 'add' ? 'PAINEL_ADD' : 'PAINEL_RET', empresa_id, provider)
      };
      const data = await iaApi('saldo', payload);
      const result = firstItem(data);
      const novo = iaField(result,'saldo_depois','saldo_posterior','saldo');
      toast(`Operação concluída${novo !== null ? `. Novo saldo: ${brl(novo)}` : ''}.`);
      $('#credit-dialog').close();
      await loadIaAdminData();
      if ($('#historico')?.classList.contains('active')) await loadHistorico();
    } catch (error) { toast(error.message, true); }
    finally { $('#dialog-submit').disabled = false; }
  }

  async function submitDefine(event) {
    event.preventDefault();
    const empresa_id = Number($('#define-empresa-id').value);
    const provider = $('#define-provedor').value;
    const atual = Number($('#define-saldo-atual').value || 0);
    const alvo = Number($('#define-saldo').value);
    const observacao = $('#define-observacao').value.trim();
    if (!Number.isFinite(alvo) || alvo < 0) { toast('Informe um saldo válido em reais.', true); return; }
    const diff = Number((alvo - atual).toFixed(2));
    if (Math.abs(diff) < 0.005) { $('#define-dialog').close(); toast('O saldo já está nesse valor.'); return; }
    const button = $('#define-form button[type="submit"]'); button.disabled = true;
    try {
      const data = await iaApi('saldo', {
        empresa_id,
        provedor: provider,
        operacao: diff > 0 ? 'ADICIONAR' : 'RETIRAR',
        valor: Math.abs(diff),
        observacao,
        referencia_externa: uniqueReference('PAINEL_DEF', empresa_id, provider)
      });
      const result = firstItem(data);
      const novo = iaField(result,'saldo_depois','saldo_posterior','saldo');
      toast(`Saldo definido${novo !== null ? ` em ${brl(novo)}` : ''}.`);
      $('#define-dialog').close();
      await loadIaAdminData();
      if ($('#historico')?.classList.contains('active')) await loadHistorico();
    } catch (error) { toast(error.message, true); }
    finally { button.disabled = false; }
  }

  async function submitAgent(event) {
    event.preventDefault();
    const empresa_id = Number($('#agent-empresa-id').value);
    const provider = $('#agent-provider').value;
    const prompt_sistema = $('#agent-prompt').value.trim();
    const agente_ativo = $('#agent-active').checked;
    const saldo_ativo = $('#balance-active').checked;
    const button = $('#agent-submit'); button.disabled = true;
    try {
      await iaApi('configuracao', {empresa_id, provedor: provider, prompt_sistema, agente_ativo, saldo_ativo});
      toast(provider === 'GEMINI' ? 'Prompt do Agente WhatsApp Gemini salvo.' : 'Configuração do agente salva.');
      $('#agent-dialog').close();
      await loadIaAdminData();
    } catch (error) { toast(error.message, true); }
    finally { button.disabled = false; }
  }

  function historyRows(data) {
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.historico)) return data.historico;
    if (Array.isArray(data?.data)) return data.data;
    if (Array.isArray(data?.rows)) return data.rows;
    return [];
  }

  async function loadHistorico(empresa_id=Number($('#historico-filtro').value||0)) {
    $('#historico-body').innerHTML='<tr><td colspan="8" class="empty">Carregando...</td></tr>';
    try {
      const provedor = $('#historico-provedor')?.value || '';
      const data = await iaApi('historico',{empresa_id, provedor, limite:100});
      const rows = historyRows(data);
      $('#historico-body').innerHTML = rows.length ? rows.map(h=>`<tr>
        <td>${date(h.criado_em || h.created_at)}</td>
        <td>${escapeHtml(h.empresa_nome || `Empresa #${h.empresa_id}`)} <small>#${escapeHtml(h.empresa_id)}</small></td>
        <td><span class="provider-chip ${String(h.provedor).toUpperCase()==='GEMINI'?'gemini':'openai'}">${escapeHtml(h.provedor||'—')}</span></td>
        <td>${escapeHtml(h.tipo||'—')}</td>
        <td class="number">${brl(h.valor)}</td>
        <td class="number">${brl(h.saldo_antes)}</td>
        <td class="number"><strong>${brl(h.saldo_depois)}</strong></td>
        <td>${escapeHtml(h.observacao||'')}</td>
      </tr>`).join('') : '<tr><td colspan="8" class="empty">Nenhuma movimentação financeira registrada.</td></tr>';
    } catch(error) { $('#historico-body').innerHTML=`<tr><td colspan="8" class="empty">${escapeHtml(error.message)}</td></tr>`; }
  }

  async function loadCrmData(empresaId, modulo='resumo') {
    if (!empresaId) return null;
    const key=`${empresaId}:${modulo}`;
    if (crmCache.has(key)) return crmCache.get(key);
    $('#crm-module-content').innerHTML='<div class="panel loading-panel">Consultando PostgreSQL pelo n8n...</div>';
    const data=await api('crm-dados',{empresa_id:Number(empresaId),modulo});
    crmCache.set(key,data);
    return data;
  }

  function updateCrmHeader(data) {
    if(!data?.empresa) return;
    $('#crm-company-title').textContent=data.empresa.nome || 'CRM Jurídico';
    $('#crm-company-meta').textContent=`empresa_id ${data.empresa.id} · slug ${data.empresa.slug||'—'} · status ${data.empresa.status||'—'}`;
    const c=data.contagens||{};
    $('#crm-counts').innerHTML=[['Clientes',c.clientes],['Processos',c.processos],['Documentos',c.documentos],['Agenda',c.agenda],['Notificações',c.notificacoes],['Chunks',c.documento_chunks]].map(([l,v])=>`<div class="mini-stat"><span>${l}</span><strong>${fmt.format(number(v))}</strong></div>`).join('');
  }

  function moduleRows(title, rows, columns) {
    if(!Array.isArray(rows)||!rows.length) return `<div class="panel"><div class="empty block-empty">Nenhum registro.</div></div>`;
    const head=columns.map(c=>`<th>${escapeHtml(c.label)}</th>`).join('')+'<th></th>';
    const body=rows.map((row,i)=>`<tr>${columns.map(c=>`<td>${formatCell(row[c.key])}</td>`).join('')}<td><button class="btn btn-secondary btn-small" data-detail-index="${i}" data-detail-title="${escapeHtml(title)}">Ver tudo</button></td></tr>`).join('');
    $('#crm-module-content').dataset.rows=JSON.stringify(rows);
    return `<div class="panel"><div class="panel-head"><div><h2>${escapeHtml(title)}</h2><p>${fmt.format(rows.length)} registro(s).</p></div></div><div class="table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div></div>`;
  }

  function formatCell(value) {
    if(value===null||value===undefined||value==='') return '—';
    if(typeof value==='boolean') return `<span class="badge ${value?'on':'off'}">${value?'Sim':'Não'}</span>`;
    if(typeof value==='object') return escapeHtml(JSON.stringify(value));
    const s=String(value);
    if(/^\d{4}-\d{2}-\d{2}T/.test(s)) return date(s);
    return escapeHtml(s.length>90?s.slice(0,90)+'…':s);
  }

  function renderCrmModule(data, module) {
    updateCrmHeader(data);
    currentCrmModule=module;
    const rows=data[module]||[];
    let html='';
    if(module==='resumo') {
      const e=data.empresa||{}, c=data.contagens||{};
      html=`<div class="detail-grid">
        <div class="panel"><h2>Empresa</h2>${detailList(e)}</div>
        <div class="panel"><h2>Configuração do CRM</h2>${detailList(data.configuracoes||{})}</div>
        <div class="panel"><h2>Notificações</h2>${detailList(data.notificacoes_config||{})}</div>
        <div class="panel"><h2>Agente IA</h2>${detailList({...data.ia_config,...data.ia_creditos})}</div>
      </div>`;
    } else if(module==='configuracoes') {
      html=`<div class="detail-grid"><div class="panel"><h2>Configuração do CRM Jurídico</h2>${detailList(data.configuracoes||{})}</div><div class="panel"><h2>Configuração de notificações</h2>${detailList(data.notificacoes_config||{})}</div></div>`;
    } else if(module==='ia') {
      html=`<div class="detail-grid"><div class="panel"><h2>Configuração do Agente IA</h2>${detailList(data.ia_config||{})}</div><div class="panel"><h2>Créditos</h2>${detailList(data.ia_creditos||{})}</div><div class="panel full-span"><h2>Histórico recente</h2>${moduleRows('Histórico de créditos',data.ia_creditos_historico||[],[{key:'id',label:'ID'},{key:'tipo',label:'Tipo'},{key:'quantidade',label:'Quantidade'},{key:'saldo_posterior',label:'Saldo'},{key:'created_at',label:'Data'}])}</div></div>`;
    } else if(module==='clientes') {
      html=moduleRows('Clientes',rows,[{key:'id',label:'ID'},{key:'nome',label:'Nome'},{key:'documento',label:'Documento'},{key:'whatsapp',label:'WhatsApp'},{key:'situacao',label:'Situação'},{key:'ia_ativa',label:'IA'},{key:'updated_at',label:'Atualizado'}]);
    } else if(module==='processos') {
      html=moduleRows('Processos',rows,[{key:'id',label:'ID'},{key:'numero_processo',label:'Processo'},{key:'cliente_id',label:'Cliente'},{key:'area_processo',label:'Área'},{key:'status_processo',label:'Status'},{key:'proximo_prazo',label:'Próximo prazo'},{key:'advogado_responsavel',label:'Responsável'}]);
    } else if(module==='documentos') {
      html=moduleRows('Documentos',rows,[{key:'id',label:'ID'},{key:'nome_documento',label:'Documento'},{key:'tipo_documento',label:'Tipo'},{key:'status_documento',label:'Status'},{key:'cliente_id',label:'Cliente'},{key:'processo_id',label:'Processo'},{key:'arquivo_nome',label:'Arquivo'},{key:'updated_at',label:'Atualizado'}]);
    } else if(module==='agenda') {
      html=moduleRows('Agenda / Prazos',rows,[{key:'id',label:'ID'},{key:'tipo_compromisso',label:'Tipo'},{key:'titulo_compromisso',label:'Título'},{key:'data_agenda',label:'Data'},{key:'hora_agenda',label:'Hora'},{key:'status_agenda',label:'Status'},{key:'responsavel_agenda',label:'Responsável'}]);
    } else if(module==='notificacoes') {
      html=moduleRows('Notificações',rows,[{key:'id',label:'ID'},{key:'tipo',label:'Tipo'},{key:'titulo',label:'Título'},{key:'lida',label:'Lida'},{key:'data_evento',label:'Evento'},{key:'created_at',label:'Criada'}]);
    } else if(module==='usuarios') {
      html=moduleRows('Usuários vinculados',rows,[{key:'usuario_id',label:'ID'},{key:'email',label:'E-mail'},{key:'papel',label:'Papel'},{key:'status',label:'Status'},{key:'created_at',label:'Criado'}]);
    }
    $('#crm-module-content').innerHTML=html;
    if(module==='resumo') $('#crm-module-content').dataset.rows='';
  }

  function detailList(obj) {
    if(!obj || typeof obj!=='object' || !Object.keys(obj).length) return '<div class="empty">Nenhum dado cadastrado.</div>';
    return `<dl class="detail-list">${Object.entries(obj).map(([k,v])=>`<div><dt>${escapeHtml(k)}</dt><dd>${formatCell(v)}</dd></div>`).join('')}</dl>`;
  }

  async function openCrm(companyId, module='resumo') {
    $('#crm-company-select').value=String(companyId);
    showSection('crm-juridico');
    $$('.module-tab').forEach(b=>b.classList.toggle('active',b.dataset.module===module));
    try { const data=await loadCrmData(Number(companyId),module); renderCrmModule(data,module); }
    catch(error){$('#crm-module-content').innerHTML=`<div class="panel empty block-empty">${escapeHtml(error.message)}</div>`;toast(error.message,true);}
  }

  async function openOverviewCompany(companyId) {
    $('#overview-company-select').value=String(companyId);
    try {
      const data=await loadCrmData(Number(companyId),'resumo');
      const e=data.empresa||{}, c=data.contagens||{};
      $('#overview-company-details').innerHTML=[
        ['Empresa',e.nome],['ID',e.id],['Status',e.status],['Clientes',c.clientes],['Processos',c.processos],['Documentos',c.documentos],['Agenda',c.agenda],['Notificações',c.notificacoes],['Chunks',c.documento_chunks],['Saldo IA',data.ia_creditos?.saldo_tokens],['Tokens consumidos',data.ia_creditos?.tokens_consumidos]
      ].map(([l,v])=>`<div class="detail-card"><span>${escapeHtml(l)}</span><strong>${escapeHtml(v??'—')}</strong></div>`).join('');
    } catch(error){$('#overview-company-details').innerHTML=`<div class="panel empty block-empty">${escapeHtml(error.message)}</div>`;}
  }

  function showSection(name) {
    $$('.section').forEach(s=>s.classList.toggle('active',s.id===name));
    $$('.nav-link').forEach(l=>l.classList.toggle('active',l.dataset.section===name));
    const titles={'visao-geral':'Visão geral','empresas':'Empresas','crm-juridico':'CRM Jurídico','creditos':'Créditos de IA','financeiro-api':'Financeiro das APIs','historico':'Histórico'};
    $('#page-title').textContent=titles[name]||'Admin SaaS';
    if(name==='historico') loadHistorico();
    if(name==='financeiro-api') loadProviderBilling();
    if(window.innerWidth<900) $('#sidebar').classList.remove('open');
  }


  function money(value, currency='BRL') {
    if (value === null || value === undefined || value === '') return '—';
    const n = Number(value);
    if (!Number.isFinite(n)) return String(value);
    try {
      return new Intl.NumberFormat('pt-BR', {style:'currency', currency: currency || 'BRL'}).format(n);
    } catch {
      return `${currency || ''} ${n.toFixed(2)}`.trim();
    }
  }

  function renderProviderBilling(provider, data) {
    const p = provider === 'openai' ? 'openai' : 'google';
    const ok = Boolean(data?.ok);
    const status = $(`#${p}-status`);
    status.textContent = ok ? 'Conectado' : (data?.configured === false ? 'Não configurado' : 'Indisponível');
    status.classList.toggle('on', ok);
    status.classList.toggle('off', !ok);
    $(`#${p}-balance`).textContent = money(data?.balance, data?.currency);
    $(`#${p}-spent`).textContent = money(data?.spent, data?.currency);
    $(`#${p}-limit`).textContent = money(data?.limit, data?.currency);
    $(`#${p}-updated`).textContent = data?.updated_at ? date(data.updated_at) : '—';
    $(`#${p}-message`).textContent = data?.message || (ok ? 'Dados obtidos da conta de faturamento.' : 'Conector de faturamento não configurado.');
    const label = data?.account_label || (p === 'openai' ? 'Conta de faturamento' : 'Conta/projeto de faturamento');
    $(`#${p}-account-label`).textContent = label;
  }

  async function loadProviderBilling() {
    const button = $('#billing-refresh-btn');
    if (button) button.disabled = true;
    try {
      if (!session?.access_token) throw new Error('Sessão expirada.');
      const response = await fetch('/api/billing/summary', {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'Authorization': `Bearer ${session.access_token}`
        },
        cache: 'no-store'
      });
      const raw = await response.text();
      let data;
      try { data = JSON.parse(raw); }
      catch { throw new Error(`Resposta inválida do backend financeiro (${response.status}).`); }
      if (!response.ok && !data?.providers) throw new Error(data?.message || `HTTP ${response.status}`);
      renderProviderBilling('openai', data?.providers?.openai || {ok:false, configured:false, message:'OpenAI não configurada.'});
      renderProviderBilling('google', data?.providers?.google || {ok:false, configured:false, message:'Google Cloud não configurado.'});
      if (response.ok) toast('Financeiro das APIs atualizado.');
    } catch (error) {
      renderProviderBilling('openai', {ok:false, message:error.message});
      renderProviderBilling('google', {ok:false, message:error.message});
      toast(error.message, true);
    } finally {
      if (button) button.disabled = false;
    }
  }

  function bindEvents() {
    $('#login-form').addEventListener('submit',login);
    $('#refresh-btn').addEventListener('click',async()=>{try{crmCache.clear();await loadEmpresas();await loadIaAdminData();await loadHistorico();const id=$('#crm-company-select').value;if(id) await openCrm(id,currentCrmModule);if($('#financeiro-api')?.classList.contains('active')) await loadProviderBilling();else toast('Dados atualizados.');}catch(e){toast(e.message,true);}});
    $('#empresa-search').addEventListener('input',()=>{renderCompanyLists();renderCreditTable();});
    $('#historico-filtro').addEventListener('change',()=>loadHistorico());
    $('#historico-provedor').addEventListener('change',()=>loadHistorico());
    $('#ia-refresh-btn')?.addEventListener('click',async()=>{try{await loadIaAdminData();toast('Créditos atualizados.');}catch(e){toast(e.message,true);}});
    $('#billing-refresh-btn')?.addEventListener('click',loadProviderBilling);
    $('#crm-company-select').addEventListener('change',e=>openCrm(e.target.value,currentCrmModule));
    $('#overview-company-select').addEventListener('change',e=>openOverviewCompany(e.target.value));
    $('#crm-module-tabs').addEventListener('click',e=>{const b=e.target.closest('.module-tab');if(!b)return;openCrm($('#crm-company-select').value,b.dataset.module);});
    document.body.addEventListener('click',e=>{
      const go=e.target.closest('[data-go]'); if(go){showSection(go.dataset.go);return;}
      const iaButton=e.target.closest('[data-ia-action]');
      if(iaButton){
        const id=iaButton.dataset.id, provider=iaButton.dataset.provider, action=iaButton.dataset.iaAction;
        if(action==='add') openCreditDialog(id,provider,'add');
        if(action==='remove') openCreditDialog(id,provider,'remove');
        if(action==='define') openDefineDialog(id,provider);
        if(action==='agent') openAgentDialog(id,provider);
        if(action==='history') { $('#historico-filtro').value=id; $('#historico-provedor').value=provider; showSection('historico'); loadHistorico(Number(id)); }
        return;
      }
      const b=e.target.closest('[data-action]');
      if(b){const id=b.dataset.id,action=b.dataset.action;if(action==='crm')openCrm(id);return;}
      const detail=e.target.closest('[data-detail-index]');
      if(detail){const rows=JSON.parse($('#crm-module-content').dataset.rows||'[]');const row=rows[Number(detail.dataset.detailIndex)];if(row){$('#detail-title').textContent=detail.dataset.detailTitle||'Detalhes';$('#detail-json').textContent=JSON.stringify(row,null,2);$('#detail-dialog').showModal();}}
    });
    $('#credit-form').addEventListener('submit',submitCredit);$('#define-form').addEventListener('submit',submitDefine);$('#agent-form').addEventListener('submit',submitAgent);
    ['dialog-close','dialog-cancel'].forEach(id=>$('#'+id).addEventListener('click',()=>$('#credit-dialog').close()));
    ['define-close','define-cancel'].forEach(id=>$('#'+id).addEventListener('click',()=>$('#define-dialog').close()));
    ['agent-close','agent-cancel'].forEach(id=>$('#'+id).addEventListener('click',()=>$('#agent-dialog').close()));
    $('#detail-close').addEventListener('click',()=>$('#detail-dialog').close());
    $$('.nav-link').forEach(link=>link.addEventListener('click',e=>{e.preventDefault();showSection(link.dataset.section);history.replaceState(null,'','#'+link.dataset.section);}));
    $('#logout-btn').addEventListener('click',async()=>{await supabase.auth.signOut();session=null;crmCache.clear();showAuth(true);toast('Sessão encerrada.');});
    $('#menu-btn').addEventListener('click',()=>$('#sidebar').classList.toggle('open'));
  }

  async function bootData() {
    await loadEmpresas();
    await loadIaAdminData();
    await loadHistorico();
    if(empresas.length){await openOverviewCompany(empresas[0].empresa_id);await openCrm(empresas[0].empresa_id,'resumo');}
    const initial=location.hash.replace('#',''); if(initial&&$('#'+initial)) showSection(initial);
  }

  async function init() {
    bindEvents();
    try { if(await getSession()) await bootData(); }
    catch(error){showAuth(true);toast(error.message,true);}
  }

  supabase.auth.onAuthStateChange(async (_event,newSession)=>{
    if(!newSession){session=null;showAuth(true);return;}
    if(String(newSession.user?.email||'').toLowerCase()!==ALLOWED_ADMIN_EMAIL){await supabase.auth.signOut();return;}
    session=newSession;$('#admin-email').textContent=newSession.user.email;showAuth(false);
  });

  init();
})();

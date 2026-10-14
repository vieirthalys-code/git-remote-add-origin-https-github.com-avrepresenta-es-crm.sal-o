/* Centraliza as interfaces originais sem duplicar endpoints ou salvar em localStorage. */
(()=>{'use strict';
  const $=id=>document.getElementById(id);
  const panels={juridico:'ia-empresa',agenda:'prompts-agenda',vendas:'crm-vendas'};
  const targets={juridico:'av-unified-juridico',agenda:'av-unified-agenda',vendas:'av-unified-vendas'};
  // Os elementos com IDs originais continuam os mesmos e mantêm os eventos dos scripts existentes.
  function mount(){
    for(const [kind,sourceId] of Object.entries(panels)){
      const source=$(sourceId),target=$(targets[kind]);
      if(!source||!target)return;
      source.classList.remove('section','active'); source.classList.add('av-embedded-crm');
      target.appendChild(source);
    }
  }
  function activate(kind){
    if(!targets[kind]) kind='juridico';
    for(const [name,id] of Object.entries(targets)){ $(id).hidden=name!==kind; }
    document.querySelectorAll('.av-unified-tab').forEach(b=>{
      const on=b.dataset.avCrm===kind;
      b.classList.toggle('btn-primary',on);b.classList.toggle('btn-secondary',!on);
      b.setAttribute('aria-pressed',String(on));
    });
    const status=$('av-unified-status');
    if(status)status.textContent=kind==='juridico'?'Jurídico: escolha a empresa. O valor mostrado é GASTO no período (na moeda retornada pelo provedor), não saldo. Sem taxa de câmbio verificada, não convertimos USD em reais.':kind==='agenda'?'Agenda: escolha a empresa e edite seu prompt Gemini abaixo. Saldo real exige confirmação oficial do Google.':'Vendas: escolha a empresa na lista e edite seu prompt Gemini. A carteira interna anterior não é dinheiro pago ao Google.';
    if(kind==='agenda') $('agenda-prompts-refresh-btn')?.click();
    if(kind==='vendas') $('avv-refresh')?.click();
  }
  window.AV_CENTRAL_IA={activate};
  mount();
  document.querySelectorAll('.av-unified-tab').forEach(b=>b.addEventListener('click',()=>activate(b.dataset.avCrm)));
  activate('juridico');
})();
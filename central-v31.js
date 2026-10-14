/* V31: camada adicional; não remove nem recria os formulários existentes. */
(() => {
'use strict';
const byId=id=>document.getElementById(id);
const root=byId('av-central-v31');if(!root)return;
const src={juridico:{section:'ia-empresa',sel:'ia-company-select',prompt:'prompt-gemini',form:'prompt-form'},agenda:{section:'prompts-agenda',sel:'agenda-company-select',prompt:'agenda-prompt-text',form:'agenda-prompt-form'},vendas:{section:'crm-vendas',sel:null,prompt:'avv-prompt',form:'avv-prompt-form'}};
let current='juridico', pending=false;
const text=(id,value)=>{const e=byId(id);if(e)e.textContent=value};
function goto(section){ const el=document.querySelector('.nav-link[data-section="'+section+'"]');el?.click(); }
function available(){return byId('app')&&!byId('app').classList.contains('hidden');}
function loadOptions(){
 const select=byId('av31-company'),old=select.value;select.replaceChildren();
 if(current==='vendas'){
  document.querySelectorAll('#avv-list [data-avv-id]').forEach(btn=>{const opt=document.createElement('option');opt.value=btn.dataset.avvId;opt.textContent=btn.querySelector('strong')?.textContent||btn.dataset.avvId;select.append(opt)});
 }else{ const orig=byId(src[current].sel);for(const node of orig?.options||[]){if(!node.value)continue;select.append(new Option(node.textContent,node.value));}}
 if(!select.options.length){select.append(new Option('Abra o módulo original para carregar empresas',''));byId('av31-prompt').disabled=true;byId('av31-save').disabled=true;text('av31-status','Empresas ainda não carregadas. Clique em Sincronizar empresas ou abra a aba original.');return;}
 select.value=[...select.options].some(x=>x.value===old)?old:select.options[0].value;
 choose();
}
function choose(){
 const company=byId('av31-company').value;
 if(current==='vendas'){
  const btn=[...document.querySelectorAll('#avv-list [data-avv-id]')].find(x=>x.dataset.avvId===company);btn?.click();
 }else {const orig=byId(src[current].sel);if(orig&&company){orig.value=company;orig.dispatchEvent(new Event('change',{bubbles:true}));}}
 setTimeout(()=>{const original=byId(src[current].prompt),editor=byId('av31-prompt');editor.value=original?.value||'';editor.disabled=!company||Boolean(original?.disabled);byId('av31-save').disabled=editor.disabled;text('av31-count',editor.value.length.toLocaleString('pt-BR')+' caracteres');text('av31-status',editor.disabled?'Selecione uma empresa disponível.':'Prompt carregado. Salvar utiliza a integração original do CRM.');updateFinance()},current==='juridico'?650:120);
}
function updateFinance(){
 const spent=byId('av31-spent'),help=byId('av31-spent-help');
 if(current==='juridico'){
  const google=byId('google-spent')?.textContent||'—',openai=byId('openai-spent')?.textContent||'—';
  spent.textContent='Gemini: '+google+' · OpenAI: '+openai;
  help.textContent='Gasto mensal exibido na aba IA por Empresa (não é saldo).';
 }else {spent.textContent='Ainda não integrado';help.textContent='Não há fonte oficial de consumo conectada a este CRM.';}
 byId('av31-openai-box').hidden=current!=='juridico';
}
function activate(crm){current=crm;document.querySelectorAll('[data-av31-crm]').forEach(x=>x.classList.toggle('is-active',x.dataset.av31Crm===crm));loadOptions();syncCompanies();}
byId('av31-company').addEventListener('change',choose);
byId('av31-prompt').addEventListener('input',e=>text('av31-count',e.target.value.length.toLocaleString('pt-BR')+' caracteres'));
byId('av31-form').addEventListener('submit',e=>{e.preventDefault();if(pending)return;const original=byId(src[current].prompt),form=byId(src[current].form);if(!original||!form||byId('av31-prompt').disabled){text('av31-status','Não foi possível acessar o formulário original.');return;}original.value=byId('av31-prompt').value;original.dispatchEvent(new Event('input',{bubbles:true}));pending=true;text('av31-status','Salvamento enviado ao módulo original. Confira a confirmação do painel.');form.requestSubmit();setTimeout(()=>{pending=false;},1800);});
document.querySelectorAll('[data-av31-crm]').forEach(b=>b.addEventListener('click',()=>activate(b.dataset.av31Crm)));
let syncSeq = 0;
function sourceReady(){
 if(current==='vendas')return !!document.querySelector('#avv-list [data-avv-id]');
 const e=byId(src[current].sel);
 return !!(e && [...e.options].some(o=>o.value && !o.disabled && !/carregando|selecione/i.test(o.textContent)));
}
function syncCompanies(){
 const request=++syncSeq, crm=current, button=byId('av31-refresh');
 button.disabled=true;
 text('av31-status','Buscando empresas de '+({juridico:'Jurídico',agenda:'Agendamento',vendas:'Vendas 360'}[crm])+'...');
 if(crm==='vendas')byId('avv-refresh')?.click();
 else if(crm==='agenda')byId('agenda-prompts-refresh-btn')?.click();
 else byId('refresh-btn')?.click();
 let attempts=0;
 const check=()=>{
   if(request!==syncSeq)return;
   if(sourceReady()){
     button.disabled=false;
     loadOptions();
     return;
   }
   if(++attempts<20){setTimeout(check,750);return;}
   button.disabled=false;
   loadOptions();
   text('av31-status','Não foi possível encontrar empresas carregadas no módulo '+crm+'. Abra a aba original e verifique se ela lista empresas; depois tente sincronizar novamente.');
 };
 setTimeout(check,300);
}
byId('av31-refresh').addEventListener('click',syncCompanies);
const nav=document.querySelector('.nav-link[data-section="gemini-real"]');nav?.addEventListener('click',()=>setTimeout(()=>{loadOptions();if(!sourceReady())syncCompanies();},350));
// Também inicializa a central quando a tela já está aberta ao recarregar a página.
setTimeout(()=>{if(location.hash.includes('gemini-real')){loadOptions();if(!sourceReady())syncCompanies();}},700);
// Mantém a V29 íntegra: os módulos originais controlam autenticação, salvamento e API.
})();
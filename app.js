import { parseFiles } from './parsers.js';
import { runFullAnalysis, getNetworkData, getReportHTML } from './nlp.js';
import { renderNetwork } from './visualization.js';
import { generateDOCX } from './reportWord.js';
import * as d3 from 'd3';

// Handle Chrome PerformanceServerTiming DataCloneError noise
window.addEventListener('error', (e) => {
  const msg = String(e?.message || '');
  if (msg.includes('PerformanceServerTiming') || msg.includes("Failed to execute 'postMessage' on 'Window'")) {
    e.preventDefault();
  }
});
window.addEventListener('unhandledrejection', (e) => {
  const msg = String(e?.reason?.message || e?.reason || '');
  if (msg.includes('PerformanceServerTiming') || msg.includes("Failed to execute 'postMessage' on 'Window'")) {
    e.preventDefault();
  }
});
/* Disable PerformanceObserver to avoid DataCloneError from ServerTiming objects */
if ('PerformanceObserver' in window) {
  window.PerformanceObserver = function() {
    return { observe(){}, disconnect(){}, takeRecords(){ return []; } };
  };
}

/* Toasts */
function showMessage(text, type='info', autoHide=true, duration=2000){
  const container = document.getElementById('toast-container');
  const box = document.createElement('div');
  box.className = `toast ${type}`;
  box.innerHTML = `<span>${text}</span><button class="close" aria-label="Cerrar">×</button>`;
  const closeBtn = box.querySelector('.close');
  closeBtn.addEventListener('click', ()=> {
    if(box.parentNode) box.parentNode.removeChild(box);
  });
  container.appendChild(box);
  if(autoHide){
    setTimeout(()=> {
      if(box.parentNode) box.parentNode.removeChild(box);
    }, duration);
  }
}

/* State */
const state = {
  rawFiles: [],
  docs: [], // {id, name, text, meta}
  categoriesBase: [],
  analysis: null,
  removedCodes: new Set(),
  networkFilter: 'all',
  removedEmergentCats: new Set(),
  networkScale: 1.0
};

const MIN_SCALE = 0.5;
const MAX_SCALE = 2.5;
const SCALE_STEP = 0.15;

// Apply scale to rendered SVG (helper)
function applyNetworkScale(){
  const container = document.getElementById('network');
  if(!container) return;
  const svg = container.querySelector('svg');
  if(!svg) return;
  const s = state.networkScale;
  // use transform on inner g if present, otherwise on svg via style (preserve layout)
  svg.style.transformOrigin = '50% 50%';
  svg.style.transform = `scale(${s})`;
  // adjust container scroll to keep centered view
  container.scrollLeft = (svg.clientWidth * (s-1))/2;
  container.scrollTop = (svg.clientHeight * (s-1))/2;
}

/* Menu handling */
const views = {
  carga: document.getElementById('view-carga'),
  categorias: document.getElementById('view-categorias'),
  analisis: document.getElementById('view-analisis'),
  red: document.getElementById('view-red'),
  reportes: document.getElementById('view-reportes')
};
document.querySelectorAll('.menu-btn[data-view]').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    document.querySelectorAll('.menu-btn').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    const target = btn.dataset.view;
    Object.entries(views).forEach(([k,el])=>{
      el.classList.toggle('visible', k===target);
    });
    if(target==='red' && state.analysis){
      const net = getNetworkData(filteredAnalysis(state.analysis));
      renderNetwork(filterNetwork(net, state.networkFilter), document.getElementById('network'));
    }
    if(target==='reportes' && state.analysis){
      document.getElementById('report-preview').innerHTML = getReportHTML(filteredAnalysis(state.analysis));
    }
  });
});

/* File selection */
const fileInput = document.getElementById('file-input');
fileInput.addEventListener('change', (e)=>{
  state.rawFiles = Array.from(e.target.files);
  renderFilesList();
  showMessage('Archivos seleccionados. Procésalos para continuar.', 'info', true, 2000);
});
document.getElementById('btn-clear').addEventListener('click', ()=>{
  state.rawFiles = [];
  state.docs = [];
  fileInput.value = '';
  renderFilesList();
  document.getElementById('preview').innerHTML = '';
  showMessage('Selección limpiada.', 'info', true, 2000);
});
function renderFilesList(){
  const list = document.getElementById('files-list');
  list.innerHTML = '';
  state.rawFiles.forEach((f, idx)=>{
    const div = document.createElement('div');
    div.className = 'file-item';
    div.innerHTML = `
      <span>${f.name}</span>
      <span class="badge">${Math.round(f.size/1024)} KB</span>
    `;
    list.appendChild(div);
  });
}

/* Parse action */
document.getElementById('btn-parse').addEventListener('click', async ()=>{
  if(!state.rawFiles.length){
    showMessage('Seleccione archivos antes de procesar.', 'warn', false);
    return;
  }
  const { docs, previews } = await parseFiles(state.rawFiles);
  state.docs = docs;
  const prev = document.getElementById('preview');
  prev.innerHTML = '';
  previews.forEach(p=>{
    const card = document.createElement('div');
    card.className = 'preview-card';
    card.innerHTML = `<div><strong>${p.name}</strong> <span class="small">(${p.type})</span></div>
    <pre>${p.snippet}</pre>`;
    prev.appendChild(card);
  });
  // render sentiment chart
  const counts = computeSentiment(state.docs);
  renderSentimentChart(counts);

  showMessage('Archivos procesados correctamente.', 'info', true, 2000);
});

/* Categories base */
document.getElementById('btn-save-categories').addEventListener('click', ()=>{
  const raw = document.getElementById('base-categories').value.trim();
  state.categoriesBase = raw.split('\n').map(l=>l.trim()).filter(Boolean).map(line=>{
    const parts = line.split('|').map(s=>s.trim()).filter(Boolean);
    return { label: parts[0], synonyms: parts.slice(1) };
  });
  // if there are processed docs, update sentiment chart (keeps sync)
  if(state.docs && state.docs.length){
    const counts = computeSentiment(state.docs);
    renderSentimentChart(counts);
  }
  showMessage('Categorías base guardadas.', 'info', true, 2000);
});

/* Run analysis */
document.getElementById('btn-run-analysis').addEventListener('click', ()=>{
  if(!state.docs.length){
    showMessage('Primero procese los archivos en "Carga y preparación".', 'warn', false);
    return;
  }
  const analysis = runFullAnalysis(state.docs, state.categoriesBase);
  state.analysis = analysis;
  const fa = filteredAnalysis(analysis);
  document.getElementById('familiarization').innerHTML = analysis.familiarization.map(i=>`<div class="block"><strong class="title">${i.doc}</strong><span class="small">${i.summary}</span></div>`).join('');
  const cc=new Map(); analysis.openCodes.forEach(c=>{ if(!state.removedCodes.has(c.code)) cc.set(c.code,(cc.get(c.code)||0)+1); });
  document.getElementById('open-codes').innerHTML = Array.from(cc.entries()).map(([code,count])=>`<span class="tag" data-code="${code}">${code} (${count}) <button class="del-code" data-code="${code}" title="Eliminar">×</button></span>`).join('');
  document.getElementById('categories').innerHTML = (()=>{
    const base = fa.grouped.filter(g=>!g.category.startsWith('Emergente'));
    const emerg = fa.grouped.filter(g=>g.category.startsWith('Emergente'));
    const baseHTML = `<h4>Categorías base</h4>` + base.map(g=>`<div class="block"><strong>${g.category}</strong> <span class="small">(${g.codes.length})</span><div class="small">${g.codes.slice(0,10).map(x=>x.code).join(', ')}</div></div>`).join('');
    const emergHTML = `<h4>Emergentes</h4>` + emerg.map(g=>`<div class="block"><strong class="emergent-name" data-cat="${escapeHtml(g.category)}">${escapeHtml(g.category)}</strong> <span class="small">(${g.codes.length})</span> <button class="del-emergent-cat" data-cat="${escapeHtml(g.category)}" title="Eliminar">×</button><div class="small">${g.codes.slice(0,10).map(x=>x.code).join(', ')}</div></div>`).join('');
    return baseHTML + (emerg.length ? emergHTML : '<div class="small">— No hay categorías emergentes.</div>');
  })();
  document.getElementById('themes').innerHTML = fa.themes.map(t=>`<div class="block"><strong>${t.theme}</strong><div class="small">Subtemas: ${t.subthemes.join(', ')}</div>${t.quotes.slice(0,3).map(q=>`<blockquote class="small">“${q.text}” — <em>${q.doc}</em></blockquote>`).join('')}</div>`).join('');
  const net = getNetworkData(fa);
  renderNetwork(filterNetwork(net, state.networkFilter), document.getElementById('network'));
  document.getElementById('report-preview').innerHTML = getReportHTML(fa);
  showMessage('Análisis completado.', 'info', true, 2000);
});

/* Network */
document.getElementById('btn-refresh-network').addEventListener('click', ()=>{
  if(!state.analysis){
    showMessage('Ejecute el análisis antes de actualizar la red.', 'warn', false);
    return;
  }
  const net = getNetworkData(filteredAnalysis(state.analysis));
  renderNetwork(filterNetwork(net, state.networkFilter), document.getElementById('network'));
  showMessage('Red actualizada.', 'info', true, 2000);
});

/* Reports */
document.getElementById('btn-generate-docx').addEventListener('click', async ()=>{
  if(!state.analysis){
    showMessage('Genere el análisis para crear el reporte.', 'warn', false);
    return;
  }
  await generateDOCX(filteredAnalysis(state.analysis));
  showMessage('Documento Word generado correctamente.', 'info', true, 2000);
});

/* Help modal */
const helpBtn = document.getElementById('help-btn');
const helpModal = document.getElementById('help-modal');
const helpClose = document.getElementById('help-close');
helpBtn.addEventListener('click', ()=>{
  helpModal.classList.add('show');
  helpModal.setAttribute('aria-hidden','false');
});
helpClose.addEventListener('click', ()=>{
  helpModal.classList.remove('show');
  helpModal.setAttribute('aria-hidden','true');
});
helpModal.addEventListener('click', (e)=>{
  if(e.target === helpModal){
    helpModal.classList.remove('show');
    helpModal.setAttribute('aria-hidden','true');
  }
});

const confirmResetModal = document.getElementById('confirm-reset-modal');
const confirmYes = document.getElementById('confirm-reset-yes');
const confirmNo = document.getElementById('confirm-reset-no');

const resetBtn = document.getElementById('btn-reset');
resetBtn.addEventListener('click', ()=>{
  confirmResetModal.classList.add('show');
  confirmResetModal.setAttribute('aria-hidden','false');
});
confirmYes.addEventListener('click', ()=>{
  state.rawFiles=[]; state.docs=[]; state.categoriesBase=[]; state.analysis=null;
  fileInput.value=''; const bc=document.getElementById('base-categories'); if(bc) bc.value='';
  ['files-list','preview','familiarization','open-codes','categories','themes','report-preview','network','sentiment-chart'].forEach(id=>{ const el=document.getElementById(id); if(el) el.innerHTML=''; });
  document.querySelectorAll('.menu-btn').forEach(b=>b.classList.remove('active'));
  document.querySelector('.menu-btn[data-view="carga"]').classList.add('active');
  Object.entries(views).forEach(([k,el])=> el.classList.toggle('visible', k==='carga'));
  showMessage('Aplicación reiniciada.', 'info', true, 2000);
  confirmResetModal.classList.remove('show'); confirmResetModal.setAttribute('aria-hidden','true');
});
confirmNo.addEventListener('click', ()=>{
  confirmResetModal.classList.remove('show');
  confirmResetModal.setAttribute('aria-hidden','true');
  showMessage('Reinicio cancelado.', 'info', true, 2000);
});

/* Open codes click handler */
document.getElementById('open-codes').addEventListener('click',(e)=>{
  if(e.target.classList.contains('del-code')){
    state.removedCodes.add(e.target.dataset.code);
    const cc=new Map(); state.analysis.openCodes.forEach(c=>{ if(!state.removedCodes.has(c.code)) cc.set(c.code,(cc.get(c.code)||0)+1); });
    document.getElementById('open-codes').innerHTML = Array.from(cc.entries()).map(([code,count])=>`<span class="tag" data-code="${code}">${code} (${count}) <button class="del-code" data-code="${code}" title="Eliminar">×</button></span>`).join('');
  }
});

document.getElementById('categories').addEventListener('click',(e)=>{
  if(e.target.classList.contains('del-emergent-cat')){
    state.removedEmergentCats.add(e.target.dataset.cat);
    const fa = filteredAnalysis(state.analysis);
    document.getElementById('categories').innerHTML = (()=>{
      const base = fa.grouped.filter(g=>!g.category.startsWith('Emergente'));
      const emerg = fa.grouped.filter(g=>g.category.startsWith('Emergente'));
      const baseHTML = `<h4>Categorías base</h4>` + base.map(g=>`<div class="block"><strong>${g.category}</strong> <span class="small">(${g.codes.length})</span><div class="small">${g.codes.slice(0,10).map(x=>x.code).join(', ')}</div></div>`).join('');
      const emergHTML = `<h4>Emergentes</h4>` + emerg.map(g=>`<div class="block"><strong class="emergent-name" data-cat="${escapeHtml(g.category)}">${escapeHtml(g.category)}</strong> <span class="small">(${g.codes.length})</span> <button class="del-emergent-cat" data-cat="${escapeHtml(g.category)}" title="Eliminar">×</button><div class="small">${g.codes.slice(0,10).map(x=>x.code).join(', ')}</div></div>`).join('');
      return baseHTML + (emerg.length ? emergHTML : '<div class="small">— No hay categorías emergentes.</div>');
    })();
    document.getElementById('themes').innerHTML = fa.themes.map(t=>`<div class="block"><strong>${t.theme}</strong><div class="small">Subtemas: ${t.subthemes.join(', ')}</div>${t.quotes.slice(0,3).map(q=>`<blockquote class="small">“${q.text}” — <em>${q.doc}</em></blockquote>`).join('')}</div>`).join('');
    const net = getNetworkData(fa);
    renderNetwork(filterNetwork(net, state.networkFilter), document.getElementById('network'));
    document.getElementById('report-preview').innerHTML = getReportHTML(fa);
    showMessage('Categoría emergente eliminada del análisis.', 'info', true, 1800);
  }
});

// Add inline rename support for emergent categories
document.getElementById('categories').addEventListener('click', (e) => {
  // if clicked on a emergent-name element, turn it into an input for renaming
  const target = e.target;
  if(target.classList && target.classList.contains('emergent-name')){
    const oldName = target.dataset.cat;
    // avoid creating multiple inputs
    if(target.querySelector('input')) return;
    const input = document.createElement('input');
    input.type = 'text';
    input.value = oldName;
    input.style.padding = '4px 8px';
    input.style.borderRadius = '6px';
    input.style.border = '1px solid #e5e7eb';
    input.style.fontWeight = '700';
    input.style.fontSize = '13px';
    input.setAttribute('data-old', oldName);
    // replace content
    target.textContent = '';
    target.appendChild(input);
    input.focus();
    input.select();

    function finishRename(save){
      const newNameRaw = input.value.trim();
      const newName = newNameRaw || oldName;
      // restore element text
      target.removeChild(input);
      target.textContent = newName;
      target.dataset.cat = newName;
      if(save && state.analysis){
        renameEmergentCategory(oldName, newName);
      }
    }

    input.addEventListener('blur', ()=> finishRename(true));
    input.addEventListener('keydown', (ev)=>{
      if(ev.key === 'Enter'){
        ev.preventDefault();
        finishRename(true);
      } else if(ev.key === 'Escape'){
        ev.preventDefault();
        finishRename(false);
      }
    });
  }
});

// Helper to rename emergent category across state.analysis (grouped and themes) and re-render relevant views
function renameEmergentCategory(oldName, newName){
  if(!state.analysis) return;
  // update grouped
  state.analysis.grouped.forEach(g=>{
    if(g.category === oldName) g.category = newName;
  });
  // update themes entries that reference the old emergent name
  state.analysis.themes.forEach(t=>{
    if(t.theme === oldName) t.theme = newName;
  });
  // update any codes ids or other places that used the old label are generated dynamically, so just re-render views
  const fa = filteredAnalysis(state.analysis);

  // Re-render categories panel
  document.getElementById('categories').innerHTML = (()=>{
    const base = fa.grouped.filter(g=>!g.category.startsWith('Emergente'));
    const emerg = fa.grouped.filter(g=>g.category.startsWith('Emergente'));
    const baseHTML = `<h4>Categorías base</h4>` + base.map(g=>`<div class="block"><strong>${escapeHtml(g.category)}</strong> <span class="small">(${g.codes.length})</span><div class="small">${g.codes.slice(0,10).map(x=>x.code).join(', ')}</div></div>`).join('');
    const emergHTML = `<h4>Emergentes</h4>` + emerg.map(g=>`<div class="block"><strong class="emergent-name" data-cat="${escapeHtml(g.category)}">${escapeHtml(g.category)}</strong> <span class="small">(${g.codes.length})</span> <button class="del-emergent-cat" data-cat="${escapeHtml(g.category)}" title="Eliminar">×</button><div class="small">${g.codes.slice(0,10).map(x=>x.code).join(', ')}</div></div>`).join('');
    return baseHTML + (emerg.length ? emergHTML : '<div class="small">— No hay categorías emergentes.</div>');
  })();

  // Re-render themes, network and report
  document.getElementById('themes').innerHTML = fa.themes.map(t=>`<div class="block"><strong>${escapeHtml(t.theme)}</strong><div class="small">Subtemas: ${t.subthemes.join(', ')}</div>${t.quotes.slice(0,3).map(q=>`<blockquote class="small">“${escapeHtml(q.text)}” — <em>${escapeHtml(q.doc)}</em></blockquote>`).join('')}</div>`).join('');
  const net = getNetworkData(fa);
  renderNetwork(filterNetwork(net, state.networkFilter), document.getElementById('network'));
  document.getElementById('report-preview').innerHTML = getReportHTML(fa);
  showMessage(`Categoría emergente renombrada: "${oldName}" → "${newName}"`, 'info', true, 1800);
}

// basic escape helper to avoid injecting HTML when building innerHTML
function escapeHtml(str){
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function filterNetwork(net, mode){
  const keepTypes = mode==='main' ? new Set(['axis','category','subtheme'])
    : mode==='cats' ? new Set(['axis','category'])
    : new Set(['axis','category','subtheme','code','quote']);
  const nodes = net.nodes.filter(n=>keepTypes.has(n.type));
  const nodeIds = new Set(nodes.map(n=>n.id));
  const links = net.links.filter(l=> nodeIds.has(l.source.id||l.source) && nodeIds.has(l.target.id||l.target));
  return { nodes, links };
}

const btnMain = document.getElementById('btn-nodes-main');
const btnCats = document.getElementById('btn-nodes-cats');
const btnAll  = document.getElementById('btn-nodes-all');

btnMain.addEventListener('click', ()=>{
  state.networkFilter = 'main';
  if(state.analysis){
    const net = getNetworkData(filteredAnalysis(state.analysis));
    renderNetwork(filterNetwork(net, state.networkFilter), document.getElementById('network'));
  }
});
btnCats.addEventListener('click', ()=>{
  state.networkFilter = 'cats';
  if(state.analysis){
    const net = getNetworkData(filteredAnalysis(state.analysis));
    renderNetwork(filterNetwork(net, state.networkFilter), document.getElementById('network'));
  }
});
btnAll.addEventListener('click', ()=>{
  state.networkFilter = 'all';
  if(state.analysis){
    const net = getNetworkData(filteredAnalysis(state.analysis));
    renderNetwork(filterNetwork(net, state.networkFilter), document.getElementById('network'));
  }
});

// Buttons handlers for zoom
const btnZoomIn = document.getElementById('btn-zoom-in');
const btnZoomOut = document.getElementById('btn-zoom-out');
const btnResetZoom = document.getElementById('btn-reset-zoom');

btnZoomIn.addEventListener('click', ()=>{
  state.networkScale = Math.min(MAX_SCALE, +(state.networkScale + SCALE_STEP).toFixed(2));
  applyNetworkScale();
});
btnZoomOut.addEventListener('click', ()=>{
  state.networkScale = Math.max(MIN_SCALE, +(state.networkScale - SCALE_STEP).toFixed(2));
  applyNetworkScale();
});
btnResetZoom.addEventListener('click', ()=>{
  state.networkScale = 1.0;
  applyNetworkScale();
});

/* Export network SVG to PDF */
document.getElementById('btn-export-pdf').addEventListener('click', async () => {
  const container = document.getElementById('network');
  if(!container || !container.querySelector('svg')){
    showMessage('No hay gráfica de red para exportar. Ejecute o actualice la red primero.', 'warn', false);
    return;
  }
  try{
    // select the rendered svg
    const svg = container.querySelector('svg');
    // ensure proper namespace
    let svgClone = svg.cloneNode(true);

    // inline computed styles for better fidelity
    const styleSheets = Array.from(document.styleSheets).map(ss => {
      try {
        return Array.from(ss.cssRules || []).map(r => r.cssText).join(' ');
      } catch(e) { return ''; }
    }).join(' ');
    const styleEl = document.createElement('style');
    styleEl.textContent = styleSheets;
    svgClone.insertBefore(styleEl, svgClone.firstChild);

    // Apply current scale transform to the cloned SVG so exported image matches view
    const s = state.networkScale || 1;
    // wrap content in a group with scale to keep svg width/height intact
    const wrapper = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    const children = Array.from(svgClone.childNodes).filter(n=> n.nodeName !== 'style');
    const tempGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    children.forEach(c=> tempGroup.appendChild(c.cloneNode(true)));
    wrapper.setAttribute('transform', `scale(${s})`);
    // remove original children except style, then append wrapper
    Array.from(svgClone.childNodes).forEach(c=>{
      if(c.nodeName !== 'style') svgClone.removeChild(c);
    });
    svgClone.appendChild(wrapper);
    wrapper.appendChild(tempGroup);

    const serializer = new XMLSerializer();
    let svgStr = serializer.serializeToString(svgClone);
    if(!svgStr.match(/^<svg[^>]+xmlns="http:\/\/www\.w3\.org\/2000\/svg"/)){
      svgStr = svgStr.replace(/^<svg/, '<svg xmlns="http://www.w3.org/2000/svg"');
    }
    if(!svgStr.match(/^<svg[^>]+"http:\/\/www\.w3\.org\/1999\/xlink"/)){
      svgStr = svgStr.replace(/^<svg/, '<svg xmlns:xlink="http://www.w3.org/1999/xlink"');
    }

    // Create image from SVG
    const svg64 = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgStr);
    await new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = async () => {
        try {
          // create canvas sized to image natural dimensions
          const canvas = document.createElement('canvas');
          // clamp dimensions to avoid extremely large PDFs so all nodes stay visible when scaled
          const maxCanvasWidth = 1400;
          const maxCanvasHeight = 1000;
          let width = img.naturalWidth || svg.clientWidth || Math.max(1000, container.scrollWidth);
          let height = img.naturalHeight || svg.clientHeight || Math.max(800, container.scrollHeight);

          // If the SVG was scaled up, naturalWidth includes scale; ensure we cap both dimensions preserving aspect ratio
          const ratioClamp = Math.min(1, Math.min(maxCanvasWidth / width, maxCanvasHeight / height));
          width = Math.round(width * ratioClamp);
          height = Math.round(height * ratioClamp);

          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          // white background
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0,0,width,height);
          // draw image scaled to canvas
          ctx.drawImage(img, 0, 0, width, height);

          // convert to PNG
          const imgData = canvas.toDataURL('image/png');

          // import jspdf dynamically from importmap
          const jspdfModule = await import('jspdf');
          const { jsPDF } = jspdfModule;
          // Use orientation to match image
          const orientation = width > height ? 'landscape' : 'portrait';
          // set page size to A4-like points but fit image with margin
          const pageW = orientation === 'landscape' ? 842 : 595;
          const pageH = orientation === 'landscape' ? 595 : 842;
          const pdf = new jsPDF({ orientation, unit: 'pt', format: [pageW, pageH] });

          // Fit image into page while preserving aspect ratio and leave small margins
          const margin = 20;
          const availableW = pageW - margin*2;
          const availableH = pageH - margin*2;
          const ratio = Math.min(availableW / width, availableH / height);
          const drawW = width * ratio;
          const drawH = height * ratio;
          const marginX = (pageW - drawW) / 2;
          const marginY = (pageH - drawH) / 2;
          pdf.addImage(imgData, 'PNG', marginX, marginY, drawW, drawH);
          pdf.save('red_tematica.pdf');
          resolve();
        } catch(err){
          reject(err);
        }
      };
      img.onerror = (e)=> reject(new Error('Error al cargar la imagen SVG para conversión.'));
      img.src = svg64;
    });

    showMessage('PDF de la red generado.', 'info', true, 2000);
  }catch(err){
    console.error(err);
    showMessage('Error al generar el PDF: ' + (err.message || err), 'error', false);
  }
});

/* Simple sentiment lexicon (naive) and utilities */
const POSITIVE = new Set([
  'bueno','buena','bien','positivo','positiva','mejor','mejora','excelente','útil','satisfecho','satisfecha','satisfactorio','favorable','agradable','aceptable',
  'fortaleza','fortalezas','beneficio','beneficios','apoyo','oportunidad','oportunidades','eficiente','eficaz','claro','claridad','acierto','logro','avance'
]);
const NEGATIVE = new Set([
  'malo','mala','mal','negativo','negativa','peor','problema','problemas','insatisfactorio','insatisfecho','riesgo','riesgos','limitado','limitada',
  'dificultad','dificultades','falla','fallas','débil','debilidad','debilidades','crítica','críticas','pobre','insuficiente','carencia','deficiente','obstáculo','obstaculos','barrera','barreras'
]);
const NEGATIONS = new Set(['no','nunca','jamás','ningún','ninguna','sin']);

function splitSentences(text){
  return (text||'').split(/(?<=[\.!\?])\s+|\n+/).map(s=>s.trim()).filter(Boolean);
}
function simpleTokens(s){
  return s.toLowerCase().split(/\s+/).map(t=>t.replace(/[^\wáéíóúñü]+/g,'')).filter(Boolean);
}

function computeSentiment(docs){
  const counts = { positive:0, neutral:0, negative:0, total:0 };
  docs.forEach(d=>{
    const sents = splitSentences(d.text||'');
    sents.forEach(sent=>{
      const toks = simpleTokens(sent);
      if(!toks.length) return;
      let score = 0;
      for(let i=0;i<toks.length;i++){
        const t = toks[i];
        if(POSITIVE.has(t) || NEGATIVE.has(t)){
          // simple negation window: check last 3 tokens
          const windowStart = Math.max(0, i-3);
          const hasNeg = toks.slice(windowStart, i).some(w=>NEGATIONS.has(w));
          const val = POSITIVE.has(t) ? 1 : -1;
          score += hasNeg ? -val : val;
        }
      }
      counts.total++;
      if(score>0) counts.positive++;
      else if(score<0) counts.negative++;
      else counts.neutral++;
    });
  });
  return counts;
}

function renderSentimentChart(counts){
  const container = document.getElementById('sentiment-chart');
  if(!container) return;
  container.innerHTML = '';
  const data = [
    {label:'Positivo', key:'positive', value: counts.positive},
    {label:'Neutral', key:'neutral', value: counts.neutral},
    {label:'Negativo', key:'negative', value: counts.negative}
  ];
  const margin = {top:18,right:12,bottom:30,left:40};
  const w = container.clientWidth || 600;
  const h = container.clientHeight || 220;
  const width = Math.max(320, w) - margin.left - margin.right;
  const height = Math.max(140, h) - margin.top - margin.bottom;

  const svg = d3.select(container).append('svg')
    .attr('width', width + margin.left + margin.right)
    .attr('height', height + margin.top + margin.bottom);

  const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

  const x = d3.scaleBand().domain(data.map(d=>d.label)).range([0,width]).padding(0.3);
  const y = d3.scaleLinear().domain([0, d3.max(data, d=>d.value) || 1]).nice().range([height,0]);

  const colors = { positive: '#16a34a', neutral: '#6b7280', negative: '#ef4444' };

  g.append('g').call(d3.axisLeft(y).ticks(3)).selectAll('text').attr('fill','#374151').attr('font-size',11);
  g.append('g').attr('transform', `translate(0,${height})`).call(d3.axisBottom(x)).selectAll('text').attr('fill','#374151').attr('font-weight',700);

  g.selectAll('.bar')
    .data(data)
    .enter().append('rect')
      .attr('class','bar')
      .attr('x', d=> x(d.label))
      .attr('y', d=> y(d.value))
      .attr('width', x.bandwidth())
      .attr('height', d=> Math.max(0, height - y(d.value)))
      .attr('fill', d=> colors[d.key]);

  // labels on bars
  g.selectAll('.label')
    .data(data)
    .enter().append('text')
      .attr('x', d=> x(d.label) + x.bandwidth()/2)
      .attr('y', d=> y(d.value) - 6)
      .attr('text-anchor','middle')
      .attr('fill','#374151')
      .attr('font-size',11)
      .text(d=>{
        const total = counts.total || 1;
        const pct = ((d.value/total)*100).toFixed(0);
        return `${d.value} (${pct}%)`;
      });
}

function filteredAnalysis(analysis){
  if(!analysis) return null;
  const grouped = analysis.grouped.filter(g=> !g.category.startsWith('Emergente') || !state.removedEmergentCats.has(g.category));
  const themes = analysis.themes.filter(t=> grouped.some(g=>g.category===t.theme));
  return { ...analysis, grouped, themes };
}
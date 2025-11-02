/* Basic Spanish text utilities and thematic analysis pipeline */

function normalize(s){
  return (s||'')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .replace(/[^a-z0-9áéíóúñü\s\.\,\:\;\-\_]/gi,' ');
}
function sentences(text){
  return text.split(/(?<=[\.\!\?])\s+|\n+/).map(t=>t.trim()).filter(t=>t.length>0);
}
function tokens(text){
  const stop = new Set([
    'de','la','y','que','el','en','los','se','del','las','por','un','para','con','no','una','su','al','lo','como','más','pero','sus','le','ya','o','este','sí','porque','esta','entre','cuando','muy','sin','sobre','también','me','hasta','hay','donde','quien','desde','todo','nos','durante','todos','uno','les','ni','contra','otros','ese','eso','ante','ellos','e','esto','mí','antes','algunos','qué','unos','yo','otro','otras','otra','él','tanto','esa','estos','mucho','quienes','nada','muchos','cual','poco','ella','estar','estas','algunas','algo','nosotros','mi','mis','tú','te','ti','tu','tus','ellas','nosotras','vosostros','vosostras','os','mío','mía','míos','mías','tuyo','tuya','tuyos','tuyas','suyo','suya','suyos','suyas','nuestro','nuestra','nuestros','nuestras','vuestro','vuestra','vuestros','vuestras','esos','esas','estoy','estás','está','estamos','estáis','están','esté','estés','estemos','estéis','estén','estaré','estarás','estará','estaremos','estaréis','estarán','estaría','estarías','estaríamos','estaríais','estarían','estaba','estabas','estábamos','estabais','estaban','estuve','estuviste','estuvo','estuvimos','estuvisteis','estuvieron','estuviera','estuvieras','estuviéramos','estuvierais','estuvieran','estuviese','estuvieses','estuviésemos','estuvieseis','estuviesen','estando','estado','estada','estados','estadas','estad'
  ]);
  return normalize(text).split(/\s+/).filter(t=>t && !stop.has(t) && t.length>2);
}
function topNgrams(texts, n=2, top=50){
  const counts = new Map();
  for(const t of texts){
    const toks = tokens(t);
    for(let i=0;i<toks.length;i++){
      for(let k=1;k<=n;k++){
        if(i+k<=toks.length){
          const gram = toks.slice(i,i+k).join(' ');
          if(gram.length<4) continue;
          counts.set(gram, (counts.get(gram)||0)+1);
        }
      }
    }
  }
  return Array.from(counts.entries()).sort((a,b)=>b[1]-a[1]).slice(0,top).map(([g,c])=>({term:g,count:c}));
}
function tfidfDocs(docs){
  const tf = [], df = new Map();
  const docTokens = docs.map(d=>tokens(d.text));
  docTokens.forEach((toks, idx)=>{
    const map = new Map();
    toks.forEach(t=> map.set(t, (map.get(t)||0)+1) );
    tf.push(map);
    for(const k of new Set(toks)) df.set(k, (df.get(k)||0)+1);
  });
  const N = docs.length;
  const vectors = tf.map(map=>{
    const out = new Map();
    map.forEach((cnt, term)=>{
      const idf = Math.log((N+1)/((df.get(term)||1)+1))+1;
      out.set(term, cnt*idf);
    });
    return out;
  });
  return { vectors, vocab: df };
}
function cosineSim(a,b){
  let dot=0, na=0, nb=0;
  a.forEach((va,ka)=>{ na+=va*va; const vb=b.get(ka)||0; dot += va*vb; });
  b.forEach(vb=>{ nb+=vb*vb; });
  const denom = Math.sqrt(na)*Math.sqrt(nb) || 1;
  return dot/denom;
}
/* Simple k-means on tfidf vectors using cosine distance */
function kmeans(vectors, k=5, iters=15){
  if(vectors.length===0) return {labels:[],centroids:[]};
  k = Math.min(k, vectors.length);
  const idxs = Array.from({length:vectors.length}, (_,i)=>i);
  // init random unique
  const init = [];
  while(init.length<k){
    const r = idxs[Math.floor(Math.random()*idxs.length)];
    if(!init.includes(r)) init.push(r);
  }
  let centroids = init.map(i=>new Map(vectors[i]));
  let labels = new Array(vectors.length).fill(0);
  for(let it=0; it<iters; it++){
    // assign
    let changed = false;
    for(let i=0;i<vectors.length;i++){
      let best=-1, bestS=-Infinity;
      for(let c=0;c<centroids.length;c++){
        const s = cosineSim(vectors[i], centroids[c]);
        if(s>bestS){ bestS=s; best=c; }
      }
      if(labels[i]!==best){ labels[i]=best; changed=true; }
    }
    // recompute
    const sums = centroids.map(()=> new Map());
    const counts = centroids.map(()=>0);
    for(let i=0;i<vectors.length;i++){
      const c = labels[i];
      counts[c]++;
      vectors[i].forEach((v,term)=>{
        sums[c].set(term, (sums[c].get(term)||0)+v);
      });
    }
    centroids = sums.map((sum,c)=>{
      const out = new Map();
      const count = counts[c]||1;
      sum.forEach((v,term)=> out.set(term, v/count) );
      return out;
    });
    if(!changed) break;
  }
  return { labels, centroids };
}

/* Familiarization: short summary by frequent terms and speakers heuristics */
function familiarization(docs){
  return docs.map(d=>{
    const sents = sentences(d.text);
    const frequent = topNgrams([d.text], 2, 5).map(x=>x.term).join(', ');
    const who = (d.text.match(/(entrevistador|entrevistadora|moderador|participante|entrevistad[oa])\s*[:\-]/ig)||[])
      .slice(0,3).map(x=>x.split(/[:\-]/)[0].trim().toLowerCase());
    const context = [];
    if(d.meta.pais) context.push(`País: ${d.meta.pais}`);
    if(d.meta.localidad) context.push(`Localidad: ${d.meta.localidad}`);
    const summary = `Temas frecuentes: ${frequent || '—'}. Interlocutores: ${[...new Set(who)].join(', ') || 'no detectado'}. ${context.join(' • ')}`;
    return { doc: d.name, summary, sentences: sents.slice(0,50) };
  });
}

/* Open coding: pick salient sentences and assign initial code from top n-grams present */
function openCoding(docs){
  const codes = [];
  const globalTop = topNgrams(docs.map(d=>d.text), 3, 60).map(x=>x.term);
  docs.forEach(d=>{
    const sents = sentences(d.text);
    sents.forEach(s=>{
      const toks = tokens(s);
      if(toks.length<6) return;
      const matched = globalTop.find(t=> s.toLowerCase().includes(t));
      if(matched){
        codes.push({ doc: d.name, code: matched, quote: s });
      }
    });
  });
  // dedupe lightly
  const seen = new Set();
  return codes.filter(c=>{
    const key = c.doc+'|'+c.code+'|'+c.quote.slice(0,40);
    if(seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/* Group into base categories + emergent (kmeans on code quotes) */
function groupCategories(openCodes, base){
  // Base mapping by keyword
  const baseGroups = base.map(b=>({ category: b.label, synonyms: b.synonyms||[], codes: [] }));
  const unassigned = [];
  openCodes.forEach(c=>{
    const txt = c.code.toLowerCase();
    let placed = false;
    for(const g of baseGroups){
      const keys = [g.category.toLowerCase(), ...g.synonyms.map(s=>s.toLowerCase())];
      if(keys.some(k=> txt.includes(k))) { g.codes.push(c); placed=true; break; }
    }
    if(!placed) unassigned.push(c);
  });

  // Emergent via kmeans
  const pseudoDocs = unassigned.map((c,i)=>({ id:i, text: c.quote }));
  const { vectors } = tfidfDocs(pseudoDocs);
  const k = Math.min(5, Math.max(1, Math.round(unassigned.length/20) ));
  const km = kmeans(vectors, k||1, 10);
  const emergent = [];
  for(let i=0;i<(k||1);i++){
    const groupCodes = unassigned.filter((_,idx)=>km.labels[idx]===i);
    if(groupCodes.length===0) continue;
    // label by top terms in group
    const txt = groupCodes.map(x=>x.quote).join(' ');
    const label = topNgrams([txt], 3, 1)[0]?.term || `Emergente ${i+1}`;
    emergent.push({ category: `Emergente: ${label}`, codes: groupCodes });
  }

  return [...baseGroups.filter(g=>g.codes.length>0), ...emergent];
}

/* Thematic synthesis: create themes and subthemes */
function thematicSynthesis(groups){
  return groups.map(g=>{
    const allQuotes = g.codes.map(c=>({ text: c.quote, doc: c.doc }));
    const sub = topNgrams(g.codes.map(c=>c.quote), 2, 4).map(x=>x.term);
    return {
      theme: g.category,
      subthemes: sub,
      quotes: allQuotes.slice(0, 8)
    };
  });
}

/* Comparative synthesis by metadata if present */
function comparativeSynthesis(docs, openCodes){
  const dims = [
    { key:'pais', label:'Por país' },
    { key:'genero', label:'Por género' },
    { key:'edad', label:'Por edad' },
    { key:'localidad', label:'Por localidad' }
  ];
  const results = [];
  for(const d of dims){
    const buckets = new Map();
    docs.forEach(doc=>{
      const val = doc.meta[d.key];
      if(!val && val!==0) return;
      if(!buckets.has(val)) buckets.set(val, []);
      buckets.get(val).push(doc.name);
    });
    if(buckets.size<2) continue;
    // compare code prevalence
    const findings = [];
    for(const [val, docNames] of buckets.entries()){
      const codes = openCodes.filter(c=>docNames.includes(c.doc)).map(c=>c.code);
      const top = topNgrams(codes.join('\n'), 2, 3).map(x=>x.term).join(', ');
      findings.push(`${val}: ${top||'—'}`);
    }
    if(findings.length) results.push({ dimension: d.label, findings: findings.join(' • ') });
  }
  return results;
}

export function runFullAnalysis(docs, categoriesBase){
  const familiar = familiarization(docs);
  const open = openCoding(docs);
  const grouped = groupCategories(open, categoriesBase||[]);
  const themes = thematicSynthesis(grouped);
  const comparative = comparativeSynthesis(docs, open);
  return {
    docs,
    familiarization: familiar,
    openCodes: open,
    grouped,
    themes,
    comparative
  };
}

/* Build network data */
export function getNetworkData(analysis){
  // Nodes: Axis (Análisis), Category, Subtheme, Code, Quote
  const nodes = [];
  const links = [];
  const rootId = 'EJE: Central';
  nodes.push({ id: rootId, type: 'axis' });
  analysis.grouped.forEach(cat=>{
    const catId = `CAT:${cat.category}`;
    nodes.push({ id: catId, type: 'category' });
    links.push({ source: rootId, target: catId });

    // subthemes from themes synthesis
    const t = analysis.themes.find(t=>t.theme===cat.category);
    const subs = t ? t.subthemes : [];
    subs.forEach(st=>{
      const sid = `SUB:${cat.category}:${st}`;
      nodes.push({ id: sid, type: 'subtheme' });
      links.push({ source: catId, target: sid });
    });

    cat.codes.slice(0,30).forEach(c=>{
      const codeId = `COD:${cat.category}:${c.code}`;
      if(!nodes.find(n=>n.id===codeId)){
        nodes.push({ id: codeId, type: 'code' });
      }
      const parentId = subs.length ? `SUB:${cat.category}:${subs[0]}` : catId;
      links.push({ source: parentId, target: codeId });
      const quoteId = `CITA:${c.doc}:${c.quote.slice(0,40)}`;
      nodes.push({ id: quoteId, type: 'quote', label: c.quote, doc: c.doc });
      links.push({ source: codeId, target: quoteId });
    });
  });
  return { nodes, links };
}

/* Report HTML */
export function getReportHTML(analysis){
  const themesHTML = analysis.themes.map(t=>{
    const cites = t.quotes.slice(0,3).map(q=>`<li>“${q.text}” — <em>${q.doc}</em></li>`).join('');
    return `<div class="theme-card">
      <strong>${t.theme}</strong>
      <div style="color:#6b7280;">Subtemas: ${t.subthemes.join(', ')}</div>
      <ul>${cites}</ul>
    </div>`;
  }).join('');

  const catsTable = analysis.grouped.map(g=>{
    const rows = g.codes.slice(0,8).map(c=>`<tr><td>${g.category}</td><td>${c.code}</td><td>${c.quote}</td><td>${c.doc}</td></tr>`).join('');
    return rows;
  }).join('');

  // Expanded synthesis with concise stats
  const docCount = analysis.docs?.length || 0;
  const totalCodes = analysis.openCodes?.length || 0;
  const catCount = analysis.grouped?.length || 0;
  const emergentCount = analysis.grouped?.filter(g=>g.category.startsWith('Emergente')).length || 0;

  // Build a richer emergent matrix: per emergent group compute count, top codes and top terms from quotes
  const emergents = analysis.grouped.filter(g=>g.category.startsWith('Emergente')).map(g=>{
    const count = g.codes.length;
    const topCodes = Array.from(new Map(g.codes.map(c=>[c.code, ( (new Map()).set?1:1 )])).keys()).slice(0,6);
    // use existing topNgrams helper to extract frequent terms from the group's quotes
    const topTerms = topNgrams(g.codes.map(c=>c.quote), 2, 5).map(t=>t.term);
    const samples = g.codes.slice(0,3).map(c=>`<li>“${c.quote.replace(/</g,'&lt;').slice(0,200)}” — <em>${c.doc}</em></li>`).join('');
    return { category: g.category, count, topCodes, topTerms, samples };
  });

  const emergentHTML = emergents.length ? emergents.map(e=>`
      <div style="margin-bottom:12px;padding:10px;border:1px solid #e5e7eb;border-radius:8px;">
        <strong style="display:block;margin-bottom:6px;">${e.category}</strong>
        <div style="color:#6b7280;margin-bottom:6px;">Citas agrupadas: ${e.count} — Términos frecuentes: ${e.topTerms.join(', ') || '—'}</div>
        <div style="margin-bottom:6px;"><strong>Top códigos (ej.):</strong> ${e.topCodes.slice(0,6).map(c=>`<span style="margin-right:6px;">${c}</span>`).join('')}</div>
        <div><strong>Ejemplos de citas:</strong><ul style="margin:6px 0 0 18px;">${e.samples}</ul></div>
      </div>
    `).join('') : '<div>— No se detectaron categorías emergentes.</div>';

  return `
    <div style="padding:16px">
      <h2 style="margin:0 0 8px;">Síntesis final</h2>
      <p style="color:#111">El análisis identifica temas centrales y patrones discursivos con base en codificación abierta, agrupación en categorías y síntesis temática reflexiva. Se procesaron ${docCount} documento(s), se detectaron ${totalCodes} ocurrencias de códigos iniciales, se consolidaron ${catCount} categoría(s) (incluyendo ${emergentCount} emergente(s)) y se sintetizaron temas con citas representativas por categoría.</p>
      <h3>Temas clave y patrones</h3>
      <p style="color:#374151;margin-top:6px;margin-bottom:8px;">
        Esta sección presenta los temas resultantes a partir de las categorías definidas (base y emergentes). Cada categoría fue construida mediante la agrupación de códigos extraídos de las citas textuales; la síntesis prioriza términos frecuentes y muestras representativas para mostrar cómo los hallazgos se sostienen en los datos originales. Los subtemas reflejan patrones léxicos y conceptuales recurrentes y las citas permiten verificar la relación directa entre las interpretaciones y las expresiones de los participantes.
      </p>
      <div class="theme-grid">${themesHTML}</div>
      <h3>Tabla de categorías, subtemas y citas</h3>
      <div style="overflow:auto;">
      <table style="width:100%;border-collapse:collapse;">
        <thead>
          <tr><th style="text-align:left;border-bottom:1px solid #e5e7eb;">Categoría</th>
              <th style="text-align:left;border-bottom:1px solid #e5e7eb;">Código</th>
              <th style="text-align:left;border-bottom:1px solid #e5e7eb;">Cita textual</th>
              <th style="text-align:left;border-bottom:1px solid #e5e7eb;">Documento</th></tr>
        </thead>
        <tbody>
          ${catsTable}
        </tbody>
      </table>
      </div>
      <!-- Comparativa eliminada del reporte visual -->
      <h3>Matriz de valores o ejes emergentes</h3>
      <p style="color:#111">A continuación se presentan las categorías emergentes derivadas del análisis, con indicadores útiles para priorizar líneas de investigación o intervención: número de citas agrupadas, términos léxicos frecuentes dentro de las citas, ejemplos representativos y una muestra de códigos asociados.</p>
      <div style="margin-top:8px;">${emergentHTML}</div>
    </div>
  `;
}
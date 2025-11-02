import Papa from 'papaparse';
import * as mammoth from 'mammoth';
import * as XLSX from 'xlsx';
import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist';

/* Configure pdf.js */
const pdfWorker = 'https://esm.sh/pdfjs-dist@4.7.76/build/pdf.worker.min.mjs';
GlobalWorkerOptions.workerSrc = pdfWorker;

export async function parseFiles(files){
  const docs = [];
  const previews = [];
  let id = 1;
  for(const f of files){
    const ext = f.name.split('.').pop().toLowerCase();
    let text = '';
    let type = ext;
    try{
      if(ext==='txt'){
        text = await f.text();
      } else if(ext==='csv'){
        const str = await f.text();
        const parsed = Papa.parse(str, { header: false });
        text = parsed.data.map(r=>r.join(' ')).join('\n');
      } else if(ext==='xlsx' || ext==='xls'){
        const buf = await f.arrayBuffer();
        const wb = XLSX.read(buf, { type: 'array' });
        const txts = [];
        wb.SheetNames.forEach(sn=>{
          const ws = wb.Sheets[sn];
          const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true });
          txts.push(`-- Hoja: ${sn} --\n` + rows.map(r=>r.join(' ')).join('\n'));
        });
        text = txts.join('\n\n');
      } else if(ext==='docx'){
        const buf = await f.arrayBuffer();
        const res = await mammoth.extractRawText({ arrayBuffer: buf });
        text = res.value || '';
      } else if(ext==='pdf'){
        const buf = await f.arrayBuffer();
        const pdf = await getDocument({ data: buf }).promise;
        let pages = [];
        for(let i=1;i<=pdf.numPages;i++){
          const page = await pdf.getPage(i);
          const content = await page.getTextContent();
          const strings = content.items.map(it=>it.str);
          pages.push(strings.join(' '));
        }
        text = pages.join('\n\n');
      } else if(ext==='doc'){
        type = 'doc (no soportado nativo)';
        text = '[Aviso] Formato .doc no es totalmente compatible en navegador. Convierta a .docx para mejores resultados.';
      } else {
        type = 'desconocido';
        text = '';
      }
    }catch(e){
      text = `[Error al leer ${f.name}]: ${e.message || e}`;
    }
    const meta = detectMetadata(text);
    docs.push({ id: id++, name: f.name, text, meta });
    previews.push({ name: f.name, type, snippet: text.slice(0, 800) });
  }
  return { docs, previews };
}

/* Heurística para metadatos: país, género, edad, rol */
function detectMetadata(text){
  const meta = {};
  // País
  const paisMatch = text.match(/pa[ií]s\s*[:\-]\s*([A-Za-zÁÉÍÓÚÑáéíóúñ ]{3,30})/i);
  if(paisMatch) meta.pais = paisMatch[1].trim();
  // Edad
  const edadMatch = text.match(/edad\s*[:\-]\s*(\d{1,2})/i);
  if(edadMatch) meta.edad = parseInt(edadMatch[1],10);
  // Género
  const genMatch = text.match(/g[eé]nero\s*[:\-]\s*(masculino|femenino|hombre|mujer|no binario)/i);
  if(genMatch) meta.genero = genMatch[1].toLowerCase();
  // Rol/interlocutor
  const rolMatch = text.match(/(entrevistador|entrevistadora|entrevistado|entrevistada|moderador|participante)\s*[:\-]/i);
  if(rolMatch) meta.rol = rolMatch[1].toLowerCase();
  // Localidad
  const locMatch = text.match(/(ciudad|localidad|municipio)\s*[:\-]\s*([A-Za-zÁÉÍÓÚÑáéíóúñ ]{2,40})/i);
  if(locMatch) meta.localidad = locMatch[2].trim();
  return meta;
}


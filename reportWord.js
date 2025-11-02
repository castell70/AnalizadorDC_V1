import { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, AlignmentType, PageOrientation } from 'docx';

export async function generateDOCX(analysis) {
  const title = new Paragraph({
    text: 'Analizador de Datos Cualitativos — Resumen Ejecutivo',
    heading: HeadingLevel.TITLE,
  });

  const intro = new Paragraph({
    children: [
      new TextRun({ text: 'El análisis identifica temas centrales y patrones discursivos con base en codificación abierta, agrupación en categorías y síntesis temática reflexiva.' }),
    ],
    spacing: { after: 120 },
  });

  // Resultados: Lectura inicial
  const familiarParas = [
    new Paragraph({ text: 'Lectura inicial', heading: HeadingLevel.HEADING_2 }),
    ...analysis.familiarization.map(f => new Paragraph({ children: [
      new TextRun({ text: `${f.doc}: `, bold: true }),
      new TextRun({ text: f.summary }),
    ]}))
  ];

  // Resultados: Códigos iniciales (muestra compacta)
  const openCodeParas = [
    new Paragraph({ text: 'Códigos iniciales', heading: HeadingLevel.HEADING_2 }),
    new Paragraph({ spacing: { after: 120 }, children:
      (analysis.openCodes.slice(0,120).map((c,i)=> new TextRun({
        text: (i? ' · ' : '') + c.code,
      })))
    })
  ];

  // Resultados: Categorías (lista con ejemplos)
  const catsParas = [
    new Paragraph({ text: 'Categorías', heading: HeadingLevel.HEADING_2 }),
    ...analysis.grouped.map(g => new Paragraph({
      spacing: { after: 60 },
      children: [
        new TextRun({ text: g.category + ': ', bold: true }),
        new TextRun({ text: g.codes.slice(0,10).map(x=>x.code).join(', ') })
      ]
    }))
  ];

  // Temas
  const themeParas = [];
  themeParas.push(new Paragraph({ text: 'Temas y subtemas', heading: HeadingLevel.HEADING_2 }));
  analysis.themes.forEach(t => {
    themeParas.push(new Paragraph({ text: t.theme, heading: HeadingLevel.HEADING_3 }));
    if (t.subthemes?.length) {
      themeParas.push(new Paragraph({ text: `Subtemas: ${t.subthemes.join(', ')}` }));
    }
    t.quotes.slice(0, 3).forEach(q => {
      themeParas.push(new Paragraph({
        children: [ new TextRun({ text: `\"${q.text}\" — ${q.doc}` }) ],
      }));
    });
  });

  // Tabla categorías/códigos/citas
  const tableHeader = new TableRow({
    children: [
      new TableCell({ children: [new Paragraph({ text: 'Categoría' })] }),
      new TableCell({ children: [new Paragraph({ text: 'Código' })] }),
      new TableCell({ children: [new Paragraph({ text: 'Cita textual' })] }),
      new TableCell({ children: [new Paragraph({ text: 'Documento' })] }),
    ],
  });
  const tableRows = [];
  analysis.grouped.forEach(g => {
    g.codes.slice(0, 50).forEach(c => {
      tableRows.push(
        new TableRow({
          children: [
            new TableCell({ children: [new Paragraph({ text: g.category })] }),
            new TableCell({ children: [new Paragraph({ text: c.code })] }),
            new TableCell({ children: [new Paragraph({ text: c.quote })] }),
            new TableCell({ children: [new Paragraph({ text: c.doc })] }),
          ],
        })
      );
    });
  });
  const catsTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [tableHeader, ...tableRows],
  });

  // Comparativa
  const compParas = [];
  compParas.push(new Paragraph({ text: 'Síntesis comparativa', heading: HeadingLevel.HEADING_2 }));
  if (analysis.comparative?.length) {
    analysis.comparative.forEach(b => {
      compParas.push(new Paragraph({ text: `${b.dimension}: ${b.findings}` }));
    });
  } else {
    compParas.push(new Paragraph({ text: 'No se detectaron suficientes metadatos comparables.' }));
  }

  // Matriz emergente
  const emergParas = [];
  emergParas.push(new Paragraph({ text: 'Matriz de valores o ejes emergentes', heading: HeadingLevel.HEADING_2 }));
  const emergentes = analysis.grouped.filter(g => g.category.startsWith('Emergente'));
  if (emergentes.length) {
    emergentes.forEach(g => {
      const count = g.codes.length;
      const topCodes = Array.from(new Set(g.codes.map(c=>c.code))).slice(0,6).join(', ');
      const sampleQuotes = g.codes.slice(0,3).map(c=>`"${c.quote.slice(0,180)}" — ${c.doc}`);
      emergParas.push(new Paragraph({ spacing: { after: 120 }, children: [
        new TextRun({ text: `${g.category}`, bold: true }),
        new TextRun({ text: ` — citas agrupadas: ${count}` }),
      ]}));
      emergParas.push(new Paragraph({ children: [ new TextRun({ text: `Códigos (ej.): ${topCodes}` }) ] }));
      sampleQuotes.forEach(sq=>{
        emergParas.push(new Paragraph({ children: [ new TextRun({ text: sq }) ] }));
      });
      emergParas.push(new Paragraph({ text: '' }));
    });
  } else {
    emergParas.push(new Paragraph({ text: 'No se detectaron categorías emergentes.' }));
  }

  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 },
            size: { orientation: PageOrientation.PORTRAIT },
          },
        },
        children: [
          title,
          new Paragraph({ text: '', spacing: { after: 100 } }),
          intro,
          ...familiarParas,
          new Paragraph({ text: '', spacing: { after: 120 } }),
          ...openCodeParas,
          new Paragraph({ text: '', spacing: { after: 120 } }),
          ...catsParas,
          new Paragraph({ text: '', spacing: { after: 160 } }),
          ...themeParas,
          new Paragraph({ text: '', spacing: { after: 200 } }),
          new Paragraph({ text: 'Tabla de categorías, subtemas y citas', heading: HeadingLevel.HEADING_2 }),
          catsTable,
          new Paragraph({ text: '', spacing: { after: 200 } }),
          ...compParas,
          new Paragraph({ text: '', spacing: { after: 200 } }),
          ...emergParas,
        ],
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'resumen_ejecutivo.docx';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
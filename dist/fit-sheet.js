import {exportSVG,pocketOutline} from './geometry.js';

// A small vector PDF writer. Coordinates are millimetres; PDF's native unit is 1/72 inch.
// Standard Helvetica keeps the template self-contained. Labels are transliterated to ASCII.
const PT=72/25.4, pageWidth=210, pageHeight=297;
const num=n=>(Math.round(n*100000)/100000).toString();
const literal=s=>String(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^\x20-\x7e]/g,' ').replace(/[\\()]/g,'\\$&');
const text=(s,x,y,size=10)=>`BT /F1 ${size} Tf ${num(x*PT)} ${num((pageHeight-y)*PT)} Td (${literal(s)}) Tj ET\n`;

export function fitSheetPages(project,{moduleId=null}={}){
  // Reuse manufacturing validation, and never omit a waiting tool silently.
  exportSVG(project,{moduleId});
  const modules=project.modules.filter(m=>!moduleId||m.id===moduleId),pages=[];
  for(const m of modules){
    const cols=Math.max(1,Math.ceil((m.width-5)/185)),rows=Math.max(1,Math.ceil((m.height-5)/235));
    if(pages.length+cols*rows>250)throw Error('Šablona by měla více než 250 stran. Exportujte vybraný modul.');
    for(let row=0;row<rows;row++)for(let col=0;col<cols;col++)pages.push({module:m,col,row,cols,rows,x:col*185,y:row*235});
  }
  return pages;
}

export function exportFitPDF(project,options={}){
  const pages=fitSheetPages(project,options),objects=['','<< /Type /Catalog /Pages 2 0 R /ViewerPreferences << /PrintScaling /None >> >>','', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'],pageIds=[];
  for(const [index,p] of pages.entries()){
    const m=p.module;
    let content='0.15 0.18 0.16 rg\n'+text('SUPLIK STUDIO / ZKOUSKA VELIKOSTI 1:1',10,13,13);
    content+=text(`${String(m.name).slice(0,42)} | ${num(m.width-.5)} x ${num(m.height-.5)} mm | vule ${project.clearance} mm`,10,21,9);
    content+=text('Tisk: A4, skutecna velikost 100 %. Vypnout prizpusobeni strance.',10,28,9);
    content+=`q ${num(PT)} 0 0 ${num(-PT)} ${num(10*PT)} ${num((pageHeight-35)*PT)} cm\n0 0 190 240 re W n\n`;
    const shift=q=>({x:q.x-m.x-p.x,y:q.y-m.y-p.y});
    const outline=points=>points.map((q,i)=>{const s=shift(q);return `${num(s.x)} ${num(s.y)} ${i?'l':'m'}`;}).join('\n')+'\nh S\n';
    content+='0.6 0.6 0.6 RG 0.18 w\n'+outline([{x:m.x+.25,y:m.y+.25},{x:m.x+m.width-.25,y:m.y+.25},{x:m.x+m.width-.25,y:m.y+m.height-.25},{x:m.x+.25,y:m.y+m.height-.25}]);
    content+='0 0 0 RG 0.25 w\n';
    for(const t of project.tools.filter(t=>t.moduleId===m.id))content+=outline(pocketOutline(t,project.clearance));
    content+='Q\n';
    // Exactly 100mm horizontal gauge on every page, outside the tiled drawing.
    content+=`0 0 0 RG 0.5 w ${num(10*PT)} ${num(14*PT)} m ${num(110*PT)} ${num(14*PT)} l S\n`;
    for(const x of [10,110])content+=`${num(x*PT)} ${num(12*PT)} m ${num(x*PT)} ${num(16*PT)} l S\n`;
    content+=text('Tato usecka musi mit presne 100 mm.',10,290,8);
    content+=text(`${index+1}/${pages.length} | dil ${p.col+1},${p.row+1} z ${p.cols} x ${p.rows}`,142,285,8);
    if(p.cols>1||p.rows>1)content+=text('Spojit se sousednim listem: prekryv 5 mm.',119,291,7);
    const contentId=objects.length;objects.push(`<< /Length ${content.length} >>\nstream\n${content}endstream`);
    const pageId=objects.length;pageIds.push(pageId);objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(pageWidth*PT)} ${num(pageHeight*PT)}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`);
  }
  objects[2]=`<< /Type /Pages /Kids [${pageIds.map(i=>`${i} 0 R`).join(' ')}] /Count ${pages.length} >>`;
  let pdf='%PDF-1.4\n',offsets=[0];
  for(let i=1;i<objects.length;i++){offsets.push(pdf.length);pdf+=`${i} 0 obj\n${objects[i]}\nendobj\n`;}
  const xref=pdf.length;
  pdf+=`xref\n0 ${objects.length}\n0000000000 65535 f \n${offsets.slice(1).map(n=>`${String(n).padStart(10,'0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}

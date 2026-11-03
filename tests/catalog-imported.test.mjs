import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import imported from '../dist/catalog/imported.js';
import {validateProject,blankProject} from '../dist/model.js';

const CATEGORIES=['wrenches','hex-keys','sockets','screwdrivers','pliers','measuring','cutting','striking','other'];
const OPEN_LICENSES=/^(CC0-1\.0|CC-BY-(3\.0|4\.0)|CC-BY-SA-(3\.0|4\.0)|MIT|Apache-2\.0|BSD-[23]-Clause)$/;
const bbox=points=>{
  const xs=points.map(p=>p.x),ys=points.map(p=>p.y);
  return{w:Math.max(...xs)-Math.min(...xs),h:Math.max(...ys)-Math.min(...ys)};
};
const area=p=>p.reduce((s,a,i)=>{const b=p[(i+1)%p.length];return s+a.x*b.y-b.x*a.y;},0)/2;
const cross=(p,q,r)=>Math.sign((q.x-p.x)*(r.y-p.y)-(q.y-p.y)*(r.x-p.x));
function selfIntersects(p){
  const n=p.length;
  for(let i=0;i<n;i++)for(let j=i+2;j<n;j++){
    if(i===0&&j===n-1)continue;
    const a=p[i],b=p[(i+1)%n],c=p[j],d=p[(j+1)%n];
    if(cross(a,b,c)*cross(a,b,d)<0&&cross(c,d,a)*cross(c,d,b)<0)return true;
  }
  return false;
}
// Plausible real-world lengths (long side, mm) per category.
const LENGTH={wrenches:[80,700],'hex-keys':[30,300],sockets:[10,400],screwdrivers:[60,450],pliers:[100,450],measuring:[40,700],cutting:[80,700],striking:[100,600],other:[10,1000]};

test('imported catalogue is a non-empty list with unique ids',()=>{
  assert.ok(Array.isArray(imported)&&imported.length>0);
  const ids=imported.map(item=>item.id);
  assert.equal(new Set(ids).size,ids.length);
  for(const id of ids)assert.match(id,/^[a-z0-9-]+$/);
});

for(const item of imported){
  test(`imported item ${item.id}`,()=>{
    assert.ok(CATEGORIES.includes(item.category),'category');
    assert.ok(item.name?.cs&&item.name?.en,'bilingual name');
    assert.ok(['mm','in'].includes(item.unit),'unit');
    assert.ok(['measured','typical'].includes(item.accuracy),'accuracy');
    assert.ok(item.source?.name&&item.source?.url&&item.source?.license,'provenance');
    assert.match(item.source.license,OPEN_LICENSES,'redistributable licence');
    assert.match(item.source.url,/^https:\/\//);
    assert.ok(item.points.length>=3&&item.points.length<=600,'≤600 points');
    assert.ok(item.points.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)));
    assert.ok(area(item.points)>0,'counter-clockwise outline');
    assert.equal(selfIntersects(item.points),false,'no self-intersections');
    assert.ok(item.depth>=3&&item.depth<=40,'depth');
    const {w,h}=bbox(item.points),long=Math.max(w,h),[min,max]=LENGTH[item.category];
    assert.ok(long>=min&&long<=max,`long side ${long.toFixed(1)} mm outside ${min}..${max}`);
    assert.ok(Math.min(w,h)>=5&&w<=3000&&h<=3000,'bbox');
    const project=validateProject({...blankProject(),tools:[{id:item.id,name:item.name.cs,points:item.points,depth:item.depth}]});
    assert.equal(project.tools.length,1);
  });
}

test('every imported source has its provenance folder with README and licence',()=>{
  const root=new URL('../dist/catalog/sources/',import.meta.url);
  const dirs=fs.readdirSync(root,{withFileTypes:true}).filter(d=>d.isDirectory()).map(d=>d.name);
  assert.ok(dirs.length>0);
  for(const dir of dirs){
    const files=fs.readdirSync(new URL(dir+'/',root));
    assert.ok(files.includes('README.md'),`${dir}/README.md`);
    assert.ok(files.some(f=>/^LICENSE/i.test(f)),`${dir}/LICENSE*`);
  }
});

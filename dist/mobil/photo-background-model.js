const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
function solve3(matrix,rhs){
  const a=matrix.map((row,i)=>[...row,rhs[i]]);
  for(let j=0;j<3;j++){
    let pivot=j;for(let i=j+1;i<3;i++)if(Math.abs(a[i][j])>Math.abs(a[pivot][j]))pivot=i;
    [a[j],a[pivot]]=[a[pivot],a[j]];if(Math.abs(a[j][j])<1e-8)return[rhs[0]/Math.max(1,matrix[0][0]),0,0];
    const div=a[j][j];for(let k=j;k<4;k++)a[j][k]/=div;
    for(let i=0;i<3;i++)if(i!==j){const factor=a[i][j];for(let k=j;k<4;k++)a[i][k]-=factor*a[j][k];}
  }
  return a.map(row=>row[3]);
}
export function plainBackgroundModel({width,height,data}){
  const samples=[],stride=Math.max(1,Math.floor(Math.max(width,height)/600));
  const add=(x,y)=>{
    const p=(y*width+x)*4,alpha=data[p+3]/255;
    samples.push({b:[1,x/Math.max(1,width-1)*2-1,y/Math.max(1,height-1)*2-1],rgb:[0,1,2].map(c=>data[p+c]*alpha+255*(1-alpha))});
  };
  for(let x=0;x<width;x+=stride){add(x,0);add(x,height-1);}
  for(let y=0;y<height;y+=stride){add(0,y);add(width-1,y);}
  const rgb=[0,1,2].map(c=>samples.map(s=>s.rgb[c]).sort((a,b)=>a-b)[samples.length>>1]);
  // Ordinary paper and its existing neural path keep their established rules.
  if(Math.min(...rgb)>=230&&Math.max(...rgb)-Math.min(...rgb)<=16)return null;
  let coefficients=rgb.map(v=>[v,0,0]);
  const evaluate=(c,b)=>c[0]+c[1]*b[1]+c[2]*b[2];
  for(let iteration=0;iteration<6;iteration++){
    const matrix=Array.from({length:3},()=>[0,0,0]),rhs=Array.from({length:3},()=>[0,0,0]);
    for(const sample of samples){
      const residual=Math.max(...sample.rgb.map((v,c)=>Math.abs(v-evaluate(coefficients[c],sample.b))));
      const weight=iteration?Math.min(1,3/Math.max(1,residual)):1;
      for(let j=0;j<3;j++){
        for(let k=0;k<3;k++)matrix[j][k]+=sample.b[j]*sample.b[k]*weight;
        for(let c=0;c<3;c++)rhs[c][j]+=sample.b[j]*sample.rgb[c]*weight;
      }
    }
    coefficients=rhs.map(values=>solve3(matrix,values));
  }
  const deviations=samples.map(sample=>Math.max(...sample.rgb.map((v,c)=>Math.abs(v-evaluate(coefficients[c],sample.b))))).sort((a,b)=>a-b);
  const noise=deviations[Math.floor(deviations.length*.9)];
  if(noise>6)return null;
  // A gradual photographic illumination change is valid; a large unexplained
  // border transition belongs to the existing paper/tray recognition paths.
  if(coefficients.some(c=>Math.abs(c[1])+Math.abs(c[2])>40))return null;
  return{rgb,threshold:Math.max(12,noise*3+4),at:(x,y)=>{
    const b=[1,x/Math.max(1,width-1)*2-1,y/Math.max(1,height-1)*2-1];
    return coefficients.map(c=>clamp(evaluate(c,b),0,255));
  }};
}

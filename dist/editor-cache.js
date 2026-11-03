// Selection and camera changes reuse geometry. Cache keys include actual contents, not object identity alone.
export function createEditorGeometryCache({validateLayout,pocketOutline,findToolSets}){
  let layoutKey=null,layoutValue,setsKey=null,setsValue;
  const outlines=new WeakMap(),stats={layouts:0,sets:0,pockets:0,pocketHits:0};
  return{
    validate(project,context=''){
      const key=context+JSON.stringify(project);
      if(key!==layoutKey){layoutValue=validateLayout(project);layoutKey=key;stats.layouts++;}return layoutValue;
    },
    sets(project,context=''){const key=context+JSON.stringify(project);if(key!==setsKey){setsValue=findToolSets(project);setsKey=key;stats.sets++;}return setsValue;},
    pocket(tool,clearance){
      if(!Array.isArray(tool?.points))return pocketOutline(tool,clearance);
      const signature=JSON.stringify(tool.points),key=JSON.stringify([clearance,tool.rotation??0,tool.fingerGrips]);
      let entry=outlines.get(tool.points);if(!entry||entry.signature!==signature){entry={signature,values:new Map()};outlines.set(tool.points,entry);}
      let points=entry.values.get(key);
      if(!points){points=pocketOutline({...tool,x:0,y:0},clearance);if(entry.values.size>=12)entry.values.clear();entry.values.set(key,points);stats.pockets++;}else stats.pocketHits++;
      const x=Number(tool.x)||0,y=Number(tool.y)||0;return points.map(point=>({x:point.x+x,y:point.y+y}));
    },
    stats:()=>({...stats})
  };
}

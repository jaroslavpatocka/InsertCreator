// Tool categories shared by the catalogue and the user's library. Kept free of heavy imports so the app can
// categorise tools without loading the catalogue outlines.
export const CATEGORIES=[
  {id:'wrenches',cs:'Klíče',en:'Wrenches'},
  {id:'hex-keys',cs:'Imbusy a torxy',en:'Hex & Torx keys'},
  {id:'sockets',cs:'Nástrčné hlavice a bity',en:'Sockets & bits'},
  {id:'screwdrivers',cs:'Šroubováky',en:'Screwdrivers'},
  {id:'pliers',cs:'Kleště',en:'Pliers'},
  {id:'measuring',cs:'Měření a značení',en:'Measuring & marking'},
  {id:'cutting',cs:'Řezání a nože',en:'Cutting & knives'},
  {id:'striking',cs:'Kladiva a průbojníky',en:'Hammers & punches'},
  {id:'other',cs:'Ostatní',en:'Other'}
];

const ids=new Set(CATEGORIES.map(c=>c.id));
const fold=s=>String(s??'').normalize('NFD').replace(/\p{M}/gu,'').toLowerCase();
const rule=(id,...words)=>[id,new RegExp(String.raw`(?<![\p{L}\p{N}])(?:${words.join('|')})`,'u')];
// First match wins, keywords are diacritics-free word prefixes. The order settles names that hit several groups:
// a tool type beats its drive shape ('Torx bit', 'Šroubovák Torx'), and hex/Torx/socket beat the generic 'klíč'/'wrench'.
const RULES=[
  rule('wrenches','ockoplo','combination wrench','ratchet[a-z]* wrench','racnov[a-z]* klic'),
  rule('sockets','screwdriver bit','sroubovakov[a-z]* bit'),
  rule('screwdrivers','sroubovak','screwdriver','nut ?driver'),
  rule('sockets','nastrcn','hlavic','socket','bit','racn','ratchet','nastavec','prodluzk','extension bar','kloub','universal joint','t-rukojet','t-bar','vratidl','breaker bar'),
  rule('hex-keys','imbus','inbus','hex','allen','torx','sestihran','l-key'),
  rule('pliers','klest','kombinack','pliers','pincer','nipper','stipac','siko','diagonal cutter','side cutter','wire cutter','bolt cutter'),
  rule('wrenches','klic','wrench','spanner','hasak'),
  rule('measuring','pravitk','meritk','meric','metr','posuvk','uhelnik','vodovah','tuzk','rysovac','znackovac','caliper','calliper','micrometer','rule','tape measure','measur','gauge','square','level','pencil','scriber','marker'),
  rule('cutting','nuz','noz','knife','knives','cutter','blade','cepel','skalpel','scalpel','snips','scissors','shears','pila','pily','pilk','pilnik','saw','hacksaw','file','rasp','dlat','chisel','sekac','seker','hatchet','axe'),
  rule('striking','kladiv','palic','hammer','mallet','sledge','dulcik','vyrazec','prubojn','punch')
];

/** Category id guessed from a tool name in Czech or English, 'other' when no keyword matches. */
export function inferCategory(name){
  const folded=fold(name);
  return RULES.find(([,re])=>re.test(folded))?.[0]??'other';
}

/** The tool's stored category when it is a known id, otherwise one inferred from its name. */
export function toolCategory(tool){return ids.has(tool?.category)?tool.category:inferCategory(tool?.name);}

// One printable object made of named parts, each on its own filament.
// Checked against the Bambu Studio reader: part names and filaments survive loading, as one object.
// Do not write a BambuStudio Application name here, the reader then expects a full project and crashes.
import {zipFiles} from './geometry.js';

const HEAD='<?xml version="1.0" encoding="UTF-8"?>\n',MODEL='unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"';
const PACKAGE='http://schemas.openxmlformats.org/package/2006/relationships',REL='http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel';
const xml=value=>String(value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const number=value=>String(Math.round(value*1e5)/1e5);
// The production extension requires an id on these elements. Unique inside one file is enough.
const uuid=index=>`${String(index+1).padStart(8,'0')}-1c3f-4a00-8000-000000000000`;

function meshXml(triangles){
  const ids=new Map(),vertices=[],faces=[];
  const vertex=point=>{const key=point.map(number).join(' ');let id=ids.get(key);if(id===undefined){id=ids.size;ids.set(key,id);const [x,y,z]=key.split(' ');vertices.push(`<vertex x="${x}" y="${y}" z="${z}"/>`);}return id;};
  for(const [a,b,c] of triangles)faces.push(`<triangle v1="${vertex(a)}" v2="${vertex(b)}" v3="${vertex(c)}"/>`);
  return`<mesh><vertices>${vertices.join('')}</vertices><triangles>${faces.join('')}</triangles></mesh>`;
}

/** parts: [{name,color,filament,triangles}] in shared millimetre coordinates. position moves the object on the plate. */
export function encodeColor3MF(parts,{title='InsertCreator',position={x:0,y:0}}={}){
  if(!parts.length)throw Error('3MF needs at least one part.');
  const top=parts.length+1,materials=top+1,prefix=`xmlns:BambuStudio="http://schemas.bambulab.com/package/2021" xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06" requiredextensions="p"`,place=`1 0 0 0 1 0 0 0 1 ${number(position.x)} ${number(position.y)} 0`;
  const objects=`${HEAD}<model ${MODEL} ${prefix}><metadata name="BambuStudio:3mfVersion">1</metadata><resources><basematerials id="${materials}">${parts.map(part=>`<base name="${xml(part.name)}" displaycolor="${xml(part.color.toUpperCase())}FF"/>`).join('')}</basematerials>${parts.map((part,i)=>`<object id="${i+1}" p:UUID="${uuid(10+i)}" type="model" name="${xml(part.name)}" pid="${materials}" pindex="${i}">${meshXml(part.triangles)}</object>`).join('')}</resources><build/></model>`;
  const root=`${HEAD}<model ${MODEL} ${prefix}><metadata name="Application">InsertCreator</metadata><metadata name="BambuStudio:3mfVersion">1</metadata><metadata name="Title">${xml(title)}</metadata><resources><object id="${top}" p:UUID="${uuid(0)}" type="model" name="${xml(title)}"><components>${parts.map((part,i)=>`<component p:path="/3D/Objects/object_1.model" objectid="${i+1}" p:UUID="${uuid(100+i)}" transform="1 0 0 0 1 0 0 0 1 0 0 0"/>`).join('')}</components></object></resources><build p:UUID="${uuid(1)}"><item objectid="${top}" p:UUID="${uuid(2)}" transform="${place}" printable="1"/></build></model>`;
  const settings=`${HEAD}<config><object id="${top}"><metadata key="name" value="${xml(title)}"/><metadata key="extruder" value="${parts[0].filament}"/>${parts.map((part,i)=>`<part id="${i+1}" subtype="normal_part"><metadata key="name" value="${xml(part.name)}"/><metadata key="extruder" value="${part.filament}"/></part>`).join('')}</object><assemble><assemble_item object_id="${top}" instance_id="0" transform="${place}" offset="0 0 0"/></assemble></config>`;
  const rel=target=>`${HEAD}<Relationships xmlns="${PACKAGE}"><Relationship Target="${target}" Id="rel-1" Type="${REL}"/></Relationships>`;
  const types=`${HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/><Default Extension="config" ContentType="text/xml"/></Types>`;
  return zipFiles([{name:'[Content_Types].xml',data:types},{name:'_rels/.rels',data:rel('/3D/3dmodel.model')},{name:'3D/3dmodel.model',data:root},{name:'3D/_rels/3dmodel.model.rels',data:rel('/3D/Objects/object_1.model')},{name:'3D/Objects/object_1.model',data:objects},{name:'Metadata/model_settings.config',data:settings}]);
}

// GPU renderer: the camera lives in uniforms, so orbiting costs one draw and no mesh or DOM work.
const VERTEX=`#version 300 es
in vec3 position;in vec3 normal;
uniform vec3 center,right,down,towards;uniform vec4 view;uniform float depth;
out vec3 surface;
void main(){vec3 p=position-center;gl_Position=vec4((dot(p,right)-view.x)/view.z,-(dot(p,down)-view.y)/view.w,-dot(p,towards)/depth,1.);surface=normal;}`;
const FRAGMENT=`#version 300 es
precision highp float;
in vec3 surface;uniform vec3 color,towards;uniform float flatColor,alpha;out vec4 result;
void main(){
  vec3 n=normalize(surface);
  float light=clamp(42.+max(0.,dot(n,vec3(-.35,-.45,.82)))*22.+max(0.,dot(n,towards))*15.,40.,82.);
  result=vec4(mix(color*light/62.,color,flatColor)*alpha,alpha);
}`;

function compile(gl,type,source){
  const shader=gl.createShader(type);gl.shaderSource(shader,source);gl.compileShader(shader);
  if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(shader)||'shader');
  return shader;
}

// A context that does not return in this time is treated as gone, so the SVG view can take over.
const RESTORE_WAIT=3000;

export function createGLPreview(canvas,{onStateChange,wait=RESTORE_WAIT}={}){
  let gl=null;
  try{gl=canvas.getContext?.('webgl2',{antialias:true,alpha:true,premultipliedAlpha:true,powerPreference:'high-performance'})||null;}catch{gl=null;}
  if(!gl)return null;
  const meshes=new Map();let program,uniforms,attributes,pickBuffer=null,outline=null,lost=false,failed=false,timer=null,last=null;

  const upload=mesh=>{
    mesh.buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,mesh.buffer);gl.bufferData(gl.ARRAY_BUFFER,mesh.vertices,gl.STATIC_DRAW);
  };
  const setup=()=>{
    program=gl.createProgram();gl.attachShader(program,compile(gl,gl.VERTEX_SHADER,VERTEX));gl.attachShader(program,compile(gl,gl.FRAGMENT_SHADER,FRAGMENT));gl.linkProgram(program);
    if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program)||'program');
    gl.useProgram(program);
    uniforms=Object.fromEntries(['center','right','down','towards','view','depth','color','flatColor','alpha'].map(name=>[name,gl.getUniformLocation(program,name)]));
    attributes={position:gl.getAttribLocation(program,'position'),normal:gl.getAttribLocation(program,'normal')};
    gl.enableVertexAttribArray(attributes.position);gl.enableVertexAttribArray(attributes.normal);
    gl.clearColor(0,0,0,0);gl.blendFunc(gl.ONE,gl.ONE_MINUS_SRC_ALPHA);pickBuffer=null;
    for(const mesh of meshes.values())upload(mesh);
    if(outline)upload(outline);
  };
  try{setup();}catch{return null;}
  canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();lost=true;clearTimeout(timer);timer=setTimeout(()=>{failed=true;onStateChange?.();},wait);});
  canvas.addEventListener('webglcontextrestored',()=>{
    clearTimeout(timer);lost=false;
    try{setup();failed=false;if(last)draw(last);}catch{failed=true;}
    onStateChange?.();
  });

  const bind=mesh=>{
    gl.bindBuffer(gl.ARRAY_BUFFER,mesh.buffer);
    gl.vertexAttribPointer(attributes.position,3,gl.FLOAT,false,24,0);gl.vertexAttribPointer(attributes.normal,3,gl.FLOAT,false,24,12);
  };
  const camera=view=>{
    gl.uniform3fv(uniforms.center,view.center);gl.uniform3fv(uniforms.right,view.right);gl.uniform3fv(uniforms.down,view.down);gl.uniform3fv(uniforms.towards,view.towards);
    gl.uniform4f(uniforms.view,view.bounds.x+view.bounds.width/2,view.bounds.y+view.bounds.height/2,view.bounds.width/2,view.bounds.height/2);gl.uniform1f(uniforms.depth,view.fitSize*4);
  };
  const paint=(view,color,flat)=>{
    gl.uniform1f(uniforms.flatColor,flat);gl.uniform1f(uniforms.alpha,1);
    for(const [id,mesh] of meshes){
      bind(mesh);
      for(const range of mesh.ranges){gl.uniform3fv(uniforms.color,color(id,range.zone));gl.drawArrays(mesh.lines?gl.LINES:gl.TRIANGLES,range.first,range.count);}
    }
  };
  const resize=view=>{
    const ratio=Math.min(2,canvas.ownerDocument?.defaultView?.devicePixelRatio||1),width=Math.max(1,Math.round(view.viewport.width*ratio)),height=Math.max(1,Math.round(view.viewport.height*ratio));
    if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height;}
  };
  function draw(view){
    last=view;if(lost)return;
    resize(view);gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.viewport(0,0,canvas.width,canvas.height);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
    gl.useProgram(program);camera(view);
    if(view.reference){
      gl.disable(gl.DEPTH_TEST);gl.enable(gl.BLEND);bind(view.reference);
      gl.uniform1f(uniforms.flatColor,1);gl.uniform1f(uniforms.alpha,.5);gl.uniform3fv(uniforms.color,[.933,.953,.91]);gl.drawArrays(gl.TRIANGLE_FAN,0,4);
      gl.uniform1f(uniforms.alpha,1);gl.uniform3fv(uniforms.color,[.725,.788,.659]);gl.drawArrays(gl.LINE_LOOP,0,4);
      gl.disable(gl.BLEND);
    }
    gl.enable(gl.DEPTH_TEST);paint(view,view.color,0);
  }
  return{
    get failed(){return failed;},
    setMesh(id,mesh){const old=meshes.get(id);if(old?.vertices===mesh.vertices)return;if(old?.buffer)gl.deleteBuffer(old.buffer);const entry={...mesh};if(!lost)upload(entry);meshes.set(id,entry);},
    removeMesh(id){const old=meshes.get(id);if(old?.buffer)gl.deleteBuffer(old.buffer);meshes.delete(id);},
    has:id=>meshes.has(id),
    ids:()=>[...meshes.keys()],
    /** The drawer outline shares the mesh shader, so it keeps the same projection. */
    reference(points){if(outline?.buffer)gl.deleteBuffer(outline.buffer);outline={vertices:new Float32Array(points.flatMap(point=>[...point,0,0,1]))};if(!lost)upload(outline);return outline;},
    draw,
    /** Renders mesh ids into a one-pixel target and returns the id under the point, or null. */
    pick(x,y,view){
      if(lost)return null;
      resize(view);
      const ratio=canvas.width/Math.max(1,view.viewport.width),px=Math.floor(x*ratio),py=canvas.height-1-Math.floor(y*ratio);
      if(!pickBuffer){
        pickBuffer=gl.createFramebuffer();gl.bindFramebuffer(gl.FRAMEBUFFER,pickBuffer);
        const target=gl.createRenderbuffer();gl.bindRenderbuffer(gl.RENDERBUFFER,target);gl.renderbufferStorage(gl.RENDERBUFFER,gl.RGBA8,1,1);gl.framebufferRenderbuffer(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.RENDERBUFFER,target);
        const depth=gl.createRenderbuffer();gl.bindRenderbuffer(gl.RENDERBUFFER,depth);gl.renderbufferStorage(gl.RENDERBUFFER,gl.DEPTH_COMPONENT24,1,1);gl.framebufferRenderbuffer(gl.FRAMEBUFFER,gl.DEPTH_ATTACHMENT,gl.RENDERBUFFER,depth);
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER,pickBuffer);gl.viewport(-px,-py,canvas.width,canvas.height);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
      gl.useProgram(program);camera(view);gl.enable(gl.DEPTH_TEST);gl.disable(gl.BLEND);
      const ids=[],color=id=>{let index=ids.indexOf(id);if(index<0)index=ids.push(id)-1;const value=index+1;return[(value&255)/255,((value>>8)&255)/255,0];};
      paint(view,color,1);
      const pixel=new Uint8Array(4);gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.viewport(0,0,canvas.width,canvas.height);
      const value=pixel[0]+pixel[1]*256;return value?ids[value-1]??null:null;
    }
  };
}

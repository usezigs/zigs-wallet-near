// Camera-locked 3D relief portrait. Its baked appearance comes from the approved
// cinematic artwork; this is deliberately not a replacement 360-degree sculpt.
// No wallet, network, storage or audio dependencies.
const VERTEX = `
precision highp float;
attribute vec2 a_uv;
uniform float u_time;
uniform float u_breath;
uniform vec2 u_ears;
uniform float u_gust;
uniform float u_look;
varying vec2 v_uv;

float field(vec2 p, vec2 center, vec2 radius) {
  vec2 q = (p - center) / radius;
  return exp(-dot(q, q) * 1.7);
}
vec2 pivot(vec2 p, vec2 root, float angle) {
  float c = cos(angle), s = sin(angle);
  vec2 d = p - root;
  return root + vec2(c*d.x - s*d.y, s*d.x + c*d.y);
}
void main() {
  v_uv = a_uv;
  vec2 uv = a_uv;
  float backEar = smoothstep(.10, .66, field(uv, vec2(.325,.14), vec2(.095,.15)))
    * (1. - smoothstep(.235,.29,uv.y)) * (1. - smoothstep(.385,.43,uv.x));
  float frontEar = smoothstep(.08, .66, field(uv, vec2(.468,.13), vec2(.09,.16)))
    * (1. - smoothstep(.235,.29,uv.y)) * smoothstep(.37,.41,uv.x);
  uv = mix(uv, pivot(uv, vec2(.385,.258), u_ears.x), backEar);
  uv = mix(uv, pivot(uv, vec2(.505,.269), u_ears.y), frontEar);
  // Motion rises from the mane roots to the tips; facial markings stay attached.
  float maneRoot = .58 + .34 * a_uv.y;
  float mane = smoothstep(maneRoot, maneRoot + .14, a_uv.x)
    * (1. - smoothstep(.79,.98,a_uv.y));
  uv.x += mane * u_gust * (.65*sin(a_uv.y*47. - u_time*1.7)
    + .35*sin(a_uv.y*83. - u_time*2.3)) * .0045;
  uv.y += mane * u_gust * sin(a_uv.y*39. - u_time*1.2) * .0011;

  // The head follows the upper neck, while the base stays planted. This is a
  // connected resting breath, rather than scaling the entire portrait.
  float head = 1. - smoothstep(.56,.86,a_uv.y);
  uv = mix(uv,pivot(uv,vec2(.66,.72),-u_breath*.0018),head);
  uv.y -= head * u_breath * .0028;

  float cheek = field(a_uv,vec2(.48,.44),vec2(.24,.27));
  float muzzle = field(a_uv,vec2(.19,.63),vec2(.20,.18));
  float neck = field(a_uv,vec2(.70,.80),vec2(.29,.49));
  float depth = .24*cheek + .30*muzzle + .17*neck;
  vec3 p = vec3(uv.x*2.-1., 1.-uv.y*2., depth);
  float chest = field(a_uv,vec2(.70,.74),vec2(.38,.28))
    * smoothstep(.48,.70,a_uv.y) * (1.-smoothstep(.90,.98,a_uv.y));
  p.x += (a_uv.x-.70) * chest * u_breath * .055;
  p.y += chest * u_breath * .005;
  p.z += neck * u_breath * .018;
  // A small yaw around the upper neck brings the muzzle toward the viewer.
  // Depth supplies the foreshortening; the chest and base keep their own pose.
  float turn = u_look * (1.-smoothstep(.66,.93,a_uv.y));
  vec3 relative = p-vec3(.32,-.44,.08);
  p.x = .32 + cos(turn)*relative.x + sin(turn)*relative.z;
  p.z = .08 - sin(turn)*relative.x + cos(turn)*relative.z;
  gl_Position = vec4(p.xy, -p.z*.2, 1.);
}`;

const FRAGMENT = `
precision mediump float;
uniform sampler2D u_art;
uniform sampler2D u_closed;
uniform float u_blink;
varying vec2 v_uv;
void main() {
  vec4 art = texture2D(u_art, v_uv);
  if (art.a < .002) discard;
  // Only the eyelid patch uses the closed-eye texture; everything else stays put.
  float eye = length((v_uv - vec2(.404,.370)) / vec2(.077,.052));
  float mask = 1. - smoothstep(.60,1.,eye);
  vec3 closed = texture2D(u_closed,v_uv).rgb;
  vec3 color = mix(art.rgb,closed,mask*u_blink);
  gl_FragColor = vec4(color*art.a,art.a);
}`;

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("Homepage portrait unavailable");
  gl.shaderSource(shader,source); gl.compileShader(shader);
  if (gl.getShaderParameter(shader,gl.COMPILE_STATUS)) return shader;
  gl.deleteShader(shader);
  throw new Error("Homepage portrait unavailable");
}

function pipeline(gl) {
  const vertex = compile(gl,gl.VERTEX_SHADER,VERTEX);
  let fragment, program;
  try {
    fragment = compile(gl,gl.FRAGMENT_SHADER,FRAGMENT);
    program = gl.createProgram();
    if (!program) throw new Error("Homepage portrait unavailable");
    gl.attachShader(program,vertex); gl.attachShader(program,fragment); gl.linkProgram(program);
    if (!gl.getProgramParameter(program,gl.LINK_STATUS))
      throw new Error("Homepage portrait unavailable");
    return program;
  } catch (error) {
    if (program) gl.deleteProgram(program);
    throw error;
  } finally {
    gl.deleteShader(vertex);
    if (fragment) gl.deleteShader(fragment);
  }
}

function texture(gl, image, unit) {
  const result = gl.createTexture();
  if (!result) throw new Error("Homepage portrait unavailable");
  try {
    gl.activeTexture(gl.TEXTURE0+unit); gl.bindTexture(gl.TEXTURE_2D,result);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,false);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,image);
    return result;
  } catch (error) { gl.deleteTexture(result); throw error; }
}

// A 128 × 128 subdivided surface carries depth and local ear/mane deformation.
function grid(gl) {
  const steps = 128, side = steps+1;
  const uv = new Float32Array(side*side*2);
  const indices = new Uint16Array(steps*steps*6);
  for (let y=0;y<=steps;y++) for (let x=0;x<=steps;x++) {
    const i=(y*side+x)*2; uv[i]=x/steps; uv[i+1]=y/steps;
  }
  let at=0;
  for (let y=0;y<steps;y++) for (let x=0;x<steps;x++) {
    const i=y*side+x;
    indices.set([i,i+side,i+1,i+1,i+side,i+side+1],at); at+=6;
  }
  const vertices=gl.createBuffer(), elements=gl.createBuffer();
  if (!vertices || !elements) {
    gl.deleteBuffer(vertices); gl.deleteBuffer(elements);
    throw new Error("Homepage portrait unavailable");
  }
  gl.bindBuffer(gl.ARRAY_BUFFER,vertices); gl.bufferData(gl.ARRAY_BUFFER,uv,gl.STATIC_DRAW);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,elements);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,indices,gl.STATIC_DRAW);
  return { vertices,elements,count:indices.length };
}

const smooth = (x) => { const p=Math.max(0,Math.min(1,x)); return p*p*(3-2*p); };
function blinkAt(time, start) {
  const age=time-start;
  if (age<0 || age>.31) return 0;
  if (age<.095) return smooth(age/.095);
  if (age<.13) return 1;
  return 1-smooth((age-.13)/.18);
}
function earAt(time,start) {
  const age=time-start;
  if (age<0 || age>1.8) return 0;
  return age<.35 ? smooth(age/.35)
    : (1-smooth((age-.35)/1.45)) * (1+.10*Math.sin((age-.35)*9.));
}

function lookAt(time,start,pace=1) {
  const age=(time-start)/pace;
  if (age<0 || age>6.6) return 0;
  if (age<1.8) return smooth(age/1.8);
  if (age<3.) return 1;
  return 1-smooth((age-3.)/3.6);
}

export function sceneSample(milliseconds) {
  const time=Math.max(0,Number.isFinite(milliseconds)?milliseconds:0)/1000;
  const cycle=time%61;
  const blink=Math.max(...[4.8,13.1,22.4,31.2,31.64,43.7,53.8].map(t=>blinkAt(cycle,t)));
  const leftEar=Math.max(earAt(cycle,8.4),earAt(cycle,35.2),earAt(cycle,56.1))*.027;
  const rightEar=-Math.max(earAt(cycle,18.2),earAt(cycle,47.6))*.022;
  const ease=smooth(time/2.5);
  // A quiet inhale, a longer release, then a short rest. The slight variation
  // prevents the chest from moving like a perfectly repeating metronome.
  const phase=((time+.10*Math.sin(time*.17))%6.8)/6.8;
  const respiration=phase<.34 ? smooth(phase/.34)
    : phase<.88 ? 1-smooth((phase-.34)/.54) : 0;
  const attention=time%97;
  const headTurn=Math.max(lookAt(attention,6.5),lookAt(attention,31.,1.16)*.78,
    lookAt(attention,66.5,.94)*.92)*.045;
  return { seconds:time,blink,leftEar,rightEar,
    headTurn,
    breath:respiration*ease,
    gust:(.32+.25*Math.sin(time*.29)+.16*Math.sin(time*.71))*ease,
    atmosphere:.60,x:0,y:0 };
}

export function createHeroScene(image, doc=image.ownerDocument) {
  const canvas=doc.createElement("canvas");
  canvas.className="home-hero-lighting home-hero-portrait";
  canvas.setAttribute("aria-hidden","true");
  const gl=canvas.getContext("webgl",{ alpha:true,antialias:true,depth:false,stencil:false,
    premultipliedAlpha:true,preserveDrawingBuffer:false,powerPreference:"low-power",
    failIfMajorPerformanceCaveat:true });
  if (!gl) throw new Error("Homepage portrait unavailable");
  let program, art, closed, mesh;
  try {
    program=pipeline(gl); art=texture(gl,image,0); closed=texture(gl,image,1); mesh=grid(gl);
    gl.useProgram(program);
    const position=gl.getAttribLocation(program,"a_uv");
    gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position,2,gl.FLOAT,false,0,0);
    gl.uniform1i(gl.getUniformLocation(program,"u_art"),0);
    gl.uniform1i(gl.getUniformLocation(program,"u_closed"),1);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE,gl.ONE_MINUS_SRC_ALPHA);
  } catch (error) {
    if (program) gl.deleteProgram(program);
    if (art) gl.deleteTexture(art);
    if (closed) gl.deleteTexture(closed);
    if (mesh) { gl.deleteBuffer(mesh.vertices); gl.deleteBuffer(mesh.elements); }
    throw error;
  }
  const uniforms=Object.fromEntries(["time","breath","ears","gust","blink","look"]
    .map(name=>[name,gl.getUniformLocation(program,"u_"+name)]));
  let disposed=false,blinkReady=false,finishBlink;
  const ready=new Promise(resolve=>{ finishBlink=resolve; });
  const eyelid=new doc.defaultView.Image();
  eyelid.decoding="async";
  eyelid.onload=async()=>{
    try {
      await eyelid.decode();
      if (disposed || gl.isContextLost()) { finishBlink(false); return; }
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D,closed);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,eyelid);
      blinkReady=true; finishBlink(true);
    } catch { finishBlink(false); }
  };
  eyelid.onerror=()=>finishBlink(false);
  eyelid.src=new URL("./assets/brand/hero-zebra-blink.webp",import.meta.url).href;
  return { canvas,ready,
    resize(width,pixelRatio=1) {
      const size=Math.min(1024,Math.max(1,Math.round(width*Math.min(1.5,pixelRatio))));
      if (canvas.width===size && canvas.height===size) return;
      canvas.width=size; canvas.height=size; gl.viewport(0,0,size,size);
    },
    draw(sample) {
      if (disposed || gl.isContextLost()) throw new Error("Homepage portrait unavailable");
      gl.uniform1f(uniforms.time,sample.seconds);
      gl.uniform1f(uniforms.breath,sample.breath);
      gl.uniform2f(uniforms.ears,sample.leftEar,sample.rightEar);
      gl.uniform1f(uniforms.gust,sample.gust);
      gl.uniform1f(uniforms.look,sample.headTurn??0);
      gl.uniform1f(uniforms.blink,blinkReady?sample.blink:0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawElements(gl.TRIANGLES,mesh.count,gl.UNSIGNED_SHORT,0);
    },
    dispose() {
      if (disposed) return;
      disposed=true; finishBlink(false);
      eyelid.onload=null; eyelid.onerror=null; eyelid.removeAttribute("src");
      gl.deleteTexture(art); gl.deleteTexture(closed);
      gl.deleteBuffer(mesh.vertices); gl.deleteBuffer(mesh.elements); gl.deleteProgram(program);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    } };
}

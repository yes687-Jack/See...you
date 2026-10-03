import THREE from './three-global.js';
import './three-extras.js';
import { show } from '../ui/router.js';

// 3D 上色世界：程序化模型 / GLB 加载 / 顶点色喷涂 / 倾倒颜料模拟
// ===== 3D 建筑涂鸦（埃菲尔铁塔）=====
var scene3d,camera3d,renderer3d;
var raycaster=null,mouseNDC=null;
var lookYaw=0,lookPitch=0,camDist=9;   // 正对模型中心，旋转绕中心
var drawSurfaces=[];
var surfaceCanvas=[],surfaceCtx=[],surfaceTex=[];
var brushSize=60,toolMode='paint',sprayTimer=null,pourState=null,pourActive=false,brushCursor=null,lastEvt=null;
var faucetMarker=null,pourJet=null,pourJetTop=null,pourDrops=null;   // 水龙头壶口标记 + 下落颜料流 + 壶口液滴 + 下落粒子
var drawColor='#ea6668';   // 3D 上色当前颜色（init3d 内会按初始工具色再同步一次）

function enter3d(){
  if(typeof THREE==='undefined'){alert('3D引擎加载中，请稍等');return;}
  show('screen-3d');
  init3d();
  // 每次进入都打开颜色面板（init3d 只在首次执行；返回主页时会隐藏面板，需重新打开）
  var panel=document.getElementById('3d-color-panel');
  if(panel)panel.style.display='flex';
  // 每次进入都确保模型面板已绑定（幂等，不依赖 init3d 首次执行）
  if(!window.__modelPanelInit){window.__modelPanelInit=true;initModelPanel();}
}

function makeDrawCanvas(w,h,color){
  var c=document.createElement('canvas');
  c.width=w;c.height=h;
  var ctx=c.getContext('2d');
  ctx.fillStyle=color||'#8a7a6a';
  ctx.fillRect(0,0,w,h);
  var tex=new THREE.CanvasTexture(c);
  tex.flipY=false;
  return {canvas:c,ctx:ctx,tex:tex};
}

// ===== 流体熊（积木熊）程序化模型：6 面拼装，每面独立纹理 =====
// 涂鸦只出现在命中的那一面（不会同时出现在多个面）；漫灌方向按世界高度（竖直面 uv.y=世界 y）
function makeBoxFaces(w,h,d,color){
  var faces=[];
  function addFace(geo,rx,ry,dx,dy,dz){
    var dc=makeDrawCanvas(256,256,color);
    // 搪胶釉面：Phong 高光材质（双面防看穿），配合方向光呈现流体熊光泽
    var mat=new THREE.MeshPhongMaterial({map:dc.tex,side:THREE.DoubleSide,specular:new THREE.Color(0x000000),shininess:0});
    var m=new THREE.Mesh(geo,mat);
    m.rotation.x=rx;m.rotation.y=ry;
    m.position.set(dx,dy,dz);
    surfaceCanvas.push(dc.canvas);surfaceCtx.push(dc.ctx);surfaceTex.push(dc.tex);
    drawSurfaces.push(dc.tex);
    return m;
  }
  var w2=w/2,h2=h/2,d2=d/2;
  faces.push(addFace(new THREE.PlaneGeometry(w,h),0,0,0,0,d2));            // 前
  faces.push(addFace(new THREE.PlaneGeometry(w,h),0,Math.PI,0,0,-d2));     // 后
  faces.push(addFace(new THREE.PlaneGeometry(d,h),0,Math.PI/2,-w2,0,0));   // 左
  faces.push(addFace(new THREE.PlaneGeometry(d,h),0,-Math.PI/2,w2,0,0));   // 右
  faces.push(addFace(new THREE.PlaneGeometry(w,d),-Math.PI/2,0,0,h2,0));   // 顶
  faces.push(addFace(new THREE.PlaneGeometry(w,d),Math.PI/2,0,0,-h2,0));   // 底
  return faces;
}
// ===== 搪胶圆润部件：球体/圆柱 + 单张包裹画布（UV 直接映射：正面涂正面显示，不会镜像到背面）=====
function makeRoundCanvas(w,h,color){
  var c=document.createElement('canvas');c.width=w;c.height=h;
  var ctx=c.getContext('2d');
  ctx.fillStyle=color||MODEL_WHITE;ctx.fillRect(0,0,w,h);
  var tex=new THREE.CanvasTexture(c);tex.flipY=false;
  c.__init=color||MODEL_WHITE;   // 记录初始色：清除颜色时恢复角色本色
  return {canvas:c,ctx:ctx,tex:tex};
}
function mkSphere(root,r,x,y,z,parent,partName,color,sx,sy,sz){
  var dc=makeRoundCanvas(512,256,color||MODEL_WHITE);
  var mat=new THREE.MeshPhongMaterial({map:dc.tex,side:THREE.DoubleSide,specular:new THREE.Color(0x000000),shininess:0});
  var m=new THREE.Mesh(new THREE.SphereGeometry(r,28,20),mat);
  m.position.set(x,y,z);
  if(sx||sy||sz)m.scale.set(sx||1,sy||1,sz||1);
  m.userData.part=partName||'模型';
  (parent||root).add(m);
  surfaceCanvas.push(dc.canvas);surfaceCtx.push(dc.ctx);surfaceTex.push(dc.tex);
  drawSurfaces.push(dc.tex);
  return m;
}
function mkCyl(root,rt,rb,h,x,y,z,parent,partName,color){
  var dc=makeRoundCanvas(256,256,color||MODEL_WHITE);
  var mat=new THREE.MeshPhongMaterial({map:dc.tex,side:THREE.DoubleSide,specular:new THREE.Color(0x000000),shininess:0});
  var m=new THREE.Mesh(new THREE.CylinderGeometry(rt,rb,h,18,1),mat);
  m.position.set(x,y,z);
  m.userData.part=partName||'模型';
  (parent||root).add(m);
  surfaceCanvas.push(dc.canvas);surfaceCtx.push(dc.ctx);surfaceTex.push(dc.tex);
  drawSurfaces.push(dc.tex);
  return m;
}
// 椭球四肢：末端圆润一体成型（r128 无 CapsuleGeometry，用拉伸球体实现同样观感）
function mkLimbRound(root,r,len,px,py,off,partName,color){
  var sy=(len+2*r)/(2*r);   // 拉伸比：总高=len+2r，两端圆润收口
  return mkSphere(root,r,px,py-off,0,null,partName,color,1,sy,1);
}
// ===== 搪胶 Q 版五官助手：大眼睛+鼻子+嘴线（独立 mesh，aux 标记不参与涂色/漫灌/浇注）=====
function addQFace(model,cfg){
  var hw=cfg.w/2,hh=cfg.h/2,hd=cfg.d/2;
  var eyeR=Math.max(0.075,hw*0.20);          // 大眼（参考图：黑亮大圆珠）
  var eyeY=cfg.y-hh*0.02;                    // 眼睛在脸部中部略偏下
  var eyeZ=hd+eyeR*0.28;
  var eyeDX=hw*0.34;
  function ball(r,color,x,y,z,shin){
    var m=new THREE.Mesh(new THREE.SphereGeometry(r,18,14),
      new THREE.MeshPhongMaterial({color:color,specular:new THREE.Color(0xffffff),shininess:shin||80}));
    m.position.set(x,y,z);
    m.userData.aux=true;
    model.add(m);
    return m;
  }
  ball(eyeR,0x1a1a1e,-eyeDX,eyeY,eyeZ);   // 左眼
  ball(eyeR,0x1a1a1e,eyeDX,eyeY,eyeZ);    // 右眼
  var hl=eyeR*0.38;
  ball(hl,0xffffff,-eyeDX+eyeR*0.28,eyeY+eyeR*0.3,eyeZ+eyeR*0.55,200);   // 眼珠高光（大而亮）
  ball(hl,0xffffff,eyeDX+eyeR*0.28,eyeY+eyeR*0.3,eyeZ+eyeR*0.55,200);
  // 腮红：脸两侧下部粉红扁球（参考图公仔标配）
  if(cfg.blush!==false){
    var blR=Math.max(0.06,hw*0.13);
    function bl(r,c,x,y,z){
      var m=new THREE.Mesh(new THREE.SphereGeometry(r,14,10),
        new THREE.MeshPhongMaterial({color:c,specular:new THREE.Color(0x000000),shininess:0}));
      m.position.set(x,y,z);m.userData.aux=true;model.add(m);return m;
    }
    bl(blR,0xf2a8a8,-eyeDX*1.28,eyeY-hh*0.20,eyeZ-blR*0.1);
    bl(blR,0xf2a8a8,eyeDX*1.28,eyeY-hh*0.20,eyeZ-blR*0.1);
  }
  var noseR=cfg.noseBig?hw*0.15:Math.max(0.04,hw*0.085);
  ball(noseR,cfg.nose||0x4a4038,0,eyeY-hh*0.22,eyeZ+noseR*0.25);             // 小鼻子（偏下）
  if(cfg.mouth!==false){
    var mk=new THREE.Mesh(new THREE.BoxGeometry(hw*0.3,0.04,hw*0.05),
      new THREE.MeshBasicMaterial({color:cfg.mouth||0x3a3028}));
    mk.position.set(0,eyeY-hh*0.36,eyeZ+0.01);
    mk.userData.aux=true;
    model.add(mk);
  }
  return model;
}
// 宇航员面罩：半透明弧形头盔玻璃 + 内部眼睛
function addAstroVisor(model,cfg){
  var hw=cfg.w/2,hh=cfg.h/2,hd=cfg.d/2;
  var v=new THREE.Mesh(new THREE.SphereGeometry(hd*0.62,24,18),
    new THREE.MeshPhongMaterial({color:0x2b3a4a,transparent:true,opacity:0.62,specular:new THREE.Color(0x000000),shininess:0,side:THREE.DoubleSide}));
  v.position.set(0,cfg.y+hh*0.12,hd*0.88);   // 面罩中心在头表面附近，前缘凸出
  v.scale.set(1,0.8,0.55);
  v.userData.aux=true;
  model.add(v);
  function ball(r,color,x,y,z){
    var m=new THREE.Mesh(new THREE.SphereGeometry(r,18,14),
      new THREE.MeshPhongMaterial({color:color,specular:new THREE.Color(0x000000),shininess:0}));
    m.position.set(x,y,z);m.userData.aux=true;model.add(m);return m;
  }
  ball(Math.max(0.06,hw*0.15),0x1b1b20,-hw*0.34,cfg.y+hh*0.1,hd*0.78);   // 眼睛在面罩内部
  ball(Math.max(0.06,hw*0.15),0x1b1b20, hw*0.34,cfg.y+hh*0.1,hd*0.78);
  return model;
}
// ===== 角色模型工厂：搪胶 Q 版 6 面拼装，每面独立纹理、部位标记、可涂色 =====
var MODEL_WHITE='#f5f2ec';
function mkPartBox(root,w,h,d,x,y,z,parent,partName,color){
  var fs=makeBoxFaces(w,h,d,color||MODEL_WHITE);
  for(var i=0;i<fs.length;i++){
    fs[i].position.x+=x;fs[i].position.y+=y;fs[i].position.z+=z;
    fs[i].userData.part=partName||'模型';
    (parent||root).add(fs[i]);
  }
  return fs;
}
function mkLimb(root,w,h,d,px,py,off,partName,color){
  var g=new THREE.Group();
  g.position.set(px,py,0);
  mkPartBox(root,w,h,d,0,-off,0,g,partName,color);
  root.add(g);
  return g;
}
function finalizeModel(model){
  var box=new THREE.Box3().setFromObject(model);
  var s=4/(box.max.y-box.min.y);
  model.scale.set(s,s,s);
  box=new THREE.Box3().setFromObject(model);
  var cc=box.getCenter(new THREE.Vector3());
  model.position.set(-cc.x,-cc.y,-cc.z);
  return model;
}
function bindParts(model,armL,armR,legL,legR,body,head){
  window.__bearParts={model:model,armL:armL,armR:armR,legL:legL,legR:legR,body:body,head:head};
  window.__bearAnim='idle';
  window.__bearPose='standing';
  return model;
}
// 卡通 3D 小熊（Q 版泰迪）：超大圆头、短胖四肢、奶白吻部/肚皮/内耳、大眼高光+腮红、红色小领结
function buildCartoonBear(group){
  var model=new THREE.Group();
  var FUR='#c89a64',FUR_D='#a07040',CREAM='#f6e8ca',BOW='#e0655a';
  var body=mkSphere(model,0.46,0,0.02,0,null,'身体',FUR,1,0.92,0.85);      // 圆润微梨形身体
  mkSphere(model,0.30,0,0.02,0.33,null,'肚皮',CREAM,1,1.08,0.32);          // 奶白肚皮补丁
  var head=mkSphere(model,0.50,0,0.80,0,null,'头',FUR,1,0.90,0.90);        // 超大圆头深嵌入身体
  mkSphere(model,0.15,-0.32,1.21,0,null,'左耳',FUR,1,0.92,0.65);           // 圆耳嵌在头顶
  mkSphere(model,0.15,0.32,1.21,0,null,'右耳',FUR,1,0.92,0.65);
  mkSphere(model,0.082,-0.32,1.22,0.10,null,'左耳内',CREAM,1,0.85,0.45);   // 奶白内耳
  mkSphere(model,0.082,0.32,1.22,0.10,null,'右耳内',CREAM,1,0.85,0.45);
  mkSphere(model,0.18,0,0.62,0.42,null,'口鼻',CREAM,1.1,0.80,0.70);         // 奶白椭圆吻部
  var armL=mkLimbRound(model,0.15,0.26,-0.40,0.34,0.30,'左臂',FUR);         // 短粗手臂贴身体
  var armR=mkLimbRound(model,0.15,0.26,0.40,0.34,0.30,'右臂',FUR);
  var legL=mkLimbRound(model,0.19,0.20,-0.29,-0.34,0.26,'左腿',FUR_D);      // 深棕短腿
  var legR=mkLimbRound(model,0.19,0.20,0.29,-0.34,0.26,'右腿',FUR_D);
  mkSphere(model,0.09,0,0.26,-0.36,null,'尾巴',FUR,1,1,1);                 // 背后小圆尾
  mkSphere(model,0.11,0,0.45,0.36,null,'领结',BOW,0.85,0.50,0.35);          // 红色小领结
  addQFace(model,{w:1.0,h:0.86,d:0.9,y:0.80,nose:0x4a3224});
  finalizeModel(model);
  group.add(model);
  bindParts(model,armL,armR,legL,legR,body,head);
  return model;
}
// 猫咪：尖耳、竖尾
function buildCat(group){
  var model=new THREE.Group();
  var C='#e2ded8';
  var body=mkSphere(model,0.47,0,0.02,0,null,'身体',C,1,0.8,0.84);    // 浅灰猫
  var head=mkSphere(model,0.47,0,0.70,0,null,'头',C,1,0.88,0.92);     // 大头深嵌入身体
  mkSphere(model,0.12,-0.30,1.08,0,null,'左耳',0xb0a8a0,0.7,1.55,0.6);  // 深灰水滴尖耳：贴头
  mkSphere(model,0.12,0.30,1.08,0,null,'右耳',0xb0a8a0,0.7,1.55,0.6);
  var armL=mkLimbRound(model,0.15,0.28,-0.40,0.34,0.28,'左臂',C);        // 臂插入身体侧壁
  var armR=mkLimbRound(model,0.15,0.28,0.40,0.34,0.28,'右臂',C);
  var legL=mkLimbRound(model,0.17,0.20,-0.30,-0.33,0.24,'左腿',C);
  var legR=mkLimbRound(model,0.17,0.20,0.30,-0.33,0.24,'右腿',C);
  mkCyl(model,0.06,0.08,0.58,0.56,0.2,-0.4,null,'尾巴',0xb0a8a0);   // 深灰竖尾
  addQFace(model,{w:0.94,h:0.83,d:0.86,y:0.70,nose:0xe88aa0});
  finalizeModel(model);
  group.add(model);
  bindParts(model,armL,armR,legL,legR,body,head);
  return model;
}
// 狗狗：垂耳、短翘尾
function buildDog(group){
  var model=new THREE.Group();
  var C='#f0e6d0';
  var body=mkSphere(model,0.48,0,0.02,0,null,'身体',C,1,0.82,0.85);   // 米黄狗
  var head=mkSphere(model,0.48,0,0.72,0,null,'头',C,1,0.88,0.92);     // 头深嵌入身体
  mkSphere(model,0.15,-0.40,0.58,0.08,null,'左耳',0x9a7a58,0.8,1.2,0.55);  // 棕垂耳：贴头侧
  mkSphere(model,0.15,0.40,0.58,0.08,null,'右耳',0x9a7a58,0.8,1.2,0.55);
  var armL=mkLimbRound(model,0.16,0.30,-0.42,0.35,0.29,'左臂',C);
  var armR=mkLimbRound(model,0.16,0.30,0.42,0.35,0.29,'右臂',C);
  var legL=mkLimbRound(model,0.18,0.22,-0.30,-0.33,0.25,'左腿',C);
  var legR=mkLimbRound(model,0.18,0.22,0.30,-0.33,0.25,'右腿',C);
  mkCyl(model,0.05,0.09,0.3,0.52,0.42,-0.4,null,'尾巴',0x9a7a58);           // 棕短翘尾
  // 红色项圈（参考图：狗狗戴红项圈）
  var collar=new THREE.Mesh(new THREE.CylinderGeometry(0.52,0.52,0.09,18),
    new THREE.MeshPhongMaterial({color:0xc94f4f,specular:new THREE.Color(0x000000),shininess:0}));
  collar.position.set(0,0.32,0);collar.userData.aux=true;model.add(collar);
  addQFace(model,{w:0.96,h:0.84,d:0.88,y:0.72,nose:0x3a3028});
  finalizeModel(model);
  group.add(model);
  bindParts(model,armL,armR,legL,legR,body,head);
  return model;
}
// 宇航员：背包在身后
function buildAstro(group){
  var model=new THREE.Group();
  var C='#f2f4f6';
  var body=mkSphere(model,0.46,0,0.02,0,null,'身体',C,1,1.1,0.85);
  var head=mkSphere(model,0.46,0,0.88,0,null,'头',C,1,0.92,0.95);    // 大白头深嵌入
  var armL=mkLimbRound(model,0.16,0.32,-0.42,0.42,0.30,'左臂',C);
  var armR=mkLimbRound(model,0.16,0.32,0.42,0.42,0.30,'右臂',C);
  var legL=mkLimbRound(model,0.17,0.22,-0.30,-0.35,0.25,'左腿',C);
  var legR=mkLimbRound(model,0.17,0.22,0.30,-0.35,0.25,'右腿',C);
  mkSphere(model,0.24,0,0.06,-0.4,null,'背包',0xdde3e8,0.9,1.1,0.6);        // 灰白背包
  addAstroVisor(model,{w:0.92,h:0.85,d:0.87,y:0.88});
  finalizeModel(model);
  group.add(model);
  bindParts(model,armL,armR,legL,legR,body,head);
  return model;
}
// 精灵：尖耳、身后翅膀
function buildElf(group){
  var model=new THREE.Group();
  var C='#dcead8';
  var body=mkSphere(model,0.42,0,0.02,0,null,'身体',C,1,1.12,0.86);  // 浅绿精灵
  var head=mkSphere(model,0.42,0,0.84,0,null,'头',C,1,0.9,0.92);     // 头深嵌入
  mkSphere(model,0.11,-0.36,1.04,0,null,'左耳',0x7a9a6a,0.55,1.95,0.5);  // 深绿长尖耳：贴头
  mkSphere(model,0.11,0.36,1.04,0,null,'右耳',0x7a9a6a,0.55,1.95,0.5);
  var armL=mkLimbRound(model,0.13,0.28,-0.38,0.40,0.27,'左臂',C);
  var armR=mkLimbRound(model,0.13,0.28,0.38,0.40,0.27,'右臂',C);
  var legL=mkLimbRound(model,0.15,0.20,-0.27,-0.35,0.24,'左腿',C);
  var legR=mkLimbRound(model,0.15,0.20,0.27,-0.35,0.24,'右腿',C);
  mkSphere(model,0.18,-0.5,0.42,-0.16,null,'左翅膀',0xf0f4ee,0.3,0.9,0.4);
  mkSphere(model,0.18,0.5,0.42,-0.16,null,'右翅膀',0xf0f4ee,0.3,0.9,0.4);
  addQFace(model,{w:0.84,h:0.76,d:0.77,y:0.84,nose:0x7fb069});
  finalizeModel(model);
  group.add(model);
  bindParts(model,armL,armR,legL,legR,body,head);
  return model;
}
// 小丑：尖帽+帽球、大脚、蝴蝶结
function buildClown(group){
  var model=new THREE.Group();
  var C='#f7ece4';
  var body=mkSphere(model,0.48,0,0.0,0,null,'身体',C,1,0.95,0.85);   // 米白小丑
  var head=mkSphere(model,0.46,0,0.80,0,null,'头',C,1,0.9,0.92);     // 头深嵌入
  mkCyl(model,0.12,0.22,0.44,0,1.32,0,null,'帽子',0xd84040);         // 红尖帽（上细下粗）
  mkSphere(model,0.11,0,1.60,0,null,'帽球',0xf7f4f0);                // 白帽球
  var armL=mkLimbRound(model,0.17,0.30,-0.42,0.40,0.28,'左臂',C);
  var armR=mkLimbRound(model,0.17,0.30,0.42,0.40,0.28,'右臂',C);
  var legL=mkLimbRound(model,0.22,0.20,-0.30,-0.34,0.22,'左腿',C);   // 大脚
  var legR=mkLimbRound(model,0.22,0.20,0.30,-0.34,0.22,'右腿',C);
  mkSphere(model,0.13,0,0.5,0.34,null,'蝴蝶结',0xd84040,0.9,0.5,0.4);  // 红蝴蝶结
  addQFace(model,{w:0.92,h:0.83,d:0.85,y:0.80,nose:0xd84040,noseBig:true});
  finalizeModel(model);
  group.add(model);
  bindParts(model,armL,armR,legL,legR,body,head);
  return model;
}
// 熊猫：白身、黑耳、黑眼圈、黑四肢
function buildPanda(group){
  var model=new THREE.Group();
  var W='#f5f5f2',BLACK='#1a1a1a';
  var body=mkSphere(model,0.5,0,0.02,0,null,'身体',W,1,0.8,0.82);
  var head=mkSphere(model,0.5,0,0.74,0,null,'头',W,1,0.86,0.9);
  mkSphere(model,0.15,-0.30,1.16,0,null,'左耳',BLACK,1,0.85,0.6);
  mkSphere(model,0.15,0.30,1.16,0,null,'右耳',BLACK,1,0.85,0.6);
  var armL=mkLimbRound(model,0.17,0.30,-0.40,0.36,0.30,'左臂',BLACK);
  var armR=mkLimbRound(model,0.17,0.30,0.40,0.36,0.30,'右臂',BLACK);
  var legL=mkLimbRound(model,0.20,0.22,-0.30,-0.34,0.26,'左腿',BLACK);
  var legR=mkLimbRound(model,0.20,0.22,0.30,-0.34,0.26,'右腿',BLACK);
  mkSphere(model,0.13,-0.17,0.74,0.42,null,'左眼圈',BLACK,0.55,0.9,0.4);
  mkSphere(model,0.13,0.17,0.74,0.42,null,'右眼圈',BLACK,0.55,0.9,0.4);
  addQFace(model,{w:1.0,h:0.86,d:0.9,y:0.74,nose:0x1a1a1a});
  finalizeModel(model);
  group.add(model);
  bindParts(model,armL,armR,legL,legR,body,head);
  return model;
}

// ===== 模型切换：左侧两级面板（分类 → 模型）=====
var MODEL_LABELS={bear:'小熊',cat:'猫咪',dog:'狗狗',astro:'宇航员',elf:'精灵',panda:'熊猫'};
var MODEL_ICONS={bear:'🐻',cat:'🐱',dog:'🐶',astro:'🧑‍🚀',elf:'🧚',panda:'🐼'};
var MODEL_FNS={bear:buildCartoonBear,cat:buildCat,dog:buildDog,astro:buildAstro,elf:buildElf,clown:buildClown,panda:buildPanda};
var MODEL_CATS={animal:{label:'🐾 动物',items:['bear','cat','dog']},role:{label:'🧑‍🚀 角色',items:['astro','elf','panda']}};
// 真实 glb 模型（CC0/CC-BY，poly.pizza 公开资源）
var GLB_MODELS={};   // 远程 GLB 已全部失效（doubaocdn 404）；熊改为程序化卡通熊，不再内嵌 base64
var MODEL_SRC={};
for(var _k in GLB_MODELS)MODEL_SRC[_k]={glb:GLB_MODELS[_k]};
for(var _f in MODEL_FNS)if(!MODEL_SRC[_f])MODEL_SRC[_f]={fn:MODEL_FNS[_f]};
var currentModelKind='bear';
var openModelCat=null;
var GLB_BUSY={};
var MODEL_ANIM_NAMES={idle:'静止',walk:'走路',run:'跑步',wave:'打招呼',dance:'跳舞',jump:'跳跃',punch:'打拳',thumbsup:'点赞',sit:'坐下',stand:'站立'};
var ANIM_ALIASES={idle:['Idle','Idle1','Stand','Standing','Breathing','Pose','TPose','Sit','Sitting'],
  walk:['Walk','Walking'],run:['Run','Running','Sprint'],wave:['Wave','Waving','Hello','Hi'],
  dance:['Dance','Dancing'],jump:['Jump','Jumping'],punch:['Punch','Punching','Box'],
  thumbsup:['ThumbsUp','Thumbs','Like'],sit:['Sit','Sitting'],stand:['Stand','Standing','Idle']};
// 把 glb 模型的所有部件材质统一为搪胶光泽 Phong（保留原色），记录初始色供清除恢复
// 颜色转 hex（兼容 string / THREE.Color / number）
function toHex(c){
  if(typeof c==='string')return parseInt(c.replace('#',''),16);
  if(c&&c.getHex)return c.getHex();
  if(typeof c==='number')return c;
  return 0x3366ff;
}
// 低模加密：1 级中点细分（顶点×4），全新重建 BufferGeometry，让顶点色涂色过渡更细腻
function subdivideAll(root){
  var list=[];
  root.traverse(function(c){if(c.isMesh&&c.geometry&&c.geometry.index)list.push(c);});
  for(var si=0;si<list.length;si++){
    var c=list[si],g=c.geometry;
    var pos=g.attributes.position,idx=g.index.array;
    if(!pos||pos.count<3||idx.length%3!==0)continue;
    if(pos.count>30000)continue;
    try{
      var arr=[];
      for(var v=0;v<pos.count;v++)arr.push([pos.getX(v),pos.getY(v),pos.getZ(v)]);
      var midMap={};
      function mid(a,b){
        var key=a<b?a+'-'+b:b+'-'+a;
        if(midMap[key]!==undefined)return midMap[key];
        var va=arr[a],vb=arr[b];
        arr.push([(va[0]+vb[0])/2,(va[1]+vb[1])/2,(va[2]+vb[2])/2]);
        var ni=arr.length-1;midMap[key]=ni;
        return ni;
      }
      var nIdx=[];
      for(var f=0;f<idx.length;f+=3){
        var a=idx[f],b=idx[f+1],c=idx[f+2];
        var ab=mid(a,b),bc=mid(b,c),ca=mid(c,a);
        nIdx.push(a,ab,ca, b,bc,ab, c,ca,bc, ab,bc,ca);
      }
      var nPos=new Float32Array(arr.length*3);
      for(var i2=0;i2<arr.length;i2++){nPos[i2*3]=arr[i2][0];nPos[i2*3+1]=arr[i2][1];nPos[i2*3+2]=arr[i2][2];}
      var ng=new THREE.BufferGeometry();
      ng.setAttribute('position',new THREE.BufferAttribute(nPos,3));
      ng.setIndex(nIdx);
      ng.computeVertexNormals();
      ng.computeBoundingSphere();ng.computeBoundingBox();
      c.geometry=ng;
    }catch(e){}
  }
}
// 重建 UV（世界坐标投影 + 法线符号分区）：无镜像、正反/上下/左右对称面各占一半纹理区域，
// 涂一处只在对应区域出现（不会同时画到对称面）；UV 与几何位置一一对应，支持纹理级硬边涂色
function rebuildUvBox(geo){
  var pos=geo.attributes.position;
  if(!pos)return;
  if(!geo.attributes.normal)geo.computeVertexNormals();
  var norm=geo.attributes.normal;
  var bb=new THREE.Box3().setFromBufferAttribute(pos);
  var sz=new THREE.Vector3();bb.getSize(sz);
  var sx=sz.x||1,sy=sz.y||1,szz=sz.z||1;
  var uvs=new Float32Array(pos.count*2);
  for(var i=0;i<pos.count;i++){
    var nx=norm.getX(i),ny=norm.getY(i),nz=norm.getZ(i);
    var ax=Math.abs(nx),ay=Math.abs(ny),az=Math.abs(nz);
    var x=pos.getX(i),y=pos.getY(i),z=pos.getZ(i);
    var u,v;
    if(ax>=ay&&ax>=az){u=z;v=y;u=(u-bb.min.z)/(szz*2)+(nx<0?0.5:0);v=(v-bb.min.y)/sy;}
    else if(ay>=ax&&ay>=az){u=x;v=z;u=(u-bb.min.x)/(sx*2)+(ny<0?0.5:0);v=(v-bb.min.z)/szz;}
    else{u=x;v=y;u=(u-bb.min.x)/(sx*2)+(nz<0?0.5:0);v=(v-bb.min.y)/sy;}
    if(u<0)u=0;if(u>1)u=1;if(v<0)v=0;if(v>1)v=1;
    uvs[i*2]=u;uvs[i*2+1]=v;
  }
  geo.setAttribute('uv',new THREE.BufferAttribute(uvs,2));
}
// ===== shader 涂色点（替代 UV 纹理涂色）：片元到涂色点（模型局部坐标）距离 < 半径 → 涂色
// 硬边、面积=半径、无 UV 依赖（对称面/镜像天然免疫）、跟随模型旋转
function addDecalShader(mat){
  mat.onBeforeCompile=function(sh){
    var cap=window.__paintCap||40;
    var segCap=window.__segCap||30;
    var capS=String(cap),segS=String(segCap);
    sh.uniforms.uPaintData={value:new Float32Array(cap*4)};  // 喷雾点：xyz=局部坐标, w=半径
    sh.uniforms.uPaintCol={value:new Float32Array(cap*4)};   // rgb=颜色, a=透明度
    sh.uniforms.uPaintCount={value:0};
    sh.uniforms.uSegA={value:new Float32Array(segCap*4)};    // 画笔线段：起点 xyz
    sh.uniforms.uSegB={value:new Float32Array(segCap*4)};    // 终点 xyz + 半径(w)
    sh.uniforms.uSegCol={value:new Float32Array(segCap*4)};  // 线段颜色 rgb + a
    sh.uniforms.uSegCount={value:0};
    sh.vertexShader='varying vec3 vPaintLocal;\n'+sh.vertexShader;
    sh.vertexShader=sh.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\n vPaintLocal=transformed;');
    sh.fragmentShader='varying vec3 vPaintLocal;\nuniform vec4 uPaintData['+capS+'];uniform vec4 uPaintCol['+capS+'];uniform int uPaintCount;uniform vec4 uSegA['+segS+'];uniform vec4 uSegB['+segS+'];uniform vec4 uSegCol['+segS+'];uniform int uSegCount;\n'+sh.fragmentShader;
    sh.fragmentShader=sh.fragmentShader.replace('gl_FragColor = vec4( outgoingLight, diffuseColor.a );',
      'vec3 paintC=outgoingLight;\nfor(int i=0;i<'+segS+';i++){if(i>=uSegCount)break;vec3 sa=uSegA[i].xyz;vec3 sb=uSegB[i].xyz;float rr=uSegB[i].w;if(rr<=0.0)continue;vec3 ab=sb-sa;float tt=clamp(dot(vPaintLocal-sa,ab)/max(dot(ab,ab),1e-8),0.0,1.0);float dd=length(vPaintLocal-(sa+ab*tt));if(dd<rr){paintC=mix(paintC,uSegCol[i].rgb,uSegCol[i].a);}}\nfor(int j=0;j<'+capS+';j++){if(j>=uPaintCount)break;float d=length(vPaintLocal-uPaintData[j].xyz);if(d<uPaintData[j].w){paintC=mix(paintC,uPaintCol[j].rgb,uPaintCol[j].a);}}\ngl_FragColor = vec4( paintC, diffuseColor.a );');
    mat.userData=mat.userData||{};
    mat.userData.__shader=sh;
  };
}
window.__paintPoints=[];
window.__paintSegsMap={};
// 涂色点满了不丢：烘焙进顶点色（永久保留），然后清空继续画 → 无限容量
function bakePaintToVertex(){
  var pts=window.__paintPoints;
  var map=window.__paintSegsMap;
  var segTotal=0;for(var kM in map)segTotal+=map[kM].length;
  if(!window.__glbModel||(pts.length===0&&segTotal===0))return;
  // 线段采样成点（步长 r），与喷雾点合并 → 全部笔迹
  var all=pts.slice();
  for(var kM2 in map){
    var segs=map[kM2];
    for(var si=0;si<segs.length;si++){
      var sg=segs[si];
      var len=sg.a.distanceTo(sg.b);
      var n=Math.max(1,Math.ceil(len/(sg.r*0.8)));
      for(var q=0;q<=n;q++){
        var t=q/n;
        all.push({p:sg.a.clone().lerp(sg.b,t),r:sg.r*0.85,c:sg.c,a:sg.alpha});
      }
    }
  }
  window.__glbModel.meshes.forEach(function(m){
    var g=m.geometry;
    if(!g||!g.attributes||!g.attributes.position||!g.attributes.color)return;
    var pos=g.attributes.position,col=g.attributes.color;
    // mesh bbox 粗筛：只处理与笔迹相交的 mesh，再按三角形中心判定（硬边色块、面积≈笔刷）
    var bb=new THREE.Box3().setFromBufferAttribute(pos);
    var hitPts=[];
    for(var pi=0;pi<all.length;pi++){
      var pp=all[pi];
      if(pp.p.x+pp.r<bb.min.x||pp.p.x-pp.r>bb.max.x||pp.p.y+pp.r<bb.min.y||pp.p.y-pp.r>bb.max.y||pp.p.z+pp.r<bb.min.z||pp.p.z-pp.r>bb.max.z)continue;
      hitPts.push(pp);
    }
    if(hitPts.length===0)return;
    for(var vi=0;vi+2<pos.count;vi+=3){
      var cx=(pos.getX(vi)+pos.getX(vi+1)+pos.getX(vi+2))/3;
      var cy=(pos.getY(vi)+pos.getY(vi+1)+pos.getY(vi+2))/3;
      var cz=(pos.getZ(vi)+pos.getZ(vi+1)+pos.getZ(vi+2))/3;
      var hitP=null,hitD2=Infinity;
      for(var hi=0;hi<hitPts.length;hi++){
        var hp=hitPts[hi];
        var dx=cx-hp.p.x,dy=cy-hp.p.y,dz=cz-hp.p.z;
        var d2=dx*dx+dy*dy+dz*dz;
        var rr=hp.r*1.05;
        if(d2<rr*rr&&d2<hitD2){hitD2=d2;hitP=hp;}
      }
      if(hitP){
        var c2=hitP.c,a2=hitP.a;
        var nr=(c2>>16&255)/255,ng=(c2>>8&255)/255,nb=(c2&255)/255;
        for(var kt2=0;kt2<3;kt2++){
          var or_=col.getX(vi+kt2),og=col.getY(vi+kt2),ob=col.getZ(vi+kt2);
          col.setXYZ(vi+kt2,or_*(1-a2)+nr*a2,og*(1-a2)+ng*a2,ob*(1-a2)+nb*a2);
        }
      }
    }
    col.needsUpdate=true;
    var mats=Array.isArray(m.material)?m.material:[m.material];
    for(var i3=0;i3<mats.length;i3++){if(mats[i3])mats[i3].color.set(0xffffff);}
  });
  window.__paintPoints=[];
  window.__paintSegsMap={};
  syncPaintUniforms();
  syncPaintSegs();
}
function paintPushPoint(pp){
  var pts=window.__paintPoints;
  var last=pts[pts.length-1];
  if(last&&last.p.distanceTo(pp.p)<pp.r*0.4)return;
  if(pts.length>=(window.__paintCap||64)){
    bakePaintToVertex();   // 满了不丢：当前所有笔迹烘焙进顶点色，永久保留
  }
  pts.push(pp);
  syncPaintUniforms();
}
// 画笔线段：同 mesh + 同色 + 同向自动合并为一条（直线笔画=1 条，容量≈笔数）
function paintPushSeg(seg){
  var map=window.__paintSegsMap;
  var segs=map[seg.meshId]||(map[seg.meshId]=[]);
  var last=segs[segs.length-1];
  if(last&&last.c===seg.c&&Math.abs(last.r-seg.r)<Math.max(1e-4,last.r*0.05)){
    var d1=last.b.clone().sub(last.a);
    var d2=seg.b.clone().sub(seg.a);
    var l1=d1.length(),l2=d2.length();
    if(l1>1e-6&&l2>1e-6){
      var dot=(d1.x*d2.x+d1.y*d2.y+d1.z*d2.z)/(l1*l2);
      if(dot>0.94){last.b.copy(seg.b);syncPaintSegs();return;}
    }
  }
  if(segs.length>=(window.__segCap||30)){
    bakePaintToVertex();   // 满了不丢：当前所有笔迹烘焙进顶点色，永久保留
  }
  segs.push(seg);
  syncPaintSegs();
}
function syncPaintSegs(){
  if(!window.__glbModel)return;
  var cap=window.__segCap||30;
  var map=window.__paintSegsMap;
  window.__glbModel.meshes.forEach(function(m){
    var segs=map[m.id]||[];
    var nSeg=Math.min(segs.length,cap);
    var aArr=new Float32Array(cap*4),bArr=new Float32Array(cap*4),colArr=new Float32Array(cap*4);
    for(var i=0;i<nSeg;i++){
      aArr[i*4]=segs[i].a.x;aArr[i*4+1]=segs[i].a.y;aArr[i*4+2]=segs[i].a.z;aArr[i*4+3]=0;
      bArr[i*4]=segs[i].b.x;bArr[i*4+1]=segs[i].b.y;bArr[i*4+2]=segs[i].b.z;bArr[i*4+3]=segs[i].r;
      var c=segs[i].c;
      colArr[i*4]=(c>>16&255)/255;colArr[i*4+1]=(c>>8&255)/255;colArr[i*4+2]=(c&255)/255;colArr[i*4+3]=segs[i].alpha;
    }
    var mats=Array.isArray(m.material)?m.material:[m.material];
    for(var i2=0;i2<mats.length;i2++){
      var sm=mats[i2]&&mats[i2].userData&&mats[i2].userData.__shader;
      if(sm){
        sm.uniforms.uSegA.value=aArr;
        sm.uniforms.uSegB.value=bArr;
        sm.uniforms.uSegCol.value=colArr;
        sm.uniforms.uSegCount.value=nSeg;
      }
    }
  });
}
function syncPaintUniforms(){
  var pts=window.__paintPoints;
  var cap=window.__paintCap||64;
  var dataArr=new Float32Array(cap*4),colArr=new Float32Array(cap*4);
  for(var i=0;i<pts.length;i++){
    dataArr[i*4]=pts[i].p.x;dataArr[i*4+1]=pts[i].p.y;dataArr[i*4+2]=pts[i].p.z;dataArr[i*4+3]=pts[i].r;
    var c=pts[i].c;
    colArr[i*4]=(c>>16&255)/255;colArr[i*4+1]=(c>>8&255)/255;colArr[i*4+2]=(c&255)/255;colArr[i*4+3]=pts[i].a;
  }
  if(!window.__glbModel)return;
  window.__glbModel.meshes.forEach(function(m){
    var mats=Array.isArray(m.material)?m.material:[m.material];
    for(var i2=0;i2<mats.length;i2++){
      var sm=mats[i2]&&mats[i2].userData&&mats[i2].userData.__shader;
      if(sm){
        sm.uniforms.uPaintData.value=dataArr;
        sm.uniforms.uPaintCol.value=colArr;
        sm.uniforms.uPaintCount.value=pts.length;
      }
    }
  });
}
// 每三角形独立顶点：三角形 3 顶点颜色始终一致 → 三角形内无渐变插值（烘焙/填色呈硬边色块）
function splitFlat(g){
  try{
    var pos=g.attributes.position,norm=g.attributes.normal;
    if(!pos)return g;
    if(!norm)g.computeVertexNormals();
    norm=g.attributes.normal;
    var idx=g.index;
    if(!idx)return g;
    var iarr=idx.array;
    var nV=iarr.length;
    if(nV%3!==0)return g;
    var newPos=new Float32Array(nV*3),newNorm=new Float32Array(nV*3);
    for(var i=0;i<nV;i++){
      var vi=iarr[i];
      newPos[i*3]=pos.getX(vi);newPos[i*3+1]=pos.getY(vi);newPos[i*3+2]=pos.getZ(vi);
      newNorm[i*3]=norm.getX(vi);newNorm[i*3+1]=norm.getY(vi);newNorm[i*3+2]=norm.getZ(vi);
    }
    var ng=new THREE.BufferGeometry();
    ng.setAttribute('position',new THREE.BufferAttribute(newPos,3));
    ng.setAttribute('normal',new THREE.BufferAttribute(newNorm,3));
    ng.setIndex(null);
    ng.computeBoundingSphere();ng.computeBoundingBox();
    return ng;
  }catch(e){return g;}
}
function prepareGlb(root){
  var capU=0;
  try{
    var glc=renderer3d&&renderer3d.getContext();
    if(glc&&glc.MAX_FRAGMENT_UNIFORM_VECTORS)capU=glc.getParameter(glc.MAX_FRAGMENT_UNIFORM_VECTORS);
  }catch(e3){}
  if(!capU||capU<32)capU=224;
  var availU=(capU-24);
  window.__segCap=Math.max(16,Math.min(240,Math.floor(availU*0.45/3)));
  window.__paintCap=Math.max(16,Math.min(240,Math.floor(availU*0.4/2)));
  while(3*window.__segCap+2*window.__paintCap>availU){
    if(window.__segCap>4)window.__segCap--;
    else if(window.__paintCap>1)window.__paintCap--;
    else break;
  }
  root.traverse(function(c){
    if(c.isMesh){
      var mats=Array.isArray(c.material)?c.material:[c.material];
      var initCol=null;
      for(var i=0;i<mats.length;i++){
        var m=mats[i];
        if(m){
          var col=(m.color?m.color.getHex():0xcccccc);
          if(initCol==null)initCol=col;
          var nm=new THREE.MeshPhongMaterial({color:0xffffff,side:THREE.DoubleSide,specular:new THREE.Color(0x000000),shininess:0,vertexColors:true});
          addDecalShader(nm);
          if(Array.isArray(c.material))c.material[i]=nm;else c.material=nm;
          if(m.map)m.map.dispose();
          if(m.dispose)m.dispose();
        }
      }
      c.userData.__initColor=(initCol!=null)?initCol:0xcccccc;
      c.userData.__colorable=true;
      // 几何离散化：每三角形独立顶点（涂色/填色呈硬边色块，无插值光晕）
      var g=c.geometry;
      if(g&&g.attributes&&g.attributes.position&&g.index){g=splitFlat(g);c.geometry=g;}
      // 涂色走 shader 涂色点（模型局部坐标距离判定）——无 UV 依赖、无镜像/对称串色
      // 顶点色=原部件色（材质白直接呈现）；浇注/填色/烘焙都染顶点色；涂色点渲染在最上层
      if(g&&g.attributes&&g.attributes.position){
        var posC=g.attributes.position;
        var icR=(c.userData.__initColor>>16&255)/255,icG=(c.userData.__initColor>>8&255)/255,icB=(c.userData.__initColor&255)/255;
        var colArr=new Float32Array(posC.count*3);
        for(var kC=0;kC<posC.count;kC++){colArr[kC*3]=icR;colArr[kC*3+1]=icG;colArr[kC*3+2]=icB;}
        g.setAttribute('color',new THREE.BufferAttribute(colArr,3));
      }
    }
  });
}
function centerModelGroup(g){
  var box=new THREE.Box3().setFromObject(g);
  var cc=box.getCenter(new THREE.Vector3());
  window.__modelHalfH=(box.max.y-box.min.y)/2;
  if(!window.__camTarget)window.__camTarget=new THREE.Vector3(0,0,0);
  window.__camTarget.set(cc.x,cc.y,cc.z);
  var dbg=document.getElementById('3d-dbg');
  if(dbg)dbg.textContent='已切换：'+(MODEL_ICONS[currentModelKind]||'')+' '+(MODEL_LABELS[currentModelKind]||currentModelKind);
}
function glbFindClip(name){
  if(!window.__animClips)return null;
  var al=ANIM_ALIASES[name]||[name];
  for(var i=0;i<al.length;i++){
    var c=THREE.AnimationClip.findByName(window.__animClips,al[i]);
    if(c)return c;
  }
  for(var j=0;j<window.__animClips.length;j++){
    var nm=window.__animClips[j].name||'';
    for(var k=0;k<al.length;k++){
      if(nm.toLowerCase().indexOf(al[k].toLowerCase())>=0)return window.__animClips[j];
    }
  }
  return null;
}
function setGlbAnim(name,hold){
  try{
    if(!window.__mixer)return;
    var clip=glbFindClip(name);
    if(!clip)return;
    var mixer=window.__mixer;
    if(hold){
      mixer.stopAllAction();
      var a=mixer.clipAction(clip);
      a.reset();a.play();a.time=0;a.paused=true;
      window.__curAction=a;
    }else{
      var act=mixer.clipAction(clip);
      if(window.__curAction&&window.__curAction!==act)window.__curAction.fadeOut(0.3);
      act.reset();act.play();act.fadeIn(0.3);
      window.__curAction=act;
    }
  }catch(e){console.error('动画失败',e)}
}
// 部件着色（glb 模式）：mesh 材质 color 染色
function colorMesh(mesh,c){
  var mats=Array.isArray(mesh.material)?mesh.material:[mesh.material];
  for(var i=0;i<mats.length;i++){
    var m=mats[i];
    if(m&&m.color)m.color.set(c);
  }
}
function addSheenGlb(){
  if(!window.__glbModel)return;
  window.__glbModel.meshes.forEach(function(m){
    var mats=Array.isArray(m.material)?m.material:[m.material];
    for(var i=0;i<mats.length;i++){if(mats[i]){mats[i].shininess=0;if(mats[i].specular)mats[i].specular.set(0x000000);}}
  });
}
// ===== 顶点色工具（GLB 涂色核心：按世界坐标/顶点上色，无 UV 镜像偏差）=====
// 颜色字符串/数字 → [r,g,b] 数字数组（浇注预计算时解析一次，染顶点零分配）
function parseColorArr(c){
  if(typeof c==='number')return [((c>>16)&255)/255,((c>>8)&255)/255,(c&255)/255];
  var col=new THREE.Color(c);
  return [col.r,col.g,col.b];
}
function vertSetColor(v,colArr){
  var g=v.mesh.geometry,colA=g.attributes.color;
  if(!colA)return;
  colA.setXYZ(v.idx,colArr[0],colArr[1],colArr[2]);
}
function flushVertColors(meshes){
  if(!meshes)return;
  for(var i=0;i<meshes.length;i++){
    var g=meshes[i].geometry;
    if(g&&g.attributes&&g.attributes.color)g.attributes.color.needsUpdate=true;
  }
}
// 画笔/喷雾：命中点 world 位置附近 radius 内顶点上色（视觉精确）
function colorRadius(mesh,point,radius,color,alpha,rand,soft){
  var g=mesh.geometry,colA=g.attributes.color,posA=g.attributes.position;
  if(soft==null)soft=0.6;
  if(!colA||!posA)return 0;
  var wp=new THREE.Vector3();
  var r2=radius*radius;
  var n=0;
  for(var i=0;i<posA.count;i++){
    wp.fromBufferAttribute(posA,i).applyMatrix4(mesh.matrixWorld);
    var dx=wp.x-point.x,dy=wp.y-point.y,dz=wp.z-point.z;
    var d2=dx*dx+dy*dy+dz*dz;
    if(d2<=r2){
      if(rand&&Math.random()>rand)continue;
      var f=alpha;
      if(soft>0&&radius>0)f=alpha*(1-Math.sqrt(d2/r2)*soft);
      else f=alpha;
      var c=new THREE.Color(color);
      var r0=colA.getX(i),g0=colA.getY(i),b0=colA.getZ(i);
      colA.setXYZ(i,r0+(c.r-r0)*f,g0+(c.g-g0)*f,b0+(c.b-b0)*f);
      n++;
    }
  }
  colA.needsUpdate=true;
  return n;
}
// GLB 半径归一化：按 mesh 世界尺寸换算（模型 scale 后可能只有 2 单位高，绝对半径会罩住全身）
function glbRadius(mesh,frac){
  var bb=new THREE.Box3().setFromObject(mesh);
  var sz=bb.getSize(new THREE.Vector3());
  var unit=Math.max(sz.x,Math.max(sz.y,sz.z));
  return Math.max(unit*0.005,unit*frac);
}
// 填色：整 mesh 全部顶点上色
function fillMeshAll(mesh,color){
  var g=mesh.geometry,colA=g.attributes.color;
  if(!colA)return 0;
  var c=new THREE.Color(color);
  for(var i=0;i<colA.count;i++){colA.setXYZ(i,c.r,c.g,c.b);}
  colA.needsUpdate=true;
  return colA.count;
}
// glb 漫灌：液面从头顶降到脚底，顶点色按世界高度逐个下移（顶点间自动插值→平滑流淌）
function floodStepGlb(){
  var fl=window.__flood;
  if(!fl||!fl.active)return;
  if(!fl.verts||fl.verts.length===0){fl.active=false;return;}
  fl.progress+=fl.speed*(window.__dt3||0.016);
  if(fl.progress>=1){
    fl.progress=1;fl.active=false;
    for(var vi2=0;vi2<fl.verts.length;vi2++){
      var v2=fl.verts[vi2];
      if(!v2.done){v2.done=true;vertSetColor(v2,v2.col);}
    }
    flushVertColors(fl.meshes);
    addSheenGlb();
    window.__pourMeter={val:0,active:false,rate:0,poured:false,recharging:true};
    var dbg=document.getElementById('3d-dbg');
    if(dbg)dbg.textContent='浇注完成：颜料已铺满全身 🎨（能量恢复中）';
    return;
  }
  var liquidY=fl.topY-fl.progress*(fl.topY-fl.botY);
  var doneAll=true;
  for(var vi=0;vi<fl.verts.length;vi++){
    var v=fl.verts[vi];
    if(v.done)continue;
    if(liquidY<=v.wy){v.done=true;vertSetColor(v,v.col);}
    else{doneAll=false;}
  }
  if(doneAll){fl.progress=1;return;}
  flushVertColors(fl.meshes);
}
// 加载真实 glb 模型并替换当前模型
function loadGlbModel(kind){
  var url=GLB_MODELS[kind];
  if(!url||GLB_BUSY[kind])return;
  GLB_BUSY[kind]=true;
  var loader=new THREE.GLTFLoader();
  var dbg=document.getElementById('3d-dbg');
  if(dbg)dbg.textContent='正在加载真实模型…';
  function onOk(gltf){
    GLB_BUSY[kind]=false;
    try{
      var root=gltf.scene||(gltf.scenes&&gltf.scenes[0]);
      if(!root)throw new Error('empty gltf');
      subdivideAll(root);
      subdivideAll(root);
      prepareGlb(root);
      // 归一化：高度=2，中心在原点，底部 -1
      var box=new THREE.Box3().setFromObject(root);
      var h=(box.max.y-box.min.y)||1;
      root.scale.setScalar(2.0/h);
      box.setFromObject(root);
      var cc=box.getCenter(new THREE.Vector3());
      root.position.x-=cc.x;root.position.y-=cc.y;root.position.z-=cc.z;
      var mixer=new THREE.AnimationMixer(root);
      window.__mixer=mixer;
      window.__animClips=gltf.animations||[];
      window.__glbModel={root:root,mixer:mixer,kind:kind,meshes:[]};
      root.traverse(function(c){if(c.isMesh&&c.userData.__colorable)window.__glbModel.meshes.push(c)});
      // 替换旧模型（程序化占位 / 默认熊）
      var old=(window.__bearParts&&window.__bearParts.model)||window.__pendingGlb;
      window.__pendingGlb=null;
      if(old){disposeObject(old);if(old.parent)old.parent.remove(old);}
      window.__bearParts=null;
      surfaceCanvas=[];surfaceCtx=[];surfaceTex=[];drawSurfaces=[];
      lastPaintTex=null;pourState=null;pourActive=false;
      window.__paintSegsMap={};
      if(pourDrops)pourDrops.forEach(function(d){d.visible=false;d.ph=null});
      if(pourJetTop)pourJetTop.visible=false;
      if(pourJet)pourJet.visible=false;
      window.__jetTop=null;window.__pourMeter=null;
      (window.__modelGroup?window.__modelGroup:scene3d).add(root);
      window.__modelHalfH=1;
      if(!window.__camTarget)window.__camTarget=new THREE.Vector3(0,0,0);
      window.__camTarget.set(0,0,0);
      var dbg2=document.getElementById('3d-dbg');
      if(dbg2)dbg2.textContent='已加载真实模型：'+(MODEL_LABELS[kind]||kind);
      var __m0=window.__glbModel.meshes[0];
      var __c0='?';
      try{var __mm=Array.isArray(__m0.material)?__m0.material[0]:__m0.material;__c0=__mm&&__mm.color?('#'+__mm.color.getHexString()):'noColor';}catch(e9){}
      var __nL=scene3d.children.filter(function(x){return x.isLight}).length;
      document.title='[GLB OK '+kind+'] '+window.__glbModel.meshes.length+' meshes c0='+__c0+' lights='+__nL;
      // 初始静止（pose）
      setGlbAnim('idle',true);
      // 清模型颜色按钮状态
      try{
        var cb=document.getElementById('3d-clear-btn');
        if(cb&&cb.onclick)cb.style.background='rgba(234,102,104,.25)';
      }catch(e3){}
    }catch(err){
      onErr(err);
    }
  }
  function onErr(em){
    GLB_BUSY[kind]=false;
    var dbg3=document.getElementById('3d-dbg');
    if(dbg3)dbg3.textContent='真实模型加载失败，使用备用模型';
    document.title='[GLB ERR '+kind+'] '+(em&&em.message?em.message:em||'');
    // 占位模型保留在场景中（不重复添加，避免双熊叠加）
  }
  if(url.indexOf('data:')===0){
    // 内嵌 glb：base64 → ArrayBuffer → parse（最可靠，file:// 也能用，无跨域）
    try{
      var b64=url.slice(url.indexOf(',')+1);
      var bin=atob(b64);
      var arr=new Uint8Array(bin.length);
      for(var i=0;i<bin.length;i++)arr[i]=bin.charCodeAt(i);
      loader.parse(arr.buffer,'',function(gltf){onOk(gltf);},function(e){onErr(e);});
    }catch(e){
      onErr();
    }
  }else{
    loader.load(url,function(gltf){onOk(gltf);},undefined,function(e){onErr(e);});
  }
}
function disposeObject(root){
  root.traverse(function(c){
    if(c.geometry)c.geometry.dispose();
    if(c.material){
      if(Array.isArray(c.material))c.material.forEach(function(m){if(m.map)m.map.dispose();m.dispose();});
      else{if(c.material.map)c.material.map.dispose();c.material.dispose();}
    }
  });
}
function switchModel(kind){
  if(kind===currentModelKind||!MODEL_SRC[kind])return;
  currentModelKind=kind;
  // 清理旧模型（glb / 程序化）
  var glb=window.__glbModel;
  if(glb){
    try{if(window.__mixer)window.__mixer.stopAllAction();}catch(e0){}
    disposeObject(glb.root);
    if(glb.root.parent)glb.root.parent.remove(glb.root);
  }
  var old=window.__bearParts&&window.__bearParts.model;
  var pend=window.__pendingGlb;
  if(pend){disposeObject(pend);if(pend.parent)pend.parent.remove(pend);}
  if(old){disposeObject(old);if(old.parent)old.parent.remove(old);}
  window.__bearParts=null;window.__glbModel=null;window.__mixer=null;window.__animClips=null;window.__pendingGlb=null;
  surfaceCanvas=[];surfaceCtx=[];surfaceTex=[];drawSurfaces=[];
  lastPaintTex=null;pourState=null;pourActive=false;
  if(sprayTimer){clearInterval(sprayTimer);sprayTimer=null;}
  if(pourDrops)pourDrops.forEach(function(d){d.visible=false;d.ph=null});
  if(pourJetTop)pourJetTop.visible=false;
  if(pourJet)pourJet.visible=false;
  window.__jetTop=null;window.__pourMeter=null;window.__flood=null;
  var src=MODEL_SRC[kind];
  if(src&&src.glb){
    // 先放程序化占位（快速反馈），glb 加载成功后替换
    if(MODEL_FNS[kind]){
      var g0=new THREE.Group();
      MODEL_FNS[kind](g0);
      scene3d.add(g0);
      centerModelGroup(g0);
      window.__pendingGlb=g0;
    }
    loadGlbModel(kind);
  }else if(MODEL_FNS[kind]){
    var g=new THREE.Group();
    MODEL_FNS[kind](g);
    scene3d.add(g);
    centerModelGroup(g);
  }
  var sub=document.getElementById('3d-model-sub');
  if(sub)renderModelSub(sub);
}
function renderModelSub(sub){
  try{
  if(!openModelCat||!sub)return;
  sub.innerHTML='';
  MODEL_CATS[openModelCat].items.forEach(function(k){
    var d=document.createElement('button');
    d.textContent=(MODEL_ICONS[k]||'')+' '+(MODEL_LABELS[k]||k);
    d.setAttribute('data-key',k);
    d.style.cssText='padding:8px 10px;border-radius:10px;font-size:13px;cursor:pointer;background:rgba(255,255,255,.08);color:#e8e6e1;border:2px solid transparent;text-align:left;font-family:inherit;';
    if(k===currentModelKind)d.style.borderColor='#fff';
    d.onclick=function(){switchModel(k);renderModelSub(sub)};
    sub.appendChild(d);
  });
  sub.style.display='flex';
  
  }catch(err){
    var dbg=document.getElementById('3d-dbg');
    if(dbg)dbg.textContent='[模型列表] '+err.message;
    document.title='[CAT ERR] '+err.message;
  }
}
function toggleModelCat(cat){
  try{
    
    var sub=document.getElementById('3d-model-sub');
    if(!sub){return;}
    var panel=document.getElementById('3d-model-panel');
    var cats=panel?panel.getElementsByClassName('3d-cat'):[];
    if(openModelCat===cat){
      openModelCat=null;sub.style.display='none';sub.innerHTML='';
      Array.prototype.forEach.call(cats,function(x){x.style.background='rgba(255,255,255,.08)'});
      return;
    }
    openModelCat=cat;
    Array.prototype.forEach.call(cats,function(x){x.style.background='rgba(255,255,255,.08)'});
    var cur=null;
    Array.prototype.forEach.call(cats,function(x){if(x.getAttribute('data-cat')===cat)cur=x});
    if(cur)cur.style.background='rgba(255,255,255,.22)';
    renderModelSub(sub);
  }catch(err){
    var dbg=document.getElementById('3d-dbg');
    if(dbg)dbg.textContent='[模型面板] '+err.message;
  }
}
function initModelPanel(){
  var panel=document.getElementById('3d-model-panel');
  if(!panel)return;
  var cats=panel.getElementsByClassName('3d-cat');
  Array.prototype.forEach.call(cats,function(b){
    b.onclick=function(){toggleModelCat(b.getAttribute('data-cat'))};
  });
}

// ===== 积木熊程序化动画：走路/跑步/打招呼/跳舞/跳跃/打拳/点赞 + 坐下 =====
function bearAnimStep(t){
  try{
    var ap=window.__bearParts;if(!ap)return;
    var mode=window.__bearAnim||'idle';
    var pose=window.__bearPose||'standing';
    var m=ap.model;
    var s=Math.sin(t*9),cs=Math.cos(t*9),s2=Math.sin(t*14),cs2=Math.cos(t*14);
    ap.armL.rotation.x=0;ap.armR.rotation.x=0;ap.legL.rotation.x=0;ap.legR.rotation.x=0;
    m.rotation.z=0;m.rotation.x=0;m.position.y=0;m.scale.y=1;
    if(pose==='sitting'){
      m.scale.y=0.74;m.position.y=-0.42;   // 坐下：整体变矮下沉
      ap.legL.rotation.x=1.35;ap.legR.rotation.x=1.35;   // 腿前伸
      ap.armL.rotation.x=-1.0;ap.armR.rotation.x=-1.0;   // 手前撑
      return;
    }
    if(mode==='walk'){
      ap.armL.rotation.x=s*0.7;ap.armR.rotation.x=-s*0.7;
      ap.legL.rotation.x=-s*0.7;ap.legR.rotation.x=s*0.7;
      m.position.y=Math.abs(cs)*0.05;
    }else if(mode==='run'){
      ap.armL.rotation.x=s2*1.1;ap.armR.rotation.x=-s2*1.1;
      ap.legL.rotation.x=-s2*1.1;ap.legR.rotation.x=s2*1.1;
      m.position.y=Math.abs(cs2)*0.14;
    }else if(mode==='wave'){
      ap.armR.rotation.x=-2.7+s*0.12;ap.armL.rotation.x=s*0.1;
    }else if(mode==='jump'){
      m.position.y=Math.abs(Math.sin(t*7))*0.55;
      ap.armL.rotation.x=s2*0.5;ap.armR.rotation.x=-s2*0.5;
      ap.legL.rotation.x=-s2*0.3;ap.legR.rotation.x=s2*0.3;
    }else if(mode==='dance'){
      m.rotation.z=s*0.13;
      ap.armL.rotation.x=s2*0.9;ap.armR.rotation.x=-s2*0.9;
      ap.legL.rotation.x=-s2*0.4;ap.legR.rotation.x=s2*0.4;
    }else if(mode==='punch'){
      ap.armR.rotation.x=(Math.sin(t*16)>0.2)?-2.3:0.2;ap.armL.rotation.x=s*0.15;
    }else if(mode==='thumbsup'){
      ap.armR.rotation.x=-2.3;ap.armL.rotation.x=0;
    }else{
      m.position.y=Math.sin(t*3)*0.02;   // idle 呼吸
    }
  }catch(e){}
}

function init3d(){
  if(window.__init3dDone)return;
  var container=document.getElementById('three-container');
  scene3d=new THREE.Scene();
  scene3d.background=new THREE.Color(0x1a1a2e);
  camera3d=new THREE.PerspectiveCamera(60,window.innerWidth/window.innerHeight,0.1,1000);
  renderer3d=new THREE.WebGLRenderer({antialias:true});
  renderer3d.setSize(window.innerWidth,window.innerHeight);
  renderer3d.setPixelRatio(window.devicePixelRatio);
  container.appendChild(renderer3d.domElement);

  scene3d.add(new THREE.AmbientLight(0xffffff,0.65));

  // 加载真实 GLTF 模型（已弃用；保护防止中断后续初始化）
  try{var loader=new THREE.GLTFLoader();}catch(e){}
  var modelGroup=window.__modelGroup=new THREE.Group();
  scene3d.add(modelGroup);

  // 柔和均匀照明：无方向性高光（哑光材质，无釉面）
  scene3d.add(new THREE.HemisphereLight(0xffffff,0x9a9a9a,0.85));

  // 水龙头壶口标记：白色圆环，跟随鼠标，用于定位浇注点
  faucetMarker=new THREE.Mesh(
    new THREE.RingGeometry(0.22,0.34,32),
    new THREE.MeshBasicMaterial({color:0xffffff,transparent:true,opacity:0.95,side:THREE.DoubleSide})
  );
  faucetMarker.rotation.x=-Math.PI/2;
  faucetMarker.visible=false;
  faucetMarker.userData.aux=true;   // 辅助对象：不参与射线命中
  scene3d.add(faucetMarker);
  // 下落颜料流：粗壮的半透明色柱（加粗+不透明），从壶口垂直落到模型表面命中点
  pourJet=new THREE.Mesh(
    new THREE.CylinderGeometry(0.17,0.17,1,16,1,true),
    new THREE.MeshBasicMaterial({color:0xea6668,transparent:false,side:THREE.DoubleSide})
  );
  pourJet.visible=false;
  pourJet.userData.aux=true;        // 辅助对象：不参与射线命中
  scene3d.add(pourJet);
  // 下落液滴粒子：沿柱体循环下落，模拟流体连续流下
  pourDrops=[];
  for(var ddi=0;ddi<3;ddi++){
    var dd=new THREE.Mesh(
      new THREE.SphereGeometry(0.12,12,8),
      new THREE.MeshBasicMaterial({color:0xea6668,transparent:true,opacity:0.9})
    );
    dd.visible=false;
    dd.userData.aux=true;
    scene3d.add(dd);
    pourDrops.push(dd);
  }
  // 壶口下方的小液滴（模拟从壶口溢出的颜料）
  pourJetTop=new THREE.Mesh(
    new THREE.SphereGeometry(0.12,14,10),
    new THREE.MeshBasicMaterial({color:0xea6668,transparent:true,opacity:0.9})
  );
  pourJetTop.visible=false;
  pourJetTop.userData.aux=true;     // 辅助对象：不参与射线命中
  scene3d.add(pourJetTop);

  // ===== 卡通 3D 小熊（默认模型）：大头圆身，部件贴合不分离，每部件可涂色纹理 =====
  buildCartoonBear(modelGroup);
  // 更新相机旋转中心为模型中心
  var boxB=new THREE.Box3().setFromObject(modelGroup);
  var cB=boxB.getCenter(new THREE.Vector3());
  window.__modelHalfH=(boxB.max.y-boxB.min.y)/2;   // 模型半高：倾倒口=模型正上方
  if(!window.__camTarget)window.__camTarget=new THREE.Vector3(0,0,0);
  window.__camTarget.set(cB.x,cB.y,cB.z);
  // 动画按钮（积木熊程序化动画）
  (function(){
    var actNames={静止:'idle',走路:'walk',跑步:'run',打招呼:'wave',跳舞:'dance',跳跃:'jump',打拳:'punch',点赞:'thumbsup'};
    var boxA=document.getElementById('3d-actions');
    if(!boxA)return;
    boxA.innerHTML='';
    var first=null;
    for(var key in actNames){
      (function(k,n){
        var b=document.createElement('button');
        b.textContent=k;
        b.style.cssText='padding:6px 12px;border-radius:20px;font-size:12px;cursor:pointer;background:rgba(255,255,255,.12);color:#fff;border:2px solid transparent;transition:all .2s;';
        b.onmouseenter=function(){b.style.background='rgba(255,255,255,.25)'};
        b.onmouseleave=function(){b.style.background='rgba(255,255,255,.12)'};
        b.onclick=function(){
          playAnim(n);
          boxA.querySelectorAll('button').forEach(function(x){x.style.borderColor='transparent'});
          b.style.borderColor='#fff';
        };
        boxA.appendChild(b);
        if(!first)first=b;
      })(key,actNames[key]);
    }
    // 站立/坐下切换（整体缩放模拟）
    var poseBtn=document.createElement('button');
    poseBtn.id='pose-btn';
    poseBtn.textContent='坐下';
    poseBtn.style.cssText='padding:6px 12px;border-radius:20px;font-size:12px;cursor:pointer;background:rgba(255,255,255,.12);color:#fff;border:2px solid transparent;transition:all .2s;';
    poseBtn.onmouseenter=function(){poseBtn.style.background='rgba(255,255,255,.25)'};
    poseBtn.onmouseleave=function(){poseBtn.style.background='rgba(255,255,255,.12)'};
    poseBtn.onclick=function(){
      poseState=(poseState==='standing')?'sitting':'standing';
      setPose(poseState);
      poseBtn.textContent=(poseState==='standing')?'坐下':'站立';
      boxA.querySelectorAll('button').forEach(function(x){x.style.borderColor='transparent'});
      poseBtn.style.borderColor='#fff';
    };
    boxA.insertBefore(poseBtn,boxA.children[1]);
    // 清除模型颜色（一键恢复白色）
    var clearBtn=document.createElement('button');
    clearBtn.textContent='🧽 清除颜色';
    clearBtn.style.cssText='padding:6px 12px;border-radius:20px;font-size:12px;cursor:pointer;background:rgba(234,102,104,.25);color:#fff;border:2px solid transparent;transition:all .2s;';
    clearBtn.onmouseenter=function(){clearBtn.style.background='rgba(234,102,104,.4)'};
    clearBtn.onmouseleave=function(){clearBtn.style.background='rgba(234,102,104,.25)'};
    clearBtn.onclick=function(){clearModelColors();};
    boxA.appendChild(clearBtn);
    setTimeout(function(){if(first)first.style.borderColor='#fff';},200);
  })();

  raycaster=new THREE.Raycaster();
  mouseNDC=new THREE.Vector2();

  // 事件：右键旋转视角（屏蔽浏览器右键菜单/手势），左键按住拖动连续涂鸦
  var dom=renderer3d.domElement;
  dom.style.touchAction='none';
  var rotating=false,painting=false,lastMX=0,lastMY=0;
  dom.style.cursor='none';
  // 圆形光标跟随
  // 鼠标小光标：8px 圆点（定位用，不抢眼）
  brushCursor=document.createElement('div');
  brushCursor.style.cssText='position:fixed;z-index:999;pointer-events:none;border-radius:50%;width:60px;height:60px;background:rgba(255,255,255,.25);border:2px solid rgba(255,255,255,.75);transform:translate(-50%,-50%);';
  document.body.appendChild(brushCursor);
  function syncCursor(x,y){
    if(!brushCursor)return;
    brushCursor.style.left=x+'px';brushCursor.style.top=y+'px';
    // 触点提示：笔刷=圆形与粗细匹配；喷雾=圆形范围；油漆桶=隐藏（由浇注杯动画代替）
    if(toolMode==='brush'){
      var d=Math.max(8,brushSize);
      brushCursor.style.display='block';
      brushCursor.style.width=d+'px';brushCursor.style.height=d+'px';
      brushCursor.style.borderRadius='50%';
      brushCursor.style.border='2px solid rgba(255,255,255,.8)';
      brushCursor.style.background='rgba(255,255,255,.28)';
      brushCursor.style.boxShadow='0 0 0 1px rgba(0,0,0,.35)';
    }else if(toolMode==='spray'){
      var d2=Math.max(14,brushSize*1.6);
      brushCursor.style.display='block';
      brushCursor.style.width=d2+'px';brushCursor.style.height=d2+'px';
      brushCursor.style.borderRadius='50%';
      brushCursor.style.border='2px dashed rgba(255,255,255,.75)';
      brushCursor.style.background='rgba(255,255,255,.12)';
      brushCursor.style.boxShadow='none';
    }else{
      // 油漆桶（默认）：显示小圆点触点，保证鼠标在场景中始终可见
      brushCursor.style.display='block';
      brushCursor.style.width='14px';brushCursor.style.height='14px';
      brushCursor.style.borderRadius='50%';
      brushCursor.style.border='2px solid rgba(255,255,255,.85)';
      brushCursor.style.background='rgba(255,255,255,.45)';
      brushCursor.style.boxShadow='0 0 0 1px rgba(0,0,0,.35)';
    }
  }
  function doPaint(e){
    if(toolMode==='brush')paintAt(e);
    else if(toolMode==='spray')sprayAt(e);
    else if(toolMode==='paint')pourAt();   // 浇注始终从模型头顶
    else if(toolMode==='fill')fillAt(e);   // 填色：点击部位整块填色
  }
  dom.addEventListener('mousedown',function(e){
    if(e.button===2){
      rotating=true;lastMX=e.clientX;lastMY=e.clientY;
      e.preventDefault();
    }else if(e.button===0){
      painting=true;lastEvt=e;
      if(toolMode!=='paint')window.__lastPaintWorld=null;
      window.__lastPaintPx=null;window.__lastPaintTex=null;   // 新一笔：从圆点起笔，不连上一笔
      if(toolMode==='paint'){
        // 简化：加颜料后直接点击模型浇注（无需点杯就绪）
        if(sprayTimer){clearInterval(sprayTimer);sprayTimer=null;}
        var dbgP=document.getElementById('3d-dbg');
        var pmP=window.__pourMeter;
        if(!window.__hasMix){
          if(dbgP)dbgP.textContent='请先往颜料杯里加颜色';
        }else if(window.__flood&&window.__flood.active){
          if(dbgP)dbgP.textContent='浇注效果生成中，请稍候…';
        }else if(pmP&&pmP.active){
          if(dbgP)dbgP.textContent='浇注进行中…';
        }else if(pmP&&pmP.recharging){
          if(dbgP)dbgP.textContent='能量恢复中 '+Math.round(pmP.val)+'%，稍后再浇注';
        }else{
          var r=hitMesh(e);
          if(r)pourAt();
          else if(dbgP)dbgP.textContent='请点击模型身体浇注';
        }
      }else{
        doPaint(e);
        if(toolMode==='spray'){
          if(sprayTimer){clearInterval(sprayTimer);sprayTimer=null;}
          sprayTimer=setInterval(function(){if(painting&&!rotating&&lastEvt)sprayAt(lastEvt);},120);
        }
      }
    }
  });
  document.addEventListener('contextmenu',function(e){
    if(rotating||e.target===dom)e.preventDefault();
  });
  dom.addEventListener('mousemove',function(e){
    lastEvt=e;
    syncCursor(e.clientX,e.clientY);
    updateFaucetMarker(e);
    if(rotating){
      var dx=e.clientX-lastMX,dy=e.clientY-lastMY;
      lookYaw-=dx*0.006;
      lookPitch+=dy*0.005;
      lookPitch=Math.max(-0.5,Math.min(1.2,lookPitch));
      lastMX=e.clientX;lastMY=e.clientY;
    }else if(painting&&toolMode!=='paint'&&toolMode!=='fill'){
      doPaint(e);
    }
  });
  dom.addEventListener('mouseup',function(){
    rotating=false;painting=false;window.__lastPaintWorld=null;lastPaintTex=null;pourState=null;pourActive=false;
    if(toolMode!=='paint'){   // 油漆桶浇注动画由状态机管理，松开鼠标不消失
      if(pourJet)pourJet.visible=false;
      if(pourJetTop)pourJetTop.visible=false;
      if(pourDrops)pourDrops.forEach(function(d){d.visible=false});
      window.__jetTop=null;
    }
    if(sprayTimer){clearInterval(sprayTimer);sprayTimer=null;}
  });
  dom.addEventListener('mouseleave',function(){
    rotating=false;painting=false;lastPaintTex=null;pourState=null;pourActive=false;
    if(toolMode!=='paint'){
      if(pourJet)pourJet.visible=false;
      if(pourJetTop)pourJetTop.visible=false;
      if(pourDrops)pourDrops.forEach(function(d){d.visible=false});
      window.__jetTop=null;
    }
    if(sprayTimer){clearInterval(sprayTimer);sprayTimer=null;}
  });
  // 滚轮缩放：上滚放大、下滚缩小（指数步进，范围 3~18）
  dom.addEventListener('wheel',function(e){
    e.preventDefault();
    camDist*=Math.exp(e.deltaY*0.001);
    camDist=Math.max(3,Math.min(18,camDist));
  },{passive:false});

  // 工具切换
  var toolBtns={brush:document.getElementById('tool-brush'),spray:document.getElementById('tool-spray'),paint:document.getElementById('tool-paint'),fill:document.getElementById('tool-fill')};
  var sizeLabel=document.getElementById('3d-size-label');
  function setTool(t){
    toolMode=t;
    var labels={brush:'粗细',spray:'范围',paint:'流量',fill:'填色'};
    if(sizeLabel)sizeLabel.textContent=labels[t]||'粗细';
    for(var k in toolBtns){if(toolBtns[k])toolBtns[k].style.borderColor=(k===t)?'#fff':'transparent';}
    // 浇注杯：仅油漆桶模式显示（浇注入口）
    var cupBtn=document.getElementById('pour-cup-btn');
    if(cupBtn)cupBtn.style.display=(t==='paint')?'block':'none';
    // 壶口圆环：油漆桶模式彻底隐藏（由浇注杯动画代替）；笔刷/喷雾由鼠标移动控制显示
    if(faucetMarker)faucetMarker.visible=false;
    if(brushCursor){}   // 光标固定小圆点，不随工具/大小变化
  }
  if(toolBtns.brush)toolBtns.brush.onclick=function(){setTool('brush')};
  if(toolBtns.spray)toolBtns.spray.onclick=function(){setTool('spray')};
  if(toolBtns.paint)toolBtns.paint.onclick=function(){setTool('paint')};
  if(toolBtns.fill)toolBtns.fill.onclick=function(){setTool('fill')};
  setTool('paint');   // 默认油漆桶
  // 笔刷/范围/流量滑块（默认最大 40）
  var brushInput=document.getElementById('3d-brush');
  if(brushInput){
    brushSize=parseInt(brushInput.value)||60;
    brushInput.addEventListener('input',function(){brushSize=parseInt(this.value)||40;});
  }
  // 颜色：由右侧固定面板选择（工具栏不再放颜色按钮）
  drawColor='#ea6668';
  var swatch=null;
  // 右侧固定面板：常用色网格 + 自定义取色
  var panel=document.getElementById('3d-color-panel');
  var grid=document.getElementById('3d-color-grid');
  var custom=document.getElementById('3d-color-custom');
  function setColor(c){
    drawColor=c;
    if(swatch)swatch.style.background=c;
    if(custom)custom.value=c;
  }
  var preset=['#ea6668','#ff6b6b','#f06595','#cc5de8','#845ef7','#5c7cfa','#339af0','#22b8cf','#20c997','#51cf66','#a9e34b','#fcc419','#ff922b','#f76707','#e8590c','#9775fa','#e64980','#12b886','#fab005','#868e96','#343a40','#f8f9fa','#8e44ad','#2c3e50'];
  // ---- 颜料混合杯：每次选色=往杯里倒一条色带，形成多色大理石纹（不融合） ----
  var mixCup=document.getElementById('3d-mix-cup');
  if(mixCup){
    window.__mixCtx=mixCup.getContext('2d');
    window.__mixCtx.clearRect(0,0,160,160);
    window.__hasMix=false;
  }
  var mixClearBtn=document.getElementById('3d-mix-clear');
  if(mixClearBtn){
    mixClearBtn.onclick=function(){
      if(!window.__mixCtx)return;
      window.__mixCtx.clearRect(0,0,160,160);
      window.__hasMix=false;
      window.__pourMeter={val:0,active:false,rate:0};
      var cn=document.getElementById('pour-cup-num');
      if(cn)cn.textContent='空';
    };
  }
  // 选色时：更新 drawColor + 倒入混合杯（点色块/自定义都倒）
  function setColor2(c){
    setColor(c);
    pourPaintIntoCup(c);
  }
  if(grid){
    preset.forEach(function(c){
      var d=document.createElement('div');
      d.style.cssText='width:28px;height:28px;border-radius:8px;background:'+c+';cursor:pointer;border:2px solid rgba(255,255,255,.25);transition:transform .12s;';
      d.onclick=function(){setColor2(c)};
      d.onmouseenter=function(){d.style.transform='scale(1.12)'};
      d.onmouseleave=function(){d.style.transform='scale(1)'};
      grid.appendChild(d);
    });
  }
  if(custom){
    custom.oninput=function(){setColor2(this.value)};
  }
  function toggleColorPanel(){
    if(!panel)return;
    var on=panel.style.display==='flex';
    panel.style.display=on?'none':'flex';
  }
  if(panel)panel.style.display='flex';   // 默认打开颜色面板，省去每次点击
  var closeBtn=document.getElementById('3d-color-close');
  if(closeBtn)closeBtn.onclick=function(){if(panel)panel.style.display='none'};

  window.addEventListener('resize',function(){
    camera3d.aspect=window.innerWidth/window.innerHeight;
    camera3d.updateProjectionMatrix();
    renderer3d.setSize(window.innerWidth,window.innerHeight);
  });

  // 供 clear3dTools 在离开 3D 屏时复位交互局部状态
  window.__reset3dInteraction=function(){rotating=false;painting=false};
  // 调试用：暴露核心 3D 对象到 window（仅开发期）
  window.__r3d=renderer3d;window.__s3d=scene3d;window.__cam3d=camera3d;

  window.__init3dDone=true;
  animate3d();
}

var lastPaintTex=null,lastPaintPx=0,lastPaintPy=0;

function clear3dTools(){
  if(sprayTimer){clearInterval(sprayTimer);sprayTimer=null;}
  if(window.__reset3dInteraction)window.__reset3dInteraction();
  pourState=null;lastPaintTex=null;
  if(brushCursor)brushCursor.style.display='none';
  var panel=document.getElementById('3d-color-panel');
  if(panel)panel.style.display='none';
  if(faucetMarker)faucetMarker.visible=false;
  if(pourJet)pourJet.visible=false;
  if(pourJetTop)pourJetTop.visible=false;
  if(pourDrops)pourDrops.forEach(function(d){d.visible=false});
  window.__jetTop=null;
}

// 像素→世界半径：在命中深度处把 brushSize/2 像素换算为世界长度，与鼠标圆环精确一致
function brushWorldRadius(hitDist){
  var dom=renderer3d&&renderer3d.domElement;
  var hPx=(dom&&(dom.clientHeight||dom.height))||600;
  var vFov=(camera3d&&camera3d.fov?camera3d.fov:45)*Math.PI/180;
  var hAt=2*Math.tan(vFov/2)*hitDist;
  return Math.max(0.005,brushSize/2/hPx*hAt);
}
function paintAt(e){
  try{
  if(window.__glbModel){
    var hh=hitMesh(e);
    var dbgG=document.getElementById('3d-dbg');
    if(hh&&hh.hit&&hh.hit.point){
      // 线段涂色：上一点→当前点，同向自动合并为一条（直线笔迹=1 条，容量≈笔数）
      var pG=hh.hit.point;
      var rG=brushWorldRadius(hh.hit.distance||3);
      var sclG=hh.mesh.getWorldScale(new THREE.Vector3());
      var sMaxG=Math.max(sclG.x,sclG.y,sclG.z)||1;
      var pL=hh.mesh.worldToLocal(pG.clone());
      var hexP=toHex(drawColor);
      var rL=rG/sMaxG;
      var meshId=hh.mesh.id;
      var lastW=window.__lastPaintWorld;
      if(lastW){
        var dist=lastW.distanceTo(pG);
        var step=rG*0.35;
        if(dist>step){
          var segsN=Math.ceil(dist/step);
          var prev=lastW;
          for(var si=1;si<=segsN;si++){
            var ip=lastW.clone().lerp(pG,si/segsN);
            paintPushSeg({meshId:meshId,a:hh.mesh.worldToLocal(prev.clone()),b:hh.mesh.worldToLocal(ip.clone()),r:rL,c:hexP,alpha:1});
            prev=ip;
          }
        }else{
          paintPushSeg({meshId:meshId,a:hh.mesh.worldToLocal(lastW.clone()),b:pL,r:rL,c:hexP,alpha:1});
        }
      }else{
        paintPushSeg({meshId:meshId,a:pL,b:pL.clone(),r:rL,c:hexP,alpha:1});
      }
      window.__lastPaintWorld=pG.clone();
      if(dbgG)dbgG.textContent=hh.dbg+' | 已涂色';
      return;
    }
    if(dbgG)dbgG.textContent=(hh?hh.dbg:'未命中模型')+' | 该面未启用涂色';
    return;
  }
  var rect=renderer3d.domElement.getBoundingClientRect();
  mouseNDC.x=((e.clientX-rect.left)/rect.width)*2-1;
  mouseNDC.y=-((e.clientY-rect.top)/rect.height)*2+1;
  raycaster.setFromCamera(mouseNDC,camera3d);
  var allMeshes=[];
  scene3d.traverse(function(c){if(c.isMesh&&!c.userData.ground&&!c.userData.aux)allMeshes.push(c)});
  var hits=raycaster.intersectObjects(allMeshes,false);
  if(hits.length>0){
    var hit=hits[0];
    var mats=hit.object.material;
    var mat;
    if(Array.isArray(mats)){
      mat=mats[hit.face.materialIndex];
    }else{
      mat=mats;
    }
    var tex=mat&&mat.map;
    var dbg=document.getElementById('3d-dbg');
    var dbgInfo='命中:'+(hit.object.name||'模型')+' uv=('+(hit.uv?hit.uv.x.toFixed(2)+','+hit.uv.y.toFixed(2):'无')+')';
    if(dbg)dbg.textContent=dbgInfo;
    if(tex&&tex.image&&tex.image.getContext){
      var ctx=tex.image.getContext('2d');
      var w=tex.image.width,h=tex.image.height;
      var px=Math.round(hit.uv.x*w),py=Math.round(hit.uv.y*h);
      // 连续画线：与上一次命中同一纹理时连线段，否则画圆点
      if(lastPaintTex===tex){
        ctx.strokeStyle=drawColor;
        ctx.lineWidth=brushSize;
        ctx.lineCap='round';
        ctx.lineJoin='round';
        ctx.globalAlpha=(window.__paintOpacity||1);
        ctx.beginPath();
        ctx.moveTo(lastPaintPx,lastPaintPy);
        ctx.lineTo(px,py);
        ctx.stroke();
      }else{
        ctx.fillStyle=drawColor;
        ctx.globalAlpha=(window.__paintOpacity||1);
        ctx.beginPath();
        ctx.arc(px,py,brushSize/2,0,Math.PI*2);
        ctx.fill();
      }
      ctx.globalAlpha=1;
      lastPaintTex=tex;lastPaintPx=px;lastPaintPy=py;
      tex.needsUpdate=true;
      if(dbg)dbg.textContent=dbgInfo+' | 已涂色';
    }else{
      if(dbg)dbg.textContent=dbgInfo+' | 该面未启用涂色';
    }
  }else{
    lastPaintTex=null;
  }
  }catch(err){document.title='[PAINTERR] '+err.message;}
}

function hitMesh(e){
  var rect=renderer3d.domElement.getBoundingClientRect();
  mouseNDC.x=((e.clientX-rect.left)/rect.width)*2-1;
  mouseNDC.y=-((e.clientY-rect.top)/rect.height)*2+1;
  raycaster.setFromCamera(mouseNDC,camera3d);
  var allMeshes=[];
  scene3d.traverse(function(c){if(c.isMesh&&!c.userData.ground&&!c.userData.aux)allMeshes.push(c)});
  var hits=raycaster.intersectObjects(allMeshes,false);
  if(hits.length>0){
    var hit=hits[0];
    var obj=hit.object;
    if(window.__glbModel){
      return {hit:hit,mesh:obj,dbg:'命中:'+(obj.name||'部件')};
    }
    var mats=obj.material;
    var mat=Array.isArray(mats)?mats[hit.face.materialIndex]:mats;
    var tex=mat&&mat.map;
    if(tex&&tex.image&&tex.image.getContext){
      var ctx=tex.image.getContext('2d');
      return {hit:hit,tex:tex,ctx:ctx,w:tex.image.width,h:tex.image.height,
        px:Math.round(hit.uv.x*tex.image.width),py:Math.round(hit.uv.y*tex.image.height),
        dbg:'命中:'+(obj.name||'模型')+' uv=('+(hit.uv?hit.uv.x.toFixed(2)+','+hit.uv.y.toFixed(2):'无')+')'};
    }
  }
  return null;
}

// 喷雾罐：以命中点为中心随机散布，范围=滑块值
function sprayAt(e){
  try{
    if(window.__glbModel){
      var rh=hitMesh(e);
      var dbgS=document.getElementById('3d-dbg');
      if(rh&&rh.hit&&rh.hit.point){
        // 喷雾：命中点周围随机散布小涂色点（半透明叠加，圆形雾状）
        var pS=rh.hit.point;
        var rangeS=brushWorldRadius(rh.hit.distance||3);
        var sclS=rh.mesh.getWorldScale(new THREE.Vector3());
        var sMaxS=Math.max(sclS.x,sclS.y,sclS.z)||1;
        var densS=Math.max(3,Math.min(10,Math.round(rangeS*0.6)+2));
        var hexS=toHex(drawColor);
        var opS=(window.__paintOpacity||1)*0.28;
        for(var si3=0;si3<densS;si3++){
          var aa3=Math.random()*Math.PI*2;
          var rr3=rangeS*Math.sqrt(Math.random());
          var sp=new THREE.Vector3(pS.x+Math.cos(aa3)*rr3,pS.y+Math.sin(aa3)*rr3,pS.z);
          var spL=rh.mesh.worldToLocal(sp);
          paintPushPoint({p:spL,r:(rangeS*0.18)/sMaxS,c:hexS,a:opS});
        }
        if(dbgS)dbgS.textContent=rh.dbg+' | 已喷色';
        return;
      }
      if(dbgS)dbgS.textContent=(rh?rh.dbg:'未命中模型')+' | 该面未启用喷涂';
      return;
    }
    var r=hitMesh(e);
    if(!r){lastPaintTex=null;return;}
    var range=brushSize*1.6;
    var density=Math.round(brushSize*0.5)+3;
    var opBase=(window.__paintOpacity||1);
    for(var i=0;i<density;i++){
      // 圆形喷射范围：极坐标随机（sqrt 面积均匀），中心浓、边缘淡（真实喷漆雾状）
      var a=Math.random()*Math.PI*2;
      var rr=range*0.5*Math.sqrt(Math.random());
      var edgeF=Math.max(0,1-rr/(range*0.5+1));   // 边缘淡出
      var ox=Math.cos(a)*rr;
      var oy=Math.sin(a)*rr;
      var pr=Math.max(1.5,brushSize*(0.06+Math.random()*0.09));
      r.ctx.fillStyle=drawColor;
      r.ctx.globalAlpha=opBase*(0.3+0.7*edgeF);
      r.ctx.beginPath();
      r.ctx.arc(r.px+ox,r.py+oy,pr,0,Math.PI*2);
      r.ctx.fill();
    }
    r.ctx.globalAlpha=1;
    r.tex.needsUpdate=true;
    var dbg=document.getElementById('3d-dbg');
    if(dbg)dbg.textContent=r.dbg+' | 喷雾中';
  }catch(err){document.title='[SPRAYERR] '+err.message;}
}

// 填色（秘密花园玩法）：点击一个部位 → 该部位所有面整体填上所选颜色
function fillAt(e){
  try{
    var dbg=document.getElementById('3d-dbg');
    if(window.__glbModel){
      var rf=hitMesh(e);
      if(!rf){if(dbg)dbg.textContent='请点击模型部位填色';return;}
      fillMeshAll(rf.mesh,drawColor);
      // 材质转白：顶点色=fill 色纯色呈现（不被原色调制）
      var matsF=Array.isArray(rf.mesh.material)?rf.mesh.material:[rf.mesh.material];
      for(var iF=0;iF<matsF.length;iF++){if(matsF[iF])matsF[iF].color.set(0xffffff);}
      if(dbg)dbg.textContent='已为「'+(rf.mesh.name||'部位')+'」填色';
      return;
    }
    var r=hitMesh(e);
    if(!r||!r.hit||!r.hit.object){
      if(dbg)dbg.textContent='请点击模型部位填色';
      return;
    }
    var part=r.hit.object.userData.part;
    if(!part){
      if(dbg)dbg.textContent='该部位不支持整体填色，试试身体/头/四肢';
      return;
    }
    var op=(window.__paintOpacity||1);
    var filled=0;
    scene3d.traverse(function(c){
      if(c.isMesh&&c.userData.part===part){
        var mat=c.material;var tex=mat&&mat.map;
        if(tex&&tex.image&&tex.image.getContext){
          var ctx=tex.image.getContext('2d');
          ctx.save();
          ctx.globalAlpha=op;
          ctx.fillStyle=drawColor;
          ctx.fillRect(0,0,tex.image.width,tex.image.height);   // 整面填满所选颜色
          ctx.restore();
          tex.needsUpdate=true;
          filled++;
        }
      }
    });
    if(dbg)dbg.textContent=filled>0?('已为「'+part+'」整体填色'):'未找到可填色的面';
  }catch(err){document.title='[FILLERR] '+err.message;}
}

// 水滴效果：颜料在堆积底部边缘长出拉长的泪滴 → 变长 → 淡出滴落（周期性动画）
function paintDrip(ctx,x,topY,color,phase,size){
  try{
    var cyc=36;                       // 一个水滴周期（帧）
    var p=phase%cyc;
    var len=size*(0.4+0.6*p/cyc);     // 水滴长度随周期增长
    var botY=topY+len;
    var r=Math.max(3,size*0.18);      // 水滴圆头半径
    var alpha=1;
    if(p>cyc*0.62)alpha=Math.max(0,1-(p-cyc*0.62)/(cyc*0.38));  // 后半段淡出=滴落离开
    if(alpha<=0.02)return;
    ctx.fillStyle=color;
    ctx.globalAlpha=alpha*0.95;
    // 泪滴：底部圆头 + 上部收窄连到堆积
    ctx.beginPath();
    ctx.arc(x,botY-r,r,0,Math.PI*2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x-r*0.6,topY);
    ctx.quadraticCurveTo(x-r*0.9,(topY+botY-r)*0.5,x-r*0.85,botY-r);
    ctx.quadraticCurveTo(x-r*0.3,botY-r*0.7,x,botY-r);
    ctx.quadraticCurveTo(x+r*0.3,botY-r*0.7,x+r*0.85,botY-r);
    ctx.quadraticCurveTo(x+r*0.9,(topY+botY-r)*0.5,x+r*0.6,topY);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha=1;
  }catch(err){document.title='[DRIPERR] '+err.message;}
}

// ===== 颜料混合杯（全局）=====
// 往杯里倒入颜料：大色域软边叠压 —— 各色保持色相、交界自然晕染（流体熊大理石感）
function pourPaintIntoCup(c){
  try{
    var mixCtx=window.__mixCtx;
    if(!mixCtx)return;
    window.__pourMeter={val:100,active:false,rate:0};   // 加入颜料=满杯(100%)，清除已浇注标记
    if(!window.__hasMix){
      window.__hasMix=true;
      // 首滴：铺满杯底的大色域底彩
      mixCtx.save();
      mixCtx.globalAlpha=0.92;
      mixCtx.fillStyle=c;
      mixCtx.beginPath();
      mixCtx.arc(80,80,60,0,Math.PI*2);
      mixCtx.fill();
      mixCtx.restore();
    }
    // 每滴颜料：1 个大软边色块（径向渐变，边缘自然淡出，与大色域交融）+ 1 条宽色带
    mixCtx.save();
    mixCtx.globalCompositeOperation='source-over';
    var px2=28+Math.random()*104, py2=28+Math.random()*104;
    var r=24+Math.random()*34;
    var g=mixCtx.createRadialGradient(px2,py2,2,px2,py2,r);
    g.addColorStop(0,c);
    g.addColorStop(0.55,c);
    g.addColorStop(1,'rgba(0,0,0,0)');
    mixCtx.globalAlpha=0.8+Math.random()*0.2;
    mixCtx.fillStyle=g;
    mixCtx.beginPath();
    mixCtx.arc(px2,py2,r,0,Math.PI*2);
    mixCtx.fill();
    // 宽色带（模拟倒下去的长条颜料，带一点弧）
    mixCtx.globalAlpha=0.9;
    mixCtx.strokeStyle=c;
    mixCtx.lineWidth=15+Math.random()*13;
    mixCtx.lineCap='round';
    mixCtx.beginPath();
    mixCtx.moveTo(px2-r,py2+10);
    mixCtx.quadraticCurveTo(px2,py2-8+(Math.random()-0.5)*26,px2+r,py2+10);
    mixCtx.stroke();
    mixCtx.restore();
    mixCtx.globalAlpha=1;
  }catch(err){}
}
// 从混合杯中采样若干种颜色（用于浇注时多色印染）
function sampleMixColors(n){
  var out=[];
  var mixCtx=window.__mixCtx;
  if(!mixCtx||!window.__hasMix){
    for(var i=0;i<n;i++)out.push(drawColor);
    return out;
  }
  try{
    var data=mixCtx.getImageData(0,0,160,160).data;
    for(var i=0;i<n;i++){
      var idx=(Math.floor(Math.random()*160)*160+Math.floor(Math.random()*160))*4;
      var r=data[idx],g=data[idx+1],b=data[idx+2];
      if(r+g+b<140){i--;if(i<0)i=0;continue;}
      out.push('rgb('+r+','+g+','+b+')');
    }
    if(out.length<n){
      for(var j=out.length;j<n;j++)out.push(drawColor);
    }
  }catch(err){for(var i=0;i<n;i++)out.push(drawColor);}
  return out;
}

// 计算水龙头位置（全局）：鼠标射线与"模型顶部水平面"的交点
function calcFaucet(e){
  try{
    if(!window.__camTarget)return null;
    var ct=window.__camTarget;
    var halfH=window.__modelHalfH||1.2;
    var topY=ct.y+halfH+1.5;   // 壶口抬到头顶上方 1.5 单位：下落落差更大，颜料流清晰可见
    var rect=renderer3d.domElement.getBoundingClientRect();
    mouseNDC.x=((e.clientX-rect.left)/rect.width)*2-1;
    mouseNDC.y=-((e.clientY-rect.top)/rect.height)*2+1;
    raycaster.setFromCamera(mouseNDC,camera3d);
    var topPlane=new THREE.Plane(new THREE.Vector3(0,1,0),-topY);
    var faucet=new THREE.Vector3();
    var has=raycaster.ray.intersectPlane(topPlane,faucet);
    if(!has)faucet.set(ct.x,topY,ct.z);
    return {x:faucet.x,y:topY,z:faucet.z};
  }catch(err){return null;}
}
// 更新壶口标记跟随鼠标（未浇注时也显示，方便定位）
function updateFaucetMarker(e){
  // 壶口圆环已移除：涂鸦/喷雾/浇注都不再显示跟随圆环，保持画面干净
  if(faucetMarker)faucetMarker.visible=false;
}

// 油漆桶（流体熊浇注式）：
// 1) 水龙头=鼠标位置（鼠标射线与"模型顶部水平面"的交点，相机旋转不影响）
// 2) 颜料从水龙头垂直落下，落到表面后持续扩散 + 沿表面向下流动 + 底部堆积
// 3) 按住越久覆盖越大片；移动鼠标可浇出大面积色带 —— 模拟市场流体熊浇注
function pourAt(){
  try{
    if(!window.__camTarget)return;
    var ct=window.__camTarget;
    var halfH=window.__modelHalfH||1.2;
    var topY=ct.y+halfH+1.5;
    // 固定从模型正上方浇注（无需找位置）
    var faucet=new THREE.Vector3(ct.x,topY,ct.z);
    if(faucetMarker){
      faucetMarker.position.set(faucet.x,faucet.y,faucet.z);
      faucetMarker.visible=false;   // 油漆桶模式不显示跟随圆环（浇注杯动画代替）
      try{faucetMarker.material.color.set(drawColor);}catch(e2){}
    }
    if(pourJetTop){
      pourJetTop.position.set(faucet.x,faucet.y-0.34,faucet.z);
      pourJetTop.visible=true;
      try{pourJetTop.material.color.set(drawColor);}catch(e2){}
    }
    // 下落颜料流：壶口→模型头顶（浇注动画，逐帧流动）
    if(pourJet){
      var jt=ct.y+halfH+0.6;
      var jb=ct.y+halfH-0.1;
      window.__jetTop=jt;window.__jetBot=jb;window.__jetX=faucet.x;window.__jetZ=faucet.z;
      window.__jetH0=Math.max(0.6,jt-jb);   // 流柱高度=壶口到模型头顶（柱底固定 jb，全程连续）
      // 流柱多色纹理：采样混合杯颜色（多色时流柱呈多彩，匹配杯中颜料）
      try{
        var jc=(typeof sampleMixColors==='function')?sampleMixColors(6):[drawColor];
        window.__jetColors=jc;
        // 自然流体纹理：蜿蜒竖向色带（非规则竖条），模拟多彩颜料从壶口流下
        var cv=document.createElement('canvas');cv.width=128;cv.height=256;
        var cx=cv.getContext('2d');
        var nJ=4+Math.floor(Math.random()*2);
        for(var ji=0;ji<nJ;ji++){
          var jx0=cv.width*(0.08+Math.random()*0.84);
          var jsway=cv.width*(0.03+Math.random()*0.07);
          var jf=0.02+Math.random()*0.03;
          var jph=Math.random()*6.28;
          var jw0=cv.width*(0.06+Math.random()*0.12);
          var jCol=jc[ji%jc.length], jCol2=jc[(ji+1)%jc.length];
          for(var yy=0;yy<256;yy+=16){   // 分段多边形近似蜿蜒色带
            var y0j=yy, y1j=Math.min(256,yy+16);
            var cx0=jx0+jsway*Math.sin(y0j*jf+jph);
            var cx1=jx0+jsway*Math.sin(y1j*jf+jph);
            var w0j=jw0*(1-0.5*y0j/256), w1j=jw0*(1-0.5*y1j/256);
            var g3=cx.createLinearGradient(0,y0j,0,y1j);
            g3.addColorStop(0,jCol);
            g3.addColorStop(1,jCol2);
            cx.fillStyle=g3;
            cx.beginPath();
            cx.moveTo(cx0-w0j,y0j);
            cx.lineTo(cx1-w1j,y1j);
            cx.lineTo(cx1+w1j,y1j);
            cx.lineTo(cx0+w0j,y0j);
            cx.closePath();
            cx.fill();
          }
        }
        pourJet.material.map=new THREE.CanvasTexture(cv);
        pourJet.material.map.needsUpdate=true;
        pourJet.material.color.set(0xffffff);
        pourJet.material.needsUpdate=true;
      }catch(e5){}
      // 出现动画：从壶口（顶端）开始向下生长到模型头顶（非瞬发）
      window.__jetGrow={h:0.05,H:window.__jetH0,jt:jt,jb:jb,active:true};
      window.__jetShrink=null;
      pourJet.position.set(faucet.x,jt-0.025,faucet.z);
      pourJet.scale.set(1,0.05,1);
      pourJet.visible=false;   // 流柱圆柱已取消，仅保留壶口小球 + 下落液滴
      // 重置液滴状态：每次浇注都从壶口错开出现（与第一次一致）
      if(pourDrops)pourDrops.forEach(function(d){d.visible=false;d.ph=null;});
      // 壶口液滴颜色同步为杯中首色
      if(pourJetTop&&window.__jetColors&&window.__jetColors[0]){
        try{pourJetTop.material.color.set(window.__jetColors[0]);}catch(e7){}
      }
    }
    // 浇筑量提示：杯内数字 100%→0% 递减（浓稠颜料倒下的过程）
    window.__pourMeter={val:100,active:true,rate:brushSize/60,poured:true};
    // ===== 全局漫灌：颜料液面从模型头顶匀速下降到脚底，全身慢慢铺满 =====
    var dbg=document.getElementById('3d-dbg');
    var mixCols=(typeof sampleMixColors==='function')?sampleMixColors(5):[drawColor];
    var parts=[];
    var topY2=-999,botY2=999;
    var gms=window.__glbModel&&window.__glbModel.meshes;
    var verts=[],meshes=[];
    if(gms&&gms.length>0){
      // glb 模式：预计算每 mesh 全部顶点（世界Y），液面下降时顶点色逐个下移（平滑流淌）
      window.__paintPoints=[];syncPaintUniforms();   // 浇注前清涂色点（浇注覆盖画笔痕迹）
      window.__paintSegsMap={};syncPaintSegs();
      for(var gi=0;gi<gms.length;gi++){
        var gm=gms[gi];
        var bbG=new THREE.Box3().setFromObject(gm);
        var tpG=bbG.max.y,bpG=bbG.min.y;
        if(tpG>topY2)topY2=tpG;
        if(bpG<botY2)botY2=bpG;
        var geoG=gm.geometry;
        if(!geoG||!geoG.attributes||!geoG.attributes.position)continue;
        var posG=geoG.attributes.position;
        if(!geoG.attributes.color)continue;
        gm.updateMatrixWorld();
        // 竖向流纹（流体熊）：按水平角度分带，带边界随机宽窄，浇注完成呈五彩竖向流纹
        var nBands=14+Math.floor(Math.random()*6);
        var bandCols=[];
        for(var bI=0;bI<nBands;bI++)bandCols.push(parseColorArr(flCol(mixCols)));
        var boundaries=[];
        var segA=2*Math.PI/nBands,accA=0;
        for(var bI2=0;bI2<nBands;bI2++){
          accA+=segA*(0.7+Math.random()*0.6);
          boundaries.push(accA%(2*Math.PI));
        }
        var eM=gm.matrixWorld.elements;
        for(var viG=0;viG<posG.count;viG++){
          var pxG=posG.getX(viG),pyG=posG.getY(viG),pzG=posG.getZ(viG);
          var wxG=eM[0]*pxG+eM[4]*pyG+eM[8]*pzG+eM[12];
          var wyG=eM[1]*pxG+eM[5]*pyG+eM[9]*pzG+eM[13];
          var wzG=eM[2]*pxG+eM[6]*pyG+eM[10]*pzG+eM[14];
          var angA=Math.atan2(wzG,wxG);
          if(angA<0)angA+=2*Math.PI;
          var bandA=0;
          for(var bI3=0;bI3<nBands;bI3++){if(angA<boundaries[bI3]){bandA=bI3;break;}}
          verts.push({mesh:gm,idx:viG,wy:wyG,col:bandCols[bandA],done:false});
        }
        if(meshes.indexOf(gm)<0)meshes.push(gm);
      }
      parts.push({verts:verts});
    }else{
    scene3d.traverse(function(c){
      if(c.isMesh&&!c.userData.ground&&!c.userData.aux){
        var mats=c.material;
        var mat=Array.isArray(mats)?mats[0]:mats;
        var tex=mat&&mat.map;
        if(!(tex&&tex.image&&tex.image.getContext))return;
        var bb=new THREE.Box3().setFromObject(c);
        var tp=bb.max.y,bp=bb.min.y;
        var isFlat=((tp-bp)<0.15);   // 顶/底面（薄片）：液面到达时整面覆盖
        if(tp>topY2)topY2=tp;
        if(bp<botY2)botY2=bp;
        // 大理石色斑：液面流经时浮现的大色块（径向渐变混色），取代条纹
        var blobs=[];
        var nBl=6+Math.floor(Math.random()*4);   // 6~9 个色斑
        for(var bl=0;bl<nBl;bl++){
          blobs.push({
            x:Math.random()*tex.image.width,
            y:Math.random()*tex.image.height,
            r:tex.image.width*(0.16+Math.random()*0.30),   // 大半径色块
            ci:Math.floor(Math.random()*mixCols.length),
            done:false
          });
        }
        // 竖向蜿蜒流带：大色域自然流淌（流体熊），4~5 条宽流带，蜿蜒+宽窄变化
        var stripes=[];
        var nSt=4+Math.floor(Math.random()*2);
        for(var st=0;st<nSt;st++){
          stripes.push({
            x0:tex.image.width*(0.06+Math.random()*0.88),      // 起始位置（覆盖全宽）
            swayA:tex.image.width*(0.04+Math.random()*0.09),   // 蜿蜒幅度（柔和）
            swayB:tex.image.width*(0.02+Math.random()*0.05),
            swayF:0.02+Math.random()*0.03,                     // 蜿蜒频率（每像素）
            swayF2:0.015+Math.random()*0.025,
            phase:Math.random()*6.28,
            w0:tex.image.width*(0.14+Math.random()*0.16),      // 头顶宽（大色块）
            wGrow:tex.image.width*(0.06+Math.random()*0.12),   // 向下增宽
            ci:Math.floor(Math.random()*mixCols.length)
          });
        }
        parts.push({ctx:tex.image.getContext('2d'),tex:tex,w:tex.image.width,h:tex.image.height,
          topY:tp,botY:bp,lastF:0,flat:isFlat,
          blobs:blobs,
          stripes:stripes,
          colors:mixCols});
      }
    });
    }
    if(parts.length>0){
      window.__flood={active:true,progress:0,speed:0.5,topY:topY2,botY:botY2,parts:parts,colors:mixCols,verts:verts,meshes:meshes};
      if(dbg)dbg.textContent='浇注：颜料正慢慢流遍全身…';
    }else{
      if(dbg)dbg.textContent='找不到可涂色的部件';
    }
  }catch(err){document.title='[POURERR] '+err.message;}
}

function flCol(arr){return arr[Math.floor(Math.random()*arr.length)];}
// ===== 杯下状态提示：空→"先添加颜色"；有颜料→"点击模型浇注"；浇注/恢复中各自提示 =====
function updateCupHint(){
  try{
    var hint=document.getElementById('pour-cup-hint');
    if(!hint)return;
    var pm=window.__pourMeter;
    var fl=window.__flood;
    if(!window.__hasMix){hint.textContent='先添加颜色';return;}
    if(fl&&fl.active){hint.textContent='颜料正铺满全身…';return;}
    if(pm&&pm.active){hint.textContent='浇注进行中…';return;}
    if(pm&&pm.recharging){hint.textContent='能量恢复中 '+Math.round(pm.val)+'%';return;}
    hint.textContent='点击模型浇注';
  }catch(err){}
}

// ===== 清除模型颜色：一键恢复白色（同时取消就绪/漫灌/动画）=====
function clearModelColors(){
  try{
    if(window.__flood){window.__flood.active=false;}
    if(window.__pourMeter){window.__pourMeter.active=false;window.__pourMeter.poured=false;window.__pourMeter.recharging=false;window.__pourMeter.val=window.__hasMix?100:0;}
    if(window.__glbModel){
      window.__paintPoints=[];syncPaintUniforms();
      window.__paintSegsMap={};syncPaintSegs();
      window.__glbModel.meshes.forEach(function(m){
        var ic=m.userData.__initColor;
        var cR=(ic>>16&255)/255,cG=(ic>>8&255)/255,cB=(ic&255)/255;
        var gC=m.geometry,colC=gC&&gC.attributes&&gC.attributes.color;
        if(colC){
          for(var iCC=0;iCC<colC.count;iCC++){colC.setXYZ(iCC,cR,cG,cB);}
          colC.needsUpdate=true;
        }
        var matsC=Array.isArray(m.material)?m.material:[m.material];
        for(var iC=0;iC<matsC.length;iC++){
          var mmC=matsC[iC];
          if(mmC){mmC.color.set(0xffffff);mmC.shininess=0;if(mmC.specular)mmC.specular.set(0x000000);}
        }
      });
      if(pourJet)pourJet.visible=false;
      if(pourJetTop)pourJetTop.visible=false;
      if(pourDrops)pourDrops.forEach(function(d){d.visible=false});
      var dbgG2=document.getElementById('3d-dbg');
      if(dbgG2)dbgG2.textContent='已清除颜色，恢复原始模型';
      return;
    }
    scene3d.traverse(function(c){
      if(c.isMesh&&!c.userData.ground&&!c.userData.aux){
        var mats=c.material;
        var mat=Array.isArray(mats)?mats[0]:mats;
        var tex=mat&&mat.map;
        if(tex&&tex.image&&tex.image.getContext){
          var ctx=tex.image.getContext('2d');
          ctx.clearRect(0,0,tex.image.width,tex.image.height);
          ctx.fillStyle=(tex.image.__init||'#f5f2ec');   // 恢复角色初始色（各角色不同本色）
          ctx.fillRect(0,0,tex.image.width,tex.image.height);
          tex.needsUpdate=true;
        }
      }
    });
    if(pourJet)pourJet.visible=false;
    if(pourJetTop)pourJetTop.visible=false;
    if(pourDrops)pourDrops.forEach(function(d){d.visible=false});
    var dbg=document.getElementById('3d-dbg');
    if(dbg)dbg.textContent='已清除模型颜色，恢复白色';
  }catch(err){}
}

// ===== 浇筑量提示：100%→0% 递减（每帧驱动，倾倒速度随流量）=====
function updatePourMeter(){
  try{
    var pm=window.__pourMeter;
    var cup=document.getElementById('pour-cup-num');
    if(!cup)return;
    if(!pm){   // 无状态：默认空杯
      cup.textContent=window.__hasMix?'100%':'空';
      return;
    }
    if(pm.active){
      // 每秒 -(14+36*rate)%，流量大倒得快（约 2 秒倒完）——浓稠颜料倒下的过程（时间基准）
      pm.val-=(window.__dt3||0.016)*(14+pm.rate*36);
      if(pm.val<=0){pm.val=0;pm.active=false;pm.poured=true;}
      cup.textContent=Math.round(pm.val)+'%';
    }else if(pm.recharging){
      // 浇注效果生成完毕后：能量从 0% 慢慢恢复到 100%（未满不可再次浇注）
      pm.val+=(window.__dt3||0.016)*30;
      if(pm.val>=100){pm.val=100;pm.recharging=false;pm.poured=false;}
      cup.textContent=Math.round(pm.val)+'%';
    }else if(pm.poured){
      cup.textContent='0%';   // 已浇注：颜料倒完
    }else{
      cup.textContent=window.__hasMix?'100%':'空';
    }
    updateCupHint();   // 每帧同步杯下文字
  }catch(err){}
}

// ===== 颜色工具：'#rrggbb' 或 'rgb(r,g,b)' → 'rgba(...,a)' =====
function colRgba(col,a){
  try{
    if(col&&col.indexOf('#')===0){
      var r=parseInt(col.slice(1,3),16),g=parseInt(col.slice(3,5),16),b=parseInt(col.slice(5,7),16);
      return 'rgba('+r+','+g+','+b+','+a+')';
    }
    var m=(col||'').match(/[\d.]+/g);
    if(m&&m.length>=3)return 'rgba('+m[0]+','+m[1]+','+m[2]+','+a+')';
  }catch(e){}
  return col;
}

// ===== 光泽漆面：浇注完成后加湿润高光（白色流痕 + 亮斑），模拟流体熊漆面 =====
function addSheen(){
  try{
    var fl=window.__flood;if(!fl||!fl.parts)return;
    for(var i=0;i<fl.parts.length;i++){
      var p=fl.parts[i];
      if(p.flat)continue;
      p.ctx.save();
      p.ctx.globalCompositeOperation='source-atop';
      // 白色高光流痕（湿润漆面反光）
      for(var k=0;k<3;k++){
        var bx=Math.random()*p.w;
        var bw=6+Math.random()*18;
        p.ctx.globalAlpha=0.10+Math.random()*0.12;
        p.ctx.fillStyle='#ffffff';
        p.ctx.fillRect(bx,0,bw,p.h);
      }
      // 径向亮斑（光泽）
      var lx=Math.random()*p.w,ly=Math.random()*p.h;
      var rr=20+Math.random()*55;
      var rg=p.ctx.createRadialGradient(lx,ly,2,lx,ly,rr);
      rg.addColorStop(0,'rgba(255,255,255,0.28)');
      rg.addColorStop(1,'rgba(255,255,255,0)');
      p.ctx.globalAlpha=1;
      p.ctx.fillStyle=rg;
      p.ctx.fillRect(0,0,p.w,p.h);
      p.ctx.restore();
      p.tex.needsUpdate=true;
    }
  }catch(e){}
}

// ===== 全局漫灌（animate3d 每帧驱动）：液面从头顶匀速降到脚底，全身随机流体熊色带 =====
function floodStep(){
  try{
    if(window.__glbModel){floodStepGlb();return;}
    var fl=window.__flood;
    if(!fl||!fl.active)return;
    fl.progress+=fl.speed*(window.__dt3||0.016);
    if(fl.progress>=1){
      fl.progress=1;
      fl.active=false;
      addSheen();   // 光泽漆面：湿润高光
      // 效果生成完毕：能量从 0% 重新恢复到 100%（未满不可再次浇注）
      window.__pourMeter={val:0,active:false,rate:0,poured:false,recharging:true};
      var dbg=document.getElementById('3d-dbg');
      if(dbg)dbg.textContent='浇注完成：颜料已铺满全身 🎨（能量恢复中）';
      return;
    }
    var liquidY=fl.topY-fl.progress*(fl.topY-fl.botY);
    for(var i=0;i<fl.parts.length;i++){
      var p=fl.parts[i];
      if(p.flat){   // 顶/底面：液面降到该面之下时整面覆盖（无方向）
        if(liquidY<=p.topY+0.01&&p.lastF<1){
          p.ctx.save();
          p.ctx.globalCompositeOperation='source-atop';
          p.ctx.globalAlpha=0.94*(window.__paintOpacity||1);
          p.ctx.fillStyle=p.colors[Math.floor(fl.progress*4)%p.colors.length];
          p.ctx.fillRect(0,0,p.w,p.h);
          // 色斑：一次性浮现（大理石混色）
          var opF2=(window.__paintOpacity||1);
          for(var bl=0;bl<p.blobs.length;bl++){
            var b3=p.blobs[bl];
            var rg=p.ctx.createRadialGradient(b3.x,b3.y,b3.r*0.15,b3.x,b3.y,b3.r);
            rg.addColorStop(0,colRgba(p.colors[b3.ci],0.8*opF2));
            rg.addColorStop(0.6,colRgba(p.colors[b3.ci],0.4*opF2));
            rg.addColorStop(1,colRgba(p.colors[b3.ci],0));
            p.ctx.fillStyle=rg;
            p.ctx.fillRect(b3.x-b3.r,b3.y-b3.r,b3.r*2,b3.r*2);
          }
          p.ctx.restore();
          p.tex.needsUpdate=true;
          p.lastF=1;
        }
        continue;
      }
      var span=(p.topY-p.botY)||1;
      var f=(p.topY-liquidY)/span;
      f=Math.max(0,Math.min(1,f));
      if(f<=p.lastF+0.004)continue;
      // 纹理顶部=世界头顶（uv.y=1=h），颜料从顶部向下流并逐渐扩散
      // 新增段：上次液面行→本次液面行（从 h 向下推进）
      var yTop=(1-p.lastF)*p.h;      // 段顶（上次液面，靠纹理顶部）
      var yBot=(1-f)*p.h;            // 段底（本次液面，向下推进）
      if(yBot>=yTop-1)continue;
      p.ctx.save();
      p.ctx.globalCompositeOperation='source-atop';   // 只覆盖已有像素，不画出方框
      var fT=1-yTop/p.h, fB=1-yBot/p.h;   // 0=顶, 1=底
      var opF=(window.__paintOpacity||1);
      // 竖向蜿蜒流带：纯色大色块（无段内渐变，消除横向细纹）+ 双层软边晕染
      for(var k=0;k<p.stripes.length;k++){
        var st= p.stripes[k];
        var cxT=st.x0+st.swayA*Math.sin(yTop*st.swayF+st.phase)+st.swayB*Math.cos(yTop*st.swayF2);
        var cxB=st.x0+st.swayA*Math.sin(yBot*st.swayF+st.phase)+st.swayB*Math.cos(yBot*st.swayF2);
        var wT=Math.max(6,st.w0+st.wGrow*fT);
        var wB=Math.max(6,st.w0+st.wGrow*fB);
        var cMain=p.colors[st.ci];
        // 主体：纯色大色块（每帧段间颜色一致，拼接连续无接缝）
        p.ctx.fillStyle=colRgba(cMain,0.9*opF);
        p.ctx.beginPath();
        p.ctx.moveTo(cxT-wT,yTop);
        p.ctx.lineTo(cxB-wB,yBot);
        p.ctx.lineTo(cxB+wB,yBot);
        p.ctx.lineTo(cxT+wT,yTop);
        p.ctx.closePath();
        p.ctx.fill();
        // 软边中层：边缘晕染（1.5 倍宽）
        p.ctx.fillStyle=colRgba(cMain,0.32*opF);
        p.ctx.beginPath();
        p.ctx.moveTo(cxT-wT*1.5,yTop);
        p.ctx.lineTo(cxB-wB*1.5,yBot);
        p.ctx.lineTo(cxB+wB*1.5,yBot);
        p.ctx.lineTo(cxT+wT*1.5,yTop);
        p.ctx.closePath();
        p.ctx.fill();
        // 软边外层：更大范围微染（2.4 倍宽，融入底色）
        p.ctx.fillStyle=colRgba(cMain,0.13*opF);
        p.ctx.beginPath();
        p.ctx.moveTo(cxT-wT*2.4,yTop);
        p.ctx.lineTo(cxB-wB*2.4,yBot);
        p.ctx.lineTo(cxB+wB*2.4,yBot);
        p.ctx.lineTo(cxT+wT*2.4,yTop);
        p.ctx.closePath();
        p.ctx.fill();
      }
      // 大理石色斑：液面行经过色斑中心时浮现（径向渐变，色块自然混色）
      for(var bl=0;bl<p.blobs.length;bl++){
        var b2=p.blobs[bl];
        if(b2.done)continue;
        var byF=b2.y/p.h;   // 0=底,1=顶
        if(byF>=fB-0.012&&byF<=fT){   // 液面正经过该色斑
          b2.done=true;
          var c3=p.colors[b2.ci];
          var opB=(window.__paintOpacity||1);
          var rg=p.ctx.createRadialGradient(b2.x,b2.y,b2.r*0.1,b2.x,b2.y,b2.r);
          rg.addColorStop(0,colRgba(c3,0.92*opB));
          rg.addColorStop(0.55,colRgba(c3,0.5*opB));
          rg.addColorStop(1,colRgba(c3,0.05*opB));
          p.ctx.globalAlpha=1;
          p.ctx.fillStyle=rg;
          p.ctx.fillRect(b2.x-b2.r,b2.y-b2.r,b2.r*2,b2.r*2);
        }
      }
      p.ctx.restore();
      p.tex.needsUpdate=true;
      p.lastF=f;
    }
  }catch(err){}
}

function pourStep(){
  try{
    if(!pourState)return;
    var ps=pourState;
    var flow=Math.max(10,brushSize*0.55); // 流下阶段：每步下流距离
    var w=Math.max(16,brushSize*1.2);     // 流宽
    var ctx=ps.ctx;
    var step=ps.step=(ps.step||0)+1;
    var pooled=!!ps.pooled;               // 是否已进入底部堆积模式（持久标记）
    ctx.fillStyle=drawColor;
    ctx.globalAlpha=0.94;
    if(!pooled){
      // ===== 流淌阶段：液体从倾倒口向下淌，液头逐段下移 =====
      var y0=ps.headY,y1=y0+flow;
      var sway=Math.sin(step*0.5)*w*0.12;
      var xc=ps.x+sway;
      ctx.beginPath();
      ctx.arc(ps.x,ps.spoutY,Math.max(9,w*0.85),0,Math.PI*2);  // 倾倒口持续湿润
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(xc-w*0.18,y0);
      ctx.lineTo(xc+w*0.18,y0);
      ctx.quadraticCurveTo(xc+w*0.5,(y0+y1)*0.5,xc+w*(0.45+Math.random()*0.2),y1);
      ctx.lineTo(xc-w*(0.45+Math.random()*0.2),y1);
      ctx.quadraticCurveTo(xc-w*0.5,(y0+y1)*0.5,xc-w*0.18,y0);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();                                          // 液头圆头
      ctx.arc(xc,y1,Math.max(4,w*0.26),0,Math.PI*2);
      ctx.fill();
      for(var i=0;i<3;i++){                                     // 沿程溅滴
        ctx.beginPath();
        ctx.arc(xc+(Math.random()-0.5)*w*2.2,y0+Math.random()*flow*0.9,
          Math.max(2,w*(0.08+Math.random()*0.12)),0,Math.PI*2);
        ctx.fill();
      }
      ps.headY=y1;
      if(y1>ps.h*0.85){ps.pooled=true;ps.poolTop=ps.h*0.85;}    // 触及底部，切换堆积
    }else{
      // ===== 堆积阶段：倾倒口恒定出液，流束从倾倒口垂到堆积顶，底部越积越厚越宽 =====
      var spout=Math.max(20,ps.spoutY);   // spoutY=0 时从画布顶部出液，即模型顶端持续倒下
      var top=ps.poolTop;
      var topW=w*(0.7+step*0.04);                               // 堆积宽度逐步增大
      ctx.beginPath();                                           // 倾倒口持续出液
      ctx.arc(ps.x,spout,Math.max(9,w*0.85),0,Math.PI*2);
      ctx.fill();
      ctx.beginPath();                                           // 垂流：倾倒口 → 堆积顶
      ctx.moveTo(ps.x-w*0.16,spout);
      ctx.lineTo(ps.x+w*0.16,spout);
      ctx.lineTo(ps.x+topW*0.5,top);
      ctx.lineTo(ps.x-topW*0.5,top);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();                                           // 堆积主体（椭圆，随 step 增高增宽）
      ctx.ellipse(ps.x,ps.h-6,topW,(ps.h-top)*0.65+10,0,0,Math.PI*2);
      ctx.fill();
      ctx.beginPath();                                           // 堆积顶沿的液滴头
      ctx.arc(ps.x,top,Math.max(4,w*0.3),0,Math.PI*2);
      ctx.fill();
      ps.poolTop=Math.max(ps.h*0.68,top-2.8);                   // 堆积顶缓慢上移
      ps.headY=ps.poolTop;
      ps.pooled=true;
      ps.dripPhase=(ps.dripPhase||0)+1;
      paintDrip(ctx,ps.x,top,drawColor,ps.dripPhase,Math.max(18,brushSize*0.8));  // 底部边缘水滴
    }
    ctx.globalAlpha=1;
    ps.tex.needsUpdate=true;
  }catch(err){document.title='[POURERR] '+err.message;}
}

var clock3d=new THREE.Clock();
var poseState='standing';

// 定格姿势：播放对应 clip 后定位到目标帧并暂停（站着/坐着不动）
function setPose(state){
  try{
    if(window.__glbModel){
      setGlbAnim(state==='sitting'?'sit':'stand',true);
      return;
    }
    if(window.__bearParts){window.__bearPose=state;return;}
    if(!window.__mixer||!window.__animClips)return;
    var name=(state==='sitting')?'Sitting':'Standing';
    var clip=THREE.AnimationClip.findByName(window.__animClips,name);
    if(!clip)return;
    var mixer=window.__mixer;
    mixer.stopAllAction();
    var action=mixer.clipAction(clip);
    action.reset();
    action.play();
    // Standing 动画=站起过程、Sitting 动画=坐下过程，二者都是"最后一帧"才是稳定姿势（站直/坐定）
    action.time=Math.max(0,clip.duration-0.01);
    action.paused=true;
    window.__curAction=action;
  }catch(e){console.error('姿势切换失败',e)}
}

function playAnim(name){
  try{
    if(window.__glbModel){
      if(name==='__pose__'){
        if(window.__mixer)window.__mixer.stopAllAction();
        window.__curAction=null;
        return;
      }
      var clipG=glbFindClip(name);
      var dbgA=document.getElementById('3d-dbg');
      if(!clipG){
        if(dbgA)dbgA.textContent='该模型没有「'+(MODEL_ANIM_NAMES[name]||name)+'」动画';
        return;
      }
      setGlbAnim(name,false);
      var pbG=document.getElementById('pose-btn');
      if(pbG&&poseState!=='standing'){poseState='standing';pbG.textContent='坐下';}
      return;
    }
    if(window.__bearParts){
      window.__bearAnim=(name==='__pose__')?'idle':name;
      // 点击其他动作：先恢复站立（坐下状态会拦截所有动画）
      if(name!=='__pose__'){
        window.__bearPose='standing';
        poseState='standing';
        var pb=document.getElementById('pose-btn');
        if(pb)pb.textContent='坐下';
      }
      return;
    }
    if(name==='__pose__'){
      if(window.__mixer)window.__mixer.stopAllAction();
      window.__curAction=null;
      return;
    }
    if(!window.__mixer||!window.__animClips)return;
    var clip=THREE.AnimationClip.findByName(window.__animClips,name);
    if(!clip)return;
    var mixer=window.__mixer;
    var action=mixer.clipAction(clip);
    if(window.__curAction&&window.__curAction!==action){
      window.__curAction.fadeOut(0.4);
      action.reset();
      action.fadeIn(0.4);
    }
    action.play();
    window.__curAction=action;
  }catch(e){console.error('播放动画失败',e)}
}

function animate3d(){
  if(!window.__camTarget)window.__camTarget=new THREE.Vector3(0,0,0);
  var camTarget=window.__camTarget;
  requestAnimationFrame(animate3d);
  var nowT=Date.now();
  window.__dt3=Math.min(0.05,((nowT-(window.__lastT3||nowT))/1000)||0.016);
  window.__lastT3=nowT;
  camera3d.position.x=camTarget.x+Math.sin(lookYaw)*camDist*Math.cos(lookPitch);
  camera3d.position.z=camTarget.z+Math.cos(lookYaw)*camDist*Math.cos(lookPitch);
  camera3d.position.y=camTarget.y+Math.sin(lookPitch)*camDist;
  camera3d.lookAt(camTarget);
  if(window.__mixer)window.__mixer.update(clock3d.getDelta());
  bearAnimStep(clock3d.getElapsedTime());   // 积木熊程序化动画
  // 颜料液滴：从壶口落下，接触模型表面后消失（浇注期间持续生成，替代流柱圆柱）
  if(window.__jetTop!=null){
    var jT=window.__jetTop,jB=window.__jetBot,jX=window.__jetX,jZ=window.__jetZ;
    var pmJ2=window.__pourMeter;
    var pouringOn=(window.__jetGrow&&window.__jetGrow.active)||(pmJ2&&pmJ2.active);
    var dropN=pourDrops?pourDrops.length:0;
    for(var di=0;di<dropN;di++){
      var dd=pourDrops[di];
      if(!dd.visible){
        if(pouringOn){
          if(dd.ph==null){dd.visible=true;dd.ph=di/dropN;}   // 首次：从壶口出现（相位错开）
          else if(dd.ph>=1){dd.visible=true;dd.ph=0;}         // 接触模型消失后：浇注中从壶口重生
        }
        continue;
      }
      dd.ph+=0.028*(window.__dt3||0.016)*60;   // 下落速度（约 0.6 秒落全程，时间基准）
      if(dd.ph>=1){dd.visible=false;continue;}   // 接触模型表面即消失（不再循环）
      var dy=jB+(jT-jB)*(1-dd.ph);
      dd.position.set(jX,dy,jZ);
      try{
        var jcols=window.__jetColors;
        dd.material.color.set(jcols?(jcols[di%jcols.length]||drawColor):drawColor);
      }catch(e4){}
      dd.material.opacity=0.35+0.65*dd.ph;   // 越接近落点越明显
      dd.scale.setScalar(0.8+0.6*(1-dd.ph)); // 靠近壶口小、接近落点大
    }
  }
  if(pourJetTop&&pourJetTop.visible){
    pourJetTop.scale.setScalar(0.85+0.25*(0.5+0.5*Math.sin(Date.now()*0.019)));
  }
  // 浇注流柱状态机：出现（顶端向下生长）→保持（浇注量 100%→0%）→消失（从上到下）
  var pmJ=window.__pourMeter;
  if(pourJet&&pmJ){
    if(window.__jetGrow&&window.__jetGrow.active){
      // 出现阶段：从壶口（顶端）向下生长到模型头顶，颜料流下的过程可见
      var g=window.__jetGrow;
      g.h+=g.H*0.025*(window.__dt3||0.016)*60;   // 约 0.7 秒生长完整（时间基准）
      if(g.h>=g.H){g.h=g.H;g.active=false;}
      pourJet.scale.y=Math.max(0.06,g.h);
      pourJet.position.y=g.jt-g.h/2;   // 顶端固定=壶口，向下长
    }else if(pmJ.active){
      // 浇注中：流柱保持完整高度（等浇注量倒完）
      if(window.__jetShrink)window.__jetShrink.active=false;
      pourJet.visible=false;   // 流柱圆柱始终不显示
      pourJet.scale.y=window.__jetH0||1;
    }else if(pmJ.poured&&!window.__jetShrink){
      window.__jetShrink={h:window.__jetH0||1,H:window.__jetH0||1,jb:window.__jetBot||0,active:true};
      // 液滴继续落完（接触模型后消失，不再重生）
    }
  }
  if(window.__jetShrink&&window.__jetShrink.active){
    var sh=window.__jetShrink;
    sh.h-=sh.H*0.02*(window.__dt3||0.016)*60;   // 从上到下收缩（约 0.8 秒，时间基准）
    if(sh.h<=0.02){
      pourJet.visible=false;
      if(pourJetTop)pourJetTop.visible=false;
      if(pourDrops)pourDrops.forEach(function(d){d.visible=false});
      sh.active=false;
      window.__jetTop=null;
    }else{
      pourJet.scale.y=sh.h;                 // 绝对高度：与完整阶段连续，无跳变
      pourJet.position.y=sh.jb+sh.h/2;      // 底端固定=模型头顶，顶端从上往下缩
    }
  }
  floodStep();   // 全局漫灌：颜料液面从头顶慢慢降到底，全身铺满
  updatePourMeter();   // 浇筑量 100%→0%
  renderer3d.render(scene3d,camera3d);
}


export { enter3d, clear3dTools, toggleModelCat, updateCupHint, switchModel };

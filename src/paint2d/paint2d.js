import { G } from '../state.js';
import { scenes } from '../data/scenes.js';
import { show } from '../ui/router.js';

// 2D 喷绘画布 + 「搭一个世界」分层选择
var ratios=[['9:16',400,710],['3:4',480,640],['1:1',600,600],['4:3',720,540],['16:9',800,450]];
var currentRatio='16:9';

function changeRatio(label,w,h){
  currentRatio=label;
  var c=document.getElementById('draw-canvas');
  c.width=w;c.height=h;
  document.querySelectorAll('#ratio-row .choice-tag').forEach(function(b){b.classList.toggle('selected',b.textContent===label)});
  if(drawCtx)drawCtx.clearRect(0,0,c.width,c.height);
}

function buildMode(){
  G.mode='build';
  // 画幅
  var rr=document.getElementById('ratio-row');rr.innerHTML='';
  ratios.forEach(function(r){
    var b=document.createElement('button');b.className='choice-tag'+(r[0]===currentRatio?' selected':'');b.textContent=r[0];
    b.onclick=function(){changeRatio(r[0],r[1],r[2])};
    rr.appendChild(b);
  });
  // 视角
  var ar=document.getElementById('angle-row');ar.innerHTML='';
  ['平视','俯视/鸟瞰','仰视','广角','鱼眼','特写'].forEach(function(a){
    var b=document.createElement('button');b.className='choice-tag';b.textContent=a;
    b.onclick=function(){ar.querySelectorAll('.choice-tag').forEach(function(x){x.classList.remove('selected')});b.classList.add('selected')};
    ar.appendChild(b);
  });
  // 主色调
  var colorRow=document.getElementById('color-row');colorRow.innerHTML='';
  var colors=['#1a1a2e','#e8a87c','#8ecae6','#95d5b2','#d4a5c9','#2d3436','#f4d35e'];
  colors.forEach(function(c){
    var b=document.createElement('button');b.style.cssText='width:24px;height:24px;border-radius:50%;border:2px solid transparent;background:'+c+';cursor:pointer;padding:0';
    b.onclick=function(){colorRow.querySelectorAll('button').forEach(function(x){x.style.borderColor='transparent'});b.style.borderColor='#fff';colorRow.dataset.val=c};
    colorRow.appendChild(b);
  });
  document.getElementById('custom-color').value='';
  // 风格
  var styleRow=document.getElementById('style-row');styleRow.innerHTML='';
  ['写实','复古','科幻','抽象','电影感','水彩'].forEach(function(s){
    var b=document.createElement('button');b.className='choice-tag';b.textContent=s;
    b.onclick=function(){styleRow.querySelectorAll('.choice-tag').forEach(function(x){x.classList.remove('selected')});b.classList.add('selected')};
    styleRow.appendChild(b);
  });
  show('screen-build');
  initDraw();
}
var drawColor='#e8e6e1',drawMode='pen',drawing=false,lastX=0,lastY=0,drawCtx=null,hasDrawn=false;
var undoStack=[],redoStack=[];
function pushUndo(){
  var c=document.getElementById('draw-canvas');if(!c||!drawCtx)return;
  undoStack.push(c.toDataURL());
  if(undoStack.length>10)undoStack.shift();
  redoStack=[];
}
function undo(){
  if(!undoStack.length)return;
  var c=document.getElementById('draw-canvas');
  redoStack.push(c.toDataURL());
  var img=new Image();
  img.onload=function(){drawCtx.clearRect(0,0,c.width,c.height);drawCtx.drawImage(img,0,0)};
  img.src=undoStack.pop();
}
function redo(){
  if(!redoStack.length)return;
  var c=document.getElementById('draw-canvas');
  undoStack.push(c.toDataURL());
  var img=new Image();
  img.onload=function(){drawCtx.clearRect(0,0,c.width,c.height);drawCtx.drawImage(img,0,0)};
  img.src=redoStack.pop();
}
function initDraw(){
  var c=document.getElementById('draw-canvas');if(!c)return;
  drawCtx=c.getContext('2d');drawCtx.lineCap='round';drawCtx.lineJoin='round';
  hasDrawn=false;undoStack=[];redoStack=[];
  var tools=document.getElementById('draw-tools');tools.innerHTML='';
  var undoBtn=document.createElement('button');undoBtn.textContent='↩ 撤销';undoBtn.onclick=undo;tools.appendChild(undoBtn);
  var redoBtn=document.createElement('button');redoBtn.textContent='↪ 重做';redoBtn.onclick=redo;tools.appendChild(redoBtn);
  var sep0=document.createElement('span');sep0.style.cssText='width:1px;height:18px;background:rgba(255,255,255,.15)';tools.appendChild(sep0);
  var modes=[['pen','笔'],['spray','喷射'],['splatter','泼'],['smear','涂抹']];
  modes.forEach(function(m,i){
    var b=document.createElement('button');b.textContent=m[1];if(i===0)b.classList.add('tool-active');
    b.onclick=function(){tools.querySelectorAll('button').forEach(function(x){x.classList.remove('tool-active')});b.classList.add('tool-active');drawMode=m[0]};
    tools.appendChild(b);
  });
  var sep=document.createElement('span');sep.style.cssText='width:1px;height:18px;background:rgba(255,255,255,.15)';tools.appendChild(sep);
  var colors=['#e8e6e1','#e8a87c','#8ecae6','#95d5b2','#d4a5c9','#f4d35e','#ea6668'];
  colors.forEach(function(col,i){
    var b=document.createElement('button');b.className='dot'+(i===0?' selected':'');b.style.background=col;
    b.onclick=function(){tools.querySelectorAll('.dot').forEach(function(x){x.classList.remove('selected')});b.classList.add('selected');drawColor=col};
    tools.appendChild(b);
  });
  var sep2=document.createElement('span');sep2.style.cssText='width:1px;height:18px;background:rgba(255,255,255,.15)';tools.appendChild(sep2);
  var clr=document.createElement('button');clr.textContent='清空';clr.onclick=clearDraw;tools.appendChild(clr);
  function pos(e){var r=c.getBoundingClientRect();var t=e.touches?e.touches[0]:e;return{x:(t.clientX-r.left)*(c.width/r.width),y:(t.clientY-r.top)*(c.height/r.height)}}
  function sprayAt(x,y){for(var i=0;i<15;i++){var a=Math.random()*Math.PI*2,r=Math.random()*12;drawCtx.fillStyle=drawColor;drawCtx.globalAlpha=0.2+Math.random()*0.3;drawCtx.beginPath();drawCtx.arc(x+Math.cos(a)*r,y+Math.sin(a)*r,1+Math.random()*1.5,0,Math.PI*2);drawCtx.fill()}drawCtx.globalAlpha=1}
  function splatterAt(x,y){for(var i=0;i<5;i++){var a=Math.random()*Math.PI*2,r=5+Math.random()*25;drawCtx.fillStyle=drawColor;drawCtx.globalAlpha=0.3+Math.random()*0.5;drawCtx.beginPath();drawCtx.arc(x+Math.cos(a)*r,y+Math.sin(a)*r,2+Math.random()*6,0,Math.PI*2);drawCtx.fill()}drawCtx.globalAlpha=1}
  function start(e){e.preventDefault();drawing=true;pushUndo();var p=pos(e);lastX=p.x;lastY=p.y;if(drawMode==='spray')sprayAt(p.x,p.y);else if(drawMode==='splatter')splatterAt(p.x,p.y)}
  function move(e){if(!drawing)return;e.preventDefault();var p=pos(e);
    if(drawMode==='pen'){drawCtx.strokeStyle=drawColor;drawCtx.lineWidth=3;drawCtx.globalAlpha=1;drawCtx.beginPath();drawCtx.moveTo(lastX,lastY);drawCtx.lineTo(p.x,p.y);drawCtx.stroke()}
    else if(drawMode==='spray')sprayAt(p.x,p.y)
    else if(drawMode==='splatter'){if(Math.random()>0.5)splatterAt(p.x,p.y)}
    else if(drawMode==='smear'){drawCtx.strokeStyle=drawColor;drawCtx.lineWidth=20;drawCtx.globalAlpha=0.15;drawCtx.lineCap='round';drawCtx.beginPath();drawCtx.moveTo(lastX,lastY);drawCtx.lineTo(p.x,p.y);drawCtx.stroke();drawCtx.globalAlpha=1}
    lastX=p.x;lastY=p.y;hasDrawn=true;
  }
  function end(){drawing=false}
  c.onmousedown=start;c.onmousemove=move;c.onmouseup=end;c.onmouseleave=end;
  c.ontouchstart=start;c.ontouchmove=move;c.ontouchend=end;
}
function clearDraw(){var c=document.getElementById('draw-canvas');if(c&&drawCtx){pushUndo();drawCtx.clearRect(0,0,c.width,c.height)}hasDrawn=false}
function generateBuild(){
  var parts=[];
  var free=document.getElementById('build-free').value.trim();
  if(free)parts.push(free);
  var ang=document.querySelector('#angle-row .choice-tag.selected');
  if(ang)parts.push(ang.textContent+'视角');
  var cr=document.getElementById('color-row');
  if(cr.dataset.val)parts.push('主色调'+cr.dataset.val);
  var cc=document.getElementById('custom-color').value.trim();
  if(cc)parts.push('主色调'+cc);
  var st=document.querySelector('#style-row .choice-tag.selected');
  if(st)parts.push(st.textContent+'风格');
  parts.push(currentRatio+'画幅');
  if(hasDrawn)parts.push('参考涂鸦草图');
  var desc=parts.length?parts.join('，'):'一个随机的世界';
  document.getElementById('loading-text').textContent='正在构建你的世界';
  show('screen-loading');
  var idx=Math.floor(Math.random()*4);
  setTimeout(function(){
    document.getElementById('self-img').src=scenes[G.currentScene].seeds[idx].img;
    document.getElementById('self-caption').textContent=desc;
    show('screen-self');
  },2000);
}


export { buildMode, generateBuild };

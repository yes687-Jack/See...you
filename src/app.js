import { G } from './state.js';
import { scenes } from './data/scenes.js';
import { show } from './ui/router.js';
import { resumeAudio, isSoundPlaying, playScene, stopSound } from './audio/soundscape.js';
import { buildMode } from './paint2d/paint2d.js';

// 主流程：听见 → 想象 → 表达 → 看见自己 → 看见别人 → 看见现实；含本地聚会模式
function singleStart(){G.mode='single';goListen()}
function goListen(){stopSound();show('screen-listen')}
function toggleSound(){
  resumeAudio();
  if(isSoundPlaying()){stopSound();return}
  playScene(G.currentScene);
  setTimeout(function(){stopSound();setTimeout(function(){show('screen-type')},500)},6000);
}
function generateSelf(){
  var text=document.getElementById('user-input').value.trim();
  if(!text){document.getElementById('user-input').focus();return}
  document.getElementById('loading-text').textContent='正在为你构建世界';
  show('screen-loading');
  var idx=matchImage(text);
  setTimeout(function(){
    document.getElementById('self-img').src=scenes[G.currentScene].seeds[idx].img;
    document.getElementById('self-caption').textContent=text;
    show('screen-self');
  },2000);
}


function partySetup(){G.mode='party';show('screen-party-rules')}
function createRoom(){
  G.roomCode=String(Math.floor(1000+Math.random()*9000));
  document.getElementById('room-code').textContent=G.roomCode;
  document.getElementById('joined-count').textContent='1';
  document.getElementById('joined-list').innerHTML='';
  G.partyCount=1;
  show('screen-party-create');
}
function showJoin(){show('screen-party-join');document.getElementById('join-code').value='';document.getElementById('join-error').style.display='none';setTimeout(function(){document.getElementById('join-code').focus()},400)}
function joinRoom(){
  var code=document.getElementById('join-code').value.trim();
  if(code.length!==4||!/^\d{4}$/.test(code)){document.getElementById('join-error').textContent='请输入 4 位数字';document.getElementById('join-error').style.display='block';return}
  // 本地Demo：任意4位数字都算加入成功
  G.partyCount++;
  if(G.partyCount>8)G.partyCount=8;
  // 模拟加入者进入等待页
  document.getElementById('joined-count').textContent=G.partyCount;
  var list=document.getElementById('joined-list');
  var p=document.createElement('div');p.textContent='同学'+G.partyCount+' 加入了';list.appendChild(p);
  show('screen-party-create');
}
function partyStart(){
  G.partyPlayers=[];G.partyIdx=0;show('screen-listen');
  playScene(G.currentScene);
  setTimeout(function(){stopSound();goPartyInput()},6000);
}
function goPartyInput(){
  G.partyIdx=0;G.partyPlayers=[];
  document.getElementById('party-who').textContent='轮到第 1 个人';
  document.getElementById('name-input').value='';document.getElementById('party-desc').value='';
  show('screen-party-input');setTimeout(function(){document.getElementById('name-input').focus()},400);
}
function nextPlayer(){
  var name=document.getElementById('name-input').value.trim()||('同学'+(G.partyIdx+1));
  var desc=document.getElementById('party-desc').value.trim();
  if(!desc){document.getElementById('party-desc').focus();return}
  G.partyPlayers.push({name:name,desc:desc});G.partyIdx++;
  if(G.partyIdx<G.partyCount){
    document.getElementById('party-who').textContent='轮到第 '+(G.partyIdx+1)+' 个人';
    document.getElementById('name-input').value='';document.getElementById('party-desc').value='';
    document.getElementById('name-input').focus();
  } else {
    document.getElementById('loading-text').textContent='正在生成每个人的世界';
    show('screen-loading');
    setTimeout(function(){renderWall();show('screen-wall')},2000);
  }
}
function renderWall(){
  var grid=document.getElementById('wall-grid');grid.innerHTML='';
  G.partyPlayers.forEach(function(p){
    var idx=matchImage(p.desc);
    var item=document.createElement('div');item.className='wall-item';
    var img=document.createElement('img');img.src=scenes[G.currentScene].seeds[idx].img;
    img.addEventListener('error',function(){if(img.src.indexOf(scenes[G.currentScene].revealImg)<0){img.src=scenes[G.currentScene].revealImg}});
    var name=document.createElement('div');name.className='name';name.textContent=p.name;
    var desc=document.createElement('div');desc.className='desc serif';desc.textContent=p.desc;
    item.appendChild(img);item.appendChild(name);item.appendChild(desc);
    grid.appendChild(item);
  });
}

function matchImage(text){
  var kws;
  if(G.currentScene===0)kws=[['雨','森林','树'],['站','火车','轨道'],['海','码头','船','浪'],['城市','楼','天台','路']];
  else if(G.currentScene===1)kws=[['大厅','站','大'],['走廊','医院','长'],['山','顶','云'],['工厂','钢架','工业']];
  else kws=[['湖','夜晚','萤'],['海','码头','日落'],['水乡','船','江'],['河','芦苇','草']];
  var scores=[0,0,0,0];
  for(var i=0;i<4;i++)kws[i].forEach(function(k){if(text.indexOf(k)>=0)scores[i]++});
  var best=0;for(var i=1;i<4;i++)if(scores[i]>scores[best])best=i;return best;
}
function goOthers(){renderCards();show('screen-others')}
function goReveal(){
  document.getElementById('reveal-img').src=scenes[G.currentScene].revealImg;
  document.getElementById('reveal-caption').textContent=scenes[G.currentScene].revealText;
  show('screen-reveal');
}
function nextScene(){
  G.currentScene=(G.currentScene+1)%scenes.length;
  document.getElementById('user-input').value='';
  if(G.mode==='party')partySetup();
  else if(G.mode==='build')buildMode();
  else goListen();
}
function renderCards(){
  var box=document.getElementById('cards');box.innerHTML='';
  scenes[G.currentScene].seeds.forEach(function(seed){
    var card=document.createElement('div');card.className='card';
    var img=document.createElement('img');img.src=seed.img;
    img.addEventListener('error',function(){if(img.src.indexOf(scenes[G.currentScene].revealImg)<0){img.src=scenes[G.currentScene].revealImg}});
    var d=document.createElement('div');d.className='desc serif';d.textContent=seed.text;
    var sa=document.createElement('div');sa.className='see-also';
    var btn=document.createElement('button');btn.textContent='我也看见了';
    btn.addEventListener('click',function(){btn.classList.add('seen')});
    sa.appendChild(btn);card.appendChild(img);card.appendChild(d);card.appendChild(sa);
    box.appendChild(card);
  });
}


export {
  singleStart, goListen, toggleSound, generateSelf,
  partySetup, createRoom, showJoin, joinRoom, partyStart, goPartyInput, nextPlayer,
  goOthers, goReveal, nextScene, renderCards
};

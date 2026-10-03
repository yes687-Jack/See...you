// Web Audio 实时合成音景（雨夜空屋 / 废弃老房子 / 湖边傍晚），零音频文件
var audioCtx=null,soundNodes=null,isPlaying=false;

function initAudio(){if(!audioCtx)audioCtx=new(window.AudioContext||window.webkitAudioContext)()}
function makeNoise(){var sz=2*audioCtx.sampleRate,buf=audioCtx.createBuffer(1,sz,audioCtx.sampleRate),d=buf.getChannelData(0);for(var i=0;i<sz;i++)d[i]=Math.random()*2-1;var s=audioCtx.createBufferSource();s.buffer=buf;s.loop=true;return s}
function soundRainAll(){
  var n=[];
  var rain=makeNoise(),f=audioCtx.createBiquadFilter();f.type='lowpass';f.frequency.value=1000;
  var g=audioCtx.createGain();g.gain.value=.18;rain.connect(f).connect(g).connect(audioCtx.destination);rain.start();n.push(rain);
  var wind=makeNoise(),wf=audioCtx.createBiquadFilter();wf.type='bandpass';wf.frequency.value=500;
  var wg=audioCtx.createGain();wg.gain.value=.06;wind.connect(wf).connect(wg).connect(audioCtx.destination);wind.start();n.push(wind);
  return n;
}
function soundEmptyAll(){
  var n=[];
  var wind=makeNoise(),f=audioCtx.createBiquadFilter();f.type='bandpass';f.frequency.value=300;f.Q.value=1.5;
  var g=audioCtx.createGain();g.gain.value=.1;wind.connect(f).connect(g).connect(audioCtx.destination);wind.start();n.push(wind);
  return n;
}
function soundWaterAll(){
  var n=[];
  var water=makeNoise(),f=audioCtx.createBiquadFilter();f.type='lowpass';f.frequency.value=400;
  var g=audioCtx.createGain();g.gain.value=.08;water.connect(f).connect(g).connect(audioCtx.destination);water.start();n.push(water);
  return n;
}
function stopSound(){isPlaying=false;var ic=document.getElementById('sound-icon');if(ic)ic.classList.remove('playing');if(soundNodes){soundNodes.forEach(function(x){try{x.stop()}catch(e){}});soundNodes=null}}

function animateWave(){var w=document.getElementById('wave');if(!w)return;w.innerHTML='';for(var i=0;i<16;i++){var s=document.createElement('span');s.style.height=(3+Math.random()*14)+'px';w.appendChild(s)}if(isPlaying)setTimeout(animateWave,300)}

export function resumeAudio(){initAudio();if(audioCtx.state==='suspended')audioCtx.resume()}
export function isSoundPlaying(){return isPlaying}
export function playScene(sceneIdx){
  resumeAudio();
  isPlaying=true;
  var ic=document.getElementById('sound-icon');if(ic)ic.classList.add('playing');
  soundNodes=sceneIdx===0?soundRainAll():sceneIdx===1?soundEmptyAll():soundWaterAll();
  animateWave();
}
export { stopSound };

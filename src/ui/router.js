// 屏幕切换（14 个 .screen 通过 .active 控制显隐）
export function show(id){document.querySelectorAll('.screen').forEach(function(s){s.classList.remove('active')});document.getElementById(id).classList.add('active');if(id==='screen-welcome')makeSparks()}

function makeSparks(){
  var box=document.getElementById('sparks');if(!box)return;box.innerHTML='';
  for(var i=0;i<25;i++){
    var s=document.createElement('div');s.className='spark';
    var size=2+Math.random()*4;
    s.style.cssText='width:'+size+'px;height:'+size+'px;left:'+Math.random()*100+'%;top:'+Math.random()*100+'%;animation-delay:'+(Math.random()*3)+'s;animation-duration:'+(2+Math.random()*3)+'s';
    box.appendChild(s);
  }
}

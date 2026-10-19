// Landing page: cabinet, attract demos and terrain. Moved from OpenArcade.html with the look
// unchanged; the game list now comes from games.ts and START opens /play/<slug>.
import { GAMES, INPUT_META } from '../games';
import { go, playPath } from '../router';
import { getBest, getLastGame, setLastGame } from '../lib/storage';

export function mount(){
var reduce=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
function $(s){return document.querySelector(s)}
var W=256,H=192;
var C={cyan:'#19f0ff',pink:'#ff2bd6',coin:'#ffe14a',violet:'#6a2cff',bg:'#050212',dim:'#2a1460',soft:'#a99bd8'};
var heroVisible=true;
function clamp(v,a,b){return Math.max(a,Math.min(b,v))}
function lerp(a,b,t){return a+(b-a)*t}
function ease(t){return t*t*(3-2*t)}
function pad(n,l){return ('0000'+n).slice(-l)}

/* ---- pixel bitmaps ---- */
var HAND=['....#......','..#.#.#....','..#.#.#.#..','..#.#.#.#..','#.#.#.#.#..','#########..','#########..','.########..','..#######..','...#####...','...#####...'];
var MIC=['..#####..','.#######.','.#######.','.#######.','.#######.','#.#####.#','#..###..#','.#.....#.','..#####..','....#....','....#....','..#####..'];
var DOC=['######...','#....##..','#....#.#.','#....####','#.......#','#.####..#','#.......#','#.#####.#','#.......#','#.###...#','#.......#','#########'];
var BMP={hand:HAND,mic:MIC,doc:DOC};
document.querySelectorAll('.ico').forEach(function(cn){
  var rows=BMP[cn.getAttribute('data-ico')],x=cn.getContext('2d');
  x.fillStyle=cn.getAttribute('data-c');
  for(var j=0;j<rows.length;j++)for(var i=0;i<rows[j].length;i++)if(rows[j][i]==='#')x.fillRect(i,j,1,1);
});
// '#' takes the main colour, '+' the detail colour.
var ROCK=['...........','...........','...........','.##.##.##..','.########..','.#########.','.#########.','.++++++###.','.#########.','..########.','...######..','...#####...'];
var PAPER=['....#......','..#.#.#....','..#.#.#.#..','..#.#.#.#..','..#.#.#.#..','#.#.#.#.#..','##########.','.#########.','..########.','...#######.','...#####...','...#####...'];
var SCISSORS=['.#.....#...','.#.....#...','..#...#....','..#...#....','..#..#.....','...#.#.....','..######...','.########..','.#########.','..########.','...######..','...#####...'];
var CHICK=['....pp....','...wwww...','...wwkwy..','..wwwwwyy.','w.wwwwww..','wwwwwwww..','wwwwwwww..','.wwwwww...'];
var LEGS=[['..y..y....','..y..y....'],['..y...y...','.y...y....']];

/* ---- demo canvas helpers ---- */
var cv=$('#demo'),g=cv.getContext('2d');g.imageSmoothingEnabled=false;
function R(x,y,w,h,c){g.fillStyle=c;g.fillRect(Math.round(x),Math.round(y),Math.round(w),Math.round(h))}
function T(s,x,y,size,c,al){g.font=size+'px "VT323", monospace';g.fillStyle=c;g.textAlign=al||'left';g.textBaseline='top';g.fillText(s,Math.round(x),Math.round(y))}
function grid(){g.fillStyle='rgba(106,44,255,.16)';var i;for(i=0;i<W;i+=16)g.fillRect(i,0,1,H);for(i=0;i<H;i+=16)g.fillRect(0,i,W,1)}
function bmp(rows,x,y,s,c){g.fillStyle=c;for(var j=0;j<rows.length;j++)for(var i=0;i<rows[j].length;i++)if(rows[j][i]==='#')g.fillRect(Math.round(x+i*s),Math.round(y+j*s),s,s)}
function bmpc(rows,x,y,s,pal,flip){for(var j=0;j<rows.length;j++)for(var i=0;i<rows[j].length;i++){var c=pal[rows[j][i]];if(!c)continue;var ii=flip?rows[j].length-1-i:i;g.fillStyle=c;g.fillRect(Math.round(x+ii*s),Math.round(y+j*s),s,s)}}
function poly(pts,ox,oy,fill,stroke){g.beginPath();g.moveTo(ox+pts[0][0],oy+pts[0][1]);for(var i=1;i<pts.length;i++)g.lineTo(ox+pts[i][0],oy+pts[i][1]);g.closePath();if(fill){g.fillStyle=fill;g.fill()}if(stroke){g.strokeStyle=stroke;g.lineWidth=1;g.stroke()}}
function box(x,y,w,h,fill,stroke,lw){R(x,y,w,h,fill);if(stroke){lw=lw||1;R(x,y,w,lw,stroke);R(x,y+h-lw,w,lw,stroke);R(x,y,lw,h,stroke);R(x+w-lw,y,lw,h,stroke)}}
function wrap(s,w,size){g.font=size+'px "VT323", monospace';var ws=s.split(' '),lines=[],cur='';ws.forEach(function(wd){var tst=cur?cur+' '+wd:wd;if(g.measureText(tst).width>w&&cur){lines.push(cur);cur=wd}else cur=tst});lines.push(cur);return lines}
function runner(x,ty,air,t,c){
  var f2=Math.floor(t*12)%2;
  R(x+2,ty,6,6,c);R(x+1,ty+7,8,9,c);
  if(air){R(x+1,ty+16,3,6,c);R(x+6,ty+14,3,5,c)}
  else if(f2){R(x+1,ty+16,3,6,c);R(x+6,ty+16,3,3,c)}
  else{R(x+1,ty+16,3,3,c);R(x+6,ty+16,3,6,c)}
}

/* ---- 1. Rail Rush ---- */
var rail=(function(){
  var P=1.2,TR=2.2,HY=44,GY=170,VX=W/2,LX=[-78,0,78];
  var SEQ=[1,0,0,1,2,2,1,0,1,2];
  function lane(k){return SEQ[((k%SEQ.length)+SEQ.length)%SEQ.length]}
  function at(p,off){var f=Math.pow(p,1.6);return {x:VX+off*f,y:HY+(GY-HY)*f,s:f}}
  return {reset:function(){},draw:function(t){
    var i,k,o;
    for(i=0;i<13;i++){var bh=8+((i*37)%22);R(i*20,HY-bh,16,bh,'#12062a');R(i*20+4,HY-bh+4,3,2,'#3a1a80')}
    R(0,HY,W,1,C.pink);
    var fb=(H-HY)/(GY-HY);
    poly([[-2,HY],[2,HY],[117*fb,H],[-117*fb,H]],VX,0,'#0a0320');
    var ph=(t*2.2)%1;
    for(k=0;k<12;k++){var q=(k+ph)/12*1.08,f=Math.pow(q,1.6);R(VX-117*f,HY+(GY-HY)*f,234*f,1,'#3b1d7a')}
    g.strokeStyle='rgba(255,43,214,.55)';g.lineWidth=1;
    [-39,39].forEach(function(d){g.beginPath();g.moveTo(VX,HY);g.lineTo(VX+d*fb,H);g.stroke()});
    g.strokeStyle=C.cyan;
    [-117,117].forEach(function(d){g.beginPath();g.moveTo(VX,HY);g.lineTo(VX+d*fb,H);g.stroke()});
    // Object set k arrives at the runner line at k*P+0.9, while the runner sits in lane(k).
    var k0=Math.floor((t-1)/P),k1=Math.floor((t+TR)/P)+1;
    for(k=k1;k>=k0;k--){
      var p=1-((k*P+.9)-t)/TR;if(p<.05||p>1.08)continue;
      var safe=lane(k),bad=(safe+1+(Math.abs(k)%2))%3;
      o=at(p,LX[bad]);
      if(k%3===0){var tw=68*o.s,th=52*o.s;box(o.x-tw/2,o.y-th,tw,th,'#12062a',C.cyan);R(o.x-tw*.35,o.y-th*.8,tw*.7,th*.25,C.cyan)}
      else{var bw=64*o.s,bh2=20*o.s;R(o.x-bw/2,o.y-bh2,bw,bh2,C.pink);R(o.x-bw/2,o.y-bh2,bw,Math.max(1,bh2*.2),'#ffb0f3')}
      if(p<.97){o=at(p,LX[safe]);var cs=Math.max(1,8*o.s);R(o.x-cs/2,o.y-cs-12*o.s,cs,cs,C.coin)}
    }
    var kk=Math.floor(t/P),tt=t-kk*P,from=lane(kk-1),to=lane(kk);
    var lx=lerp(LX[from],LX[to],ease(clamp(tt/.25,0,1)));
    runner(VX+lx-5,GY-22,false,t,'#fff');
    var dir=tt<.6?Math.sign(to-from):0;
    bmp(HAND,W-34+dir*5,6,2,C.cyan);
    T(dir<0?'< LEFT':dir>0?'RIGHT >':'HOLD',W-8,30,16,dir?C.coin:C.soft,'right');
    T('DIST '+pad(t*14|0,4),6,6,16,C.coin);
    T('COIN '+pad(Math.max(0,Math.floor((t-.9)/P)+1),2),6,20,16,C.coin);
  }}
})();

/* ---- 2. Hill Climb ---- */
var hill=(function(){
  var CY=4,CX=72;
  function hy(x){return 136-16*Math.sin(x*.021)-9*Math.sin(x*.057+1.3)-4*Math.sin(x*.13)}
  function dist(t){var n=Math.floor(t/CY),tt=t-n*CY;return n*205+(tt<3?tt*60:180+(tt-3)*25)}
  return {reset:function(){},draw:function(t){
    var s=dist(t),gas=(t%CY)<3,x,c,y;
    for(x=0;x<W;x+=4){y=92-12*Math.sin((x+s*.3)*.03)-6*Math.sin((x+s*.3)*.011);R(x,y,4,H-y,'#12062a');R(x,y,4,1,'#3a1a80')}
    for(x=0;x<W;x+=2){y=hy(s+x);R(x,y,2,H-y,'#1a0a3a');R(x,y,2,2,C.cyan)}
    for(c=Math.floor(s/90);c<=Math.floor((s+W)/90)+1;c++){var wx=c*90+45;if(wx>s+CX)R(wx-s-2,hy(wx)-18,5,5,C.coin)}
    for(c=Math.floor(s/600);c<=Math.floor((s+W)/600)+1;c++){var fx=c*600+300,sx=fx-s;if(fx>s+CX){y=hy(fx);R(sx-3,y-12,7,9,'#e8defc');R(sx-3,y-9,7,2,C.pink);R(sx-1,y-14,3,2,'#e8defc')}}
    var yb=hy(s+CX-10),yf=hy(s+CX+10),a=Math.atan2(yf-yb,20),ca=Math.cos(a),sa=Math.sin(a),cy=(yb+yf)/2-3;
    function rot(pts){return pts.map(function(p){return [p[0]*ca-p[1]*sa,p[0]*sa+p[1]*ca]})}
    poly(rot([[-15,-2],[15,-2],[15,-8],[6,-9],[2,-15],[-9,-15],[-12,-9],[-15,-9]]),CX,cy,C.cyan);
    poly(rot([[0,-9],[2,-13],[-8,-13],[-10,-9]]),CX,cy,'#050212');
    R(CX-13,yb-6,6,6,'#fff');R(CX-11,yb-4,2,2,'#050212');R(CX+7,yf-6,6,6,'#fff');R(CX+9,yf-4,2,2,'#050212');
    if(gas)for(var k=1;k<4;k++){var pf=((t*4+k*.33)%1);R(CX-18-pf*14,cy-6-pf*5,2,2,'rgba(207,196,242,'+(.6-pf*.5)+')')}
    var fuel=1-((((s+CX-300)%600)+600)%600)/600*.85;
    T('DIST '+pad(s/4|0,4),6,6,16,C.coin);
    T('COIN '+pad(Math.max(0,Math.floor((s+CX-45)/90)+1),2),6,20,16,C.coin);
    T('FUEL',6,36,14,C.soft);R(32,40,48,4,C.dim);R(32,40,48*fuel,4,fuel<.3?C.pink:C.coin);
    bmpc(gas?PAPER:ROCK,W-34,6,2,{'#':C.cyan,'+':'#050212'});
    T(gas?'PALM = GAS':'FIST = BRAKE',W-8,32,16,gas?C.coin:C.soft,'right');
  }}
})();

/* ---- 3. Rock Paper Scissors ---- */
var rps=(function(){
  var RD=4,SHAPES=[ROCK,PAPER,SCISSORS],NAMES=['ROCK','PAPER','SCISSORS'];
  var ROUNDS=[[0,2],[1,1],[2,1],[0,1],[1,0]]; // [you, cpu]; 0 rock, 1 paper, 2 scissors
  function res(a,b){return a===b?0:((a-b+3)%3===1?1:-1)}
  return {reset:function(){},draw:function(t){
    var n=ROUNDS.length,cyc=n*RD+2,ct=t%cyc,over=ct>=n*RD,r=Math.min(n-1,Math.floor(ct/RD)),tt=over?RD:ct-r*RD;
    var you=0,cpu=0,j;
    for(j=0;j<n;j++)if(j<r||(j===r&&tt>2.6)){var o=res(ROUNDS[j][0],ROUNDS[j][1]);if(o>0)you++;else if(o<0)cpu++}
    T('YOU',6,4,16,C.cyan);T('CPU',W-6,4,16,'#e8defc','right');
    for(j=0;j<3;j++){R(34+j*10,8,8,8,j<you?C.cyan:C.dim);R(W-42-j*10,8,8,8,j<cpu?'#e8defc':C.dim)}
    var shoot=tt>=2.25,bob=shoot?0:Math.abs(Math.sin(tt*Math.PI/.75))*10;
    var ys=shoot?ROUNDS[r][0]:0,cs=shoot?ROUNDS[r][1]:0;
    bmpc(SHAPES[ys],16,44+bob,5,{'#':C.cyan,'+':'#050212'});
    bmpc(SHAPES[cs],W-16-55,44+bob,5,{'#':'#e8defc','+':'#050212'},true);
    if(over)T(you>cpu?'MATCH WON':'MATCH LOST',W/2,64,30,C.coin,'center');
    else if(!shoot)T(String(3-Math.floor(tt/.75)),W/2,52,56,C.coin,'center');
    else if(tt<2.8)T('SHOOT!',W/2,64,30,C.coin,'center');
    else{var o2=res(ys,cs);T(o2>0?'YOU WIN':o2<0?'CPU WINS':'DRAW',W/2,64,26,o2>0?C.cyan:o2<0?'#e8defc':C.soft,'center')}
    var conf=shoot?.92:.55+.1*Math.sin(t*7);
    T('SEEN '+NAMES[ys],16,120,14,C.cyan);R(16,134,60,5,C.dim);R(16,134,60*conf,5,C.cyan);
    T(pad(conf*100|0,2)+'%',80,130,14,C.soft);
    T('FIST  PALM  TWO FINGERS',W/2,160,14,'#7a5cff','center');
    T('3-2-1, THEN HOLD YOUR MOVE',W/2,174,14,C.soft,'center');
  }}
})();

/* ---- 4. Scream Chicken ---- */
var chick=(function(){
  var SP=48,PER=320,GY=150,CX=64;
  var OBS=[{x:70,w:26,gap:true},{x:170,w:10,h:16,gap:false},{x:250,w:38,gap:true}];
  function hop(wx){
    var px=((wx%PER)+PER)%PER;
    for(var i=0;i<OBS.length;i++){var o=OBS[i],js=o.x-16,je=o.x+o.w+12,hm=o.gap?10+o.w*.5:o.h+14;
      if(px>=js&&px<=je){var u=(px-js)/(je-js);return {y:4*hm*u*(1-u),u:u,hm:hm}}}
    return null;
  }
  function isGap(px){for(var i=0;i<OBS.length;i++)if(OBS[i].gap&&px>=OBS[i].x&&px<OBS[i].x+OBS[i].w)return true;return false}
  return {reset:function(){},draw:function(t){
    var s=t*SP,j=hop(s+CX),x,i,b;
    for(x=0;x<W;x+=2){var px=(((s+x)%PER)+PER)%PER;if(!isGap(px)){R(x,GY,2,H-GY,'#1a0a3a');R(x,GY,2,2,C.pink)}}
    for(b=Math.floor(s/PER);b<=Math.floor((s+W)/PER);b++)for(i=0;i<OBS.length;i++){var o=OBS[i];if(o.gap)continue;var sx=b*PER+o.x-s;R(sx,GY-o.h,o.w,o.h,'#3a1a80');R(sx,GY-o.h,o.w,2,C.pink)}
    var cy=GY-20-(j?j.y:0);
    bmpc(CHICK,CX-10,cy,2,{w:'#fff',y:C.coin,p:C.pink,k:'#050212'});
    bmpc(j?LEGS[0]:LEGS[Math.floor(t*8)%2],CX-10,cy+16,2,{y:C.coin});
    var level=j?clamp(j.hm/40,0,1)*(j.u<.35?1:Math.max(0,1-(j.u-.35)*2)):.32+.06*Math.sin(t*9);
    level=Math.max(level,.3);
    for(var sg=0;sg<10;sg++){var lit=sg<Math.round(level*10);R(8,120-sg*10,10,7,lit?(sg>6?C.coin:sg>3?C.pink:C.cyan):C.dim)}
    T('MIC',6,127,14,C.soft);
    T(j?'SHOUT = JUMP':'TALK = WALK',W-6,6,16,j?C.coin:C.pink,'right');
    T('DIST '+pad(s/4|0,4),W-6,22,16,C.coin,'right');
  }}
})();

/* ---- 5. AI Quiz Battle (the original Quiz Duel demo) ---- */
var duel=(function(){
  var QS=[
    {q:'WHICH STEP TURNS TEXT INTO VECTORS?',a:['TOKENIZER','EMBEDDING MODEL','RETRIEVER','RERANKER'],ok:1,src:'notes_week3.pdf p.4',who:0},
    {q:'WHAT SLIDES ACROSS AN IMAGE IN A CNN?',a:['A FILTER','A PROMPT','A QUERY','A TOKEN'],ok:0,src:'cv_intro.pdf p.12',who:1},
    {q:'HOW DO YOU STOP A CHATBOT MAKING THINGS UP?',a:['MORE EMOJI','LOWER VOLUME','GROUND IT IN TEXT','BIGGER FONT'],ok:2,src:'chatbots.pdf p.7',who:0}
  ];
  var D=6.4;
  return {reset:function(){},draw:function(t){
    var qi=Math.floor(t/D)%3,tt=t%D,q=QS[qi],h1=5,h2=5,j;
    for(j=0;j<qi;j++){if(QS[j].who===0)h2--;else h1--}
    if(tt>5){if(q.who===0)h2--;else h1--}
    var wc=q.who===0?C.cyan:C.pink,lc=q.who===0?C.pink:C.cyan;
    T('P1',6,3,16,C.cyan);T('AI',W-6,3,16,C.pink,'right');
    for(j=0;j<5;j++){R(26+j*10,6,8,8,j<h1?C.cyan:C.dim);R(W-34-j*10,6,8,8,j<h2?C.pink:C.dim)}
    R(6,20,W-12,4,C.dim);
    var fr=tt<1.4?1:tt>4.6?0:1-(tt-1.4)/3.2;R(6,20,(W-12)*fr,4,C.coin);
    var lines=wrap(q.q,W-12,16),rem=Math.floor(clamp(tt/1.2,0,1)*q.q.length);
    for(j=0;j<lines.length;j++){var sl=lines[j].slice(0,Math.max(0,rem));rem-=lines[j].length+1;T(sl,6,30+j*14,16,'#fff')}
    if(tt>1.4){
      for(j=0;j<4;j++){
        var bx=j%2?132:6,by=j<2?72:102,st=null,fill='#12062a',tc='#e9e0ff';
        if(tt>3&&j===q.ok)st=wc;
        if(tt>3.8&&j===(q.ok+2)%4)st=lc;
        if(tt>4.6&&j===q.ok){fill=C.coin;tc='#1a0f00'}
        box(bx,by,118,26,fill,st||'#3a1a80',st?2:1);
        T('ABCD'[j]+' '+q.a[j],bx+6,by+8,14,tc);
      }
    }
    T('SOURCE',6,142,14,'#7a5cff');
    T(tt>4.6?q.src:'...',6,154,16,C.coin);
    T('FASTER ANSWER = MORE DAMAGE',W/2,176,14,C.soft,'center');
  }}
})();

/* ---- Apex Drive ---- */
var drive=(function(){
  return {reset:function(){},draw:function(t){
    var i,ph=(t*38)%34,roadTop=66,center=W/2;
    var sky=g.createLinearGradient(0,0,0,H);sky.addColorStop(0,'#10172a');sky.addColorStop(.58,'#33203e');sky.addColorStop(1,'#e76b68');g.fillStyle=sky;g.fillRect(0,0,W,H);
    R(0,62,W,42,'#171426');
    for(i=0;i<18;i++){var bx=i*17,bh=12+(i*29%31);R(bx,roadTop-bh,14,bh,'#0b1020');R(bx+3,roadTop-bh+4,2,2,'#ffb84d');R(bx+9,roadTop-bh+10,2,2,'#633b69')}
    R(0,104,W,88,'#11151e');
    poly([[-2,roadTop],[2,roadTop],[center+112,H],[center-112,H]],0,0,'#333943');
    poly([[-2,roadTop],[2,roadTop],[center+112,H],[center-112,H]],0,0,null,'#e7c36c');
    for(i=0;i<8;i++){var p=(i/8+ph/34)%1,sz=1+p*2.8,yy=roadTop+Math.pow(p,1.55)*(H-roadTop);R(center-1.5*sz,yy,3*sz,Math.max(1,3*p),'#d6dce3')}
    var ox=center+Math.sin(t*1.6)*18,oy=96;
    R(ox-8,oy-5,16,10,'#e7a73e');R(ox-5,oy-10,10,6,'#354d61');R(ox-7,oy+3,4,2,'#fff0c2');R(ox+3,oy+3,4,2,'#fff0c2');
    var cx=center+Math.sin(t*1.1)*35,cy=158;
    poly([[-27,7],[-23,-3],[-14,-8],[-11,-20],[11,-20],[15,-8],[24,-3],[28,7],[24,17],[-24,17]],cx,cy,'#d82e4e');
    poly([[-12,-7],[-8,-17],[8,-17],[13,-7]],cx,cy,'#183346');
    R(cx-22,cy-1,5,5,'#ff374f');R(cx+17,cy-1,5,5,'#ff374f');
    R(cx-26,cy+10,6,7,'#0a0d13');R(cx+20,cy+10,6,7,'#0a0d13');
    T('APEX DRIVE',W/2,8,24,'#fff','center');
    T('BEAT THE RIVAL  ·  BRAKE FOR CORNERS',W/2,34,14,'#ffe14a','center');
    T('NIGHT CIRCUIT',W/2,174,16,'#fff','center');
  }};
})();

/* ---- game data ---- */
var DEMOS={'apex-drive':drive,'rail-rush':rail,'hill-climb':hill,'rps':rps,'scream-chicken':chick,'quiz-battle':duel};
var LIST=GAMES.map(function(G){
  var m=INPUT_META[G.input];
  return {slug:G.slug,title:G.title,name:G.title.toUpperCase(),tag:m.tag,kind:m.kind,c:G.color,players:G.players,
    demo:DEMOS[G.slug],cap:G.shortDescription,how:G.rules.slice(0,2).join(' ')};
});
$('#hudCount').textContent=LIST.length+' GAMES';

/* ---- sound ---- */
var ac=null,soundOn=false;
function beep(f,d){
  if(!soundOn)return;d=d||.07;
  try{ac=ac||new (window.AudioContext||window.webkitAudioContext)();
    var o=ac.createOscillator(),v=ac.createGain();o.type='square';o.frequency.value=f;v.gain.value=.04;
    o.connect(v);v.connect(ac.destination);o.start();v.gain.exponentialRampToValueAtTime(.0001,ac.currentTime+d);o.stop(ac.currentTime+d)}catch(e){}
}
$('#snd').addEventListener('click',function(){soundOn=!soundOn;this.setAttribute('aria-pressed',String(soundOn));this.textContent=soundOn?'Sound on':'Sound off';beep(660,.1)});

/* ---- selection ---- */
var cab=$('#cab'),list=$('#games'),frame=$('#frame'),placard=$('#placard'),stick=$('#stick');
var idx=0,cur=LIST[0],items=[],simT=0,glitchUntil=0,lastUser=0,leaving=false;
LIST.forEach(function(G,i){
  var li=document.createElement('li');li.style.setProperty('--i',i);
  var b=document.createElement('button');b.type='button';b.style.setProperty('--c',G.c);
  b.innerHTML='<span class="ar">&gt;</span><span>'+G.name+'</span><em>'+G.tag+'</em>';
  b.addEventListener('click',function(){select(i,true)});
  li.appendChild(b);list.appendChild(li);items.push(b);
});
function indexOf(slug){for(var i=0;i<LIST.length;i++)if(LIST[i].slug===slug)return i;return -1}
function retrigger(el,cls){el.classList.remove(cls);void el.offsetWidth;el.classList.add(cls)}
function drawFrame(dt){
  simT+=dt;g.fillStyle=C.bg;g.fillRect(0,0,W,H);grid();cur.demo.draw(simT,dt);
  if(performance.now()<glitchUntil)glitch();
}
function glitch(){
  for(var k=0;k<5;k++){var y=Math.random()*H|0,h=4+(Math.random()*18|0),dx=(Math.random()*40-20)|0;g.drawImage(cv,0,y,W,h,dx,y,W,h)}
  g.fillStyle='rgba(255,255,255,.14)';for(var j=0;j<30;j++)g.fillRect(Math.random()*W|0,Math.random()*H|0,20+(Math.random()*40|0),1);
}
function settle(){simT=0;for(var i=0;i<90;i++)drawFrame(1/30)}
function select(i,user){
  var n=LIST.length;i=(i%n+n)%n;var dir=i>=idx?1:-1;idx=i;cur=LIST[i];
  simT=0;if(cur.demo.reset)cur.demo.reset();
  items.forEach(function(b,k){if(k===i)b.setAttribute('aria-current','true');else b.removeAttribute('aria-current')});
  cab.style.setProperty('--c',cur.c);
  $('#pName').textContent=cur.name;$('#pPill').textContent=cur.kind+' · '+cur.players;$('#pHow').textContent=cur.how;$('#cap').textContent=cur.cap;
  var best=getBest(cur.slug);$('#hudHi').textContent=best?'HI-SCORE '+pad(best,5):'HI-SCORE NONE YET';
  $('#bStart').setAttribute('aria-label','Start '+cur.title);
  cv.setAttribute('aria-label',cur.name+' preview. '+cur.cap);
  stick.style.setProperty('--tilt',(dir*22)+'deg');
  setTimeout(function(){stick.style.setProperty('--tilt','0deg')},150);
  if(reduce)settle();else{glitchUntil=performance.now()+260;retrigger(frame,'tune');retrigger(placard,'flip')}
  if(user){lastUser=performance.now();beep(300+i*70);setLastGame(cur.slug)}
}
function start(){
  if(leaving)return;leaving=true;
  setLastGame(cur.slug);beep(880,.09);
  $('#hint').textContent='LOADING '+cur.name;
  go(playPath(cur.slug));
}
function press(btn){btn.classList.add('press');setTimeout(function(){btn.classList.remove('press')},120)}
$('#bPrev').addEventListener('click',function(){select(idx-1,true)});
$('#bNext').addEventListener('click',function(){select(idx+1,true)});
$('#bStart').addEventListener('click',start);
document.querySelectorAll('[data-pick]').forEach(function(b){
  b.addEventListener('click',function(){select(indexOf(b.getAttribute('data-pick')),true);$('#hero').scrollIntoView({behavior:reduce?'auto':'smooth'})});
});
document.addEventListener('keydown',function(e){
  var tn=(e.target&&e.target.tagName)||'';
  if(tn==='INPUT'||tn==='TEXTAREA'||e.defaultPrevented)return;
  if(e.key==='ArrowLeft'||e.key==='ArrowUp'){if(!heroVisible)return;e.preventDefault();press($('#bPrev'));select(idx-1,true)}
  else if(e.key==='ArrowRight'||e.key==='ArrowDown'){if(!heroVisible)return;e.preventDefault();press($('#bNext'));select(idx+1,true)}
  else if(e.key==='Enter'&&heroVisible&&tn!=='BUTTON'&&tn!=='A'){press($('#bStart'));start()}
});
// Leaving for a game and coming back with Back can restore this page from the cache.
window.addEventListener('pageshow',function(){leaving=false;$('#hint').textContent='PRESS START'});
if(!reduce)setInterval(function(){
  if(heroVisible&&performance.now()-lastUser>20000)select(idx+1,false);
},8000);

/* ---- terrain ---- */
var terrain=null;
import('three').then(function(THREE){
  var hero=$('#hero'),cvs=$('#terrain'),renderer;
  // The shaders were tuned without colour management (three r128), so keep colours as written.
  THREE.ColorManagement.enabled=false;
  try{renderer=new THREE.WebGLRenderer({canvas:cvs,antialias:true})}catch(e){return}
  renderer.outputColorSpace=THREE.LinearSRGBColorSpace;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,1.5));
  var scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(60,1,.5,500);
  var CELL=4,NX=48,NZ=64,SX=NX*CELL,SZ=NZ*CELL,BASE=-100;
  var FOG=new THREE.Color('#3a0b57');
  var shared={uShift:{value:0},uFog:{value:FOG},uFogNear:{value:40},uFogFar:{value:250}};
  var VS=[
    'uniform float uShift; varying float vH; varying float vDepth; varying vec3 vPos;',
    'float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}',
    'float heightAt(vec2 p){',
    '  vec2 id=floor(p/4.0+0.5);',
    '  float e=smoothstep(9.0,46.0,abs(p.x));',
    '  float r=hash(id);',
    '  float ridge=0.5+0.5*sin(id.y*0.35+id.x*0.2);',
    '  return e*(6.0+30.0*(0.65*r+0.35*ridge));',
    '}',
    'void main(){',
    '  vec3 p=position;',
    '  p.y=heightAt(vec2(p.x,p.z+uShift));',
    '  vH=p.y;',
    '  vec4 mv=modelViewMatrix*vec4(p,1.0);',
    '  vDepth=-mv.z;',
    '  vPos=(modelMatrix*vec4(p,1.0)).xyz;',
    '  gl_Position=projectionMatrix*mv;',
    '}'
  ].join('\n');
  var FILL=[
    'uniform vec3 uFog; uniform float uFogNear; uniform float uFogFar;',
    'varying float vH; varying float vDepth; varying vec3 vPos;',
    'void main(){',
    '  vec3 n=normalize(cross(dFdx(vPos),dFdy(vPos)));',
    '  float l=clamp(dot(n,normalize(vec3(-0.5,0.7,0.4))),0.0,1.0);',
    '  vec3 base=mix(vec3(0.05,0.02,0.12),vec3(0.34,0.08,0.46),l);',
    '  base+=vec3(0.45,0.1,0.4)*l*smoothstep(8.0,28.0,vH)*0.25;',
    '  float f=smoothstep(uFogNear,uFogFar,vDepth);',
    '  gl_FragColor=vec4(mix(base,uFog,f),1.0);',
    '}'
  ].join('\n');
  var WIRE=[
    'uniform vec3 uFog; uniform float uFogNear; uniform float uFogFar;',
    'varying float vH; varying float vDepth;',
    'void main(){',
    '  float k=smoothstep(0.0,22.0,vH);',
    '  vec3 col=mix(vec3(1.0,0.17,0.84),vec3(0.1,0.94,1.0),k);',
    '  float f=smoothstep(uFogNear,uFogFar,vDepth);',
    '  gl_FragColor=vec4(mix(col,uFog,f),1.0);',
    '}'
  ].join('\n');
  var geo=new THREE.PlaneGeometry(SX,SZ,NX,NZ);geo.rotateX(-Math.PI/2);
  var fill=new THREE.Mesh(geo,new THREE.ShaderMaterial({uniforms:shared,vertexShader:VS,fragmentShader:FILL,polygonOffset:true,polygonOffsetFactor:1,polygonOffsetUnits:1}));
  var wire=new THREE.Mesh(geo,new THREE.ShaderMaterial({uniforms:shared,vertexShader:VS,fragmentShader:WIRE,wireframe:true}));
  fill.frustumCulled=false;wire.frustumCulled=false;scene.add(fill);scene.add(wire);

  var sky=new THREE.Mesh(new THREE.PlaneGeometry(2,2),new THREE.ShaderMaterial({
    uniforms:{uH:{value:.45}},depthTest:false,depthWrite:false,
    vertexShader:'varying vec2 vUv; void main(){vUv=uv; gl_Position=vec4(position.xy,1.0,1.0);}',
    fragmentShader:[
      'uniform float uH; varying vec2 vUv;',
      'void main(){',
      '  float k=clamp((vUv.y-uH)/(1.0-uH),0.0,1.0);',
      '  vec3 hor=vec3(0.227,0.043,0.341),mid=vec3(0.11,0.02,0.22),top=vec3(0.02,0.008,0.05);',
      '  vec3 c=mix(hor,mid,smoothstep(0.0,0.35,k));',
      '  c=mix(c,top,smoothstep(0.25,1.0,k));',
      '  gl_FragColor=vec4(c,1.0);',
      '}'].join('\n')}));
  sky.renderOrder=-10;sky.frustumCulled=false;scene.add(sky);

  var sun=new THREE.Mesh(new THREE.PlaneGeometry(120,120),new THREE.ShaderMaterial({
    vertexShader:'varying vec2 vUv; void main(){vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
    fragmentShader:[
      'varying vec2 vUv;',
      'void main(){',
      '  vec2 p=vUv-0.5; if(length(p)>0.5) discard;',
      '  float y=vUv.y;',
      '  vec3 col=mix(vec3(1.0,0.17,0.84),vec3(1.0,0.88,0.29),smoothstep(0.1,0.9,y));',
      '  float s=fract(y*16.0); float cut=(0.5-y)*1.1;',
      '  if(y<0.48 && s<cut) discard;',
      '  gl_FragColor=vec4(col,1.0);',
      '}'].join('\n')}));
  sun.position.set(0,30,-236);scene.add(sun);

  var sp=[];for(var i=0;i<150;i++)sp.push((Math.random()-.5)*420,28+Math.random()*130,-242);
  var sg=new THREE.BufferGeometry();sg.setAttribute('position',new THREE.Float32BufferAttribute(sp,3));
  var stars=new THREE.Points(sg,new THREE.PointsMaterial({color:0xffffff,size:1.6,sizeAttenuation:false}));
  stars.frustumCulled=false;scene.add(stars);

  var scroll=0,mx=0,sy=0,hv=new THREE.Vector3();
  window.addEventListener('pointermove',function(e){mx=(e.clientX/window.innerWidth-.5)*2},{passive:true});
  window.addEventListener('scroll',function(){sy=Math.min(window.scrollY,900)},{passive:true});
  function resize(){
    var w=hero.clientWidth,h=hero.clientHeight;if(!w||!h)return;
    renderer.setSize(w,h,false);camera.aspect=w/h;camera.fov=w/h<.9?80:60;camera.updateProjectionMatrix();draw();
  }
  function draw(){
    camera.position.x+=(mx*4-camera.position.x)*.06;camera.position.y=9+sy*.012;camera.position.z=20;
    camera.lookAt(camera.position.x*.3,3.5,-50);camera.updateMatrixWorld();
    hv.set(camera.position.x,camera.position.y,-5000).project(camera);
    sky.material.uniforms.uH.value=clamp((hv.y+1)/2,0,1);
    shared.uShift.value=BASE-CELL*Math.floor(scroll/CELL);
    fill.position.z=wire.position.z=BASE+(scroll%CELL);
    renderer.render(scene,camera);
  }
  if(window.ResizeObserver)new ResizeObserver(resize).observe(hero);else window.addEventListener('resize',resize);
  resize();
  terrain={frame:function(dt){scroll+=dt*22;draw()}};
}).catch(function(){/* No terrain: the hero gradient behind it still shows. */});

/* ---- main loop ---- */
if('IntersectionObserver' in window)new IntersectionObserver(function(en){heroVisible=en[0].isIntersecting},{threshold:0}).observe($('#hero'));
var first=indexOf(getLastGame());
select(first<0?0:first,false);
var last=performance.now();
function loop(now){
  requestAnimationFrame(loop);
  var dt=clamp((now-last)/1000,0,.05);last=now;
  if(!heroVisible||reduce)return;
  drawFrame(dt);
  if(terrain)terrain.frame(dt);
}
if(document.fonts&&document.fonts.ready)document.fonts.ready.then(function(){if(reduce)settle()});
requestAnimationFrame(loop);
}

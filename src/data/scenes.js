export const scenes=[
{revealImg:'./assets/img/s1-reveal.jpg',revealText:'一个下雨的城市夜晚。路灯、湿滑的路面、远处模糊的车灯。',seeds:[
  {img:'./assets/img/s1-1.jpg',text:'暴雨森林里，很大的树'},
  {img:'./assets/img/s1-2.jpg',text:'废弃火车站台，铁轨延伸'},
  {img:'./assets/img/s1-3.jpg',text:'暴风雨中的海边码头'},
  {img:'./assets/img/s1-4.jpg',text:'雨夜城市天台，远处灯火'}]},
{revealImg:'./assets/img/s2-reveal.jpg',revealText:'一间废弃的老房子。穿堂风、木地板脚步、生锈窗框、窗外鸟叫。',seeds:[
  {img:'./assets/img/s2-1.jpg',text:'很大的废弃车站大厅'},
  {img:'./assets/img/s2-2.jpg',text:'长长的医院走廊'},
  {img:'./assets/img/s2-3.jpg',text:'山顶，云在脚下翻'},
  {img:'./assets/img/s2-4.jpg',text:'废弃工厂的钢架空间'}]},
{revealImg:'./assets/img/s3-reveal.jpg',revealText:'一个湖边的傍晚。水波拍岸、虫鸣、远处人声、木船吱呀。',seeds:[
  {img:'./assets/img/s3-1.jpg',text:'夏夜湖边，萤火虫在飞'},
  {img:'./assets/img/s3-2.jpg',text:'海边码头，太阳落下'},
  {img:'./assets/img/s3-reveal.jpg',text:'江南水乡，小船停在岸边'}, // 临时兜底：原图床链接已失效，待补独立图后替换此路径
  {img:'./assets/img/s3-4.jpg',text:'安静河边，芦苇在摇'}]}
];

export const buildLayers=[
  {label:'天空',hint:'比如：橙红色晚霞 / 漫天星空（可留空）'},
  {label:'远景',hint:'比如：连绵雪山 / 城市天际线（可留空）'},
  {label:'中景',hint:'比如：一个孤零零的站台 / 几栋老房子（可留空）'},
  {label:'近景',hint:'比如：湿漉漉的铁轨 / 一杯咖啡（可留空）'},
  {label:'主色调',type:'color',options:['#1a1a2e','#e8a87c','#8ecae6','#95d5b2','#d4a5c9','#2d3436','#f4d35e','#c9ada7']},
  {label:'风格',type:'tag',options:['写实','复古','科幻','抽象','电影感','水彩']}
];

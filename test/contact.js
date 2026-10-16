const fs=require('fs');const Charts=require('../js/charts.js');const Render=require('../js/render.js');
const grid=[['','North','South','West'],['Q1','120','90','60'],['Q2','150','110','75'],['Q3','135','130','88'],['Q4','180','125','95']];
const data=Charts.gridToData(grid);
const hexOf=(c)=>c.startsWith('#')?c:({'doc:Color/Black':'#000000','doc:Color/Paper':'#ffffff'}[c]||'#444');
const W=560,H=300;let svg='';const cols=3;const types=Charts.TYPES;
types.forEach((t,i)=>{
  const x=(i%cols)*(W+20)+10,y=Math.floor(i/cols)*(H+20)+10;
  const opts={title:t.name,note:'Source: sample data',semi:false,centerText:t.id==='doughnut'?'$1.4M':'',hexOf,secondary:t.id==='combo',totals:true,legend:'bottom',decimals:0,prefix:t.id==='bar'?'$':''};
  const r=Charts.build(t.id,data,opts,{x:0,y:0,w:W,h:H});
  svg+=`<g transform="translate(${x},${y})"><rect width="${W}" height="${H}" fill="#fff" stroke="#ccc"/>${Render.primsToSvg(r.prims,hexOf)}</g>`;
});
const rows=Math.ceil(types.length/cols);
fs.writeFileSync('test/contact.svg',`<svg xmlns="http://www.w3.org/2000/svg" width="${cols*(W+20)+10}" height="${rows*(H+20)+10}" style="background:#eee"><rect width="100%" height="100%" fill="#e8ecef"/>${svg}</svg>`);

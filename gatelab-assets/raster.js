const {Resvg}=require('@resvg/resvg-js');const fs=require('fs');
const r=(src,dst,w)=>{const o=w?{fitTo:{mode:'width',value:w}}:{};fs.writeFileSync(dst,new Resvg(fs.readFileSync(src),o).render().asPng());};
const I='out/icons/';
r(I+'_16.svg',I+'favicon-16x16.png',16);r(I+'_32.svg',I+'favicon-32x32.png',32);r(I+'_48.svg',I+'_48.png',48);
r(I+'_apple.svg',I+'apple-touch-icon.png',180);r(I+'_192.svg',I+'icon-192.png',192);
r(I+'_512.svg',I+'icon-512.png',512);r(I+'_512m.svg',I+'icon-512-maskable.png',512);
r('out/og.svg','out/opengraph-image.png',1200);
// preview sheet: logos on dark/light
const L='out/logo/',img=f=>'data:image/svg+xml;base64,'+fs.readFileSync(f).toString('base64');
const cell=(bg,f,x,y,w,h,pw)=>`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${bg}"/><image href="${img(f)}" x="${x+20}" y="${y+(h-pw*0.224)/2}" width="${pw}"/>`;
let s=`<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="560">`;
s+=cell('#0E1311',L+'gatelab-logo-dark.svg',0,0,500,140,300)+cell('#FFFFFF',L+'gatelab-logo-light.svg',500,0,500,140,300);
s+=cell('#0E1311',L+'gatelab-wordmark-dark.svg',0,140,500,100,200)+cell('#FFFFFF',L+'gatelab-wordmark-light.svg',500,140,500,100,200);
s+=cell('#1A231D',L+'gatelab-logo-mono-white.svg',0,240,500,100,260)+cell('#F2F2F2',L+'gatelab-logo-mono.svg',500,240,500,100,260);
s+=`<rect y="340" width="500" height="220" fill="#0E1311"/><rect x="500" y="340" width="500" height="220" fill="#FFF"/>`;
let x=20;for(const [f,w] of [['favicon-16x16.png',16],['favicon-32x32.png',32],['_48.png',48],['apple-touch-icon.png',90],['icon-192.png',120],['icon-512-maskable.png',120]]){s+=`<image href="data:image/png;base64,${fs.readFileSync(I+f).toString('base64')}" x="${x}" y="360" width="${w}"/>`;x+=w+20}
x=520;for(const [f,w] of [['favicon-16x16.png',16],['favicon-32x32.png',32],['_48.png',48]]){s+=`<image href="data:image/png;base64,${fs.readFileSync(I+f).toString('base64')}" x="${x}" y="360" width="${w}"/>`;x+=w+20}
s+=`<image href="${img(L+'gatelab-symbol-light.svg')}" x="760" y="400" width="80"/><image href="${img(L+'gatelab-symbol-mono.svg')}" x="880" y="400" width="80"/></svg>`;
fs.writeFileSync('out/_sheet.svg',s);fs.writeFileSync('out/_sheet.png',new Resvg(s).render().asPng());

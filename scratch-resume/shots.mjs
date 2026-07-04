import { chromium } from 'playwright-core';
const b = await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',args:['--no-sandbox']});
const p = await b.newPage({viewport:{width:794,height:1123},deviceScaleFactor:1.4});
await p.goto('file://'+process.cwd()+'/resume.html',{waitUntil:'networkidle'});
await p.evaluate(()=>document.fonts.ready);
await p.waitForTimeout(500);
const pages = await p.$$('.page');
console.log('page count in DOM:', pages.length);
for (let i=0;i<pages.length;i++){ await pages[i].screenshot({path:`qa-${i+1}.png`}); }
await b.close();

import { chromium } from 'playwright-core';
import fs from 'fs';

const exec = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const execPath = fs.existsSync(exec) ? exec : undefined;
const browser = await chromium.launch({
  executablePath: execPath,
  args:['--no-sandbox','--font-render-hinting=none']
});
const page = await browser.newPage();
const url = 'file://' + process.cwd() + '/resume.html';
await page.goto(url, {waitUntil:'networkidle'});
await page.evaluate(()=>document.fonts.ready);
await page.waitForTimeout(600);
await page.pdf({
  path:'Uday-Shetty-Kantavara-Resume.pdf',
  width:'210mm', height:'297mm',
  printBackground:true,
  margin:{top:'0',bottom:'0',left:'0',right:'0'},
  preferCSSPageSize:false
});
await browser.close();
console.log('PDF done');

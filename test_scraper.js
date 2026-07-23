import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
puppeteer.use(StealthPlugin());

async function test() {
  console.log('Testing kozhikode...');
  const browser = await import('puppeteer').then(p => p.launch({ headless: true }));
  const page = await browser.newPage();
  await page.goto('https://in.bookmyshow.com/kozhikode/movies', { waitUntil: 'networkidle2' });
  const html = await page.content();
  await import('fs').then(fs => fs.promises.writeFile('debug.html', html));
  await browser.close();
  console.log('Saved to debug.html');
}

test();

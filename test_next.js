import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import * as cheerio from 'cheerio';

puppeteer.use(StealthPlugin());

async function test() {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36');
  
  const url = 'https://in.bookmyshow.com/kochi/movies/kalki-2898-ad/ET00310216';
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  const content = await page.content();
  const $ = cheerio.load(content);
  const nextData = $('#__NEXT_DATA__').html();
  if (nextData) {
    console.log('Found NEXT DATA length:', nextData.length);
    console.log(nextData.substring(0, 500));
  } else {
    console.log('No NEXT DATA found');
  }
  await browser.close();
}

test();

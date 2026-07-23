import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import * as cheerio from 'cheerio';

puppeteer.use(StealthPlugin());

async function run() {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36');
  await page.goto('https://in.bookmyshow.com/explore/home/kozhikode', { waitUntil: 'networkidle2', timeout: 30000 });
  const content = await page.content();
  const $ = cheerio.load(content);
  const links = [];
  $('a').each((i, el) => {
    const href = $(el).attr('href');
    if (href && (href.includes('kozhikode') || href.includes('movies'))) {
      links.push(href);
    }
  });
  console.log(links.slice(0, 50));
  await browser.close();
}
run();

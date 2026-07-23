import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import * as cheerio from 'cheerio';
import fs from 'fs';

puppeteer.use(StealthPlugin());

async function test() {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36');
  
  // Set region cookie or just visit region page first
  await page.goto('https://in.bookmyshow.com/mumbai', { waitUntil: 'networkidle2' });

  const url = 'https://in.bookmyshow.com/mumbai/movies/kalki-2898-ad/ET00310216';
  console.log('Visiting', url);
  await page.goto(url, { waitUntil: 'networkidle2' });
  
  let content = await page.content();
  fs.writeFileSync('debug_movie.html', content);
  let $ = cheerio.load(content);
  
  let bookTicketsUrl = null;
  $('a, button').each((i, el) => {
    const text = $(el).text().toLowerCase();
    if (text.includes('book tickets')) {
      if ($(el).attr('href')) {
        bookTicketsUrl = $(el).attr('href');
      }
    }
  });
  
  if (bookTicketsUrl) {
    if (!bookTicketsUrl.startsWith('http')) {
      bookTicketsUrl = `https://in.bookmyshow.com${bookTicketsUrl}`;
    }
    console.log('Found Book Tickets URL:', bookTicketsUrl);
    
    await page.goto(bookTicketsUrl, { waitUntil: 'networkidle2' });
    content = await page.content();
    fs.writeFileSync('debug_slots.html', content);
    
    const $$ = cheerio.load(content);
    const theaters = [];
    $$('.list li').each((i, el) => {
      // This is a guess of the structure. We will check the debug_slots.html.
      const name = $$(el).find('.__name a, .theater-name').text().trim();
      const slots = [];
      $$(el).find('.showtime-pill, .__details a').each((j, slotEl) => {
        slots.push($$(slotEl).text().trim());
      });
      if (name) theaters.push({ name, slots });
    });
    console.log('Theaters:', theaters.slice(0, 5));
  } else {
    console.log('No Book Tickets URL found. Look at debug_movie.html');
  }

  await browser.close();
}

test();

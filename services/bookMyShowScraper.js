import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import * as cheerio from 'cheerio';

puppeteer.use(StealthPlugin());

/**
 * Searches for currently running movies in a specific city on BookMyShow.
 * @param {string} city - e.g., 'mumbai', 'bangalore', 'kochi'
 */
export async function getRunningMovies(city) {
  const url = `https://in.bookmyshow.com/explore/home/${city.toLowerCase()}`;
  console.log(`[Scraper] Fetching movies from ${url}...`);
  
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  try {
    const page = await browser.newPage();
    
    // Set a realistic user agent
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36');
    
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    const content = await page.content();
    const $ = cheerio.load(content);
    
    // BookMyShow typically wraps movie cards in an anchor tag starting with /city/movies/
    // This selector might be fragile and need updates if BMS changes their layout
    const movies = [];
    
    // Simple heuristic: find all links that look like movie links
    $(`a[href^="/movies/"]`).each((i, el) => {
      const href = $(el).attr('href');
      // Extract title from inner text or URL path
      let title = $(el).find('div').first().text().trim() || href.split('/')[2];
      if (title) title = title.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
      
      if (title && href && !movies.find(m => m.url === `https://in.bookmyshow.com${href}`) && href.includes('ET')) {
        movies.push({
          title: title,
          url: `https://in.bookmyshow.com${href}`
        });
      }
    });

    if (content.includes('Cloudflare') || content.includes('Attention Required!')) {
      console.log('[Scraper] Blocked by Cloudflare!');
      return { error: `BookMyShow's security (Cloudflare) is currently blocking me from automatically reading their website. I cannot fetch the live movies right now. Please check manually at: https://in.bookmyshow.com/${city.toLowerCase()}/movies` };
    }

    // If heuristic fails, try grabbing JSON data embedded in the page script tags
    if (movies.length === 0) {
      console.log('[Scraper] Warning: No movies found via heuristic. Returning empty list.');
      return { error: `I couldn't find any movies for ${city}. Make sure the city name is correct or check directly at https://in.bookmyshow.com/${city.toLowerCase()}/movies` };
    } else {
      console.log(`[Scraper] Found ${movies.length} movies.`);
    }

    return movies.slice(0, 10); // Return top 10 to keep it manageable for the LLM
  } catch (error) {
    console.error('[Scraper] Error fetching movies:', error.message);
    return { error: 'Failed to fetch movies from BookMyShow' };
  } finally {
    await browser.close();
  }
}

/**
 * Checks available slots for a specific movie URL.
 * @param {string} movieUrl - The full BookMyShow movie URL
 */
export async function getMovieSlots(movieUrl) {
  console.log(`[Scraper] Fetching slots from ${movieUrl}...`);
  
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  try {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36');
    
    // Typically to get slots, we have to navigate to the "book tickets" page
    // The book tickets URL is usually `/buytickets/{movie-slug}-{city}/movie-{city}-{id}-MT/{date}`
    // But as a fallback, we will just visit the movie page and try to extract the exact book tickets link,
    // or just return the URL and tell the user to visit it.
    
    await page.goto(movieUrl, { waitUntil: 'networkidle2', timeout: 30000 });
    
    // Look for a "Book Tickets" button link
    const content = await page.content();
    const $ = cheerio.load(content);
    
    let bookTicketsUrl = null;
    $('a').each((i, el) => {
      const text = $(el).text().toLowerCase();
      if (text.includes('book tickets')) {
        bookTicketsUrl = $(el).attr('href');
      }
    });
    
    if (bookTicketsUrl) {
      if (!bookTicketsUrl.startsWith('http')) {
        bookTicketsUrl = `https://in.bookmyshow.com${bookTicketsUrl}`;
      }
      return { 
        message: 'Found booking page! You can check available slots and seats here.', 
        bookingUrl: bookTicketsUrl 
      };
    }
    
    return { 
      message: 'Could not find a direct booking link. The movie might not have open bookings yet.',
      movieUrl: movieUrl
    };

  } catch (error) {
    console.error('[Scraper] Error fetching slots:', error.message);
    return { error: 'Failed to fetch slots from BookMyShow' };
  } finally {
    await browser.close();
  }
}

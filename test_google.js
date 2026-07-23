import google from 'googlethis';

async function test() {
  const options = {
    page: 0, 
    safe: false, // Safe Search
    additional_params: { 
      hl: 'en' 
    }
  };

  const response = await google.search('movies in kozhikode bookmyshow', options);
  console.log(response.results);
}

test();

const express = require("express");
const cors    = require("cors");
const axios   = require("axios");
const cheerio = require("cheerio");

const app  = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// ─── Detectar plataforma pelo URL ─────────────────────────────────────────────
function detectPlatform(url) {
  const u = url.toLowerCase();
  if (u.includes("mercadolivre") || u.includes("mercadolibre")) return "ml";
  if (u.includes("shopee"))                                      return "shopee";
  if (u.includes("amazon"))                                      return "amazon";
  if (u.includes("magazineluiza") || u.includes("magalu"))       return "magalu";
  if (u.includes("americanas"))                                  return "americanas";
  return "other";
}

// ─── Headers para simular navegador real ─────────────────────────────────────
const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
  "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8",
  "Accept-Encoding": "gzip, deflate, br",
  "Connection": "keep-alive",
  "Cache-Control": "no-cache",
};

// ─── Scraper Mercado Livre ────────────────────────────────────────────────────
async function scrapeMercadoLivre(url) {
  const { data } = await axios.get(url, { headers: HEADERS, timeout: 10000 });
  const $ = cheerio.load(data);

  // Titulo
  const title =
    $("h1.ui-pdp-title").text().trim() ||
    $("h1.item-title").text().trim() ||
    $("h1").first().text().trim();

  // Preco - varios seletores pois o ML muda layout frequentemente
  let priceText =
    $(".andes-money-amount__fraction").first().text().trim() ||
    $(".price-tag-fraction").first().text().trim() ||
    $("[class*='price-tag-fraction']").first().text().trim();

  // Centavos (opcional)
  const cents = $(".andes-money-amount__cents").first().text().trim();

  // Montar preco
  let price = null;
  if (priceText) {
    const clean = priceText.replace(/\./g, "").replace(",", ".");
    const centVal = cents ? parseInt(cents) / 100 : 0;
    price = parseFloat(clean) + centVal;
  }

  // Tentar extrair do JSON embutido na pagina se os seletores falharem
  if (!price) {
    const match = data.match(/"price":(\d+\.?\d*)/);
    if (match) price = parseFloat(match[1]);
  }

  return { title, price, platform: "ml" };
}

// ─── Scraper Amazon ───────────────────────────────────────────────────────────
async function scrapeAmazon(url) {
  const { data } = await axios.get(url, { headers: { ...HEADERS, "Accept-Language": "pt-BR" }, timeout: 10000 });
  const $ = cheerio.load(data);

  const title =
    $("#productTitle").text().trim() ||
    $("h1.a-size-large").text().trim();

  let price = null;

  // Preco principal
  const priceWhole = $(".a-price-whole").first().text().replace(/[^\d]/g, "");
  const priceFrac  = $(".a-price-fraction").first().text().replace(/[^\d]/g, "");

  if (priceWhole) {
    price = parseFloat(priceWhole + "." + (priceFrac || "00"));
  }

  // Fallback: buscar no JSON da pagina
  if (!price) {
    const match = data.match(/"priceAmount":(\d+\.?\d*)/);
    if (match) price = parseFloat(match[1]);
  }

  return { title, price, platform: "amazon" };
}

// ─── Scraper Magazine Luiza ───────────────────────────────────────────────────
async function scrapeMagalu(url) {
  const { data } = await axios.get(url, { headers: HEADERS, timeout: 10000 });
  const $ = cheerio.load(data);

  const title =
    $("h1[class*='Title']").text().trim() ||
    $("h1[class*='title']").text().trim() ||
    $("h1").first().text().trim();

  let price = null;

  // Buscar no JSON embutido (Magalu usa Next.js com __NEXT_DATA__)
  const nextDataMatch = data.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (nextDataMatch) {
    try {
      const json = JSON.parse(nextDataMatch[1]);
      const priceData =
        json?.props?.pageProps?.product?.price ||
        json?.props?.pageProps?.product?.bestPrice;
      if (priceData) price = parseFloat(priceData);
    } catch (e) {}
  }

  // Fallback CSS
  if (!price) {
    const priceText =
      $("[class*='price-value']").first().text() ||
      $("[class*='Price']").first().text() ||
      $("[data-testid*='price']").first().text();

    if (priceText) {
      const clean = priceText.replace(/[R$\s]/g, "").replace(/\./g, "").replace(",", ".");
      price = parseFloat(clean) || null;
    }
  }

  return { title, price, platform: "magalu" };
}

// ─── Scraper Shopee ───────────────────────────────────────────────────────────
// Shopee requer JavaScript para renderizar — usamos a API interna deles
async function scrapeShopee(url) {
  // Extrair itemId e shopId da URL
  // Formato: shopee.com.br/nome-produto-i.SHOPID.ITEMID
  const match = url.match(/i\.(\d+)\.(\d+)/);

  if (match) {
    const shopId = match[1];
    const itemId = match[2];
    const apiUrl = `https://shopee.com.br/api/v4/item/get?itemid=${itemId}&shopid=${shopId}`;

    const { data } = await axios.get(apiUrl, {
      headers: {
        ...HEADERS,
        "Referer": "https://shopee.com.br/",
        "x-api-source": "pc",
      },
      timeout: 10000,
    });

    const item = data?.data?.item;
    if (item) {
      const title = item.name;
      const price = item.price_min / 100000; // Shopee usa centavos * 1000
      return { title, price, platform: "shopee" };
    }
  }

  // Fallback: tentar scraping direto
  const { data: html } = await axios.get(url, { headers: HEADERS, timeout: 10000 });
  const $ = cheerio.load(html);
  const title = $("h1").first().text().trim();

  return { title, price: null, platform: "shopee" };
}

// ─── Scraper Americanas ───────────────────────────────────────────────────────
async function scrapeAmericanas(url) {
  const { data } = await axios.get(url, { headers: HEADERS, timeout: 10000 });
  const $ = cheerio.load(data);

  const title = $("h1[class*='Title']").first().text().trim() || $("h1").first().text().trim();

  let price = null;
  const scriptMatch = data.match(/"salesPrice":(\d+\.?\d*)/);
  if (scriptMatch) price = parseFloat(scriptMatch[1]);

  if (!price) {
    const priceText = $("[class*='Price'] [class*='Integer']").first().text();
    if (priceText) price = parseFloat(priceText.replace(/[^\d]/g, ""));
  }

  return { title, price, platform: "americanas" };
}

// ─── Rota principal: POST /scrape ─────────────────────────────────────────────
app.post("/scrape", async (req, res) => {
  const { url } = req.body;

  if (!url) {
    return res.status(400).json({ error: "URL nao informada" });
  }

  const platform = detectPlatform(url);
  console.log(`Scraping ${platform}: ${url}`);

  try {
    let result;

    switch (platform) {
      case "ml":         result = await scrapeMercadoLivre(url); break;
      case "amazon":     result = await scrapeAmazon(url);       break;
      case "magalu":     result = await scrapeMagalu(url);        break;
      case "shopee":     result = await scrapeShopee(url);        break;
      case "americanas": result = await scrapeAmericanas(url);    break;
      default:
        return res.status(400).json({ error: "Plataforma nao suportada. Use ML, Amazon, Shopee, Magalu ou Americanas." });
    }

    if (!result.price && !result.title) {
      return res.status(422).json({
        error: "Nao foi possivel extrair dados deste anuncio. Verifique se o link esta correto e tente novamente.",
        platform,
      });
    }

    console.log(`OK - Titulo: ${result.title?.substring(0, 50)} | Preco: R$ ${result.price}`);

    return res.json({
      success: true,
      title:    result.title   || "Titulo nao encontrado",
      price:    result.price   || null,
      platform: result.platform,
      url,
    });

  } catch (err) {
    console.error("Erro no scraping:", err.message);
    return res.status(500).json({
      error: "Erro ao acessar o anuncio: " + err.message,
      platform,
    });
  }
});

// ─── Rota de health check ─────────────────────────────────────────────────────
app.get("/", (req, res) => {
  res.json({
    status: "online",
    service: "E-CLICK PriceWatch Scraper",
    version: "1.0.0",
    platforms: ["mercadolivre", "amazon", "shopee", "magalu", "americanas"],
  });
});

// ─── Iniciar servidor ─────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`Scraper rodando na porta ${PORT}`);
});

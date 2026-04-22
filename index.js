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
  // Fallback: extrair titulo do slug da URL
  const slugMatch = url.match(/mercadolivre\.com\.br\/([^/?#]+)/);
  const titleFromSlug = slugMatch
    ? decodeURIComponent(slugMatch[1]).replace(/[-_]/g, " ").replace(/\b\w/g, l => l.toUpperCase()).trim()
    : "";

  const { data } = await axios.get(url, { headers: HEADERS, timeout: 12000 });
  const $ = cheerio.load(data);

  // Titulo - multiplos seletores para /MLB e /p/
  const title =
    $("h1.ui-pdp-title").text().trim() ||
    $("h1.item-title__primary").text().trim() ||
    $(".ui-pdp-title").text().trim() ||
    $("h1").first().text().trim() ||
    titleFromSlug;

  // Vendedor - multiplos seletores
  const seller =
    $(".ui-pdp-seller__link-trigger-button span").text().trim() ||
    $(".ui-pdp-seller__link-trigger").text().trim() ||
    $("[data-testid='seller-name']").text().trim() ||
    $(".seller-info__name").text().trim() ||
    $("[class*='seller'] a").first().text().trim() ||
    "";

  let price = null;

  // Metodo 1: JSON-LD schema (funciona em paginas /p/)
  $("script[type='application/ld+json']").each((i, el) => {
    if (price) return;
    try {
      const json = JSON.parse($(el).html());
      const arr = Array.isArray(json) ? json : [json];
      for (const item of arr) {
        const offers = item?.offers;
        if (offers) {
          const p = offers.price || offers.lowPrice || (Array.isArray(offers) && offers[0]?.price);
          if (p) { price = parseFloat(p); return; }
        }
      }
    } catch {}
  });

  // Metodo 2: JSON embutido na pagina
  if (!price) {
    for (const pat of [/"price":(\d+(?:\.\d+)?)/, /"amount":(\d+(?:\.\d+)?)/, /"selling_price":(\d+(?:\.\d+)?)/]) {
      const m = data.match(pat);
      if (m && parseFloat(m[1]) > 1) { price = parseFloat(m[1]); break; }
    }
  }

  // Metodo 3: seletores CSS
  if (!price) {
    const fracText = $(".andes-money-amount__fraction").first().text().replace(/\./g, "").trim();
    const centsText = $(".andes-money-amount__cents").first().text().trim();
    if (fracText) price = parseFloat(fracText) + (centsText ? parseInt(centsText) / 100 : 0);
  }

  // Metodo 4: meta tag
  if (!price) {
    const metaPrice = $("meta[itemprop='price']").attr("content") || $("meta[property='product:price:amount']").attr("content");
    if (metaPrice) price = parseFloat(metaPrice);
  }

  return { title, price, seller, platform: "ml" };
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
async function scrapeShopee(url) {
  // Extrair nome do produto do slug da URL como fallback
  // Formato: shopee.com.br/Nome-Do-Produto-i.SHOPID.ITEMID
  const slugMatch = url.match(/shopee\.com\.br\/([^?]+)-i\.\d+\.\d+/);
  const titleFromSlug = slugMatch
    ? decodeURIComponent(slugMatch[1])
        .replace(/-/g, " ")
        .replace(/\b\w/g, l => l.toUpperCase())
        .trim()
    : "";

  // Extrair IDs
  const match = url.match(/i\.(\d+)\.(\d+)/);

  if (match) {
    const shopId = match[1];
    const itemId = match[2];

    // Tentar API interna da Shopee com headers completos
    try {
      const apiUrl = `https://shopee.com.br/api/v4/item/get?itemid=${itemId}&shopid=${shopId}`;
      const { data } = await axios.get(apiUrl, {
        headers: {
          ...HEADERS,
          "Referer": `https://shopee.com.br/`,
          "x-api-source": "pc",
          "x-shopee-language": "pt-BR",
          "Cookie": "SPC_EC=-",
        },
        timeout: 12000,
      });

      const item = data?.data?.item;
      if (item) {
        const title = item.name || titleFromSlug;
        const price = item.price_min / 100000;
        const seller = item.shop_name || "";
        return { title, price, seller, platform: "shopee" };
      }
    } catch (apiErr) {
      console.log("Shopee API falhou, tentando HTML:", apiErr.message);
    }

    // Fallback: tentar scraping do HTML
    try {
      const { data: html } = await axios.get(url.split("?")[0], { headers: HEADERS, timeout: 12000 });
      const $ = cheerio.load(html);
      const htmlTitle = $("h1").first().text().trim();
      const priceMatch = html.match(/"price":(\d+)/);
      const price = priceMatch ? parseInt(priceMatch[1]) / 100000 : null;
      return { title: htmlTitle || titleFromSlug, price, seller: "", platform: "shopee" };
    } catch {}
  }

  // Ultimo fallback: retornar nome extraido do URL
  if (titleFromSlug) {
    return {
      title: titleFromSlug,
      price: null,
      seller: "",
      platform: "shopee",
      warning: "Preco nao encontrado automaticamente. Insira manualmente."
    };
  }

  return { title: "", price: null, seller: "", platform: "shopee" };
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

    // Retornar sucesso mesmo com dados parciais (ex: titulo sem preco)
    const partial = !result.price || !result.title;
    console.log(`${partial ? "PARCIAL" : "OK"} - Titulo: ${result.title?.substring(0, 50)} | Preco: R$ ${result.price}`);

    return res.json({
      success: true,
      partial,
      title:    result.title   || "",
      price:    result.price   || null,
      seller:   result.seller  || null,
      warning:  result.warning || (partial ? "Alguns dados nao foram encontrados automaticamente. Preencha o restante manualmente." : null),
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

// ─── Rota de análise com IA ───────────────────────────────────────────────────
app.post("/analyze", async (req, res) => {
  const { produto, meuPreco, concorrentes } = req.body;
  if (!produto) return res.status(400).json({ error: "Dados incompletos" });

  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_KEY) {
    return res.status(500).json({ error: "Chave da API nao configurada no servidor" });
  }

  try {
    const prompt = `Produto: "${produto}"
Meu preco: R$ ${Number(meuPreco).toFixed(2)}

Concorrentes:
${(concorrentes || []).map(c =>
  `• ${c.plataforma}${c.loja ? " (Loja: " + c.loja + ")" : ""}: R$ ${Number(c.precoAtual).toFixed(2)} | min 30d: R$ ${Number(c.min30d).toFixed(2)} | max 30d: R$ ${Number(c.max30d).toFixed(2)} | tendencia: ${c.tendencia}`
).join("\n")}

Analise em 3 pontos diretos:
1) Posicao competitiva atual
2) Acao recomendada imediata
3) Preco sugerido e justificativa`;

    const response = await axios.post(
      "https://api.anthropic.com/v1/messages",
      {
        model: "claude-sonnet-4-20250514",
        max_tokens: 700,
        system: "Voce e um especialista em precificacao para marketplaces brasileiros. Respostas diretas em portugues com bullet points curtos.",
        messages: [{ role: "user", content: prompt }],
      },
      {
        headers: {
          "Content-Type": "application/json",
          "x-api-key": ANTHROPIC_KEY,
          "anthropic-version": "2023-06-01",
        },
      }
    );

    const analysis = response.data?.content?.[0]?.text || "Nao foi possivel gerar analise.";
    console.log("Analise gerada para:", produto);
    return res.json({ success: true, analysis });

  } catch (err) {
    console.error("Erro na analise:", err.message);
    return res.status(500).json({ error: "Erro ao gerar analise: " + err.message });
  }
});

E-CLICK PriceWatch — Scraper API
API de scraping de preços para marketplaces brasileiros. Parte do sistema E-CLICK PriceWatch.
Plataformas suportadas
PlataformaMétodoStatusMercado LivreHTML + Cheerio✅Amazon BrasilHTML + Cheerio✅Magazine LuizaNext.js JSON + Cheerio✅ShopeeAPI interna✅AmericanasHTML + Cheerio✅

Endpoints
GET /
Health check — verifica se o servidor está online.
Resposta:
json{
  "status": "online",
  "service": "E-CLICK PriceWatch Scraper",
  "version": "1.0.0",
  "platforms": ["mercadolivre", "amazon", "shopee", "magalu", "americanas"]
}

POST /scrape
Extrai título e preço de um anúncio.
Body:
json{
  "url": "https://www.mercadolivre.com.br/..."
}
Resposta de sucesso:
json{
  "success": true,
  "title": "Nome do produto",
  "price": 299.90,
  "platform": "ml",
  "url": "https://..."
}
Resposta de erro:
json{
  "error": "Mensagem de erro",
  "platform": "ml"
}

Deploy no Railway

Faça fork ou clone este repositório
Acesse railway.app
Clique em New Project → Deploy from GitHub
Selecione este repositório
O Railway detecta automaticamente o package.json e inicia o servidor
Vá em Settings → Networking → Generate Domain para obter a URL pública


Variáveis de ambiente
Nenhuma variável obrigatória. O servidor usa a porta definida pela variável PORT (definida automaticamente pelo Railway).

Uso local
bash# Instalar dependências
npm install

# Iniciar em modo desenvolvimento
npm run dev

# Iniciar em produção
npm start
O servidor sobe em http://localhost:3001.
Exemplo de teste:
bashcurl -X POST http://localhost:3001/scrape \
  -H "Content-Type: application/json" \
  -d '{"url": "https://www.mercadolivre.com.br/SEU-PRODUTO"}'

Integração com o frontend
No repositório monitor-precos, crie um arquivo .env na raiz:
REACT_APP_SCRAPER_URL=https://SEU-PROJETO.up.railway.app
Substitua pela URL gerada no Railway.

Estrutura do projeto
price-scraper/
├── index.js        # Servidor Express + scrapers
├── package.json    # Dependências
└── README.md       # Este arquivo

Desenvolvido para E-CLICK Comercio · monitor-de-precos.netlify.app

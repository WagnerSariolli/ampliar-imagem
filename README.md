# Ampliar Imagem

Aumenta a resolução de imagens (2× / 4×) com IA, no estilo do iLoveIMG "Ampliar imagem" — mas 100% no navegador.

- **Modelo:** ESRGAN medium (UpscalerJS + TensorFlow.js, backend WebGL)
- **Privacidade:** a imagem nunca sai do computador; os pesos do modelo são servidos de `public/models`
- **Web Worker:** a UI não trava e o processamento continua com a aba em segundo plano
- Arrastar e soltar, Ctrl+V, comparador antes/depois, transparência preservada, download em PNG

```bash
npm install
npm run dev
```

`scripts/copy-models.mjs` copia os pesos de `node_modules/@upscalerjs/esrgan-medium/models` para `public/models` (roda no install/dev/build).

## Deploy (Cloudflare)

Site 100% estático, publicado no Cloudflare Workers (`wrangler.jsonc`, pasta `dist`).

```bash
npx wrangler login   # uma vez, abre o navegador
npm run deploy       # build + publicação
```

Domínio próprio: em `wrangler.jsonc`, adicione
`"routes": [{ "pattern": "ampliar.seudominio.com.br", "custom_domain": true }]`
(o domínio precisa estar na sua conta Cloudflare) ou configure no painel em
Workers & Pages → ampliar-imagem → Settings → Domains & Routes.

## Deploy (GitHub Pages)

Cada push na `main` gera o build e publica via GitHub Actions (`.github/workflows/deploy.yml`):
https://wagnersariolli.github.io/ampliar-imagem/

# Crypto Momentum Radar

Crie uma aplicação web completa em React + TypeScript + Tailwind CSS + Lucide Icons para um Dashboard de Trading Automatizado de Alta Volatilidade (Momentum & Scalping Bot) focado no Mercado à Vista (Spot) de criptomoedas.



### IMPORTANTE SOBRE A ARQUITETURA (LOVABLE):

- Não use bibliotecas de backend pesado como `ccxt` no frontend para evitar erros de build e CORS.

- Conecte diretamente via **API Pública REST e WebSocket da Binance** (`wss://://binance.com`) para puxar preços ao vivo, velas de 1 minuto (klines) e profundidade do livro de ofertas (Order Book) em tempo real sem necessidade de chave de API para leitura.

- Estruture a execução de ordens em dois modos:

  1. **Modo Simulação / Paper Trading (Ativo por padrão):** Executa compras e vendas virtuais usando os preços reais ao vivo do WebSocket da Binance, salvando o histórico e o saldo no `localStorage` (ou Supabase se conectado).

  2. **Modo Real (Preparado para Supabase Edge Functions):** Crie uma interface segura para configurar as chaves da API (armazenadas via Supabase Secrets/Backend) com uma função serverless pronta para assinar requisições HMAC-SHA256 na Binance quando o usuário ativar o modo real.



### 1. Identidade Visual e Layout (Dark Mode Profissional)

- Fundo principal `#0B0E11`, cards `#181A20` com bordas sutis `#2B3139`, verde neon `#0ECB81` para compra/lucro e vermelho `#F6465D` para venda/stop.

- **Cabeçalho Superior:**

  - Título do Robô + Badge de Status ao vivo (`ESCANEANDO MERCADO`, `AGUARDANDO CONFIANÇA >= 85%`, `POSICIONADO`, ou `STOP DIÁRIO ATINGIDO`).

  - **Banca Atual:** Inicia em `R$ 100,00` (com conversão automática baseada na cotação ao vivo de `USDTBRL` da Binance).

  - **Barra de Meta Diária:** Progresso visual rumo aos `+R$ 30,00 (+30%)` no dia, com switch para "Pausar robô automaticamente ao atingir a meta".

  - Botão principal de destaque: `Iniciar Robô` / `Parar Robô`.



### 2. Painel Central (Gráfico + Scanner + Confiança da IA)

- **Scanner Multi-Moedas (Top Volatilidade):** Monitora simultaneamente via WebSocket os pares `PEPEUSDT`, `WIFUSDT`, `BONKUSDT`, `FLOKIUSDT`, `SUIUSDT` e `DOGEUSDT`. Permite ao usuário travar em apenas uma moeda (ex: `PEPEUSDT`) ou deixar no modo **"Auto-Caçador"** (entra na moeda que atingir a maior pontuação de confiança primeiro).

- **Gráfico de Velas em Tempo Real:** Gráfico interativo da moeda selecionada no momento com marcações visuais das linhas de Preço de Entrada, Alvo de Lucro (Take Profit) e Stop Loss quando estiver posicionado.

- **Medidor de Confiança da IA (0% a 100%):**

  - Gauge/velocímetro animado mostrando a pontuação atual calculada a cada segundo.

  - Lista dinâmica dos motivos da pontuação em tempo real (ex: `✓ Volume 240% acima da média`, `✓ RSI(7) em sobrevenda (23.4)`, `✓ Pressão compradora de 68% no Order Book`, `✗ Spread acima do ideal`).



### 3. Motor de Cálculo da Confiança da IA (Frontend Engine)

Implemente um hook customizado (`useTradingEngine.ts`) que processe os dados do WebSocket da Binance e calcule o **Score de Confiança (0 a 100)** com base em 4 indicadores reais:

1. **Explosão de Volume (35 pontos):** Compara o volume das últimas 3 velas de 1m com a média das últimas 30 velas.

2. **RSI Rápido de 7 períodos (25 pontos):** Pontua máximo quando o RSI está abaixo de 28 (repique de sobrevenda) ou em rompimento saudável entre 55 e 68.

3. **Desequilíbrio do Order Book (25 pontos):** Calcula a proporção entre o volume dos 10 primeiros níveis de compra (Bids) vs. venda (Asks) ao vivo.

4. **Filtro de Spread e Taxas (15 pontos):** Verifica se a diferença entre o melhor Bid e Ask é mínima para não corroer o lucro.



### 4. Regras de Execução e Proteção de Banca (R$ 100,00)

- **Gatilho de Entrada:** O robô SÓ pode comprar quando `Score >= Gatilho Configurado` (padrão `85%`) e não houver nenhuma posição aberta.

- **Gestão de Banca:** Entra com 98% do saldo disponível (respeitando o mínimo de ordem) em uma operação por vez.

- **Saída Automática (OCO + Trailing Stop):**

  - Take Profit padrão: `+3.2%` (liquida ~3.0% após 0.2% de taxas simuladas/reais).

  - Stop Loss padrão: `-1.5%`.

  - **Trailing Stop Inteligente:** Se o lucro da operação aberta atingir `+2.0%`, o sistema move automaticamente o Stop Loss para `+0.4%` acima do preço de entrada (garantindo lucro mínimo).

  - **Circuit Breaker (Stop Diário):** Se o prejuízo acumulado no dia atingir `-10%` (`-R$ 10,00`), o robô encerra todas as operações e bloqueia novas entradas até o dia seguinte.



### 5. Rodapé: Histórico de Operações e Terminal de Logs

- **Tabela de Trades:** Hora, Par, Tipo, Preço Entrada, Preço Saída, Score da IA na entrada, Taxa (0.2%) e Lucro/Prejuízo líquido em R$.

- **Terminal de Logs ao Vivo:** Console estilo terminal mostrando o robô analisando os pares a cada segundo e explicando por que entrou ou aguardou.

Atualize e expanda o Dashboard de Trading Automatizado (Momentum & Scalping Bot) em React + TypeScript + Tailwind CSS para incluir um **Radar em Tempo Real de Memecoins Recém-Lançadas e Explosivas**, mantendo a compatibilidade total com a arquitetura do Lovable (APIs públicas REST/WebSocket no frontend + preparação para Supabase Edge Functions).



### 1. Integração de Fontes de Memecoins Recém-Lançadas

Conecte duas fontes de dados públicas e gratuitas (sem necessidade de chave de API para leitura):

1. **API Pública da DexScreener (`https://dexscreener.com` e `/latest/dex/search`):** Busca automaticamente os tokens e memecoins mais recentes e em alta nas redes **Solana** e **Base**, exibindo preço ao vivo, variação em 5m/1h, liquidez da pool e volume.

2. **Scanner Dinâmico Binance Spot (`https://binance.com`):** Filtra automaticamente os pares USDT com maior variação percentual positiva e maior volume nas últimas horas, somados às memecoins principais (`PEPEUSDT`, `WIFUSDT`, `BONKUSDT`, `FLOKIUSDT`, `PNUTUSDT`, `NEIROUSDT`).



### 2. Novo Painel: Radar de Lançamentos & Filtro Anti-Rug (Segurança)

- Crie uma aba ou seção lateral chamada **"Radar Recém-Lançadas (DEX & CEX)"** com atualização automática a cada 15 segundos.

- **Filtro de Segurança Obrigatório (Anti-Golpe / Anti-Liquidez Baixa):** Como moedas novas podem travar o capital, o robô deve reprovar automaticamente qualquer token recém-lançado que não cumprir estes requisitos mínimos:

  - Liquidez mínima na pool: pelo menos `$50.000` (para garantir que você consiga vender seus R$ 100,00 sem derrubar o preço).

  - Volume mínimo nos últimos 60 minutos: `$20.000`.

  - Proporção de compras vs. vendas equilibrada (bloqueia tokens onde só existem compras e nenhuma venda executada, sinal clássico de golpe *honeypot*).

- Permita ao usuário escolher entre:

  - **Modo CEX (Binance):** Opera apenas moedas já listadas na corretora (mais seguro e sem taxas de rede blockchain).

  - **Modo Híbrido / Radar DEX (Simulador Avançado):** Monitora e simula scalping nas memecoins recém-lançadas da Solana/Base capturadas pela DexScreener.



### 3. Ajuste no Motor de Confiança da IA (0% a 100%) para Moedas Novas

Atualize o hook `useTradingEngine.ts` para adaptar a pontuação quando o robô analisar uma memecoin recém-lançada:

1. **Aceleração de Volume Curto (35 pts):** Verifica se o volume dos últimos 5 minutos superou em +300% a média anterior.

2. **Saúde da Liquidez e Anti-Honeypot (25 pts):** Pontua máximo apenas se houver histórico real de compras e vendas nos últimos minutos e liquidez sólida.

3. **Momentum de Preço / RSI 7 (25 pts):** Identifica rompimentos de micro-resistências com força compradora ou repiques rápidos após quedas de 5% a 10%.

4. **Spread e Slippage Estimado (15 pts):** Calcula se a oscilação atual paga com folga as taxas de entrada e saída.



### 4. Gestão de Banca (R$ 100,00) e Proteção Reforçada

- **Regra de Entrada:** Só entra se `Confiança da IA >= 85%` (ou valor definido no slider) e o token passar no Filtro de Segurança.

- **Alvos Ajustados para Alta Explosão:**

  - Take Profit padrão: `+4.5%` (aproveitando a maior explosão de moedas novas para buscar ~R$ 4,30 líquidos por ciclo).

  - Stop Loss curto: `-2.0%`.

  - **Trailing Stop:** Ativa ao bater `+2.5%` de lucro, travando o stop em `+0.8%` para proteger o ganho caso a memecoin despenche subitamente.

  - **Circuit Breaker:** Mantém a trava diária de `-10%` (`-R$ 10,00`) para proteger os R$ 100,00 iniciais.

- **Logs Detalhados:** Mostre no terminal quando o robô descartar uma moeda recém-lançada por falta de liquidez ou risco detectado (ex: `[FILTRO] Token XYZ ignorado: liquidez abaixo de $50k`).

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/4e7ea75e-f4c3-49ca-a2fd-6ce15330e35c).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```

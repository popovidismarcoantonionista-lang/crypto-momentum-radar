# IA Jev Trading Bot — simulação realista e proteções

## Diagnóstico da estrutura atual

- `gateio.functions.ts` já consulta candles e livro da Gate.io e assina ordens no servidor com Web Crypto. Ainda não consulta os mínimos e a precisão de cada par; o universo de pares e a análise usam volume mínimo de US$ 100 mil.
- `useTradingEngine.ts` concentra entradas, saídas, saldo e histórico. O paper trading compra e vende pelo último preço negociado; a posição aberta recebe apenas ticker, não um livro atualizado. A taxa atual é uma estimativa única de 0,2% sobre o capital inicial, sem debitar separadamente a compra.
- `jev.ts` separa regras testáveis: pontuação, anti-topo, trailing, cooldown e limites diários. Não há filtro obrigatório de spread, relação alvo/custos nem trava por três perdas seguidas.
- `useDexRadar.ts` atualiza a cada 15 segundos, mantém histórico sem horários e usa variações de 5 minutos/1 hora. Não há medida real de 1 minuto nem associação verificada entre contratos DEX e ativos Gate.io.
- `SettingsModal.tsx` já permite percentual de capital, TP, SL e meta. Faltam mão fixa em USDT, latência e edição do stop diário. O painel já tem histórico, mas sem motivos completos da entrada, bloqueios ou métricas de performance.
- Configurações e simulação são salvas somente neste navegador; as chaves ficam na sessão. Lovable Cloud ainda não está conectado.

## 1. Backend / Lógica de Execução

### Dados e filtros obrigatórios
- Consultar metadados da Gate.io: `min_quote_amount`, mínimo em moeda-base, precisões e disponibilidade para negociação; manter atualização periódica e invalidar dados vencidos.
- Rejeitar para análise pares com volume 24h **inferior a US$ 300.000**. Manter PEARL_USDT no topo para monitoramento, sem dispensá-lo dos filtros; linhas bloqueadas continuam visíveis, sem receber pontuação de entrada.
- Calcular spread como `(ask − bid) / bid`; bloquear valores **acima de 0,0015 (0,15%)**. Livro ausente, inválido, cruzado ou desatualizado também bloqueia, sem substituir pelo ticker.
- Usar as mesmas verificações antes da ordem, incluindo após a latência. Registrar motivo de rejeição e evitar repetir o mesmo bloqueio continuamente no histórico.

### Paper trading com saldo e taxas reais
- Criar funções puras para dimensionamento, execução simulada, taxas e avaliação da posição; o motor apenas coordena estados e dados.
- Latência configurável, padrão **400 ms**, seguida de nova consulta ao livro: compra no **best ask** e venda no **best bid**, nunca no último preço negociado. Aplicar também às saídas simuladas; se a consulta falhar, não inventar execução.
- Validar quantidade disponível no livro; consumir níveis adicionais quando a mão exceder o primeiro nível, registrando preço médio e slippage. Não preencher quantidade maior que a profundidade conhecida.
- Cobrar **0,10% na compra e 0,10% na venda**, cada taxa sobre o valor efetivamente executado daquele lado, com equivalente em USDT. Registrar quantidade líquida, saldo livre, capital reservado, lucro bruto, taxas e lucro líquido sem dupla contagem.
- Percentual ou mão fixa definem a intenção de compra. Quando estiver abaixo do mínimo do par, elevar ao mínimo somente se saldo, taxas e arredondamento permitirem; caso contrário, abortar e explicar no log. Nunca ultrapassar a banca de 17 USDT.
- Respeitar precisões e mínimos também na saída; registrar resíduos e ordens inexequíveis em vez de considerar toda a posição liquidada.
- Separar os estados de simulação e dinheiro real. Impedir troca de modo/reinício com operação em andamento; nenhuma validação automatizada enviará ordens reais.
- Migrar configurações antigas preservando valores. Histórico paper antigo ficará identificado como modelo anterior e não será misturado às métricas novas; posição antiga sem quantidade/taxas verificáveis não ganhará uma conversão fictícia.

### Risco e pausas automáticas
- Liberar entrada apenas se o TP configurado/estimado for **pelo menos 2,5 vezes o custo de 0,20% de taxas + spread**, acrescentando slippage estimado quando houver consumo de vários níveis.
- Pausar e bloquear novas entradas ao alcançar **meta diária, stop diário ou três perdas líquidas consecutivas**. A meta deixa de depender do checkbox opcional atual.
- Preservar stop/trailing de posições abertas, operação única e cooldown de 60 segundos. Uma pausa não desliga a proteção da posição.
- Mostrar causa da pausa; limites diários são reiniciados no novo dia. A trava de três perdas exige retomada explícita, sem reinício silencioso da sequência.

### Lead-Lag e análises por eventos
- Manter varredura geral **a cada 5 segundos** e acrescentar eventos do livro/negócios Gate.io para volume e mudança de spread, com reconexão, controle de frequência e fallback para varredura.
- Guardar amostras DEX com horário para calcular variação **superior a 1,5% em 60 segundos**; não tratar variação de 5 minutos como se fosse de 1 minuto. Sem uma janela completa, o sinal fica indisponível.
- Associar ativos pelo contrato/rede verificados, nunca só pelo símbolo. Sem correspondência confiável, não aplicar bônus.
- Padrão proposto: pico de volume DEX de pelo menos **2x** a referência anterior e bônus de **até 10 pontos**, limitado a 100%, somente quando a Gate.io ainda não acompanhou o movimento. Exibir origem e idade do sinal; sinal vencido não libera ordem.
- Esses parâmetros são escolhas iniciais, não garantia de antecipação. As APIs atuais não permitem prometer equivalência perfeita com execução real ou prioridade de mercado.

## 2. Frontend / Painel

- Preservar nome, tema escuro, ícones e identidade dourada **#F0B90B**, expressa pelo token de cor do projeto.
- Scanner: volume 24h, spread %, situação do livro e motivo visível de bloqueio por liquidez/spread; PEARL prioritário, mas sujeito às mesmas regras.
- Gestão de Risco & Banca: seletor mão percentual/fixa, valor em USDT, SL técnico, TP mínimo, meta, stop diário e latência. Resumo compacto no cabeçalho com acesso aos mesmos ajustes.
- Posição aberta: quantidade, ask de entrada, bid de saída disponível, lucro bruto, taxas já pagas, taxa estimada de saída e resultado líquido em USDT/R$.
- Histórico **abaixo do scanner**, em faixa larga para leitura: horário, par, pontuação total e de cada indicador na entrada, entrada/saída, bruto, taxas, líquido e status. Bloqueios não aparecem como trades lucrativos nem entram no win rate.
- Métricas: win rate de operações encerradas, taxas efetivamente pagas, profit factor e drawdown máximo da curva de patrimônio líquido incluindo posições abertas. Separar PAPER/REAL; sem amostra válida, mostrar “—”, não números inventados.
- Alertas persistentes para meta, stop diário e três perdas. Exibir motivo e impedir que “Ligar IA Jev” contorne bloqueios diários.
- Extrair histórico, métricas e controles em elementos menores para não ampliar ainda mais o arquivo principal; reutilizar os controles visuais do projeto e preservar os metadados da página.

## 3. Testes e critérios de aceite

- Testes concretos para os limites de US$ 300.000 e 0,15%, taxas por lado, ask/bid diferentes do ticker, latência de 400 ms com preço atualizado, mínimos de 5/10 USDT e banca de 17 USDT.
- Testar TP/custos em 2,5x, cada causa de pausa, três perdas consecutivas, reset da sequência após ganho, cooldown e concorrência de eventos sem compras duplicadas.
- Testar correspondência DEX/Gate.io, janela de 60 segundos, alta >1,5%, pico de volume e ausência de bônus com dados insuficientes.
- Testar métricas, saldo reservado, profundidade insuficiente, dados vencidos e falhas do livro. Atualizar os testes existentes que pressupõem o cálculo antigo de taxa.
- No navegador: configurar mão/latência/limites, recarregar e verificar persistência; executar entrada e saída paper com livro controlado; conferir saldo, histórico, bloqueio e métricas. Verificar também dados públicos reais e telas de computador/celular.

## Ordem de entrega e dependências

1. Metadados Gate.io, filtros e regras puras de execução/risco, com testes.
2. Estado paper e contabilidade, integração de livro atualizado e latência.
3. Eventos de mercado e detector Lead-Lag conservador.
4. Controles, scanner, histórico, alertas e métricas; validação completa em simulação.

Antes de ampliar funções de servidor ou persistência, ativar **Lovable Cloud**, conforme exigência da plataforma; eventual indisponibilidade será apresentada como bloqueio, não substituída por execução assinada no navegador. A sincronização entre dispositivos e armazenamento criptografado de chaves não fazem parte desta melhoria; sem isso, o histórico continuará identificado como local ao navegador. O motor atual também não opera continuamente com a aba fechada: serviço de execução permanente seria um escopo separado.

**Nesta etapa: somente análise e plano; o comportamento do robô não foi alterado.**
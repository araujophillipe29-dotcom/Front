// dashboard.js
// Tudo num arquivo só, como script comum (sem import/export), do mesmo
// jeito que o script.js que já funcionou pra você. Isso evita o problema
// de módulos ES bloqueados por CORS quando a página é aberta como file://.

(function () {

  // ===================== CONFIG =====================

  const CONFIG = {
    API_URL: 'https://api-4srz.onrender.com/status',
    STREAM_URL: 'https://api-4srz.onrender.com/stream',
  };

  const COLORS = {
    verde: '#22C55E',
    amarelo: '#DDC126',
    vermelho: '#EF4444',
    cinza: '#54545A',
    azul: '#004AAD',
  };

  // Ordem de severidade usada para decidir a cor do painel de alertas
  // (vermelho > amarelo > verde), sem que um sensor tenha prioridade fixa
  // sobre o outro — o que importa é o nível de cada leitura.
  const SEVERIDADE = {
    [COLORS.verde]: 0,
    [COLORS.amarelo]: 1,
    [COLORS.vermelho]: 2,
  };

  function corMaisGrave(a, b) {
    return (SEVERIDADE[a] ?? 0) >= (SEVERIDADE[b] ?? 0) ? a : b;
  }

  const ICONS = {

    check: `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
      <path d="M6 12l4 4 8-8"/>
    </svg>
  `,

    gear: `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="12" r="3"/>
      <path d="M19 12a7 7 0 0 0-.1-1l2-1.5-2-3.5-2.3 1a7 7 0 0 0-1.7-1l-.3-2.5h-4l-.3 2.5a7 7 0 0 0-1.7 1l-2.3-1-2 3.5 2 1.5a7 7 0 0 0 0 2l-2 1.5 2 3.5 2.3-1a7 7 0 0 0 1.7 1l.3 2.5h4l.3-2.5a7 7 0 0 0 1.7-1l2.3 1 2-3.5-2-1.5c.1-.3.1-.7.1-1z"/>
    </svg>
  `,

    power: `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
      <path d="M12 2v10"/>
      <path d="M5 7a7 7 0 1 0 14 0"/>
    </svg>
  `,

    shield: `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linejoin="round">
      <path d="M12 3l7 4v5c0 5-3.5 8-7 9-3.5-1-7-4-7-9V7l7-4z"/>
    </svg>
  `,

    warning: `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 3L2 21h20L12 3z"/>
      <line x1="12" y1="9" x2="12" y2="13"/>
      <circle cx="12" cy="17" r="1"/>
    </svg>
  `,

    info: `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
      <circle cx="12" cy="12" r="10"/>
      <line x1="12" y1="16" x2="12" y2="12"/>
      <circle cx="12" cy="8" r="1"/>
    </svg>
  `,

  };

  // ===================== CLASSIFICAÇÃO INDEPENDENTE =====================
  // Temperatura e pressão são avaliadas de forma totalmente independente,
  // cada uma com seu próprio nível (verde/amarelo/vermelho). Nenhuma delas
  // tem prioridade fixa sobre a outra — a cor do painel de alertas é
  // decidida depois, comparando os dois resultados (ver corMaisGrave).
  // Faixas espelham exatamente as regras já usadas no backend
  // (src/services/machineService.js), para as duas fontes ficarem coerentes.

  function classificarTemperatura(temperatura) {
    if (typeof temperatura !== 'number' || isNaN(temperatura)) {
      return { cor: COLORS.cinza, legenda: 'Sem leitura' };
    }
    if (temperatura > 80) return { cor: COLORS.vermelho, legenda: 'Temperatura crítica' };
    if (temperatura > 60) return { cor: COLORS.amarelo, legenda: 'Temperatura elevada, atenção' };
    if (temperatura < 40) return { cor: COLORS.verde, legenda: 'Temperatura baixa, tudo ok' };
    return { cor: COLORS.verde, legenda: 'Temperatura normal' };
  }

  function classificarPressao(psi) {
    if (typeof psi !== 'number' || isNaN(psi)) {
      return { cor: COLORS.cinza, legenda: 'Sem leitura' };
    }
    if (psi > 110) return { cor: COLORS.vermelho, legenda: 'Pressão crítica' };
    if (psi > 100) return { cor: COLORS.amarelo, legenda: 'Pressão elevada' };
    if (psi < 70) return { cor: COLORS.amarelo, legenda: 'Pressão baixa' };
    return { cor: COLORS.verde, legenda: 'Pressão normal' };
  }

  // Escalas usadas apenas para desenhar as barras de progresso (0%–100%).
  // Dão folga acima do limite crítico de cada sensor para a barra não
  // "grudar" em 100% assim que o valor entra na faixa crítica.
  const ESCALA_TEMPERATURA_MAX = 120; // °C
  const ESCALA_PRESSAO_MAX = 150;     // psi
  const PSI_POR_BAR = 14.5038;

  function calcularPercentual(valor, max) {
    if (typeof valor !== 'number' || isNaN(valor)) return 0;
    return Math.min(Math.max((valor / max) * 100, 0), 100);
  }

  function converterPsiParaBar(psi) {
    if (typeof psi !== 'number' || isNaN(psi)) return null;
    return psi / PSI_POR_BAR;
  }

  function formatarHoras(tempo) {
    if (typeof tempo === 'string') return tempo;
    if (typeof tempo === 'number') {
      const h = Math.floor(tempo / 60);
      const m = tempo % 60;
      return `${h}h ${m}m`;
    }
    return '—';
  }

  // Lê o texto de status que o backend já manda pronto e identifica apenas
  // os estados "especiais" (que não dependem da leitura de sensores).
  // O estado operacional normal (verde/amarelo/vermelho) é recalculado
  // localmente a partir de temperatura e pressão, para os dois sensores
  // terem exatamente o mesmo peso na decisão.
  function identificarEstadoEspecial(status) {
    const s = (status || '').toLowerCase();
    if (s.includes('inválid')) return 'invalido';
    if (s.includes('manutenç')) return 'manutencao';
    if (s.includes('deslig')) return 'desligada';
    if (s.includes('ligando') || s.includes('iniciando')) return 'ligada';
    return null;
  }

  // ===================== MONTAGEM DO MODELO DE VISUALIZAÇÃO =====================
  // Constrói, a partir do payload cru vindo do backend, tudo o que a função
  // render() precisa: cor de destaque, conteúdo do painel de status, do
  // painel de alertas (com as mensagens combinadas de temperatura/pressão),
  // ações recomendadas e os dados dos cards de temperatura e pressão
  // (cada um com sua própria cor e independente um do outro).

  function iconePadrao(icon, cor) {
    // Círculo sempre com fundo transparente e borda colorida, no mesmo
    // padrão visual em todos os níveis (verde, amarelo, vermelho etc.).
    // O ícone em si nunca some: no estado verde mantemos a engrenagem
    // branca (padrão original); nos demais estados usamos a própria cor.
    const isVerde = cor === COLORS.verde;
    return {
      icon,
      iconBg: 'transparent',
      iconBorder: cor,
      iconColor: isVerde ? '#fff' : cor,
    };
  }

  function buildViewModel(raw) {
    const estadoEspecial = identificarEstadoEspecial(raw.status);

    if (estadoEspecial === 'invalido') {
      const cor = COLORS.vermelho;
      return {
        accent: cor,
        badge: '⚠ Dados Inválidos',
        ligada: false,
        metricas: { horas: '—', cortes: '—', eficiencia: '—' },
        status: { ...iconePadrao(ICONS.warning, cor), title: 'Dados Inválidos', titleColor: cor, subtitle: 'Verifique o sensor' },
        alerta: {
          ...iconePadrao(ICONS.warning, cor),
          title: 'Dados Inválidos',
          mensagensHtml: (raw.alertas && raw.alertas.length) ? raw.alertas.join('<br>') : 'Dados do sensor inconsistentes.',
          blink: true,
        },
        acoes: ['Verificar a conexão do sensor', 'Confirmar a integridade dos dados enviados'],
        temp: { cor: COLORS.cinza, legenda: 'Sem leitura', percentual: 0, valorTexto: '—', blink: false },
        press: { cor: COLORS.cinza, legenda: 'Sem leitura', percentual: 0, valorBarTexto: '—', valorPsiTexto: '—', blink: false },
        overlay: null,
        soundKey: 'critico',
      };
    }

    if (estadoEspecial === 'manutencao') {
      return {
        accent: '#4D2C39',
        badge: '06 — Em manutenção',
        ligada: true,
        metricas: metricasDe(raw),
        status: { ...iconePadrao(ICONS.gear, COLORS.verde), title: 'Em Operação', titleColor: COLORS.verde, subtitle: 'Operando' },
        alerta: { ...iconePadrao(ICONS.shield, COLORS.verde), title: 'Tudo está ok!', mensagensHtml: '', blink: false },
        acoes: [],
        temp: dadosTemperatura(raw.temperatura),
        press: dadosPressao(raw.psi),
        overlay: { titulo: 'Em Manutenção', desc: 'A máquina está em manutenção.<br>Retornaremos em breve!' },
        soundKey: null,
      };
    }

    if (estadoEspecial === 'desligada') {
      return {
        accent: COLORS.cinza,
        badge: '04 — Máquina desligada',
        ligada: false,
        metricas: { horas: '—', cortes: '—', eficiencia: '—' },
        status: { ...iconePadrao(ICONS.power, COLORS.cinza), title: 'Máquina Desligada', titleColor: COLORS.cinza, subtitle: 'Inativa' },
        alerta: { ...iconePadrao(ICONS.info, COLORS.cinza), title: 'Máquina Desligada', mensagensHtml: 'Sem operação no momento', blink: false },
        acoes: [],
        temp: { cor: COLORS.cinza, legenda: 'Sem leitura', percentual: 0, valorTexto: '—', blink: false },
        press: { cor: COLORS.cinza, legenda: 'Sem leitura', percentual: 0, valorBarTexto: '—', valorPsiTexto: '—', blink: false },
        overlay: null,
        soundKey: null,
      };
    }

    if (estadoEspecial === 'ligada') {
      return {
        accent: COLORS.azul,
        badge: '05 — Máquina ligada',
        ligada: true,
        metricas: metricasDe(raw),
        status: { ...iconePadrao(ICONS.power, COLORS.azul), title: 'Máquina Ligada', titleColor: COLORS.azul, subtitle: 'Iniciando' },
        alerta: { ...iconePadrao(ICONS.shield, COLORS.verde), title: 'Tudo está ok!', mensagensHtml: 'Iniciação em andamento', blink: false },
        acoes: ['Aguarde a máquina atingir o estado operacional'],
        temp: dadosTemperatura(raw.temperatura),
        press: dadosPressao(raw.psi),
        overlay: null,
        soundKey: null,
      };
    }

    // ---------- Estado operacional normal: temperatura e pressão avaliadas
    // ---------- de forma independente, com o mesmo peso na decisão. ----------
    const temp = dadosTemperatura(raw.temperatura);
    const press = dadosPressao(raw.psi);
    const overallColor = corMaisGrave(temp.cor, press.cor);

    const mensagens = [];
    if (temp.cor !== COLORS.verde && temp.cor !== COLORS.cinza) mensagens.push('Verifique a temperatura.');
    if (press.cor !== COLORS.verde && press.cor !== COLORS.cinza) mensagens.push('Verifique a pressão pneumática.');

    let badge = '01 — Operação normal';
    let statusTitle = 'Em Operação';
    let statusSubtitle = 'Operando';
    let alertaTitle = 'Tudo está ok!';
    let alertaIcon = ICONS.shield;
    const acoes = [];

    if (overallColor === COLORS.vermelho) {
      badge = '03 — Alerta crítico';
      statusTitle = 'Em Alerta';
      statusSubtitle = 'Crítico';
      alertaTitle = 'Alerta Crítico';
      alertaIcon = ICONS.warning;
      acoes.push('Interromper o uso da máquina');
      acoes.push('Desligue a alimentação elétrica');
    } else if (overallColor === COLORS.amarelo) {
      badge = '02 — Alerta';
      statusSubtitle = 'Atenção';
      alertaTitle = 'Atenção Necessária';
      alertaIcon = ICONS.warning;
      if (temp.cor === COLORS.amarelo) acoes.push('Reduzir a carga de trabalho da máquina');
      if (press.cor === COLORS.amarelo) acoes.push('Verificar o sistema pneumático');
      acoes.push('Monitorar continuamente os sensores');
    }

    return {
      accent: overallColor,
      badge,
      ligada: true,
      metricas: metricasDe(raw),
      status: { ...iconePadrao(ICONS.gear, overallColor), title: statusTitle, titleColor: overallColor, subtitle: statusSubtitle },
      alerta: {
        ...iconePadrao(alertaIcon, overallColor),
        title: alertaTitle,
        mensagensHtml: mensagens.length ? mensagens.join('<br>') : '',
        blink: overallColor !== COLORS.verde,
      },
      acoes,
      temp,
      press,
      overlay: null,
      soundKey: overallColor === COLORS.vermelho ? 'critico' : (overallColor === COLORS.amarelo ? 'alerta' : null),
    };
  }

  function metricasDe(raw) {
    return {
      horas: formatarHoras(raw.tempo_operacao),
      cortes: (raw.contador_cortes != null) ? raw.contador_cortes : '—',
      eficiencia: (raw.eficiencia != null) ? `${raw.eficiencia}%` : '—',
    };
  }

  function dadosTemperatura(temperatura) {
    const info = classificarTemperatura(temperatura);
    return {
      cor: info.cor,
      legenda: info.legenda,
      percentual: calcularPercentual(temperatura, ESCALA_TEMPERATURA_MAX),
      valorTexto: (typeof temperatura === 'number' && !isNaN(temperatura)) ? `${temperatura}°C` : '--°C',
      blink: info.cor !== COLORS.verde && info.cor !== COLORS.cinza,
    };
  }

  function dadosPressao(psi) {
    const info = classificarPressao(psi);
    const bar = converterPsiParaBar(psi);
    return {
      cor: info.cor,
      legenda: info.legenda,
      percentual: calcularPercentual(psi, ESCALA_PRESSAO_MAX),
      valorBarTexto: bar != null ? bar.toFixed(2) : '—',
      valorPsiTexto: (typeof psi === 'number' && !isNaN(psi)) ? `${psi} psi` : '— psi',
      blink: info.cor !== COLORS.verde && info.cor !== COLORS.cinza,
    };
  }

  // ===================== ALERTA SONORO (aviso amarelo / sirene vermelha) =====================
  // Gerado via Web Audio API (sem arquivos externos). Início/fim controlados
  // pela cor mais grave do momento e pelo botão de megafone no card de Alerta.
  const AudioAlerts = (function () {
    let ctx = null;
    let intervalId = null;
    let pattern = null; // 'alerta' | 'critico' | null

    function getCtx() {
      if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
      if (ctx.state === 'suspended') ctx.resume();
      return ctx;
    }

    function tone(freq, duration, startAt, type, gainValue) {
      const c = getCtx();
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      gain.gain.value = gainValue;
      osc.connect(gain).connect(c.destination);
      osc.start(startAt);
      osc.stop(startAt + duration);
    }

    // Aviso de atenção (amarelo): dois bipes curtos, discretos.
    function playWarningOnce() {
      const c = getCtx();
      const now = c.currentTime;
      tone(880, 0.14, now, 'sine', 0.1);
      tone(880, 0.14, now + 0.22, 'sine', 0.1);
    }

    // Sirene (vermelho/crítico): dois tons alternados, um pouco mais intensos.
    function playCriticalOnce() {
      const c = getCtx();
      const now = c.currentTime;
      tone(660, 0.28, now, 'sawtooth', 0.09);
      tone(880, 0.28, now + 0.3, 'sawtooth', 0.09);
    }

    function start(newPattern) {
      if (pattern === newPattern && intervalId) return;
      stop();
      pattern = newPattern;
      const fn = newPattern === 'critico' ? playCriticalOnce : playWarningOnce;
      fn();
      intervalId = setInterval(fn, newPattern === 'critico' ? 2600 : 4200);
    }

    function stop() {
      if (intervalId) clearInterval(intervalId);
      intervalId = null;
      pattern = null;
    }

    return { start, stop, get current() { return pattern; } };
  })();

  let alarmMuted = false;
  let lastSoundKey = null;

  function updateAlarm(soundKey) {
    const muteBtn = document.getElementById('alertMuteBtn');
    const isAlertState = soundKey === 'alerta' || soundKey === 'critico';

    if (isAlertState) {
      if (muteBtn) muteBtn.classList.add('visible');
      // novo alerta (mudou de nível): reinicia o som mesmo se estava mudo antes
      if (soundKey !== lastSoundKey) alarmMuted = false;

      if (!alarmMuted) {
        AudioAlerts.start(soundKey);
      } else {
        AudioAlerts.stop();
      }
    } else {
      if (muteBtn) muteBtn.classList.remove('visible');
      AudioAlerts.stop();
      alarmMuted = false;
    }

    updateMuteButtonVisual();
    lastSoundKey = soundKey;
  }

  function updateMuteButtonVisual() {
    const muteBtn = document.getElementById('alertMuteBtn');
    if (!muteBtn) return;
    muteBtn.classList.toggle('muted', alarmMuted);
    muteBtn.title = alarmMuted ? 'Ativar alerta sonoro' : 'Silenciar alerta sonoro';
  }

  const alertMuteBtnEl = document.getElementById('alertMuteBtn');
  if (alertMuteBtnEl) {
    alertMuteBtnEl.addEventListener('click', () => {
      alarmMuted = !alarmMuted;
      if (alarmMuted) {
        AudioAlerts.stop();
      } else if (lastSoundKey === 'alerta' || lastSoundKey === 'critico') {
        AudioAlerts.start(lastSoundKey);
      }
      updateMuteButtonVisual();
    });
  }

  // ===================== RENDER =====================

  function aplicarIcone(circleEl, iconInfo) {
    if (!circleEl) return;
    circleEl.innerHTML = iconInfo.icon;
    circleEl.style.background = iconInfo.iconBg;
    circleEl.style.border = iconInfo.iconBorder !== 'transparent' ? `2px solid ${iconInfo.iconBorder}` : 'none';
    circleEl.style.color = iconInfo.iconColor;
  }

  function render(vm) {
    // Cor de destaque global do estado (badge, ícones das métricas, etc.)
    document.documentElement.style.setProperty('--accent', vm.accent);

    const stateBadge = document.getElementById('stateBadge');
    if (stateBadge) stateBadge.textContent = vm.badge;

    // Ícones de horas/cortes/eficiência acompanham a cor do estado ativo
    document.querySelectorAll('.metric-row svg').forEach((svg) => {
      svg.style.color = vm.accent;
    });

    const metricHoras = document.getElementById('metricHoras');
    if (metricHoras) metricHoras.textContent = vm.ligada ? vm.metricas.horas : '—';

    const metricCortes = document.getElementById('metricCortes');
    if (metricCortes) metricCortes.textContent = vm.ligada ? vm.metricas.cortes : '—';

    const metricEficiencia = document.getElementById('metricEficiencia');
    if (metricEficiencia) metricEficiencia.textContent = vm.ligada ? vm.metricas.eficiencia : '—';

    // Status (ícone + título) — o ícone de engrenagem nunca desaparece,
    // apenas a cor do círculo/borda muda conforme o estado.
    const statusTitle = document.getElementById('statusTitle');
    if (statusTitle) { statusTitle.textContent = vm.status.title; statusTitle.style.color = vm.status.titleColor; }

    const statusSubtitle = document.getElementById('statusSubtitle');
    if (statusSubtitle) statusSubtitle.textContent = vm.status.subtitle;

    aplicarIcone(document.getElementById('statusIconCircle'), vm.status);

    // Alerta: título/ícone refletem a cor mais grave entre temperatura e
    // pressão; a descrição lista TODAS as mensagens ativas simultaneamente.
    const alertaTitle = document.getElementById('alertaTitle');
    if (alertaTitle) alertaTitle.textContent = vm.alerta.title;

    const alertaDesc = document.getElementById('alertaDesc');
    if (alertaDesc) alertaDesc.innerHTML = vm.alerta.mensagensHtml;

    aplicarIcone(document.getElementById('alertaIconCircle'), vm.alerta);

    // Ações recomendadas
    const acoesList = document.getElementById('acoesList');
    if (acoesList) {
      acoesList.innerHTML = vm.acoes.length
        ? vm.acoes.map((a) => `<div class="acoes-item">${a}</div>`).join('')
        : '<div class="acoes-empty">Nenhuma ação necessária</div>';
    }

    // ---------- Temperatura (independente da pressão) ----------
    const tempValue = document.getElementById('tempValue');
    if (tempValue) {
      tempValue.textContent = vm.temp.valorTexto;
      tempValue.style.color = vm.temp.cor;
    }

    const tempThermo = document.getElementById('tempThermo');
    if (tempThermo) tempThermo.style.color = vm.temp.cor;

    const tempCaption = document.getElementById('tempCaption');
    if (tempCaption) {
      tempCaption.textContent = vm.temp.legenda;
      tempCaption.style.color = vm.temp.cor;
    }

    const tempFill = document.getElementById('tempFill');
    if (tempFill) { tempFill.style.width = vm.temp.percentual + '%'; tempFill.style.background = vm.temp.cor; }

    // ---------- Pressão (independente da temperatura) ----------
    const pressValue = document.getElementById('pressValue');
    if (pressValue) {
      pressValue.textContent = vm.press.valorBarTexto;
      pressValue.style.color = vm.press.cor;
    }

    const pressUnit = document.getElementById('pressUnit');
    if (pressUnit) pressUnit.style.color = vm.press.cor;

    const pressPsi = document.getElementById('pressPsi');
    if (pressPsi) pressPsi.textContent = vm.press.valorPsiTexto;

    const pressCaption = document.getElementById('pressCaption');
    if (pressCaption) {
      pressCaption.textContent = vm.press.legenda;
      pressCaption.style.color = vm.press.cor;
    }

    const pressFill = document.getElementById('pressFill');
    if (pressFill) { pressFill.style.width = vm.press.percentual + '%'; pressFill.style.background = vm.press.cor; }

    const gaugeNeedle = document.getElementById('gaugeNeedle');
    if (gaugeNeedle) {
      const angulo = -90 + (vm.press.percentual / 100) * 180;
      gaugeNeedle.setAttribute('transform', `rotate(${angulo} 39 40)`);
    }

    // Piscar (amarelo/vermelho): cada card pisca de acordo com o próprio
    // estado — temperatura e pressão nunca dependem uma da outra.
    [alertaTitle, document.getElementById('alertaIconCircle')].forEach((el) => {
      if (el) el.classList.toggle('blinking', vm.alerta.blink);
    });
    [tempValue, tempCaption].forEach((el) => {
      if (el) el.classList.toggle('blinking', vm.temp.blink);
    });
    [pressValue, pressPsi, pressCaption].forEach((el) => {
      if (el) el.classList.toggle('blinking', vm.press.blink);
    });

    // Alerta sonoro (aviso amarelo / sirene vermelha), com botão de silenciar
    updateAlarm(vm.soundKey);

    // Overlay de manutenção
    const overlay = document.getElementById('maintenanceOverlay');
    if (overlay) {
      if (vm.overlay) {
        overlay.classList.add('active');
        const t = document.getElementById('maintenanceTitle');
        const d = document.getElementById('maintenanceDesc');
        if (t) t.textContent = vm.overlay.titulo;
        if (d) d.innerHTML = vm.overlay.desc;
      } else {
        overlay.classList.remove('active');
      }
    }
  }

  // ===================== FLUXO PRINCIPAL =====================

  function handleRawData(raw) {
    console.log('Atualização:', raw);
    const vm = buildViewModel(raw);
    render(vm);
  }

  // snapshot inicial via /status (assim a tela já nasce preenchida,
  // sem esperar o primeiro evento do SSE chegar)
  fetch(CONFIG.API_URL)
    .then((resp) => resp.json())
    .then(handleRawData)
    .catch((err) => console.error('Erro ao buscar /status:', err));

  // conexão em tempo real, no mesmo padrão do script.js que já funcionou:
  const eventos = new EventSource(CONFIG.STREAM_URL);

  eventos.onmessage = (event) => {
    const dados = JSON.parse(event.data);
    handleRawData(dados);
  };

  eventos.onerror = (err) => {
    console.error('Erro na conexão SSE (o navegador tenta reconectar sozinho):', err);
  };

})();

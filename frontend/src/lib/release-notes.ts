export interface ReleaseNote {
  version: string
  date: string
  title: string
  type: 'Sistema' | 'APK' | 'Sistema + APK'
  /** Itens agrupados por seção. Se só tem uma seção, use apenas systemItems ou apkItems. */
  systemItems?: string[]
  apkItems?: string[]
  /** APK versionName + versionCode quando houver nova versão do agente */
  apkVersion?: string
}

/**
 * Release notes exibidos no popup "Novidades" ao logar no dashboard.
 * Adicione novas versões no TOPO do array.
 * O popup aparece quando a versão mais recente (índice 0) for diferente
 * da última versão vista pelo usuário (salva em localStorage).
 *
 * Padrão obrigatório dos itens:
 *   - "Novo: ..."       (✦) — funcionalidade nova
 *   - "Corrigido: ..."  (✓) — bug fix
 *   - "Melhoria: ..."   (•) — melhoria em funcionalidade existente
 */
export const releaseNotes: ReleaseNote[] = [
  {
    version: '0.18.2',
    date: '2026-05-18',
    title: 'Acesso Remoto — Funciona com Tela Bloqueada',
    type: 'APK',
    apkItems: [
      'Corrigido: Acesso remoto ficava em loading infinito se a tela do celular estivesse desligada — agora liga a tela automaticamente antes de iniciar a captura',
      'Corrigido: Tela H.264 voltava ao loading após aprovar permissão com celular bloqueado — keyguard é desabilitado durante a sessão remota (Device Owner) e reabilitado ao encerrar',
      'Melhoria: Dialog de permissão do MediaProjection agora aparece sobre a tela de bloqueio sem necessidade de desbloquear manualmente',
    ],
  },
  {
    version: '0.18.1',
    date: '2026-05-18',
    title: 'Correção — Sessão Remota não Fechava com Celular Bloqueado',
    type: 'Sistema',
    systemItems: [
      'Corrigido: Fechar sessão remota agora é idempotente — não falha se sessão já foi fechada pelo gateway',
      'Corrigido: Sessões ACTIVE orfãs (device desconectou) são auto-fechadas após 5 minutos',
    ],
  },
  {
    version: '0.18.0',
    date: '2026-05-18',
    title: 'Acesso Remoto — Sessao Gerenciada + Tela Cheia',
    type: 'Sistema',
    systemItems: [
      'Corrigido: Sessao remota ficava ativa ao navegar para outra pagina — agora fecha automaticamente ao sair',
      'Corrigido: Sessoes PENDING que nunca conectam sao auto-fechadas apos 30 segundos',
      'Novo: Botao muda de estado — "Acesso Remoto" vira "Encerrar Acesso Remoto" (vermelho) quando ativo',
      'Novo: Botao de tela cheia no viewer remoto',
      'Novo: Confirmacao antes de encerrar o acesso remoto',
      'Melhoria: Feedback de erros ao fechar sessao (log em vez de erro silencioso)',
    ],
  },
  {
    version: '0.17.2',
    date: '2026-05-18',
    title: 'Correção do Acesso Remoto — Tela Congelada após Permissão',
    type: 'Sistema + APK',
    systemItems: [
      'Corrigido: Tela do acesso remoto congelava após aprovar permissão de gravação — decoder H.264 não recebia dados no formato correto',
      'Corrigido: Conversão Annex B → AVC — MediaCodec emite start codes, WebCodecs espera length-prefixed NALUs + AVCDecoderConfigurationRecord',
      'Melhoria: Codec string derivado automaticamente do SPS do encoder (suporta Baseline, Main e High profile)',
      'Melhoria: Frontend cacheia config H.264 que chega antes do decoder estar pronto (safety net para chipsets rápidos)',
    ],
    apkItems: [
      'Corrigido: MediaProjection.registerCallback() obrigatório no Android 14+ — sem ele createVirtualDisplay() falhava silenciosamente e a pipeline H.264 nunca iniciava',
      'Corrigido: Fallback para JPEG se pipeline H.264 falhar — evita tela preta',
      'Melhoria: stream_upgrade enviado somente após pipeline H.264 iniciar com sucesso',
    ],
  },
  {
    version: '0.17.0',
    date: '2026-05-13',
    title: 'Acesso Remoto — Streaming H.264 em Tempo Real',
    type: 'Sistema + APK',
    systemItems: [
      'Novo: Streaming H.264 em tempo real via hardware encoder — de 2 FPS (screenshots) para 20 FPS (vídeo)',
      'Novo: Badge de modo no viewer (JPEG / H.264) com indicador de FPS em tempo real',
      'Novo: Cache de keyframe no backend — novos viewers conectam e veem a tela instantaneamente',
      'Melhoria: Modo JPEG otimizado como fallback — intervalo de 500ms reduzido para 150ms (~6 FPS), resolução escalada para 720p',
      'Melhoria: Frontend usa WebCodecs VideoDecoder para decodificação H.264 nativa no browser',
    ],
    apkItems: [
      'Novo: Pipeline MediaProjection + MediaCodec — captura e encoding por hardware (H.264 Baseline, 1.5 Mbps, 20 FPS)',
      'Novo: Upgrade automático de JPEG para H.264 — admin aprova permissão de gravação remotamente pelo viewer',
      'Novo: Suporte a request_keyframe — viewers que entram tarde recebem frame instantâneo',
      'Corrigido: Taps na tela do acesso remoto não funcionavam — faltava canPerformGestures na config do serviço de acessibilidade',
      'Melhoria: Logging de resultado de tap/swipe para diagnóstico em produção',
    ],
  },
  {
    version: '0.16.0',
    date: '2026-05-13',
    title: 'Acesso Remoto — Visualização de Tela + Controle',
    type: 'Sistema + APK',
    systemItems: [
      'Novo: Viewer de acesso remoto com visualização da tela do dispositivo em tempo real',
      'Novo: Controle remoto — tap, swipe e botões de navegação (voltar, home, recentes)',
      'Novo: Gateway WebSocket para relay bidirecional device ↔ viewer',
    ],
    apkItems: [
      'Novo: Captura de tela via AccessibilityService com envio por WebSocket',
      'Novo: Injeção de gestos remotos (tap, swipe) via dispatchGesture',
      'Novo: Ações globais remotas (back, home, recents) via performGlobalAction',
    ],
  },
  {
    version: '0.15.0',
    date: '2026-05-12',
    title: 'Bloqueio de Restauração de Fábrica + Wipe Seletivo',
    type: 'Sistema + APK',
    apkVersion: '2.8.6 (build 73)',
    systemItems: [
      'Novo: Botão "Limpar Dispositivo (Wipe)" na página do device — exige senha do administrador para confirmar',
      'Novo: Toggle "Bloquear Restauração de Fábrica" no editor de políticas (seção Segurança)',
      'Novo: Popup "Novidades" ao logar no dashboard com histórico de atualizações',
      'Novo: Botão "Atualizações" no menu lateral para consultar novidades a qualquer momento',
      'Corrigido: Mapa não sobrepõe mais o popup de novidades ao carregar o dashboard',
    ],
    apkItems: [
      'Novo: Bloqueio de restauração de fábrica — impede o usuário de restaurar o dispositivo (DISALLOW_FACTORY_RESET + DISALLOW_SAFE_BOOT)',
      'Novo: Proteção aplicada automaticamente ao iniciar o agente, antes mesmo de receber a política',
      'Melhoria: Wipe seletivo — limpa dados de apps, contas e arquivos sem remover o E.Guardian do dispositivo',
      'Corrigido: Dispositivo permanece online continuamente enquanto tiver rede — proteção contra otimização de bateria e restart automático do serviço',
      'Corrigido: Device Owner roda em segundo plano sem pedir permissão — restart automático em 5 camadas, compatível com Android 8.1 a 16',
    ],
  },
  {
    version: '0.14.6',
    date: '2026-04-15',
    title: 'Correção de Login Admin no Dispositivo',
    type: 'Sistema',
    systemItems: [
      'Corrigido: Usuários admin (T.I.) agora recebem corretamente o bypass de restrições ao fazer login online no dispositivo',
    ],
  },
  {
    version: '0.14.5',
    date: '2026-04-15',
    title: 'Restauração de Política após Logout Admin',
    type: 'APK',
    apkVersion: '2.7.3 (build 66)',
    apkItems: [
      'Corrigido: Política completa (câmera, USB, screenshots, etc.) agora é re-aplicada corretamente após logout do usuário admin T.I.',
      'Melhoria: Regras da política persistem no dispositivo para restauração automática',
    ],
  },
  {
    version: '0.14.4',
    date: '2026-04-15',
    title: 'Timeout de Inatividade — Android 14+',
    type: 'APK',
    apkVersion: '2.7.2 (build 65)',
    apkItems: [
      'Corrigido: Timeout de inatividade não dispara mais ao navegar fora do E.Guardian em Android 14+',
    ],
  },
  {
    version: '0.14.3',
    date: '2026-04-15',
    title: 'Correção de Timeout de Inatividade',
    type: 'APK',
    apkVersion: '2.7.0 (build 63)',
    apkItems: [
      'Corrigido: Timer de inatividade agora detecta toque real em vez de "tela ligada"',
    ],
  },
]

export const CURRENT_VERSION = releaseNotes[0]?.version ?? '0.0.0'

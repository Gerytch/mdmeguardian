export interface ReleaseNote {
  version: string
  date: string
  title: string
  type: 'Sistema' | 'APK' | 'Sistema + APK'
  items: string[]
}

/**
 * Release notes exibidos no popup "Novidades" ao logar no dashboard.
 * Adicione novas versões no TOPO do array.
 * O popup aparece quando a versão mais recente (índice 0) for diferente
 * da última versão vista pelo usuário (salva em localStorage).
 */
export const releaseNotes: ReleaseNote[] = [
  {
    version: '0.15.0',
    date: '2026-05-12',
    title: 'Bloqueio de Restauração de Fábrica + Wipe Remoto',
    type: 'Sistema + APK',
    items: [
      'Novo: Bloqueio de restauração de fábrica — impede que o usuário restaure o dispositivo para padrão de fábrica (ativado por padrão na política)',
      'Novo: Botão "Limpar Dispositivo (Wipe)" na página do device — exige senha do administrador para confirmar',
      'Novo: Toggle "Bloquear Restauração de Fábrica" no editor de políticas (seção Segurança)',
      'Segurança: Proteção aplicada automaticamente ao iniciar o agente, antes mesmo de receber a política',
    ],
  },
  {
    version: '0.14.6',
    date: '2026-04-15',
    title: 'Correção de Login Admin no Dispositivo',
    type: 'Sistema',
    items: [
      'Corrigido: Usuários admin (T.I.) agora recebem corretamente o bypass de restrições ao fazer login online no dispositivo',
    ],
  },
  {
    version: '0.14.5',
    date: '2026-04-15',
    title: 'Restauração de Política após Logout Admin',
    type: 'APK',
    items: [
      'Corrigido: Política completa (câmera, USB, screenshots, etc.) agora é re-aplicada corretamente após logout do usuário admin T.I.',
      'Melhoria: Regras da política persistem no dispositivo para restauração automática',
    ],
  },
  {
    version: '0.14.4',
    date: '2026-04-15',
    title: 'Timeout de Inatividade — Android 14+',
    type: 'APK',
    items: [
      'Corrigido: Timeout de inatividade não dispara mais ao navegar fora do E.Guardian em Android 14+',
    ],
  },
  {
    version: '0.14.3',
    date: '2026-04-15',
    title: 'Correção de Timeout de Inatividade',
    type: 'APK',
    items: [
      'Corrigido: Timer de inatividade agora detecta toque real em vez de "tela ligada"',
    ],
  },
]

export const CURRENT_VERSION = releaseNotes[0]?.version ?? '0.0.0'

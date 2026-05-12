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
    version: '0.15.0',
    date: '2026-05-12',
    title: 'Bloqueio de Restauração de Fábrica + Wipe Seletivo',
    type: 'Sistema + APK',
    apkVersion: '2.8.1 (build 68)',
    systemItems: [
      'Novo: Botão "Limpar Dispositivo (Wipe)" na página do device — exige senha do administrador para confirmar',
      'Novo: Toggle "Bloquear Restauração de Fábrica" no editor de políticas (seção Segurança)',
      'Novo: Popup "Novidades" ao logar no dashboard com histórico de atualizações',
    ],
    apkItems: [
      'Novo: Bloqueio de restauração de fábrica — impede o usuário de restaurar o dispositivo (DISALLOW_FACTORY_RESET + DISALLOW_SAFE_BOOT)',
      'Novo: Proteção aplicada automaticamente ao iniciar o agente, antes mesmo de receber a política',
      'Melhoria: Wipe seletivo — limpa dados de apps, contas e arquivos sem remover o E.Guardian do dispositivo',
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

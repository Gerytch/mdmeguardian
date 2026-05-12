'use client'

import { useEffect, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { devicesApi } from '@/lib/api'
import { getTenantId } from '@/lib/auth'
import { Device, Command } from '@/types'
import { formatDistanceToNow, format } from 'date-fns'

const ADMIN_LOCK_TEMPLATES = [
  'Leve este dispositivo ao setor de TI',
  'Dispositivo em manutenção — entre em contato com o TI',
  'Ativo em revisão de segurança — dirija-se à recepção do TI',
  'Dispositivo bloqueado por política da empresa',
  'Este dispositivo precisa de atualização obrigatória — leve ao TI',
]

type Severity = 'info' | 'warning' | 'critical'
type KioskMode = 'whitelist' | 'blacklist'

interface AppInfo { packageName: string; label: string }

const severityConfig: Record<Severity, { label: string; color: string; bg: string }> = {
  info:     { label: 'Info',     color: 'text-blue-700',  bg: 'bg-blue-50 border-blue-200' },
  warning:  { label: 'Aviso',   color: 'text-amber-700', bg: 'bg-amber-50 border-amber-200' },
  critical: { label: 'Crítico', color: 'text-red-700',   bg: 'bg-red-50 border-red-200' },
}

export default function DeviceDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [device, setDevice]   = useState<Device | null>(null)
  const [commands, setCommands] = useState<Command[]>([])
  const [loading, setLoading]   = useState(true)
  const [sending, setSending]   = useState<string | null>(null)
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const pollRef    = useRef<ReturnType<typeof setInterval> | null>(null)
  const execRef    = useRef<ReturnType<typeof setInterval> | null>(null)

  // Admin Lock execution progress popup
  const [lockExec, setLockExec] = useState<{
    type: 'ADMIN_LOCK' | 'ADMIN_UNLOCK'
    commandId: string
    status: 'waiting' | 'done' | 'failed'
    elapsed: number
  } | null>(null)
  const execStartRef = useRef<number>(0)

  // Admin Lock modal state
  const [showAdminLock, setShowAdminLock]   = useState(false)
  const [showSendMsg, setShowSendMsg]       = useState(false)
  const [adminMessage, setAdminMessage]     = useState(ADMIN_LOCK_TEMPLATES[0])
  const [adminContact, setAdminContact]     = useState('')
  const [adminSeverity, setAdminSeverity]   = useState<Severity>('warning')
  const [msgTitle, setMsgTitle]   = useState('Mensagem do TI')
  const [msgBody, setMsgBody]     = useState('')

  // Network Test modal state
  const [showNetworkTest, setShowNetworkTest] = useState(false)
  const [netTestCmdId, setNetTestCmdId]       = useState<string | null>(null)
  const [netTestProgress, setNetTestProgress] = useState(0)
  const [netTestMessage, setNetTestMessage]   = useState('')
  const [netTestScreenshot, setNetTestScreenshot] = useState<string | null>(null)
  const [netTestDone, setNetTestDone]         = useState(false)
  const [netTestWifi, setNetTestWifi]         = useState<any[]>([])
  const [netTestConnected, setNetTestConnected] = useState<any | null>(null)
  const [netTestDownloadMbps, setNetTestDownloadMbps] = useState<number | null>(null)

  // Update Agent modal state
  const [showUpdateAgent, setShowUpdateAgent] = useState(false)
  const [agentApkUrl, setAgentApkUrl]         = useState('')
  const [agentVersion, setAgentVersion]       = useState('')

  // Wipe device modal state
  const [showWipe, setShowWipe]       = useState(false)
  const [wipePassword, setWipePassword] = useState('')
  const [wipeSending, setWipeSending] = useState(false)
  const [wipeError, setWipeError]     = useState('')

  // Rename device modal state
  const [showRename, setShowRename]   = useState(false)
  const [renameValue, setRenameValue] = useState('')
  const [renaming, setRenaming]       = useState(false)

  // Delete device modal state
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleting, setDeleting] = useState(false)

  // Kiosk / App Manager modal state
  const [showKiosk, setShowKiosk]         = useState(false)
  const [kioskEnabled, setKioskEnabled]   = useState(false)  // toggle inside modal
  const [kioskMode, setKioskMode]         = useState<KioskMode>('whitelist')
  const [appList, setAppList]             = useState<AppInfo[]>([])
  const [selectedApps, setSelectedApps]   = useState<Set<string>>(new Set())
  const [appSearch, setAppSearch]         = useState('')
  const [fetchingApps, setFetchingApps]   = useState(false)

  const tenantId = getTenantId()

  const load = () => {
    if (!tenantId || !id) return
    Promise.all([
      devicesApi.get(tenantId, id as string),
      devicesApi.commands(tenantId, id as string),
    ]).then(([d, c]) => {
      setDevice(d.data)
      setCommands(c.data)
    }).finally(() => setLoading(false))
  }

  useEffect(load, [id])

  // Auto-refresh command statuses while any command is PENDING/SENT
  useEffect(() => {
    const hasPending = commands.some(c => c.status === 'PENDING' || c.status === 'SENT')
    if (hasPending) {
      if (!pollRef.current) {
        pollRef.current = setInterval(() => {
          if (!tenantId || !id) return
          devicesApi.commands(tenantId, id as string).then(r => setCommands(r.data))
        }, 3000)
      }
    } else {
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
    }
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
    }
  }, [commands])

  // Separate cleanup for the lock-exec interval — must NOT be inside the
  // commands effect or it will be cancelled on every commands state update.
  useEffect(() => {
    return () => {
      if (execRef.current) {
        clearInterval(execRef.current)
        execRef.current = null
      }
    }
  }, [])

  const sendCmd = async (type: string, payload?: Record<string, any>) => {
    if (!device) return
    setSending(type)
    setMsg(null)
    try {
      await devicesApi.sendCommand(tenantId, device.id, type, payload)
      setMsg({ type: 'success', text: `Comando ${type} enviado com sucesso` })
      setTimeout(load, 800)
    } catch (err: any) {
      const m = err.response?.data?.message
      setMsg({ type: 'error', text: Array.isArray(m) ? m.join(', ') : m || 'Falha ao enviar comando' })
    } finally {
      setSending(null)
    }
  }

  const watchLockExec = (type: 'ADMIN_LOCK' | 'ADMIN_UNLOCK', commandId: string) => {
    execStartRef.current = Date.now()
    setLockExec({ type, commandId, status: 'waiting', elapsed: 0 })

    execRef.current = setInterval(async () => {
      const elapsed = Math.floor((Date.now() - execStartRef.current) / 1000)
      setLockExec(prev => prev ? { ...prev, elapsed } : prev)

      try {
        const res = await devicesApi.commands(tenantId, id as string)
        const cmd = (res.data as Command[]).find((c: Command) => c.id === commandId)
        if (cmd?.status === 'EXECUTED') {
          clearInterval(execRef.current!); execRef.current = null
          setLockExec(prev => prev ? { ...prev, status: 'done', elapsed } : prev)
          setTimeout(() => { setLockExec(null); load() }, 1800)
        } else if (cmd?.status === 'FAILED') {
          clearInterval(execRef.current!); execRef.current = null
          setLockExec(prev => prev ? { ...prev, status: 'failed', elapsed } : prev)
          setTimeout(() => { setLockExec(null); load() }, 2500)
        }
      } catch { /* ignore polling errors */ }
    }, 2000)
  }

  const handleAdminLock = async () => {
    setShowAdminLock(false)
    setSending('ADMIN_LOCK')
    setMsg(null)
    try {
      const res = await devicesApi.sendCommand(tenantId, device!.id, 'ADMIN_LOCK', {
        message: adminMessage,
        contact: adminContact || undefined,
        severity: adminSeverity,
      })
      watchLockExec('ADMIN_LOCK', res.data.id)
    } catch (err: any) {
      const m = err.response?.data?.message
      setMsg({ type: 'error', text: Array.isArray(m) ? m.join(', ') : m || 'Falha ao enviar comando' })
    } finally {
      setSending(null)
    }
  }

  const handleAdminUnlock = async () => {
    setSending('ADMIN_UNLOCK')
    setMsg(null)
    try {
      const res = await devicesApi.sendCommand(tenantId, device!.id, 'ADMIN_UNLOCK', {})
      watchLockExec('ADMIN_UNLOCK', res.data.id)
    } catch (err: any) {
      const m = err.response?.data?.message
      setMsg({ type: 'error', text: Array.isArray(m) ? m.join(', ') : m || 'Falha ao enviar comando' })
    } finally {
      setSending(null)
    }
  }

  const handleSendMessage = async () => {
    await sendCmd('SEND_MESSAGE', { title: msgTitle, message: msgBody })
    setShowSendMsg(false)
    setMsgBody('')
  }

  const fetchApps = async () => {
    setFetchingApps(true)
    setAppList([])
    setSelectedApps(new Set())
    let poll: ReturnType<typeof setInterval> | null = null
    let timeout: ReturnType<typeof setTimeout> | null = null

    const stop = (apps: AppInfo[] = []) => {
      if (poll) clearInterval(poll)
      if (timeout) clearTimeout(timeout)
      setAppList(apps)
      if (apps.length > 0 && device?.kioskApps?.length) {
        const authorized = new Set(device.kioskApps)
        setSelectedApps(new Set(apps.map(a => a.packageName).filter(p => authorized.has(p))))
      }
      setFetchingApps(false)
    }

    try {
      const res = await devicesApi.sendCommand(tenantId, device!.id, 'GET_APPS')
      const cmdId = res.data?.id
      if (!cmdId) { stop(); return }

      // Timeout após 30s
      timeout = setTimeout(() => stop(), 30_000)

      poll = setInterval(async () => {
        try {
          const cmds = await devicesApi.commands(tenantId, id as string)
          setCommands(cmds.data)
          const cmd = (cmds.data as Command[]).find((c: Command) => c.id === cmdId)
          if (cmd?.status === 'EXECUTED') {
            stop(cmd.result?.apps ?? [])
          } else if (cmd?.status === 'FAILED') {
            stop()
          }
        } catch { /* ignore poll errors */ }
      }, 2000)
    } catch {
      stop()
    }
  }

  const handleEnableKiosk = async () => {
    await sendCmd('ENABLE_KIOSK', { apps: Array.from(selectedApps), mode: kioskMode })
    setShowKiosk(false)
  }

  const runNetworkTest = async () => {
    if (!device) return
    setShowNetworkTest(true)
    setNetTestProgress(0)
    setNetTestMessage('Enviando comando...')
    setNetTestScreenshot(null)
    setNetTestDone(false)
    setNetTestCmdId(null)
    setNetTestWifi([])
    setNetTestConnected(null)

    let poll: ReturnType<typeof setInterval> | null = null
    let timeout: ReturnType<typeof setTimeout> | null = null

    const stop = () => {
      if (poll) clearInterval(poll)
      if (timeout) clearTimeout(timeout)
      setNetTestDone(true)
    }

    try {
      const res = await devicesApi.sendCommand(tenantId, device.id, 'NETWORK_TEST')
      const cmdId = res.data?.id
      if (!cmdId) { setNetTestMessage('Falha ao enviar comando'); stop(); return }
      setNetTestCmdId(cmdId)
      setNetTestMessage('Aguardando dispositivo...')

      // Timeout de 60 segundos
      timeout = setTimeout(() => {
        setNetTestMessage('Tempo esgotado')
        stop()
      }, 60_000)

      poll = setInterval(async () => {
        try {
          const cmds = await devicesApi.commands(tenantId, id as string)
          setCommands(cmds.data)
          const cmd = (cmds.data as Command[]).find((c: Command) => c.id === cmdId)
          if (!cmd) return
          const r = cmd.result ?? {}
          if (r.progress) setNetTestProgress(r.progress as number)
          if (r.message)  setNetTestMessage(r.message as string)
          if (r.screenshotUrl)    setNetTestScreenshot(r.screenshotUrl as string)
          if (r.wifiNetworks)     setNetTestWifi(r.wifiNetworks as any[])
          if (r.connectedNetwork) setNetTestConnected(r.connectedNetwork)
          if (r.downloadMbps != null) setNetTestDownloadMbps(r.downloadMbps as number)
          if (cmd.status === 'EXECUTED' || cmd.status === 'FAILED') stop()
        } catch { /* ignore */ }
      }, 2000)
    } catch {
      setNetTestMessage('Erro ao enviar comando')
      stop()
    }
  }

  const toggleApp = (pkg: string) => {
    setSelectedApps(prev => {
      const next = new Set(prev)
      next.has(pkg) ? next.delete(pkg) : next.add(pkg)
      return next
    })
  }

  const cmdStyle = (type: string) => {
    if (type === 'ADMIN_LOCK') return 'border-amber-200 text-amber-800 hover:bg-amber-50'
    if (type === 'WIPE') return 'border-red-100 text-gray-700 hover:bg-red-50 hover:text-red-700'
    return 'border-gray-100 text-gray-700 hover:bg-primary-50 hover:text-primary-700'
  }

  // Derive admin lock active state from command history (no new state needed)
  const isAdminLocked = (() => {
    const executed = commands.filter(c => c.status === 'EXECUTED')
    const lastLock   = executed.filter(c => (c.type as string) === 'ADMIN_LOCK').sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0]
    const lastUnlock = executed.filter(c => (c.type as string) === 'ADMIN_UNLOCK').sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0]
    if (!lastLock) return false
    if (!lastUnlock) return true
    return new Date(lastLock.createdAt).getTime() > new Date(lastUnlock.createdAt).getTime()
  })()

  const handleRename = async () => {
    if (!device || !renameValue.trim() || renameValue.trim() === device.name) return
    setRenaming(true)
    try {
      const updated = await devicesApi.update(tenantId, device.id, { name: renameValue.trim() })
      setDevice(updated.data)
      setShowRename(false)
      setMsg({ type: 'success', text: 'Nome atualizado — comando RENAME_DEVICE despachado ao dispositivo.' })
    } catch {
      setMsg({ type: 'error', text: 'Erro ao renomear o dispositivo.' })
    } finally {
      setRenaming(false)
    }
  }

  const handleDelete = async () => {
    if (!device) return
    setDeleting(true)
    try {
      await devicesApi.delete(tenantId, device.id)
      router.push('/devices')
    } catch {
      setMsg({ type: 'error', text: 'Erro ao remover o dispositivo.' })
      setShowDeleteConfirm(false)
    } finally {
      setDeleting(false)
    }
  }

  if (loading) return (
    <div className="flex items-center justify-center h-full py-32">
      <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-600" />
    </div>
  )

  if (!device) return (
    <div className="p-8 text-center text-gray-500">Dispositivo não encontrado</div>
  )

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center gap-4 mb-8">
        <button onClick={() => router.push('/devices')} className="text-gray-400 hover:text-gray-600">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-gray-900">{device.name}</h1>
            <button
              onClick={() => { setRenameValue(device.name); setShowRename(true) }}
              className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-gray-500 border border-gray-300 rounded-md hover:bg-gray-100 hover:text-gray-700 transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536M9 13l6.586-6.586a2 2 0 012.828 0l.172.172a2 2 0 010 2.828L12 16H9v-3z" />
              </svg>
              Renomear
            </button>
          </div>
          <div className="flex items-center gap-2 mt-1">
            <div className={`w-2 h-2 rounded-full ${device.isOnline ? 'bg-green-500' : 'bg-gray-300'}`} />
            <span className="text-sm text-gray-500">{device.isOnline ? 'Online' : 'Offline'}</span>
          </div>
        </div>
        <button
          onClick={() => setShowDeleteConfirm(true)}
          className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-red-600 border border-red-200 rounded-lg hover:bg-red-50 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
          Remover
        </button>
      </div>

      {/* Rename device modal */}
      {showRename && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm mx-4">
            <h3 className="text-lg font-bold text-gray-900 mb-4">Renomear dispositivo</h3>
            <input
              autoFocus
              type="text"
              value={renameValue}
              onChange={e => setRenameValue(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleRename(); if (e.key === 'Escape') setShowRename(false) }}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-primary-500"
              placeholder="Nome do dispositivo"
            />
            <p className="text-xs text-gray-400 mb-4">O novo nome será sincronizado com o dispositivo via comando RENAME_DEVICE.</p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowRename(false)}
                disabled={renaming}
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={handleRename}
                disabled={renaming || !renameValue.trim() || renameValue.trim() === device.name}
                className="flex-1 px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium rounded-lg disabled:opacity-50"
              >
                {renaming ? 'Salvando...' : 'Salvar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm mx-4">
            <h3 className="text-lg font-bold text-gray-900 mb-2">Remover dispositivo?</h3>
            <p className="text-sm text-gray-500 mb-1">
              O app E.Guardian será <span className="font-semibold text-red-600">desinstalado</span> do dispositivo e todos os dados do MDM serão removidos.
            </p>
            <p className="text-xs text-gray-400 mb-6">Esta ação não pode ser desfeita.</p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                disabled={deleting}
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded-lg disabled:opacity-50"
              >
                {deleting ? 'Removendo...' : 'Remover'}
              </button>
            </div>
          </div>
        </div>
      )}

      {msg && (
        <div className={`mb-6 p-3 rounded-lg text-sm ${msg.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
          {msg.text}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        {/* Device info */}
        <div className="lg:col-span-2 bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <h2 className="font-semibold text-gray-900 mb-4">Informações do Dispositivo</h2>
          <dl className="grid grid-cols-2 gap-4">
            {[
              ['Serial', device.serialNumber],
              ['Fabricante', device.manufacturer || '—'],
              ['Modelo', device.model || '—'],
              ['Android', device.androidVersion || '—'],
              ['Agente', device.agentVersion || '—'],
              ['IMEI 1', device.imei || '—'],
              ['IMEI 2', device.imei2 || '—'],
              ['Bateria', device.batteryLevel != null ? `${device.batteryLevel}%` : '—'],
              ['Status', device.status],
              ['Kiosk', device.isKioskMode ? 'Ativado' : 'Desativado'],
              ['Enrollment', device.enrollmentDate ? format(new Date(device.enrollmentDate), 'dd/MM/yyyy') : '—'],
              ['Última vez visto', device.lastSeenAt ? formatDistanceToNow(new Date(device.lastSeenAt), { addSuffix: true }) : '—'],
            ].map(([label, value]) => (
              <div key={label}>
                <dt className="text-xs text-gray-400 font-medium">{label}</dt>
                <dd className="text-sm text-gray-900 mt-0.5">{value}</dd>
              </div>
            ))}
          </dl>
        </div>

        {/* Commands panel */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <h2 className="font-semibold text-gray-900 mb-4">Ações</h2>

          {/* Status banners — mostrar apenas quando o estado está ativo */}
          {(isAdminLocked || device.isKioskMode) && (
            <div className="mb-4 space-y-2">
              {isAdminLocked && (
                <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg border border-amber-300 bg-amber-50 text-amber-800 text-sm font-medium">
                  <span>🔒</span>
                  <span>Admin Lock ativo neste dispositivo</span>
                </div>
              )}
              {device.isKioskMode && (
                <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg border border-purple-300 bg-purple-50 text-purple-800 text-sm font-medium">
                  <span>📱</span>
                  <span>Modo Kiosk ativo neste dispositivo</span>
                </div>
              )}
            </div>
          )}

          <div className="space-y-4">

            {/* ── Seção: Bloqueio ── */}
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Bloqueio</p>
              <div className="space-y-2">

                {/* Admin Lock — sempre disponível para aplicar/reaplicar */}
                <button
                  onClick={() => setShowAdminLock(true)}
                  disabled={!!sending}
                  className={`w-full text-left px-3 py-2.5 rounded-lg text-sm font-medium transition-colors flex items-center justify-between border disabled:opacity-50 ${
                    isAdminLocked
                      ? 'border-amber-400 bg-amber-100 text-amber-900 hover:bg-amber-200'
                      : 'border-amber-200 text-amber-800 hover:bg-amber-50'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    🔒 {isAdminLocked ? 'Atualizar Admin Lock' : 'Aplicar Admin Lock'}
                    {isAdminLocked && <span className="text-xs font-semibold bg-amber-500 text-white px-1.5 py-0.5 rounded">ATIVO</span>}
                  </span>
                  <svg className="w-4 h-4 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>

                {/* Liberar Admin Lock — somente quando bloqueado */}
                {isAdminLocked && (
                  <button
                    onClick={handleAdminUnlock}
                    disabled={!!sending}
                    className="w-full text-left px-3 py-2.5 rounded-lg text-sm font-medium transition-colors flex items-center justify-between border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                  >
                    {sending === 'ADMIN_UNLOCK'
                      ? <span className="flex items-center gap-2"><div className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin" />Enviando...</span>
                      : <span>🔓 Liberar Admin Lock</span>}
                    {sending !== 'ADMIN_UNLOCK' && <svg className="w-4 h-4 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>}
                  </button>
                )}
              </div>
            </div>

            {/* ── Seção: Kiosk ── */}
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Kiosk</p>
              <div className="space-y-2">
                <button
                  onClick={() => { setKioskEnabled(device.isKioskMode); setShowKiosk(true) }}
                  disabled={!!sending}
                  className={`w-full text-left px-3 py-2.5 rounded-lg text-sm font-medium transition-colors flex items-center justify-between border disabled:opacity-50 ${
                    device.isKioskMode
                      ? 'border-purple-400 bg-purple-100 text-purple-900 hover:bg-purple-200'
                      : 'border-purple-200 text-purple-800 hover:bg-purple-50'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    📱 Kiosk
                    {device.isKioskMode && <span className="text-xs font-semibold bg-purple-500 text-white px-1.5 py-0.5 rounded">ATIVO</span>}
                  </span>
                  <svg className="w-4 h-4 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              </div>
            </div>

            {/* ── Seção: Comunicação ── */}
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Comunicação</p>
              <div className="space-y-2">
                <button
                  onClick={() => setShowSendMsg(true)}
                  disabled={!!sending}
                  className="w-full text-left px-3 py-2.5 rounded-lg text-sm font-medium transition-colors flex items-center justify-between border border-blue-100 text-blue-700 hover:bg-blue-50 disabled:opacity-50"
                >
                  <span className="flex items-center gap-2">💬 Enviar Mensagem</span>
                  <svg className="w-4 h-4 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              </div>
            </div>

            {/* ── Seção: Diagnóstico ── */}
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Diagnóstico</p>
              <div className="space-y-2">
                <button
                  onClick={runNetworkTest}
                  disabled={!!sending}
                  className="w-full text-left px-3 py-2.5 rounded-lg text-sm font-medium transition-colors flex items-center justify-between border border-cyan-200 text-cyan-800 hover:bg-cyan-50 disabled:opacity-50"
                >
                  <span className="flex items-center gap-2">📡 Diagnóstico WiFi</span>
                  <svg className="w-4 h-4 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              </div>
            </div>

            {/* ── Seção: Dispositivo ── */}
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Dispositivo</p>
              <div className="space-y-2">
                {([
                  { type: 'REBOOT',        label: '🔄 Reiniciar' },
                  { type: 'LOCATE',        label: '📍 Localizar' },
                  { type: 'UPDATE_POLICY', label: '📋 Atualizar Política' },
                ] as const).map(({ type, label }) => (
                  <button
                    key={type}
                    onClick={() => sendCmd(type)}
                    disabled={!!sending}
                    className={`w-full text-left px-3 py-2.5 rounded-lg text-sm font-medium transition-colors flex items-center justify-between border ${cmdStyle(type)} disabled:opacity-50`}
                  >
                    {sending === type
                      ? <span className="flex items-center gap-2"><div className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin" />Enviando...</span>
                      : <span>{label}</span>}
                    {sending !== type && <svg className="w-4 h-4 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>}
                  </button>
                ))}
                {/* Atualizar Agente — requer URL do APK */}
                <button
                  onClick={() => setShowUpdateAgent(true)}
                  disabled={!!sending}
                  className="w-full text-left px-3 py-2.5 rounded-lg text-sm font-medium transition-colors flex items-center justify-between border border-indigo-200 text-indigo-700 bg-indigo-50 hover:bg-indigo-100 disabled:opacity-50"
                >
                  <span>⬆️ Atualizar Agente</span>
                  <svg className="w-4 h-4 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                </button>
                {/* Limpar Dispositivo (Wipe) — requer senha admin */}
                <button
                  onClick={() => { setShowWipe(true); setWipePassword(''); setWipeError('') }}
                  disabled={!!sending}
                  className="w-full text-left px-3 py-2.5 rounded-lg text-sm font-medium transition-colors flex items-center justify-between border border-red-300 text-red-700 bg-red-50 hover:bg-red-100 disabled:opacity-50"
                >
                  <span>🗑️ Limpar Dispositivo (Wipe)</span>
                  <svg className="w-4 h-4 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                </button>
              </div>
            </div>

          </div>
        </div>
      </div>

      {/* Command history */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        <h2 className="font-semibold text-gray-900 mb-4">Histórico de Comandos</h2>
        {commands.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-4">Nenhum comando enviado ainda</p>
        ) : (
          <div className="space-y-2">
            {commands.map(cmd => (
              <div key={cmd.id} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
                <div>
                  <p className="text-sm font-medium text-gray-900">{cmd.type}</p>
                  <p className="text-xs text-gray-400">{formatDistanceToNow(new Date(cmd.createdAt), { addSuffix: true })}</p>
                  {/* Install result badge for UPDATE_AGENT */}
                  {cmd.type === 'UPDATE_AGENT' && (() => {
                    const ir = cmd.result?.installResult
                    if (!ir && cmd.result?.status === 'INSTALLING') return (
                      <p className="text-xs text-blue-600 mt-0.5">Instalando...</p>
                    )
                    if (!ir) return null
                    return ir.success
                      ? <p className="text-xs text-green-600 mt-0.5">✓ Instalado v{ir.installedVersion}</p>
                      : <p className="text-xs text-red-600 mt-0.5" title={ir.errorMessage}>✗ Falha na instalação</p>
                  })()}
                </div>
                <span className={`text-xs px-2 py-1 rounded-full font-medium ${
                  cmd.status === 'EXECUTED' ? 'bg-green-50 text-green-700' :
                  cmd.status === 'FAILED'   ? 'bg-red-50 text-red-700' :
                  cmd.status === 'PENDING'  ? 'bg-yellow-50 text-yellow-700' :
                  'bg-blue-50 text-blue-700'
                }`}>{cmd.status}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Admin Lock Execution Popup ── */}
      {lockExec && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-8 flex flex-col items-center gap-5 text-center">
            {lockExec.status === 'waiting' && (
              <>
                <div className="w-14 h-14 rounded-full border-4 border-primary-200 border-t-primary-600 animate-spin" />
                <div>
                  <p className="text-lg font-semibold text-gray-900">
                    {lockExec.type === 'ADMIN_LOCK' ? 'Aplicando Admin Lock...' : 'Removendo Admin Lock...'}
                  </p>
                  <p className="text-sm text-gray-500 mt-1">Aguardando confirmação do dispositivo</p>
                </div>
                <div className="flex items-center gap-2 px-4 py-2 bg-gray-50 rounded-full">
                  <div className="w-2 h-2 bg-amber-400 rounded-full animate-pulse" />
                  <span className="text-sm font-mono text-gray-600">{lockExec.elapsed}s</span>
                </div>
              </>
            )}
            {lockExec.status === 'done' && (
              <>
                <div className="w-14 h-14 rounded-full bg-green-100 flex items-center justify-center">
                  <svg className="w-7 h-7 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <div>
                  <p className="text-lg font-semibold text-gray-900">
                    {lockExec.type === 'ADMIN_LOCK' ? 'Admin Lock aplicado!' : 'Admin Lock removido!'}
                  </p>
                  <p className="text-sm text-gray-500 mt-1">Concluído em {lockExec.elapsed}s</p>
                </div>
              </>
            )}
            {lockExec.status === 'failed' && (
              <>
                <div className="w-14 h-14 rounded-full bg-red-100 flex items-center justify-center">
                  <svg className="w-7 h-7 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </div>
                <div>
                  <p className="text-lg font-semibold text-gray-900">Falha na execução</p>
                  <p className="text-sm text-gray-500 mt-1">O dispositivo reportou um erro após {lockExec.elapsed}s</p>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Admin Lock Modal ── */}
      {showAdminLock && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg">
            <div className="p-6 border-b border-gray-100">
              <h3 className="text-lg font-semibold text-gray-900">🔒 Admin Lock</h3>
              <p className="text-sm text-gray-500 mt-1">A tela ficará acesa exibindo a mensagem. O usuário não consegue sair.</p>
            </div>
            <div className="p-6 space-y-5">

              {/* Severity */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Severidade</label>
                <div className="flex gap-2">
                  {(Object.entries(severityConfig) as [Severity, typeof severityConfig[Severity]][]).map(([key, cfg]) => (
                    <button
                      key={key}
                      onClick={() => setAdminSeverity(key)}
                      className={`flex-1 py-2 rounded-lg text-sm font-medium border transition-all ${
                        adminSeverity === key ? `${cfg.bg} ${cfg.color} border-current` : 'border-gray-200 text-gray-500 hover:border-gray-300'
                      }`}
                    >
                      {cfg.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Message templates */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Mensagem</label>
                <div className="space-y-1 mb-2">
                  {ADMIN_LOCK_TEMPLATES.map(t => (
                    <button
                      key={t}
                      onClick={() => setAdminMessage(t)}
                      className={`w-full text-left text-sm px-3 py-2 rounded-lg border transition-all ${
                        adminMessage === t ? 'border-primary-400 bg-primary-50 text-primary-700' : 'border-gray-100 text-gray-600 hover:border-gray-200'
                      }`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
                <textarea
                  rows={2}
                  value={adminMessage}
                  onChange={e => setAdminMessage(e.target.value)}
                  placeholder="Ou escreva uma mensagem personalizada..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>

              {/* Contact */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Contato TI (opcional)</label>
                <input
                  type="text"
                  value={adminContact}
                  onChange={e => setAdminContact(e.target.value)}
                  placeholder="Ramal 2234 / ti@empresa.com"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>

            </div>

            <div className="p-6 border-t border-gray-100 flex gap-3">
              <button
                onClick={() => setShowAdminLock(false)}
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50"
              >
                Cancelar
              </button>
              <button
                onClick={handleAdminLock}
                disabled={!!sending || !adminMessage.trim()}
                className="flex-1 px-4 py-2 bg-amber-600 text-white rounded-lg text-sm font-medium hover:bg-amber-700 disabled:opacity-50"
              >
                {sending === 'ADMIN_LOCK' ? 'Enviando...' : 'Aplicar Admin Lock'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Send Message Modal ── */}
      {showSendMsg && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">💬 Enviar Mensagem</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Título</label>
                <input
                  type="text"
                  value={msgTitle}
                  onChange={e => setMsgTitle(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Mensagem</label>
                <textarea
                  rows={3}
                  value={msgBody}
                  onChange={e => setMsgBody(e.target.value)}
                  placeholder="Digite a mensagem para o usuário do dispositivo..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={() => setShowSendMsg(false)} className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50">
                Cancelar
              </button>
              <button
                onClick={handleSendMessage}
                disabled={!!sending || !msgBody.trim()}
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
              >
                {sending === 'SEND_MESSAGE' ? 'Enviando...' : 'Enviar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Kiosk / App Manager Modal ── */}
      {showKiosk && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg flex flex-col max-h-[90vh]">

            {/* Header + toggle */}
            <div className="p-6 border-b border-gray-100">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">📱 Modo Kiosk</h3>
                  <p className="text-sm text-gray-500 mt-0.5">
                    {kioskEnabled ? 'Configurar apps permitidos ou bloqueados' : 'Kiosk desativado — dispositivo em uso normal'}
                  </p>
                </div>
                {/* Toggle switch */}
                <button
                  onClick={() => { setKioskEnabled(v => !v); setAppList([]); setSelectedApps(new Set()) }}
                  className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors focus:outline-none ${kioskEnabled ? 'bg-purple-600' : 'bg-gray-300'}`}
                >
                  <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${kioskEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
                </button>
              </div>
            </div>

            {/* Body — only shown when kiosk is enabled */}
            {kioskEnabled && (
              <div className="p-6 space-y-4 overflow-y-auto flex-1">
                {/* Mode selector */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Modo</label>
                  <div className="flex rounded-lg border border-gray-200 overflow-hidden">
                    <button
                      onClick={() => setKioskMode('whitelist')}
                      className={`flex-1 py-2 text-sm font-medium transition-colors ${kioskMode === 'whitelist' ? 'bg-purple-600 text-white' : 'text-gray-600 hover:bg-gray-50'}`}
                    >
                      ✅ Whitelist — só esses rodam
                    </button>
                    <button
                      onClick={() => setKioskMode('blacklist')}
                      className={`flex-1 py-2 text-sm font-medium transition-colors ${kioskMode === 'blacklist' ? 'bg-red-600 text-white' : 'text-gray-600 hover:bg-gray-50'}`}
                    >
                      🚫 Blacklist — bloqueia esses
                    </button>
                  </div>
                </div>

                {/* Fetch apps */}
                <button
                  onClick={fetchApps}
                  disabled={fetchingApps}
                  className="w-full py-2 rounded-lg border border-purple-200 text-purple-700 text-sm font-medium hover:bg-purple-50 disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {fetchingApps
                    ? <><div className="w-4 h-4 border-2 border-purple-400 border-t-transparent rounded-full animate-spin" />Buscando apps no dispositivo...</>
                    : '🔍 Buscar Apps Instalados'}
                </button>

                {/* App list */}
                {appList.length > 0 && (
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium text-gray-700">{appList.length} apps encontrados</span>
                      <span className="text-xs text-gray-400">{selectedApps.size} selecionados</span>
                    </div>
                    <input
                      type="text"
                      value={appSearch}
                      onChange={e => setAppSearch(e.target.value)}
                      placeholder="Filtrar apps..."
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm mb-2 focus:outline-none focus:ring-2 focus:ring-purple-400"
                    />
                    <div className="space-y-1 max-h-56 overflow-y-auto border border-gray-100 rounded-lg p-2">
                      {appList
                        .filter(a => !appSearch || a.label.toLowerCase().includes(appSearch.toLowerCase()) || a.packageName.toLowerCase().includes(appSearch.toLowerCase()))
                        .map(app => (
                          <label key={app.packageName} className="flex items-center gap-3 px-2 py-1.5 rounded-lg hover:bg-gray-50 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={selectedApps.has(app.packageName)}
                              onChange={() => toggleApp(app.packageName)}
                              className="w-4 h-4 rounded text-purple-600"
                            />
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-gray-900 truncate">{app.label}</p>
                              <p className="text-xs text-gray-400 truncate">{app.packageName}</p>
                            </div>
                          </label>
                        ))}
                    </div>

                    {/* Warning: selected apps not installed on device */}
                    {(() => {
                      const installedPkgs = new Set(appList.map(a => a.packageName))
                      const notInstalled = Array.from(selectedApps).filter(p => !installedPkgs.has(p))
                      if (notInstalled.length === 0) return null
                      return (
                        <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm">
                          <p className="font-medium text-amber-800 mb-1">⚠️ {notInstalled.length} app{notInstalled.length > 1 ? 's' : ''} selecionado{notInstalled.length > 1 ? 's' : ''} não {notInstalled.length > 1 ? 'estão instalados' : 'está instalado'} neste dispositivo:</p>
                          <ul className="text-amber-700 space-y-0.5 mb-2">
                            {notInstalled.map(p => <li key={p} className="font-mono text-xs truncate">• {p}</li>)}
                          </ul>
                          <p className="text-amber-700 text-xs">O kiosk ficará pendente até estes apps serem instalados. Para instalação automática, adicione-os como <strong>Apps Obrigatórios</strong> na política do dispositivo.</p>
                        </div>
                      )
                    })()}
                  </div>
                )}
              </div>
            )}

            {/* Footer */}
            <div className="p-6 border-t border-gray-100 flex gap-3">
              <button
                onClick={() => setShowKiosk(false)}
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50"
              >
                Cancelar
              </button>
              {kioskEnabled ? (
                <button
                  onClick={handleEnableKiosk}
                  disabled={!!sending || selectedApps.size === 0}
                  className="flex-1 px-4 py-2 bg-purple-600 text-white rounded-lg text-sm font-medium hover:bg-purple-700 disabled:opacity-50"
                >
                  {sending === 'ENABLE_KIOSK' ? 'Aplicando...' : `Ativar Kiosk (${selectedApps.size} apps)`}
                </button>
              ) : (
                <button
                  onClick={async () => { await sendCmd('DISABLE_KIOSK'); setShowKiosk(false) }}
                  disabled={!!sending || !device.isKioskMode}
                  className="flex-1 px-4 py-2 bg-gray-700 text-white rounded-lg text-sm font-medium hover:bg-gray-800 disabled:opacity-50"
                >
                  {sending === 'DISABLE_KIOSK' ? 'Desativando...' : 'Desativar Kiosk'}
                </button>
              )}
            </div>

          </div>
        </div>
      )}
      {/* ── Update Agent Modal ── */}
      {showUpdateAgent && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="p-6 border-b border-gray-100">
              <h3 className="text-lg font-semibold text-gray-900">⬆️ Atualizar Agente MDM</h3>
              <p className="text-sm text-gray-500 mt-0.5">O dispositivo baixará e instalará o novo APK silenciosamente</p>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">URL do APK</label>
                <input
                  type="text"
                  value={agentApkUrl}
                  onChange={e => setAgentApkUrl(e.target.value)}
                  placeholder="ex: /uploads/eguardian-v0.3.0.apk"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Versão</label>
                <input
                  type="text"
                  value={agentVersion}
                  onChange={e => setAgentVersion(e.target.value)}
                  placeholder="ex: 0.3.0"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                />
              </div>
            </div>
            <div className="p-6 border-t border-gray-100 flex gap-3">
              <button
                onClick={() => { setShowUpdateAgent(false); setAgentApkUrl(''); setAgentVersion('') }}
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50"
              >Cancelar</button>
              <button
                onClick={async () => {
                  setShowUpdateAgent(false)
                  await sendCmd('UPDATE_AGENT', { apkUrl: agentApkUrl, version: agentVersion })
                  setAgentApkUrl(''); setAgentVersion('')
                }}
                disabled={!!sending || !agentApkUrl.trim() || !agentVersion.trim()}
                className="flex-1 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
              >
                {sending === 'UPDATE_AGENT' ? 'Enviando...' : 'Enviar Atualização'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Wipe Device Modal ── */}
      {showWipe && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="p-6 border-b border-gray-100">
              <h3 className="text-lg font-semibold text-red-700">🗑️ Limpar Dispositivo (Wipe)</h3>
              <p className="text-sm text-gray-500 mt-0.5">Todos os dados, contas, arquivos e cache serão apagados. O <strong>E.Guardian permanecerá instalado</strong> para rastreio.</p>
            </div>
            <div className="p-6 space-y-4">
              <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                <p className="text-sm text-red-700 font-medium">Dispositivo: {device?.name}</p>
                <p className="text-xs text-red-500 mt-1">Modelo: {device?.manufacturer} {device?.model}</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Senha do administrador</label>
                <input
                  type="password"
                  value={wipePassword}
                  onChange={e => { setWipePassword(e.target.value); setWipeError('') }}
                  placeholder="Digite sua senha para confirmar"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-400"
                  autoFocus
                />
                {wipeError && <p className="text-xs text-red-600 mt-1">{wipeError}</p>}
              </div>
            </div>
            <div className="p-6 border-t border-gray-100 flex gap-3">
              <button
                onClick={() => setShowWipe(false)}
                disabled={wipeSending}
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
              >Cancelar</button>
              <button
                onClick={async () => {
                  if (!wipePassword.trim()) { setWipeError('Digite sua senha'); return }
                  setWipeSending(true)
                  setWipeError('')
                  try {
                    await devicesApi.sendCommand(tenantId, device!.id, 'WIPE', {
                      confirmed: true,
                      adminPassword: wipePassword,
                    })
                    setShowWipe(false)
                    setMsg({ type: 'success', text: 'Comando WIPE enviado — dados, contas e arquivos serão apagados (E.Guardian permanece instalado)' })
                    setTimeout(load, 800)
                  } catch (err: any) {
                    const m = err.response?.data?.message
                    const errMsg = Array.isArray(m) ? m.join(', ') : m || 'Falha ao enviar comando'
                    if (errMsg.includes('Senha incorreta') || errMsg.includes('password')) {
                      setWipeError('Senha incorreta')
                    } else {
                      setWipeError(errMsg)
                    }
                  } finally {
                    setWipeSending(false)
                  }
                }}
                disabled={wipeSending || !wipePassword.trim()}
                className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 disabled:opacity-50"
              >
                {wipeSending ? 'Verificando...' : 'Confirmar Wipe'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Network Test Modal ── */}
      {showNetworkTest && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg">
            <div className="p-6 border-b border-gray-100">
              <h3 className="text-lg font-semibold text-gray-900">📡 Diagnóstico de Rede WiFi</h3>
              <p className="text-sm text-gray-500 mt-1">Lê a rede conectada e escaneia as redes próximas com sinal e canal.</p>
            </div>

            <div className="p-6 space-y-5">
              {/* Progress bar */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-gray-600">{netTestMessage}</span>
                  <span className="text-sm font-semibold text-cyan-700">{netTestProgress}%</span>
                </div>
                <div className="w-full bg-gray-100 rounded-full h-3 overflow-hidden">
                  <div
                    className="bg-cyan-500 h-3 rounded-full transition-all duration-500"
                    style={{ width: `${netTestProgress}%` }}
                  />
                </div>
              </div>

              {/* Spinner while running */}
              {!netTestDone && (
                <div className="flex items-center justify-center gap-3 py-2 text-sm text-gray-400">
                  <div className="w-4 h-4 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
                  Aguardando resposta do dispositivo...
                </div>
              )}

              {/* Connected network card */}
              {netTestConnected && (
                <div className="bg-cyan-50 border border-cyan-200 rounded-xl p-4">
                  <p className="text-xs font-semibold text-cyan-600 uppercase tracking-wide mb-2">Rede conectada</p>
                  <div className="flex items-center justify-between">
                    <span className="text-base font-bold text-gray-900">{netTestConnected.ssid}</span>
                    <span className={`text-sm font-semibold ${netTestConnected.rssi >= -60 ? 'text-green-600' : netTestConnected.rssi >= -75 ? 'text-amber-600' : 'text-red-500'}`}>
                      {'▮'.repeat(netTestConnected.bars)}{'▯'.repeat(4 - netTestConnected.bars)} {netTestConnected.rssi} dBm
                    </span>
                  </div>
                  <div className="mt-2 grid grid-cols-3 gap-2 text-xs text-gray-600">
                    <div><span className="text-gray-400">Canal</span><br /><span className="font-medium">{netTestConnected.channel} ({netTestConnected.frequency} MHz)</span></div>
                    <div><span className="text-gray-400">Velocidade</span><br /><span className="font-medium">{netTestConnected.linkSpeed} Mbps</span></div>
                    <div><span className="text-gray-400">IP</span><br /><span className="font-medium font-mono">{netTestConnected.ipAddress}</span></div>
                  </div>
                </div>
              )}

              {/* Download speed card (fast.com) */}
              {netTestDownloadMbps != null && (
                <div className="bg-green-50 border border-green-200 rounded-xl p-4 flex items-center justify-between">
                  <div>
                    <p className="text-xs font-semibold text-green-600 uppercase tracking-wide">Velocidade de Download</p>
                    <p className="text-xs text-gray-400 mt-0.5">Medido via fast.com</p>
                  </div>
                  <span className="text-2xl font-bold text-green-700">
                    {netTestDownloadMbps.toFixed(1)} <span className="text-base font-medium">Mbps</span>
                  </span>
                </div>
              )}

              {/* Nearby networks table */}
              {netTestWifi.length > 0 && (
                <div>
                  <p className="text-sm font-medium text-gray-700 mb-2">📶 Redes próximas ({netTestWifi.length})</p>
                  <div className="border border-gray-200 rounded-lg overflow-hidden max-h-56 overflow-y-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-gray-50 text-gray-500 sticky top-0">
                        <tr>
                          <th className="px-3 py-2 text-left font-medium">SSID</th>
                          <th className="px-2 py-2 text-center font-medium">Sinal</th>
                          <th className="px-2 py-2 text-center font-medium">CH</th>
                          <th className="px-2 py-2 text-center font-medium">Seg.</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {netTestWifi.map((n: any, i: number) => (
                          <tr key={i} className="hover:bg-gray-50">
                            <td className="px-3 py-2 font-medium text-gray-900 max-w-[140px] truncate">{n.ssid}</td>
                            <td className="px-2 py-2 text-center">
                              <span className={`font-semibold ${n.rssi >= -60 ? 'text-green-600' : n.rssi >= -75 ? 'text-amber-600' : 'text-red-500'}`}>
                                {'▮'.repeat(n.bars)}{'▯'.repeat(4 - n.bars)}
                              </span>
                              <span className="text-gray-400 ml-1">{n.rssi} dBm</span>
                            </td>
                            <td className="px-2 py-2 text-center text-gray-600">{n.channel}</td>
                            <td className="px-2 py-2 text-center">
                              <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${n.security === 'Open' ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}>
                                {n.security}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>

            <div className="p-6 border-t border-gray-100">
              <button
                onClick={() => setShowNetworkTest(false)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

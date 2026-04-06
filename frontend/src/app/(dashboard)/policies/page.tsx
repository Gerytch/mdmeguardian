'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { policiesApi, appsApi, devicesApi, commandsApi, deviceGroupsApi } from '@/lib/api'
import { getTenantId } from '@/lib/auth'
import { App, Policy, PolicyRules } from '@/types'

// ─── Admin Lock shared config ────────────────────────────────────────────────
const ADMIN_LOCK_TEMPLATES = [
  'Leve este dispositivo ao setor de TI',
  'Dispositivo em manutenção — entre em contato com o TI',
  'Ativo em revisão de segurança — dirija-se à recepção do TI',
  'Dispositivo bloqueado por política da empresa',
  'Este dispositivo precisa de atualização obrigatória — leve ao TI',
]
type Severity = 'info' | 'warning' | 'critical'
const severityConfig: Record<Severity, { label: string; color: string; bg: string }> = {
  info:     { label: 'Info',     color: 'text-blue-700',  bg: 'bg-blue-50 border-blue-200' },
  warning:  { label: 'Aviso',   color: 'text-amber-700', bg: 'bg-amber-50 border-amber-200' },
  critical: { label: 'Crítico', color: 'text-red-700',   bg: 'bg-red-50 border-red-200' },
}

// ─── Dispatch progress modal ─────────────────────────────────────────────────
type CmdStatus = 'PENDING' | 'SENT' | 'EXECUTED' | 'FAILED'
interface DispatchItem { deviceId: string; deviceName: string; isOnline: boolean; commandId: string; status: CmdStatus }

function DispatchProgressModal({
  title, subtitle, items, onClose, successLabel = 'Aplicado ✓',
}: {
  title: string
  subtitle: string
  items: DispatchItem[]
  onClose: () => void
  successLabel?: string
}) {
  const done   = items.filter(i => i.status === 'EXECUTED' || i.status === 'FAILED').length
  const failed = items.filter(i => i.status === 'FAILED').length
  const pct    = items.length > 0 ? Math.round((done / items.length) * 100) : 0
  const allDone = done === items.length

  const statusBadge = (s: CmdStatus, online: boolean) => {
    if (!online && (s === 'PENDING' || s === 'SENT'))
      return <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-400">Offline</span>
    if (s === 'EXECUTED') return <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 font-medium">{successLabel}</span>
    if (s === 'FAILED')   return <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700 font-medium">Falhou ✗</span>
    if (s === 'SENT')     return <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">Enviado…</span>
    return <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-700">Aguardando</span>
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md mx-4 overflow-hidden">
        {/* Header */}
        <div className="px-6 pt-5 pb-4 border-b border-gray-100">
          <div className="flex items-start justify-between">
            <div>
              <h3 className="font-semibold text-gray-900">{title}</h3>
              <p className="text-sm text-gray-500 mt-0.5 truncate max-w-xs">{subtitle}</p>
            </div>
            {allDone && (
              <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg leading-none ml-2">✕</button>
            )}
          </div>

          {/* Progress bar */}
          <div className="mt-4">
            <div className="flex justify-between text-xs text-gray-500 mb-1.5">
              <span>{done}/{items.length} dispositivos</span>
              <span className={allDone ? (failed > 0 ? 'text-red-600 font-medium' : 'text-green-600 font-medium') : 'text-gray-400'}>
                {allDone ? (failed > 0 ? `${failed} falha(s)` : 'Concluído') : `${pct}%`}
              </span>
            </div>
            <div className="w-full bg-gray-100 rounded-full h-2.5 overflow-hidden">
              <div
                className={`h-2.5 rounded-full transition-all duration-500 ${failed > 0 && allDone ? 'bg-red-400' : allDone ? 'bg-green-500' : 'bg-primary-500'}`}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        </div>

        {/* Device list */}
        <div className="px-6 py-4 max-h-64 overflow-y-auto space-y-2.5">
          {items.map(item => (
            <div key={item.deviceId} className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${item.isOnline ? 'bg-green-500' : 'bg-gray-300'}`} />
                <span className="text-sm text-gray-800">{item.deviceName}</span>
              </div>
              {statusBadge(item.status, item.isOnline)}
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="px-6 pb-5 pt-3 border-t border-gray-100">
          {allDone ? (
            <button onClick={onClose} className="w-full px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700">
              Fechar
            </button>
          ) : (
            <div className="flex items-center justify-between">
              <p className="text-xs text-gray-400 flex items-center gap-1.5">
                <span className="inline-block w-2 h-2 rounded-full bg-primary-400 animate-pulse" />
                Verificando a cada 2s…
              </p>
              <button onClick={onClose} className="text-xs text-gray-400 hover:text-gray-600 underline">
                Fechar (continua em fundo)
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// App multi-select for required apps
function AppMultiSelect({ label, hint, selectedIds, onChange, apps }: {
  label: string; hint?: string; selectedIds: string[]; onChange: (ids: string[]) => void; apps: App[]
}) {
  const appsWithApk = apps.filter(a => a.apkUrl && !a.isSystem)
  const toggle = (id: string) => {
    if (selectedIds.includes(id)) onChange(selectedIds.filter(x => x !== id))
    else onChange([...selectedIds, id])
  }
  return (
    <div className="py-3">
      <p className="text-sm font-medium text-gray-700 mb-1">{label}</p>
      {hint && <p className="text-xs text-gray-400 mb-2">{hint}</p>}
      {appsWithApk.length === 0 ? (
        <p className="text-xs text-gray-400 italic">Nenhum aplicativo com APK cadastrado ainda</p>
      ) : (
        <div className="space-y-1 max-h-40 overflow-y-auto pr-1">
          {appsWithApk.map(app => (
            <label key={app.id} className="flex items-center gap-2.5 p-2 rounded-lg hover:bg-gray-100 cursor-pointer">
              <input type="checkbox" checked={selectedIds.includes(app.id)} onChange={() => toggle(app.id)}
                className="w-4 h-4 accent-primary-600" />
              <span className="flex-1 min-w-0">
                <span className="text-sm font-medium text-gray-800 block truncate">{app.name}</span>
                <span className="text-xs text-gray-400 font-mono block truncate">{app.packageName} · v{app.version}</span>
              </span>
            </label>
          ))}
        </div>
      )}
    </div>
  )
}

const DEFAULT_RULES: PolicyRules = {
  cameraBlocked: false,
  usbBlocked: false,
  screenshotBlocked: false,
  wifiOnly: false,
  locationTracking: false,
  trackingIntervalMinutes: 5,
  kioskMode: false,
  kioskModeType: 'whitelist',
  kioskApps: [],
  screenTimeoutSeconds: 60,
  deviceUserAuthRequired: false,
  inactivityTimeoutMinutes: 5,
  allowedApps: [],
  blockedApps: [],
}

const DEFAULT_FORM = { name: '', description: '', isDefault: false, requiredAppIds: [] as string[], ...DEFAULT_RULES }
type FormState = typeof DEFAULT_FORM

function Toggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between py-3 border-b border-gray-50 last:border-0">
      <div>
        <p className="text-sm font-medium text-gray-700">{label}</p>
        {hint && <p className="text-xs text-gray-400 mt-0.5">{hint}</p>}
      </div>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors flex-shrink-0 ml-4 ${checked ? 'bg-primary-600' : 'bg-gray-200'}`}
      >
        <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-6' : 'translate-x-1'}`} />
      </button>
    </div>
  )
}

function NumberField({ label, hint, value, min, max, onChange }: { label: string; hint?: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center justify-between py-3 border-b border-gray-50 last:border-0">
      <div>
        <p className="text-sm font-medium text-gray-700">{label}</p>
        {hint && <p className="text-xs text-gray-400 mt-0.5">{hint}</p>}
      </div>
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={e => onChange(Math.min(max, Math.max(min, Number(e.target.value))))}
        className="w-20 px-2 py-1 border border-gray-300 rounded-lg text-sm text-right focus:outline-none focus:ring-2 focus:ring-primary-500 ml-4"
      />
    </div>
  )
}

function ChipInput({ label, hint, values, onChange, placeholder, suggestions = [] }: {
  label: string; hint?: string; values: string[]; onChange: (v: string[]) => void; placeholder: string; suggestions?: App[]
}) {
  const [input, setInput] = useState('')
  const [showDropdown, setShowDropdown] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)

  const filtered = suggestions
    .filter(a =>
      (!input.trim() ||
        a.packageName.toLowerCase().includes(input.toLowerCase()) ||
        a.name.toLowerCase().includes(input.toLowerCase())) &&
      !values.includes(a.packageName)
    )
    .slice(0, 8)

  const add = (val?: string) => {
    const v = (val ?? input).trim()
    if (v && !values.includes(v)) onChange([...values, v])
    setInput('')
    // keep dropdown open so user can keep selecting apps
  }

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setShowDropdown(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <div className="py-3 border-b border-gray-50 last:border-0">
      <p className="text-sm font-medium text-gray-700 mb-1">{label}</p>
      {hint && <p className="text-xs text-gray-400 mb-2">{hint}</p>}
      <p className="text-xs text-gray-400 mb-2">Digite o package name — ex: com.android.chrome</p>
      <div className="flex flex-wrap gap-1.5 mb-2">
        {values.map(v => (
          <span key={v} className="inline-flex items-center gap-1 bg-primary-50 text-primary-700 text-xs px-2 py-1 rounded-full">
            {v}
            <button type="button" onClick={() => onChange(values.filter(x => x !== v))} className="hover:text-red-500 font-bold">×</button>
          </span>
        ))}
      </div>
      <div className="relative flex gap-2" ref={wrapperRef}>
        <div className="relative flex-1">
          <input
            type="text"
            placeholder={placeholder}
            value={input}
            onChange={e => { setInput(e.target.value); setShowDropdown(true) }}
            onFocus={() => setShowDropdown(true)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add() } }}
            className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
          {showDropdown && filtered.length > 0 && (
            <ul className="absolute z-10 left-0 right-0 bg-white border border-gray-200 rounded-lg shadow-lg mt-1 max-h-48 overflow-y-auto">
              {filtered.map(app => (
                <li
                  key={app.packageName}
                  onMouseDown={e => { e.preventDefault(); add(app.packageName) }}
                  className="px-3 py-2 text-sm cursor-pointer hover:bg-primary-50 flex items-center justify-between"
                >
                  <span className="font-medium text-gray-800">{app.name}</span>
                  <span className="text-gray-400 text-xs ml-2 truncate max-w-[180px]">{app.packageName}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <button type="button" onClick={() => add()} className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm rounded-lg">Adicionar</button>
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-5">
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">{title}</p>
      <div className="bg-gray-50 rounded-lg px-4">{children}</div>
    </div>
  )
}

export default function PoliciesPage() {
  const [policies, setPolicies] = useState<Policy[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editPolicy, setEditPolicy] = useState<Policy | null>(null)
  const [form, setForm] = useState<FormState>(DEFAULT_FORM)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [appCatalog, setAppCatalog] = useState<App[]>([])
  const [devices, setDevices] = useState<any[]>([])
  const [groups, setGroups] = useState<any[]>([])
  const [commands, setCommands] = useState<any[]>([])
  const [dispatch, setDispatch] = useState<{ title: string; subtitle: string; successLabel?: string; items: DispatchItem[] } | null>(null)
  const [bulkLockPolicy, setBulkLockPolicy] = useState<Policy | null>(null)
  const [bulkLockForm, setBulkLockForm] = useState({ message: 'Dispositivo solicitado para retornar à T.I.', contact: '', severity: 'warning' })
  const [bulkLockSending, setBulkLockSending] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const tenantId = getTenantId()
  const set = (key: keyof FormState, value: any) => setForm(f => ({ ...f, [key]: value }))

  const load = () => {
    if (!tenantId) return
    policiesApi.list(tenantId).then(r => setPolicies(r.data)).finally(() => setLoading(false))
    appsApi.list(tenantId).then(r => setAppCatalog(r.data)).catch(() => {})
    devicesApi.list(tenantId).then(r => setDevices(r.data)).catch(() => {})
    deviceGroupsApi.list(tenantId).then(r => setGroups(r.data)).catch(() => {})
    commandsApi.list(tenantId).then(r => setCommands(r.data)).catch(() => {})
  }
  useEffect(load, [])
  useEffect(() => () => stopPolling(), [])

  const openCreate = () => {
    setEditPolicy(null)
    setForm(DEFAULT_FORM)
    setError('')
    setShowModal(true)
  }

  const openEdit = (p: Policy) => {
    setEditPolicy(p)
    setForm({
      name: p.name,
      description: p.description ?? '',
      isDefault: p.isDefault,
      requiredAppIds: p.requiredAppIds ?? [],
      cameraBlocked: p.rules.cameraBlocked,
      usbBlocked: p.rules.usbBlocked,
      screenshotBlocked: p.rules.screenshotBlocked,
      wifiOnly: p.rules.wifiOnly,
      locationTracking: p.rules.locationTracking,
      trackingIntervalMinutes: p.rules.trackingIntervalMinutes,
      kioskMode: p.rules.kioskMode,
      kioskModeType: p.rules.kioskModeType ?? 'whitelist',
      kioskApps: [...p.rules.kioskApps],
      screenTimeoutSeconds: p.rules.screenTimeoutSeconds ?? 60,
      deviceUserAuthRequired: p.rules.deviceUserAuthRequired ?? false,
      inactivityTimeoutMinutes: p.rules.inactivityTimeoutMinutes ?? 5,
      allowedApps: p.rules.allowedApps ?? [],
      blockedApps: p.rules.blockedApps ?? [],
    })
    setError('')
    setShowModal(true)
  }

  const closeModal = () => {
    setShowModal(false)
    setEditPolicy(null)
    setForm(DEFAULT_FORM)
    setError('')
  }

  const buildRules = (): PolicyRules => ({
    cameraBlocked: form.cameraBlocked,
    usbBlocked: form.usbBlocked,
    screenshotBlocked: form.screenshotBlocked,
    wifiOnly: form.wifiOnly,
    locationTracking: form.locationTracking,
    trackingIntervalMinutes: form.trackingIntervalMinutes,
    kioskMode: form.kioskMode,
    kioskModeType: form.kioskModeType as 'whitelist' | 'blacklist',
    kioskApps: form.kioskApps,
    screenTimeoutSeconds: form.screenTimeoutSeconds,
    deviceUserAuthRequired: form.deviceUserAuthRequired,
    inactivityTimeoutMinutes: form.inactivityTimeoutMinutes,
  })

  const stopPolling = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      const payload = { name: form.name, description: form.description, isDefault: form.isDefault, requiredAppIds: form.requiredAppIds, rules: buildRules() }
      if (editPolicy) {
        await policiesApi.update(tenantId!, editPolicy.id, payload)
        closeModal()
        load()

        // Send UPDATE_POLICY to all devices assigned to this policy
        const affected = devices.filter(d => d.policyId === editPolicy.id)
        if (affected.length > 0) {
          const cmdResults = await Promise.allSettled(
            affected.map(d => devicesApi.sendCommand(tenantId!, d.id, 'UPDATE_POLICY', {}))
          )
          const items: DispatchItem[] = affected.map((d, i) => {
            const r = cmdResults[i]
            return {
              deviceId: d.id,
              deviceName: d.name,
              isOnline: d.isOnline,
              commandId: r.status === 'fulfilled' ? r.value.data.id : '',
              status: r.status === 'fulfilled' ? 'PENDING' : 'FAILED',
            }
          })
          setDispatch({ title: 'Aplicando política', subtitle: `"${form.name}"`, items })

          // Poll every 2s to update command statuses
          stopPolling()
          pollRef.current = setInterval(async () => {
            try {
              const cmdList = await commandsApi.list(tenantId!)
              const cmds: any[] = cmdList.data
              setDispatch(prev => {
                if (!prev) return null
                const updated = prev.items.map(item => {
                  if (!item.commandId) return item
                  const found = cmds.find((c: any) => c.id === item.commandId)
                  return found ? { ...item, status: found.status as CmdStatus } : item
                })
                const allDone = updated.every(i => i.status === 'EXECUTED' || i.status === 'FAILED')
                if (allDone) { stopPolling(); commandsApi.list(tenantId!).then(r => setCommands(r.data)).catch(() => {}) }
                return { ...prev, items: updated }
              })
            } catch { /* ignore */ }
          }, 2000)
        }
      } else {
        await policiesApi.create(tenantId!, payload)
        closeModal()
        load()
      }
    } catch (err: any) {
      const msg = err.response?.data?.message
      setError(Array.isArray(msg) ? msg.join(', ') : msg || 'Failed to save policy')
    } finally {
      setSaving(false)
    }
  }

  const handleBulkLock = async () => {
    if (!bulkLockPolicy || !tenantId) return
    setBulkLockSending(true)
    const affected = devices.filter(d => d.policyId === bulkLockPolicy.id)
    const payload = { message: bulkLockForm.message, contact: bulkLockForm.contact, severity: bulkLockForm.severity }
    const cmdResults = await Promise.allSettled(
      affected.map(d => devicesApi.sendCommand(tenantId, d.id, 'ADMIN_LOCK', payload))
    )
    const items: DispatchItem[] = affected.map((d, i) => {
      const r = cmdResults[i]
      return {
        deviceId: d.id, deviceName: d.name, isOnline: d.isOnline,
        commandId: r.status === 'fulfilled' ? r.value.data.id : '',
        status: r.status === 'fulfilled' ? 'PENDING' : 'FAILED',
      }
    })
    setBulkLockPolicy(null)
    setBulkLockSending(false)
    commandsApi.list(tenantId).then(r => setCommands(r.data)).catch(() => {})
    setDispatch({ title: 'Admin Lock em massa', subtitle: `Política: ${bulkLockPolicy.name} — ${affected.length} dispositivo(s)`, successLabel: 'Bloqueado ✓', items })
    stopPolling()
    pollRef.current = setInterval(async () => {
      try {
        const cmdList = await commandsApi.list(tenantId)
        const cmds: any[] = cmdList.data
        setCommands(cmds)
        setDispatch(prev => {
          if (!prev) return null
          const updated = prev.items.map(item => {
            if (!item.commandId) return item
            const found = cmds.find((c: any) => c.id === item.commandId)
            return found ? { ...item, status: found.status as CmdStatus } : item
          })
          const allDone = updated.every(i => i.status === 'EXECUTED' || i.status === 'FAILED')
          if (allDone) stopPolling()
          return { ...prev, items: updated }
        })
      } catch { /* ignore */ }
    }, 2000)
  }

  const handleBulkUnlock = async (lockedDevices: any[], policyName: string) => {
    if (!tenantId || lockedDevices.length === 0) return
    const cmdResults = await Promise.allSettled(
      lockedDevices.map(d => devicesApi.sendCommand(tenantId, d.id, 'ADMIN_UNLOCK', {}))
    )
    const items: DispatchItem[] = lockedDevices.map((d, i) => {
      const r = cmdResults[i]
      return {
        deviceId: d.id, deviceName: d.name, isOnline: d.isOnline,
        commandId: r.status === 'fulfilled' ? r.value.data.id : '',
        status: r.status === 'fulfilled' ? 'PENDING' : 'FAILED',
      }
    })
    commandsApi.list(tenantId).then(r => setCommands(r.data)).catch(() => {})
    setDispatch({ title: 'Desbloqueando dispositivos', subtitle: `Política: ${policyName} — ${lockedDevices.length} dispositivo(s)`, successLabel: 'Desbloqueado ✓', items })
    stopPolling()
    pollRef.current = setInterval(async () => {
      try {
        const cmdList = await commandsApi.list(tenantId)
        const cmds: any[] = cmdList.data
        setCommands(cmds)
        setDispatch(prev => {
          if (!prev) return null
          const updated = prev.items.map(item => {
            if (!item.commandId) return item
            const found = cmds.find((c: any) => c.id === item.commandId)
            return found ? { ...item, status: found.status as CmdStatus } : item
          })
          const allDone = updated.every(i => i.status === 'EXECUTED' || i.status === 'FAILED')
          if (allDone) stopPolling()
          return { ...prev, items: updated }
        })
      } catch { /* ignore */ }
    }, 2000)
  }

  const deletePolicy = async (id: string) => {
    if (!tenantId || !confirm('Delete this policy?')) return
    try { await policiesApi.delete(tenantId, id); load() } catch {}
  }

  // Derive admin lock state per device from command history
  const isDeviceLocked = (deviceId: string): boolean => {
    const executed = commands.filter(c => c.deviceId === deviceId && c.status === 'EXECUTED')
    const lastLock   = executed.filter(c => c.type === 'ADMIN_LOCK').sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0]
    const lastUnlock = executed.filter(c => c.type === 'ADMIN_UNLOCK').sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0]
    if (!lastLock) return false
    if (!lastUnlock) return true
    return new Date(lastLock.createdAt).getTime() > new Date(lastUnlock.createdAt).getTime()
  }

  const rulesDisplay = (rules: PolicyRules) => [
    ['Camera', rules.cameraBlocked],
    ['USB', rules.usbBlocked],
    ['Screenshots', rules.screenshotBlocked],
    ['Wi-Fi Only', rules.wifiOnly],
    ['Location', rules.locationTracking],
    ['Kiosk', rules.kioskMode],
  ] as [string, boolean][]

  return (
    <div className="p-8">
      {/* Bulk lock confirmation modal */}
      {bulkLockPolicy && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg">
            <div className="p-6 border-b border-gray-100">
              <h3 className="text-lg font-semibold text-gray-900">🔒 Admin Lock — Chamar para T.I.</h3>
              <p className="text-sm text-gray-500 mt-1">
                {devices.filter(d => d.policyId === bulkLockPolicy.id).length} dispositivo(s) da política "{bulkLockPolicy.name}" serão bloqueados. O usuário não consegue sair.
              </p>
            </div>
            <div className="p-6 space-y-5">

              {/* Severity */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Severidade</label>
                <div className="flex gap-2">
                  {(Object.entries(severityConfig) as [Severity, typeof severityConfig[Severity]][]).map(([key, cfg]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setBulkLockForm(f => ({ ...f, severity: key }))}
                      className={`flex-1 py-2 rounded-lg text-sm font-medium border transition-all ${
                        bulkLockForm.severity === key ? `${cfg.bg} ${cfg.color} border-current` : 'border-gray-200 text-gray-500 hover:border-gray-300'
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
                      type="button"
                      onClick={() => setBulkLockForm(f => ({ ...f, message: t }))}
                      className={`w-full text-left text-sm px-3 py-2 rounded-lg border transition-all ${
                        bulkLockForm.message === t ? 'border-primary-400 bg-primary-50 text-primary-700' : 'border-gray-100 text-gray-600 hover:border-gray-200'
                      }`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
                <textarea
                  rows={2}
                  value={bulkLockForm.message}
                  onChange={e => setBulkLockForm(f => ({ ...f, message: e.target.value }))}
                  placeholder="Ou escreva uma mensagem personalizada..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>

              {/* Contact */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Contato TI (opcional)</label>
                <input
                  type="text"
                  value={bulkLockForm.contact}
                  onChange={e => setBulkLockForm(f => ({ ...f, contact: e.target.value }))}
                  placeholder="Ramal 2234 / ti@empresa.com"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>

            </div>
            <div className="p-6 border-t border-gray-100 flex gap-3">
              <button
                type="button"
                onClick={() => setBulkLockPolicy(null)}
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={bulkLockSending || !bulkLockForm.message.trim()}
                onClick={handleBulkLock}
                className="flex-1 px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-sm font-medium disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {bulkLockSending
                  ? <><span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />Enviando…</>
                  : `Bloquear ${devices.filter(d => d.policyId === bulkLockPolicy.id).length} dispositivo(s)`
                }
              </button>
            </div>
          </div>
        </div>
      )}

      {dispatch && (
        <DispatchProgressModal
          title={dispatch.title}
          subtitle={dispatch.subtitle}
          successLabel={dispatch.successLabel}
          items={dispatch.items}
          onClose={() => { stopPolling(); setDispatch(null) }}
        />
      )}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Políticas</h1>
          <p className="text-gray-500 mt-1">Configure as políticas de gerenciamento</p>
        </div>
        <button onClick={openCreate}
          className="bg-primary-600 hover:bg-primary-700 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Nova Política
        </button>
      </div>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h3 className="font-semibold text-gray-900 text-lg">
                {editPolicy ? 'Editar Política' : 'Criar Política'}
              </h3>
              <button onClick={closeModal} className="text-gray-400 hover:text-gray-600">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <form onSubmit={handleSubmit} className="overflow-y-auto flex-1 px-6 py-4">
              {error && <div className="bg-red-50 text-red-700 text-sm p-3 rounded-lg mb-4">{error}</div>}

              {/* Basic Info */}
              <Section title="Informações Básicas">
                <div className="py-3 border-b border-gray-50">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
                  <input type="text" required value={form.name} onChange={e => set('name', e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
                </div>
                <div className="py-3 border-b border-gray-50">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Descrição</label>
                  <textarea rows={2} value={form.description} onChange={e => set('description', e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
                </div>
                <Toggle label="Definir como política padrão" hint="Aplicada automaticamente a novos dispositivos" checked={form.isDefault} onChange={v => set('isDefault', v)} />
              </Section>

              {/* Security */}
              <Section title="Segurança">
                <Toggle label="Bloquear Câmera" hint="Impede o uso da câmera do dispositivo" checked={form.cameraBlocked} onChange={v => set('cameraBlocked', v)} />
                <Toggle label="Bloquear Transferência USB" hint="Desativa o acesso a dados via USB" checked={form.usbBlocked} onChange={v => set('usbBlocked', v)} />
                <Toggle label="Bloquear Capturas de Tela" hint="Impede capturas de tela" checked={form.screenshotBlocked} onChange={v => set('screenshotBlocked', v)} />
                <Toggle label="Somente Wi-Fi" hint="Desativa dados móveis" checked={form.wifiOnly} onChange={v => set('wifiOnly', v)} />
                <NumberField label="Timeout de Tela (segundos)" hint="Bloqueio automático por inatividade" value={form.screenTimeoutSeconds!} min={15} max={3600} onChange={v => set('screenTimeoutSeconds', v)} />
              </Section>

              {/* Location */}
              <Section title="Localização e Rastreamento">
                <Toggle label="Ativar Rastreamento" hint="Rastreia a posição GPS do dispositivo" checked={form.locationTracking} onChange={v => set('locationTracking', v)} />
                {form.locationTracking && (
                  <NumberField label="Intervalo de Rastreamento (minutos)" min={1} max={60} value={form.trackingIntervalMinutes} onChange={v => set('trackingIntervalMinutes', v)} />
                )}
              </Section>

              {/* Kiosk */}
              <Section title="Modo Quiosque">
                <Toggle label="Ativar Modo Quiosque" hint="Restringe o dispositivo a aplicativos específicos" checked={form.kioskMode} onChange={v => set('kioskMode', v)} />
                {form.kioskMode && (
                  <>
                    <div className="flex items-center justify-between py-3 border-b border-gray-50">
                      <div>
                        <p className="text-sm font-medium text-gray-700">Modo de filtragem</p>
                        <p className="text-xs text-gray-400 mt-0.5">
                          {form.kioskModeType === 'whitelist'
                            ? 'Whitelist — somente os apps listados ficam visíveis'
                            : 'Blacklist — os apps listados serão ocultados'}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 ml-4">
                        <span className={`text-xs font-medium ${form.kioskModeType === 'whitelist' ? 'text-primary-600' : 'text-gray-400'}`}>Lista Branca</span>
                        <button
                          type="button"
                          onClick={() => set('kioskModeType', form.kioskModeType === 'whitelist' ? 'blacklist' : 'whitelist')}
                          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors flex-shrink-0 ${form.kioskModeType === 'blacklist' ? 'bg-orange-500' : 'bg-primary-600'}`}
                        >
                          <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${form.kioskModeType === 'blacklist' ? 'translate-x-6' : 'translate-x-1'}`} />
                        </button>
                        <span className={`text-xs font-medium ${form.kioskModeType === 'blacklist' ? 'text-orange-500' : 'text-gray-400'}`}>Lista Negra</span>
                      </div>
                    </div>
                    <ChipInput
                      label={form.kioskModeType === 'whitelist'
                        ? 'Apps Permitidos — somente estes ficam visíveis'
                        : 'Apps Bloqueados — estes serão ocultados'}
                      values={form.kioskApps}
                      onChange={v => set('kioskApps', v)}
                      placeholder="com.exemplo.app — Enter para adicionar"
                      suggestions={appCatalog}
                    />
                  </>
                )}
              </Section>

              {/* Warning: kiosk whitelist apps with APK not in requiredAppIds */}
              {form.kioskMode && form.kioskModeType === 'whitelist' && (() => {
                const requiredPkgs = new Set(
                  appCatalog.filter(a => form.requiredAppIds.includes(a.id)).map(a => a.packageName)
                )
                const needsInstall = form.kioskApps.filter(pkg => {
                  const catalogApp = appCatalog.find(a => a.packageName === pkg)
                  return catalogApp?.apkUrl && !requiredPkgs.has(pkg)
                })
                if (needsInstall.length === 0) return null
                return (
                  <div className="mx-6 mb-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm">
                    <p className="font-medium text-amber-800 mb-1">⚠️ {needsInstall.length} app{needsInstall.length > 1 ? 's' : ''} do kiosk precisa{needsInstall.length > 1 ? 'm' : ''} ser instalado{needsInstall.length > 1 ? 's' : ''} no dispositivo:</p>
                    <ul className="text-amber-700 text-xs space-y-0.5 mb-2">
                      {needsInstall.map(p => <li key={p} className="font-mono truncate">• {p}</li>)}
                    </ul>
                    <p className="text-amber-700 text-xs">Adicione {needsInstall.length > 1 ? 'esses apps' : 'esse app'} em <strong>Apps Obrigatórios</strong> abaixo para instalação automática ao aplicar a política.</p>
                  </div>
                )
              })()}

              {/* Required Apps */}
              <Section title="Apps Obrigatórios">
                <AppMultiSelect
                  label="Aplicativos instalados automaticamente"
                  hint="Estes apps serão baixados e instalados no dispositivo quando a política for aplicada"
                  selectedIds={form.requiredAppIds}
                  onChange={ids => set('requiredAppIds', ids)}
                  apps={appCatalog}
                />
              </Section>

              {/* Device Auth */}
              <Section title="Autenticação no Dispositivo">
                <Toggle
                  label="Exigir login no dispositivo"
                  hint="Usuários devem fazer login com PIN antes de usar o dispositivo"
                  checked={form.deviceUserAuthRequired}
                  onChange={v => set('deviceUserAuthRequired', v)}
                />
                {form.deviceUserAuthRequired && (
                  <NumberField
                    label="Timeout de inatividade (min)"
                    hint="Bloqueia após X minutos sem interação. 0 = nunca bloqueia automaticamente"
                    value={form.inactivityTimeoutMinutes}
                    onChange={v => set('inactivityTimeoutMinutes', v)}
                    min={0}
                    max={480}
                  />
                )}
              </Section>

              <div className="h-4" />
            </form>

            <div className="flex gap-3 px-6 py-4 border-t border-gray-100">
              <button type="button" onClick={closeModal}
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50">
                Cancelar
              </button>
              <button type="button" onClick={handleSubmit} disabled={saving}
                className="flex-1 px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 disabled:opacity-50">
                {saving ? 'Salvando...' : editPolicy ? 'Salvar Alterações' : 'Criar Política'}
              </button>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-600" />
        </div>
      ) : policies.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-xl border border-gray-100">
          <svg className="w-12 h-12 text-gray-300 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <p className="text-gray-500">Nenhuma política cadastrada</p>
          <button onClick={openCreate} className="mt-3 text-primary-600 text-sm font-medium hover:underline">Crie sua primeira política</button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {policies.map(policy => (
            <div key={policy.id} className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <h3 className="font-semibold text-gray-900">{policy.name}</h3>
                  {policy.isDefault && (
                    <span className="text-xs bg-primary-50 text-primary-700 px-2 py-0.5 rounded-full font-medium mt-1 inline-block">Default</span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {devices.filter(d => d.policyId === policy.id).length > 0 && (
                    <button
                      onClick={() => { setBulkLockPolicy(policy); setBulkLockForm({ message: 'Dispositivo solicitado para retornar à T.I.', contact: '', severity: 'warning' }) }}
                      title="Chamar todos os dispositivos para T.I. (Admin Lock em massa)"
                      className="text-gray-300 hover:text-amber-500 transition-colors"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                      </svg>
                    </button>
                  )}
                <button onClick={() => openEdit(policy)} className="text-gray-300 hover:text-primary-500 transition-colors">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                  </button>
                  <button onClick={() => deletePolicy(policy.id)} className="text-gray-300 hover:text-red-500 transition-colors">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              </div>
              {policy.description && <p className="text-sm text-gray-500 mb-3">{policy.description}</p>}
              <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                {rulesDisplay(policy.rules).map(([label, value]) => (
                  <div key={label} className="flex items-center justify-between text-xs">
                    <span className="text-gray-500">{label}</span>
                    <span className={value ? 'text-green-600 font-medium' : 'text-gray-300'}>
                      {value ? '✓' : '—'}
                    </span>
                  </div>
                ))}
              </div>
              {policy.rules.trackingIntervalMinutes && policy.rules.locationTracking && (
                <p className="text-xs text-gray-400 mt-2">Tracking every {policy.rules.trackingIntervalMinutes}min</p>
              )}
              {policy.rules.deviceUserAuthRequired && (
                <div className="mt-2">
                  <span className="text-xs bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded-full font-medium">Login obrigatório</span>
                </div>
              )}
              {policy.requiredAppIds?.length > 0 && (
                <div className="mt-2">
                  <span className="text-xs bg-green-50 text-green-700 px-2 py-0.5 rounded-full font-medium">
                    {policy.requiredAppIds.length} app(s) obrigatório(s)
                  </span>
                </div>
              )}
              <div className="mt-3 pt-3 border-t border-gray-50">
                {/* Lock status summary */}
                {(() => {
                  const policyDevices = devices.filter(d => d.policyId === policy.id)
                  const locked = policyDevices.filter(d => isDeviceLocked(d.id))
                  if (policyDevices.length === 0) return null
                  return locked.length > 0 ? (
                    <div className="mb-2 p-2 bg-amber-50 border border-amber-200 rounded-lg space-y-1.5">
                      <div className="flex items-center gap-1.5">
                        <svg className="w-3.5 h-3.5 text-amber-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                        </svg>
                        <span className="text-xs font-medium text-amber-700">{locked.length}/{policyDevices.length} em Admin Lock</span>
                        <button
                          onClick={() => handleBulkUnlock(locked, policy.name)}
                          className="ml-auto text-xs px-2 py-0.5 bg-white border border-amber-300 text-amber-700 rounded-lg hover:bg-amber-100 font-medium flex items-center gap-1 transition-colors"
                        >
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z" />
                          </svg>
                          Desbloquear todos
                        </button>
                      </div>
                      <div className="flex gap-1 flex-wrap">
                        {locked.map(d => (
                          <span key={d.id} title={d.name} className="text-xs bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded font-medium truncate max-w-[90px]">{d.name}</span>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5 mb-2">
                      <span className="w-2 h-2 rounded-full bg-green-400 flex-shrink-0" />
                      <span className="text-xs text-green-600 font-medium">Todos desbloqueados</span>
                    </div>
                  )
                })()}
                <p className="text-xs text-gray-500 mb-2">
                  {devices.filter(d => d.policyId === policy.id).length} dispositivo(s) atribuído(s)
                </p>
                <select
                  className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5 text-gray-600"
                  defaultValue=""
                  onChange={async (e) => {
                    const deviceId = e.target.value
                    if (!deviceId) return
                    e.target.value = ''
                    const tid = getTenantId()!
                    await policiesApi.assign(tid, policy.id, deviceId)
                    const d = await devicesApi.list(tid)
                    setDevices(d.data)
                  }}
                >
                  <option value="">+ Atribuir a dispositivo...</option>
                  {devices.filter(d => d.policyId !== policy.id).map(d => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
                {devices.filter(d => d.policyId === policy.id).map(d => (
                  <div key={d.id} className="flex items-center justify-between mt-1">
                    <span className="text-xs text-gray-600 flex items-center gap-1">
                      <span className={`w-1.5 h-1.5 rounded-full ${d.isOnline ? 'bg-green-500' : 'bg-gray-300'}`} />
                      {d.name}
                    </span>
                    <button
                      className="text-xs text-red-500 hover:text-red-700"
                      onClick={async () => {
                        const tid = getTenantId()!
                        await devicesApi.update(tid, d.id, { policyId: null })
                        const updated = await devicesApi.list(tid)
                        setDevices(updated.data)
                      }}
                    >
                      remover
                    </button>
                  </div>
                ))}

                {/* Groups section */}
                <div className="mt-3 pt-3 border-t border-gray-100">
                  <p className="text-xs font-medium text-gray-500 mb-1.5">Grupos</p>
                  <select
                    className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5 text-gray-600"
                    defaultValue=""
                    onChange={async (e) => {
                      const groupId = e.target.value
                      if (!groupId) return
                      e.target.value = ''
                      const tid = getTenantId()!
                      await deviceGroupsApi.assignPolicy(tid, groupId, policy.id)
                      const g = await deviceGroupsApi.list(tid)
                      setGroups(g.data)
                      const d = await devicesApi.list(tid)
                      setDevices(d.data)
                    }}
                  >
                    <option value="">+ Atribuir a grupo...</option>
                    {groups.filter(g => g.policyId !== policy.id).map(g => (
                      <option key={g.id} value={g.id}>{g.name} ({g.deviceCount ?? 0} disp.)</option>
                    ))}
                  </select>
                  {groups.filter(g => g.policyId === policy.id).map(g => (
                    <div key={g.id} className="flex items-center justify-between mt-1">
                      <span className="text-xs text-gray-600 flex items-center gap-1">
                        <svg className="w-3 h-3 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                        </svg>
                        {g.name}
                        <span className="text-gray-400">({g.deviceCount ?? 0})</span>
                      </span>
                      <button
                        className="text-xs text-red-500 hover:text-red-700"
                        onClick={async () => {
                          const tid = getTenantId()!
                          await deviceGroupsApi.removePolicy(tid, g.id)
                          const updated = await deviceGroupsApi.list(tid)
                          setGroups(updated.data)
                          const d = await devicesApi.list(tid)
                          setDevices(d.data)
                        }}
                      >
                        remover
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

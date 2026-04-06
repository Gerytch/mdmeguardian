'use client'

import { useEffect, useRef, useState } from 'react'
import { devicesApi, deviceUsersApi, deviceSessionsApi } from '@/lib/api'
import { getTenantId } from '@/lib/auth'

type DeviceSession = {
  id: string
  tenantId: string
  deviceId: string
  deviceUserId: string
  deviceName?: string
  deviceUserName?: string
  deviceUserUsername?: string
  startedAt: string
  endedAt?: string
  status: 'ACTIVE' | 'CLOSED' | 'TIMEOUT' | 'INTERRUPTED'
}

type DeviceOption = { id: string; name: string }
type UserOption = { id: string; fullName: string; username: string }

function formatDuration(startedAt: string, endedAt?: string) {
  const start = new Date(startedAt)
  const end = endedAt ? new Date(endedAt) : new Date()
  const seconds = Math.floor((end.getTime() - start.getTime()) / 1000)
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}min`
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}min`
}

function SessionStatusBadge({ status }: { status: DeviceSession['status'] }) {
  switch (status) {
    case 'ACTIVE':
      return (
        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-green-50 text-green-700">
          <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
          Em uso
        </span>
      )
    case 'CLOSED':
      return (
        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-500">
          Encerrada
        </span>
      )
    case 'TIMEOUT':
      return (
        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-50 text-yellow-700">
          Timeout
        </span>
      )
    case 'INTERRUPTED':
      return (
        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-red-50 text-red-700">
          Interrompida
        </span>
      )
    default:
      return null
  }
}

const PAGE_SIZE = 20

export default function DeviceSessionsPage() {
  const [sessions, setSessions] = useState<DeviceSession[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)

  const [devices, setDevices] = useState<DeviceOption[]>([])
  const [users, setUsers] = useState<UserOption[]>([])

  const [filterDevice, setFilterDevice] = useState('')
  const [filterUser, setFilterUser] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [filterFrom, setFilterFrom] = useState('')
  const [filterTo, setFilterTo] = useState('')

  const [exporting, setExporting] = useState(false)
  const [closing, setClosing] = useState<string | null>(null)

  const autoRefreshRef = useRef<NodeJS.Timeout | null>(null)

  const tenantId = getTenantId()

  const load = (currentPage = page) => {
    if (!tenantId) return
    setLoading(true)
    const params: any = { page: currentPage, limit: PAGE_SIZE }
    if (filterDevice) params.deviceId = filterDevice
    if (filterUser) params.deviceUserId = filterUser
    if (filterStatus) params.status = filterStatus
    if (filterFrom) params.from = filterFrom
    if (filterTo) params.to = filterTo

    deviceSessionsApi.list(tenantId, params)
      .then(r => {
        const data = r.data
        // Support both { data, total } and plain array responses
        const mapSession = (s: any): DeviceSession => ({
          ...s,
          deviceUserName: s.deviceUserName ?? s.deviceUser?.fullName ?? undefined,
          deviceUserUsername: s.deviceUserUsername ?? s.deviceUser?.username ?? undefined,
          deviceName: s.deviceName ?? s.device?.name ?? undefined,
        })
        if (Array.isArray(data)) {
          setSessions(data.map(mapSession))
          setTotal(data.length)
        } else {
          setSessions((data.data ?? data.sessions ?? []).map(mapSession))
          setTotal(data.total ?? 0)
        }
      })
      .catch(() => { setSessions([]); setTotal(0) })
      .finally(() => setLoading(false))
  }

  // Load filter options once
  useEffect(() => {
    if (!tenantId) return
    devicesApi.list(tenantId).then(r => {
      const list = Array.isArray(r.data) ? r.data : []
      setDevices(list.map((d: any) => ({ id: d.id, name: d.name })))
    }).catch(() => {})
    deviceUsersApi.list(tenantId).then(r => {
      const list = Array.isArray(r.data) ? r.data : (r.data?.data ?? [])
      setUsers(list.map((u: any) => ({ id: u.id, fullName: u.fullName, username: u.username })))
    }).catch(() => {})
  }, [])

  // Reload when filters or page change
  useEffect(() => {
    load(page)
  }, [page, filterDevice, filterUser, filterStatus, filterFrom, filterTo])

  // Auto-refresh every 30s if any session is ACTIVE
  useEffect(() => {
    const hasActive = sessions.some(s => s.status === 'ACTIVE')
    if (autoRefreshRef.current) clearInterval(autoRefreshRef.current)
    if (hasActive) {
      autoRefreshRef.current = setInterval(() => load(page), 30_000)
    }
    return () => { if (autoRefreshRef.current) clearInterval(autoRefreshRef.current) }
  }, [sessions, page])

  const handleClose = async (sessionId: string) => {
    if (!tenantId) return
    setClosing(sessionId)
    try {
      await deviceSessionsApi.close(tenantId, sessionId)
      setSessions(prev => prev.map(s => s.id === sessionId ? { ...s, status: 'INTERRUPTED', endedAt: new Date().toISOString() } : s))
    } catch {}
    setClosing(null)
  }

  const applyFilters = () => {
    setPage(1)
    load(1)
  }

  const handleExport = async () => {
    if (!tenantId) return
    setExporting(true)
    try {
      const params: any = {}
      if (filterDevice) params.deviceId = filterDevice
      if (filterUser) params.deviceUserId = filterUser
      if (filterStatus) params.status = filterStatus
      if (filterFrom) params.from = filterFrom
      if (filterTo) params.to = filterTo

      const res = await deviceSessionsApi.exportCsv(tenantId, params)
      const url = URL.createObjectURL(new Blob([res.data], { type: 'text/csv' }))
      const a = document.createElement('a')
      a.href = url
      a.download = `sessoes-${new Date().toISOString().slice(0, 10)}.csv`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch {}
    setExporting(false)
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Sessões de Dispositivo</h1>
          <p className="text-gray-500 mt-1">Histórico de uso por usuário em dispositivos compartilhados</p>
        </div>
        <button
          onClick={handleExport}
          disabled={exporting}
          className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          {exporting ? 'Exportando...' : 'Exportar CSV'}
        </button>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 mb-6">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
          <select
            value={filterDevice}
            onChange={e => { setFilterDevice(e.target.value); setPage(1) }}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white"
          >
            <option value="">Todos os dispositivos</option>
            {devices.map(d => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>

          <select
            value={filterUser}
            onChange={e => { setFilterUser(e.target.value); setPage(1) }}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white"
          >
            <option value="">Todos os usuários</option>
            {users.map(u => (
              <option key={u.id} value={u.id}>{u.fullName} ({u.username})</option>
            ))}
          </select>

          <select
            value={filterStatus}
            onChange={e => { setFilterStatus(e.target.value); setPage(1) }}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white"
          >
            <option value="">Todos os status</option>
            <option value="ACTIVE">Em uso</option>
            <option value="CLOSED">Encerrada</option>
            <option value="TIMEOUT">Timeout</option>
            <option value="INTERRUPTED">Interrompida</option>
          </select>

          <div>
            <label className="block text-xs text-gray-500 mb-1">De</label>
            <input
              type="date"
              value={filterFrom}
              onChange={e => { setFilterFrom(e.target.value); setPage(1) }}
              className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>

          <div>
            <label className="block text-xs text-gray-500 mb-1">Até</label>
            <input
              type="date"
              value={filterTo}
              onChange={e => { setFilterTo(e.target.value); setPage(1) }}
              className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-600" />
        </div>
      ) : sessions.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-xl border border-gray-100">
          <svg className="w-12 h-12 text-gray-300 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
          </svg>
          <p className="text-gray-700 font-medium">Nenhuma sessão registrada</p>
          <p className="text-gray-400 text-sm mt-1">As sessões aparecem quando dispositivos com login obrigatório são utilizados</p>
        </div>
      ) : (
        <>
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Usuário</th>
                  <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Dispositivo</th>
                  <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Início</th>
                  <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Fim</th>
                  <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Duração</th>
                  <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Status</th>
                  <th className="px-6 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {sessions.map(s => (
                  <tr key={s.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-6 py-4">
                      <p className="text-sm font-medium text-gray-900">
                        {s.deviceUserName || <span className="text-gray-400 italic">Desconhecido</span>}
                      </p>
                      {s.deviceUserUsername && (
                        <span className="inline-block text-xs font-mono bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded mt-0.5">
                          {s.deviceUserUsername}
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <p className="text-sm text-gray-700">
                        {s.deviceName || <span className="text-gray-400 font-mono text-xs">{s.deviceId.slice(0, 8)}…</span>}
                      </p>
                    </td>
                    <td className="px-6 py-4">
                      <span className="text-sm text-gray-600">
                        {new Date(s.startedAt).toLocaleString('pt-BR')}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      {s.endedAt ? (
                        <span className="text-sm text-gray-600">{new Date(s.endedAt).toLocaleString('pt-BR')}</span>
                      ) : (
                        <span className="text-sm text-green-600 font-medium">Em uso</span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <span className="text-sm text-gray-600 tabular-nums">
                        {formatDuration(s.startedAt, s.endedAt)}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <SessionStatusBadge status={s.status} />
                    </td>
                    <td className="px-6 py-4 text-right">
                      {s.status === 'ACTIVE' && (
                        <button
                          onClick={() => handleClose(s.id)}
                          disabled={closing === s.id}
                          className="text-xs font-medium text-red-600 hover:text-red-800 disabled:opacity-50 transition-colors"
                        >
                          {closing === s.id ? 'Encerrando...' : 'Encerrar'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between mt-4">
            <p className="text-sm text-gray-500">
              Página {page} de {totalPages}
              {total > 0 && <span className="ml-1">· {total} sessões no total</span>}
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Anterior
              </button>
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Próxima
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

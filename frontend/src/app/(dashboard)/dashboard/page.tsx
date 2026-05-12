'use client'

import { useEffect, useState } from 'react'
import dynamic from 'next/dynamic'
import { devicesApi, commandsApi, geolocationApi, deviceSessionsApi } from '@/lib/api'
import { getTenantId } from '@/lib/auth'
import { Device, Command } from '@/types'
import { formatDistanceToNow } from 'date-fns'

interface DeviceLocation {
  id: string
  deviceId: string
  latitude: number
  longitude: number
  accuracy?: number
  timestamp: string
}

interface SessionRow {
  id: string
  deviceUserId: string
  deviceId: string
  status: string
  startedAt: string
  endedAt?: string
  deviceUserName?: string
  deviceUser?: { fullName?: string; username?: string }
}

const DeviceMap = dynamic(() => import('./DeviceMap'), { ssr: false })
const KpiCards = dynamic(() => import('./KpiCards'), { ssr: false })

function StatCard({ title, value, color, icon }: { title: string; value: number | string; color: string; icon: string }) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-gray-500">{title}</p>
          <p className={`text-3xl font-bold mt-1 ${color}`}>{value}</p>
        </div>
        <div className={`w-12 h-12 rounded-xl flex items-center justify-center bg-opacity-10 ${color.replace('text-', 'bg-')}`}>
          <svg className={`w-6 h-6 ${color}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={icon} />
          </svg>
        </div>
      </div>
    </div>
  )
}

function fmtDuration(ms: number): string {
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  if (h > 0) return `${h}h ${m}min`
  if (m > 0) return `${m}min`
  return `<1min`
}

function SessionMetrics({ sessions }: { sessions: SessionRow[] }) {
  const now = Date.now()
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0)

  // Aggregate total duration per user
  const byUser = new Map<string, { name: string; totalMs: number; count: number }>()
  for (const s of sessions) {
    const name = s.deviceUserName ?? s.deviceUser?.fullName ?? s.deviceUser?.username ?? s.deviceUserId.slice(0, 8)
    const start = new Date(s.startedAt).getTime()
    const end = s.endedAt ? new Date(s.endedAt).getTime() : now
    const ms = Math.max(0, end - start)
    const existing = byUser.get(s.deviceUserId)
    if (existing) {
      existing.totalMs += ms
      existing.count++
    } else {
      byUser.set(s.deviceUserId, { name, totalMs: ms, count: 1 })
    }
  }

  const topUsers = Array.from(byUser.values())
    .sort((a, b) => b.totalMs - a.totalMs)
    .slice(0, 5)

  const maxMs = topUsers[0]?.totalMs ?? 1

  const todaySessions = sessions.filter(s => new Date(s.startedAt) >= todayStart)
  const activeSessions = sessions.filter(s => s.status === 'ACTIVE')

  const completedMs = sessions
    .filter(s => s.endedAt)
    .map(s => new Date(s.endedAt!).getTime() - new Date(s.startedAt).getTime())
  const avgMs = completedMs.length > 0
    ? completedMs.reduce((a, b) => a + b, 0) / completedMs.length
    : 0

  // Success rate: CLOSED vs INTERRUPTED+TIMEOUT
  const ended = sessions.filter(s => ['CLOSED', 'INTERRUPTED', 'TIMEOUT'].includes(s.status))
  const closed = ended.filter(s => s.status === 'CLOSED')
  const successRate = ended.length > 0 ? Math.round((closed.length / ended.length) * 100) : 100

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
      <h2 className="font-semibold text-gray-900 mb-5">Métricas de Sessão</h2>

      {/* KPI row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className="bg-blue-50 rounded-lg p-3 text-center">
          <p className="text-2xl font-bold text-blue-700">{activeSessions.length}</p>
          <p className="text-xs text-blue-500 mt-0.5">Sessões ativas</p>
        </div>
        <div className="bg-green-50 rounded-lg p-3 text-center">
          <p className="text-2xl font-bold text-green-700">{todaySessions.length}</p>
          <p className="text-xs text-green-500 mt-0.5">Sessões hoje</p>
        </div>
        <div className="bg-purple-50 rounded-lg p-3 text-center">
          <p className="text-2xl font-bold text-purple-700">{fmtDuration(avgMs)}</p>
          <p className="text-xs text-purple-500 mt-0.5">Duração média</p>
        </div>
        <div className={`rounded-lg p-3 text-center ${successRate >= 90 ? 'bg-emerald-50' : successRate >= 70 ? 'bg-amber-50' : 'bg-red-50'}`}>
          <p className={`text-2xl font-bold ${successRate >= 90 ? 'text-emerald-700' : successRate >= 70 ? 'text-amber-700' : 'text-red-700'}`}>{successRate}%</p>
          <p className={`text-xs mt-0.5 ${successRate >= 90 ? 'text-emerald-500' : successRate >= 70 ? 'text-amber-500' : 'text-red-500'}`}>Encerramento normal</p>
        </div>
      </div>

      {/* Top users ranking */}
      <h3 className="text-sm font-semibold text-gray-700 mb-3">Top usuários por tempo acumulado</h3>
      {topUsers.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-4">Nenhuma sessão registrada ainda</p>
      ) : (
        <div className="space-y-3">
          {topUsers.map((u, i) => (
            <div key={i} className="flex items-center gap-3">
              <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                i === 0 ? 'bg-yellow-100 text-yellow-700' :
                i === 1 ? 'bg-gray-100 text-gray-600' :
                i === 2 ? 'bg-orange-100 text-orange-700' :
                'bg-gray-50 text-gray-400'
              }`}>{i + 1}</span>
              <div className="flex-1 min-w-0">
                <div className="flex justify-between items-baseline mb-1">
                  <span className="text-sm font-medium text-gray-800 truncate">{u.name}</span>
                  <span className="text-xs text-gray-500 ml-2 flex-shrink-0">{fmtDuration(u.totalMs)}</span>
                </div>
                <div className="w-full bg-gray-100 rounded-full h-1.5">
                  <div
                    className={`h-1.5 rounded-full ${i === 0 ? 'bg-yellow-400' : i === 1 ? 'bg-gray-400' : i === 2 ? 'bg-orange-400' : 'bg-blue-300'}`}
                    style={{ width: `${(u.totalMs / maxMs) * 100}%` }}
                  />
                </div>
                <p className="text-xs text-gray-400 mt-0.5">{u.count} sessão{u.count !== 1 ? 'ões' : ''}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function DashboardPage() {
  const [devices, setDevices] = useState<Device[]>([])
  const [commands, setCommands] = useState<Command[]>([])
  const [locations, setLocations] = useState<DeviceLocation[]>([])
  const [sessions, setSessions] = useState<SessionRow[]>([])
  const [loading, setLoading] = useState(true)
  const [kpiFrom, setKpiFrom] = useState('')
  const [kpiTo, setKpiTo] = useState('')

  useEffect(() => {
    const tenantId = getTenantId()
    if (!tenantId) return
    Promise.all([
      devicesApi.list(tenantId),
      commandsApi.list(tenantId),
      geolocationApi.latestAll(tenantId).catch(() => ({ data: [] })),
      deviceSessionsApi.list(tenantId, { limit: 500 }).catch(() => ({ data: [] })),
    ]).then(([d, c, l, s]) => {
      setDevices(d.data)
      setCommands(c.data)
      // Deduplicate by deviceId — keep the most-recent entry per device
      const seen = new Set<string>()
      const deduped = (Array.isArray(l.data) ? l.data : []).filter((loc: any) => {
        if (seen.has(loc.deviceId)) return false
        seen.add(loc.deviceId)
        return true
      })
      setLocations(deduped)
      const raw = s.data
      const rows: SessionRow[] = Array.isArray(raw) ? raw : (raw?.data ?? raw?.sessions ?? [])
      setSessions(rows.map((r: any) => ({
        ...r,
        deviceUserName: r.deviceUserName ?? r.deviceUser?.fullName,
      })))
    }).finally(() => setLoading(false))
  }, [])

  const online = devices.filter(d => d.isOnline).length
  const active = devices.filter(d => d.status === 'ACTIVE').length
  const pendingCmds = commands.filter(c => c.status === 'PENDING' || c.status === 'SENT').length

  if (loading) return (
    <div className="flex items-center justify-center h-full">
      <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-600" />
    </div>
  )

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Painel</h1>
        <p className="text-gray-500 mt-1">Visão geral do ambiente E.Guardian</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <StatCard title="Total de Dispositivos" value={devices.length} color="text-primary-600"
          icon="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
        <StatCard title="Online Agora" value={online} color="text-green-600"
          icon="M5.636 18.364a9 9 0 010-12.728m12.728 0a9 9 0 010 12.728m-9.9-2.829a5 5 0 010-7.07m7.072 0a5 5 0 010 7.07M13 12a1 1 0 11-2 0 1 1 0 012 0z" />
        <StatCard title="Dispositivos Ativos" value={active} color="text-blue-600"
          icon="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
        <StatCard title="Comandos Pendentes" value={pendingCmds} color="text-orange-500"
          icon="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
      </div>

      {/* Map */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 mb-6 overflow-hidden isolate relative z-0">
        <div className="flex items-center justify-between px-6 pt-5 pb-3">
          <div>
            <h2 className="font-semibold text-gray-900">Localização dos Dispositivos</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              {locations.length} dispositivo{locations.length !== 1 ? 's' : ''} com dados de localização
            </p>
          </div>
          <div className="flex items-center gap-3 text-xs text-gray-500">
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-green-500 inline-block" /> Online
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-gray-400 inline-block" /> Offline
            </span>
          </div>
        </div>
        {locations.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-56 text-center px-6 pb-6">
            <svg className="w-10 h-10 text-gray-300 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            <p className="text-sm font-medium text-gray-500">Nenhum dado de localização ainda</p>
            <p className="text-xs text-gray-400 mt-1">Envie um comando LOCATE para os dispositivos</p>
          </div>
        ) : (
          <DeviceMap locations={locations} devices={devices} />
        )}
      </div>

      {/* Session Metrics */}
      <div className="mb-6">
        <SessionMetrics sessions={sessions.filter(s => {
          const t = new Date(s.startedAt).getTime()
          const fromTs = kpiFrom ? new Date(kpiFrom).getTime() : 0
          const toTs = kpiTo ? new Date(kpiTo + 'T23:59:59').getTime() : Date.now()
          return t >= fromTs && t <= toTs
        })} />
      </div>

      {/* KPIs operacionais */}
      <div className="mb-6">
        <KpiCards
          devices={devices}
          commands={commands}
          sessions={sessions}
          onFilterChange={(f, t) => { setKpiFrom(f); setKpiTo(t) }}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <h2 className="font-semibold text-gray-900 mb-4">Dispositivos Recentes</h2>
          {devices.length === 0 ? (
            <p className="text-gray-400 text-sm py-4 text-center">Nenhum dispositivo cadastrado ainda</p>
          ) : (
            <div className="space-y-3">
              {devices.slice(0, 5).map(device => (
                <div key={device.id} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
                  <div className="flex items-center gap-3">
                    <div className={`w-2.5 h-2.5 rounded-full ${device.isOnline ? 'bg-green-500' : 'bg-gray-300'}`} />
                    <div>
                      <p className="text-sm font-medium text-gray-900">{device.name}</p>
                      <p className="text-xs text-gray-400">{device.manufacturer} {device.model}</p>
                    </div>
                  </div>
                  <span className={`text-xs px-2 py-1 rounded-full font-medium ${
                    device.status === 'ACTIVE' ? 'bg-green-50 text-green-700' :
                    device.status === 'PENDING' ? 'bg-yellow-50 text-yellow-700' :
                    device.status === 'LOST' ? 'bg-red-50 text-red-700' :
                    'bg-gray-50 text-gray-600'
                  }`}>{device.status}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <h2 className="font-semibold text-gray-900 mb-4">Comandos Recentes</h2>
          {commands.length === 0 ? (
            <p className="text-gray-400 text-sm py-4 text-center">Nenhum comando enviado ainda</p>
          ) : (
            <div className="space-y-3">
              {commands.slice(0, 5).map(cmd => (
                <div key={cmd.id} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
                  <div>
                    <p className="text-sm font-medium text-gray-900">{cmd.type}</p>
                    <p className="text-xs text-gray-400">
                      {formatDistanceToNow(new Date(cmd.createdAt), { addSuffix: true })}
                    </p>
                  </div>
                  <span className={`text-xs px-2 py-1 rounded-full font-medium ${
                    cmd.status === 'EXECUTED' ? 'bg-green-50 text-green-700' :
                    cmd.status === 'FAILED' ? 'bg-red-50 text-red-700' :
                    cmd.status === 'PENDING' ? 'bg-yellow-50 text-yellow-700' :
                    'bg-blue-50 text-blue-700'
                  }`}>{cmd.status}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

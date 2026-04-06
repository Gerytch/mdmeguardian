'use client'

import { useState, useEffect } from 'react'
import { Device, Command } from '@/types'

interface SessionRow {
  startedAt: string
  endedAt?: string
  status: string
  deviceId?: string
  deviceUserId?: string
  deviceUserName?: string
  deviceUser?: { fullName?: string; username?: string }
}

interface Props {
  devices: Device[]
  commands: Command[]
  sessions: SessionRow[]
  onFilterChange?: (from: string, to: string) => void
}

function fmtMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}min`
  return `${Math.floor(m / 60)}h ${m % 60}min`
}

// ─── Card base ───────────────────────────────────────────────────────────────
function KpiCard({
  title, children, action,
}: {
  title: string
  children: React.ReactNode
  action?: React.ReactNode
}) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-gray-700">{title}</h3>
        {action}
      </div>
      {children}
    </div>
  )
}

// ─── 1. Heartbeat (configurable) ────────────────────────────────────────────
function HeartbeatCard({ devices }: { devices: Device[] }) {
  const STORAGE_KEY = 'kpi_heartbeat_min'
  const [threshold, setThreshold] = useState<number>(30)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('30')

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) { setThreshold(Number(saved)); setDraft(saved) }
  }, [])

  const save = () => {
    const v = Math.max(1, Number(draft) || 30)
    setThreshold(v)
    localStorage.setItem(STORAGE_KEY, String(v))
    setEditing(false)
  }

  const cutoff = new Date(Date.now() - threshold * 60_000)
  const stale = devices.filter(d => !d.lastSeenAt || new Date(d.lastSeenAt) < cutoff)
  const pct = devices.length > 0 ? Math.round((stale.length / devices.length) * 100) : 0
  const ok = stale.length === 0

  return (
    <KpiCard
      title="Devices sem heartbeat"
      action={
        editing ? (
          <div className="flex items-center gap-1">
            <input
              autoFocus
              type="number"
              min={1}
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false) }}
              className="w-16 px-2 py-1 text-xs border border-primary-400 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 text-center"
            />
            <span className="text-xs text-gray-400">min</span>
            <button onClick={save} className="px-2 py-1 bg-primary-600 text-white text-xs rounded-lg hover:bg-primary-700">OK</button>
            <button onClick={() => setEditing(false)} className="px-2 py-1 text-gray-400 text-xs hover:text-gray-600">✕</button>
          </div>
        ) : (
          <button
            onClick={() => setEditing(true)}
            title={`Limite atual: ${threshold} min — clique para editar`}
            className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs text-gray-500 hover:bg-gray-100 hover:text-primary-600 transition-colors group"
          >
            <svg className="w-4 h-4 group-hover:rotate-45 transition-transform duration-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            <span className="font-medium">{threshold}min</span>
          </button>
        )
      }
    >
      <div className="flex items-end gap-3 mb-3">
        <span className={`text-4xl font-bold ${ok ? 'text-green-600' : stale.length > devices.length / 2 ? 'text-red-600' : 'text-amber-500'}`}>
          {stale.length}
        </span>
        <span className="text-sm text-gray-400 mb-1">de {devices.length} devices</span>
      </div>
      <div className="w-full bg-gray-100 rounded-full h-2 mb-3">
        <div className={`h-2 rounded-full transition-all ${ok ? 'bg-green-400' : stale.length > devices.length / 2 ? 'bg-red-400' : 'bg-amber-400'}`}
          style={{ width: ok ? '100%' : `${100 - pct}%` }} />
      </div>
      {stale.length === 0 ? (
        <p className="text-xs text-green-600 font-medium">Todos os devices respondendo</p>
      ) : (
        <div className="space-y-1 max-h-24 overflow-y-auto">
          {stale.map(d => (
            <div key={d.id} className="flex items-center justify-between text-xs">
              <span className="text-gray-700 font-medium truncate">{d.name}</span>
              <span className="text-gray-400 ml-2 flex-shrink-0">
                {d.lastSeenAt ? `há ${fmtMs(Date.now() - new Date(d.lastSeenAt).getTime())}` : 'nunca visto'}
              </span>
            </div>
          ))}
        </div>
      )}
    </KpiCard>
  )
}

// ─── 2. Devices sem política ─────────────────────────────────────────────────
function NoPolicyCard({ devices }: { devices: Device[] }) {
  const noPol = devices.filter(d => !d.policyId)
  const ok = noPol.length === 0
  return (
    <KpiCard title="Devices sem política">
      <div className="flex items-end gap-3 mb-3">
        <span className={`text-4xl font-bold ${ok ? 'text-green-600' : 'text-red-600'}`}>{noPol.length}</span>
        <span className="text-sm text-gray-400 mb-1">de {devices.length} devices</span>
      </div>
      {ok ? (
        <p className="text-xs text-green-600 font-medium">Todos os devices com política atribuída</p>
      ) : (
        <div className="space-y-1 max-h-24 overflow-y-auto">
          {noPol.map(d => (
            <div key={d.id} className="flex items-center gap-2 text-xs">
              <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${d.isOnline ? 'bg-green-500' : 'bg-gray-300'}`} />
              <span className="text-gray-700 font-medium">{d.name}</span>
              <span className="text-gray-400 ml-auto">{d.status}</span>
            </div>
          ))}
        </div>
      )}
    </KpiCard>
  )
}

// ─── 3. Taxa de sucesso de comandos ─────────────────────────────────────────
function CommandSuccessCard({ commands }: { commands: Command[] }) {
  const ended = commands.filter(c => c.status === 'EXECUTED' || c.status === 'FAILED')
  const executed = ended.filter(c => c.status === 'EXECUTED').length
  const rate = ended.length > 0 ? Math.round((executed / ended.length) * 100) : 100
  const color = rate >= 95 ? 'text-green-600' : rate >= 80 ? 'text-amber-500' : 'text-red-600'
  const bar = rate >= 95 ? 'bg-green-400' : rate >= 80 ? 'bg-amber-400' : 'bg-red-400'

  const byType = new Map<string, { ok: number; fail: number }>()
  commands.forEach(c => {
    if (c.status !== 'EXECUTED' && c.status !== 'FAILED') return
    const e = byType.get(c.type) ?? { ok: 0, fail: 0 }
    if (c.status === 'EXECUTED') e.ok++ ; else e.fail++
    byType.set(c.type, e)
  })
  const typeRows = Array.from(byType.entries())
    .sort((a, b) => (b[1].ok + b[1].fail) - (a[1].ok + a[1].fail))
    .slice(0, 4)

  return (
    <KpiCard title="Taxa de sucesso de comandos">
      <div className="flex items-end gap-3 mb-2">
        <span className={`text-4xl font-bold ${color}`}>{rate}%</span>
        <span className="text-sm text-gray-400 mb-1">{executed}/{ended.length} executados</span>
      </div>
      <div className="w-full bg-gray-100 rounded-full h-2 mb-4">
        <div className={`h-2 rounded-full ${bar}`} style={{ width: `${rate}%` }} />
      </div>
      <div className="space-y-1.5">
        {typeRows.map(([type, { ok, fail }]) => {
          const t = ok + fail
          const r = Math.round((ok / t) * 100)
          return (
            <div key={type} className="flex items-center gap-2 text-xs">
              <span className="text-gray-500 w-28 truncate">{type}</span>
              <div className="flex-1 bg-gray-100 rounded-full h-1.5">
                <div className={`h-1.5 rounded-full ${r >= 95 ? 'bg-green-400' : r >= 80 ? 'bg-amber-400' : 'bg-red-400'}`}
                  style={{ width: `${r}%` }} />
              </div>
              <span className="text-gray-400 w-8 text-right">{r}%</span>
            </div>
          )
        })}
      </div>
    </KpiCard>
  )
}

// ─── 4. Versão do agente ─────────────────────────────────────────────────────
function AgentVersionCard({ devices }: { devices: Device[] }) {
  const versions = devices.map(d => d.agentVersion).filter(Boolean) as string[]
  const latest = versions.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))[0] ?? null
  const upToDate = latest ? devices.filter(d => d.agentVersion === latest) : []
  const outdated = latest ? devices.filter(d => d.agentVersion !== latest) : devices

  return (
    <KpiCard title="Versão do agente">
      <div className="flex items-center gap-3 mb-4">
        <div className="text-center">
          <p className="text-3xl font-bold text-green-600">{upToDate.length}</p>
          <p className="text-xs text-gray-400">atualizados</p>
        </div>
        <div className="flex-1 h-px bg-gray-100" />
        <div className="text-center">
          <p className={`text-3xl font-bold ${outdated.length > 0 ? 'text-amber-500' : 'text-gray-300'}`}>{outdated.length}</p>
          <p className="text-xs text-gray-400">desatualizados</p>
        </div>
      </div>
      {latest && <p className="text-xs text-gray-400 mb-3">Versão mais recente: <span className="font-mono font-semibold text-gray-700">{latest}</span></p>}
      {outdated.length > 0 && (
        <div className="space-y-1">
          {outdated.map(d => (
            <div key={d.id} className="flex justify-between text-xs">
              <span className="text-gray-700">{d.name}</span>
              <span className="font-mono text-amber-500">{d.agentVersion ?? '—'}</span>
            </div>
          ))}
        </div>
      )}
    </KpiCard>
  )
}

// ─── 5. Kiosk vs Livre ──────────────────────────────────────────────────────
function KioskCard({ devices }: { devices: Device[] }) {
  const kiosk = devices.filter(d => d.isKioskMode).length
  const free = devices.length - kiosk
  const pct = devices.length > 0 ? Math.round((kiosk / devices.length) * 100) : 0
  return (
    <KpiCard title="Kiosk vs Livre">
      <div className="flex items-center gap-3 mb-3">
        <div className="flex-1 text-center">
          <p className="text-3xl font-bold text-indigo-600">{kiosk}</p>
          <p className="text-xs text-gray-400 mt-0.5">Kiosk</p>
        </div>
        <div className="w-px h-10 bg-gray-100" />
        <div className="flex-1 text-center">
          <p className="text-3xl font-bold text-gray-500">{free}</p>
          <p className="text-xs text-gray-400 mt-0.5">Livre</p>
        </div>
      </div>
      <div className="w-full bg-gray-100 rounded-full h-3 overflow-hidden">
        <div className="h-3 bg-indigo-400 rounded-full transition-all" style={{ width: `${pct}%` }} />
      </div>
      <p className="text-xs text-gray-400 mt-2 text-right">{pct}% em kiosk mode</p>
    </KpiCard>
  )
}

// ─── 6. Tempo médio de resposta ──────────────────────────────────────────────
function AvgResponseCard({ commands }: { commands: Command[] }) {
  const withTime = commands.filter(c => c.status === 'EXECUTED' && c.executedAt && c.createdAt)
  const times = withTime.map(c => new Date(c.executedAt!).getTime() - new Date(c.createdAt).getTime())
  const avg = times.length > 0 ? times.reduce((a, b) => a + b, 0) / times.length : null

  // P95: 95% dos comandos são respondidos em até X tempo
  const sorted = [...times].sort((a, b) => a - b)
  const p95 = sorted.length > 0 ? sorted[Math.min(Math.floor(sorted.length * 0.95), sorted.length - 1)] : null

  const isGood = avg !== null && avg < 10000
  const isOk   = avg !== null && avg >= 10000 && avg < 30000
  const color  = avg === null ? 'text-gray-300' : isGood ? 'text-green-600' : isOk ? 'text-amber-500' : 'text-red-600'
  const label  = avg === null ? null : isGood ? 'Rápido' : isOk ? 'Normal' : 'Lento'
  const labelColor = isGood ? 'bg-green-50 text-green-600' : isOk ? 'bg-amber-50 text-amber-600' : 'bg-red-50 text-red-600'

  return (
    <KpiCard title="Tempo de resposta dos comandos">
      <p className="text-xs text-gray-400 -mt-2 mb-3">Do envio até a execução no dispositivo</p>
      <div className="flex items-end gap-3 mb-1">
        <span className={`text-4xl font-bold ${color}`}>{avg !== null ? fmtMs(avg) : '—'}</span>
        <span className="text-sm text-gray-400 mb-1">em média</span>
        {label && (
          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full mb-1.5 ml-auto ${labelColor}`}>{label}</span>
        )}
      </div>
      <div className="space-y-2 text-xs text-gray-500 mt-4">
        <div className="flex justify-between items-center">
          <span>
            Pior caso
            <span className="text-gray-300 ml-1">(95% abaixo de)</span>
          </span>
          <span className="font-medium text-gray-700">{p95 !== null ? fmtMs(p95) : '—'}</span>
        </div>
        <div className="flex justify-between">
          <span>Mais rápido</span>
          <span className="font-medium text-gray-700">{sorted.length > 0 ? fmtMs(sorted[0]) : '—'}</span>
        </div>
        <div className="flex justify-between">
          <span>Mais lento</span>
          <span className="font-medium text-gray-700">{sorted.length > 0 ? fmtMs(sorted[sorted.length - 1]) : '—'}</span>
        </div>
        <div className="flex justify-between pt-1 border-t border-gray-50">
          <span>Comandos analisados</span>
          <span className="font-medium text-gray-700">{withTime.length}</span>
        </div>
      </div>
    </KpiCard>
  )
}

// ─── 7. Pico de uso por hora ─────────────────────────────────────────────────
function PeakHourCard({ sessions }: { sessions: SessionRow[] }) {
  const [tooltip, setTooltip] = useState<{ h: number; count: number } | null>(null)
  const [modal, setModal] = useState<number | null>(null)

  const counts = new Array(24).fill(0)
  sessions.forEach(s => { counts[new Date(s.startedAt).getHours()]++ })
  const max = Math.max(...counts, 1)
  const peakHour = counts.indexOf(Math.max(...counts))

  // Build user summary for a given hour
  function usersForHour(h: number) {
    const byUser = new Map<string, { name: string; totalMs: number; count: number }>()
    sessions
      .filter(s => new Date(s.startedAt).getHours() === h)
      .forEach(s => {
        const uid = s.deviceUserId ?? 'unknown'
        const name = s.deviceUserName ?? s.deviceUser?.fullName ?? s.deviceUser?.username ?? uid.slice(0, 8)
        const start = new Date(s.startedAt).getTime()
        const end = s.endedAt ? new Date(s.endedAt).getTime() : Date.now()
        const existing = byUser.get(uid)
        if (existing) { existing.totalMs += Math.max(0, end - start); existing.count++ }
        else byUser.set(uid, { name, totalMs: Math.max(0, end - start), count: 1 })
      })
    return Array.from(byUser.values()).sort((a, b) => b.totalMs - a.totalMs)
  }

  return (
    <>
      <KpiCard title="Pico de uso por hora">
        <div className="relative flex items-end gap-0.5 h-16 mb-2">
          {tooltip && (
            <div
              className="absolute -top-8 pointer-events-none z-10"
              style={{ left: `calc(${(tooltip.h / 23) * 100}% - 28px)` }}
            >
              <div className="bg-gray-800 text-white text-xs rounded px-2 py-1 whitespace-nowrap shadow-lg">
                {String(tooltip.h).padStart(2, '0')}h — {tooltip.count} {tooltip.count !== 1 ? 'sessões' : 'sessão'}
              </div>
              <div className="w-2 h-2 bg-gray-800 rotate-45 mx-auto -mt-1" />
            </div>
          )}
          {counts.map((c, h) => (
            <div
              key={h}
              className="flex-1 flex flex-col items-center justify-end cursor-pointer"
              onMouseEnter={() => setTooltip({ h, count: c })}
              onMouseLeave={() => setTooltip(null)}
              onClick={() => c > 0 && setModal(h)}
            >
              <div
                className={`w-full rounded-t transition-all hover:opacity-80 ${h === peakHour ? 'bg-primary-500' : c > 0 ? 'bg-primary-100' : 'bg-gray-100'}`}
                style={{ height: `${Math.max(4, (c / max) * 56)}px` }}
              />
            </div>
          ))}
        </div>
        <div className="flex justify-between text-xs text-gray-300">
          <span>0h</span><span>6h</span><span>12h</span><span>18h</span><span>23h</span>
        </div>
        {max > 1 && (
          <p className="text-xs text-gray-500 mt-2">
            Pico às <span className="font-semibold text-gray-700">{String(peakHour).padStart(2, '0')}h</span>
            {' '}com <span className="font-semibold text-gray-700">{counts[peakHour]} {counts[peakHour] !== 1 ? 'sessões' : 'sessão'}</span>
            <span className="text-gray-300 ml-1">(clique na barra)</span>
          </p>
        )}
      </KpiCard>

      {/* Modal */}
      {modal !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setModal(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm mx-4 overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <div>
                <h3 className="font-semibold text-gray-900">Sessões às {String(modal).padStart(2, '0')}h</h3>
                <p className="text-xs text-gray-400 mt-0.5">{counts[modal]} {counts[modal] !== 1 ? 'sessões' : 'sessão'} iniciadas</p>
              </div>
              <button onClick={() => setModal(null)} className="text-gray-400 hover:text-gray-600 text-lg leading-none">✕</button>
            </div>
            <div className="px-5 py-4 max-h-72 overflow-y-auto">
              {usersForHour(modal).length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-4">Nenhuma sessão</p>
              ) : (
                <div className="space-y-3">
                  {usersForHour(modal).map((u, i) => (
                    <div key={i} className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full bg-primary-100 text-primary-600 flex items-center justify-center text-xs font-bold">
                          {u.name.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <p className="text-sm font-medium text-gray-800">{u.name}</p>
                          <p className="text-xs text-gray-400">{u.count} {u.count !== 1 ? 'sessões' : 'sessão'}</p>
                        </div>
                      </div>
                      <span className="text-sm font-semibold text-gray-700">{fmtMs(u.totalMs)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// ─── 8. Device mais usado ────────────────────────────────────────────────────
function TopDevicesCard({ sessions, devices }: { sessions: SessionRow[]; devices: Device[] }) {
  const byDevice = new Map<string, { name: string; count: number; totalMs: number }>()

  sessions.forEach(s => {
    const d = devices.find(d => d.id === s.deviceId)
    const name = d?.name ?? s.deviceId.slice(0, 8)
    const start = new Date(s.startedAt).getTime()
    const end = s.endedAt ? new Date(s.endedAt).getTime() : Date.now()
    const existing = byDevice.get(s.deviceId)
    if (existing) {
      existing.count++
      existing.totalMs += Math.max(0, end - start)
    } else {
      byDevice.set(s.deviceId, { name, count: 1, totalMs: Math.max(0, end - start) })
    }
  })

  const top = Array.from(byDevice.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)

  const maxCount = top[0]?.count ?? 1

  return (
    <KpiCard title="Devices mais usados">
      {top.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-4">Nenhuma sessão registrada</p>
      ) : (
        <div className="space-y-3">
          {top.map((d, i) => (
            <div key={i} className="flex items-center gap-3">
              <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                i === 0 ? 'bg-yellow-100 text-yellow-700' :
                i === 1 ? 'bg-gray-100 text-gray-600' :
                i === 2 ? 'bg-orange-100 text-orange-700' :
                'bg-gray-50 text-gray-400'
              }`}>{i + 1}</span>
              <div className="flex-1 min-w-0">
                <div className="flex justify-between items-baseline mb-1">
                  <span className="text-sm font-medium text-gray-800 truncate">{d.name}</span>
                  <span className="text-xs text-gray-500 ml-2 flex-shrink-0">{d.count} sessão{d.count !== 1 ? 'ões' : ''}</span>
                </div>
                <div className="w-full bg-gray-100 rounded-full h-1.5">
                  <div
                    className={`h-1.5 rounded-full ${i === 0 ? 'bg-yellow-400' : i === 1 ? 'bg-gray-400' : i === 2 ? 'bg-orange-400' : 'bg-blue-300'}`}
                    style={{ width: `${(d.count / maxCount) * 100}%` }}
                  />
                </div>
                <p className="text-xs text-gray-400 mt-0.5">{fmtMs(d.totalMs)} no total</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </KpiCard>
  )
}

// ─── 9. Sessões simultâneas ──────────────────────────────────────────────────
function PeakConcurrentCard({ sessions }: { sessions: SessionRow[] }) {
  // Build sweep-line events: +1 on start, -1 on end
  const events: { t: number; delta: 1 | -1 }[] = []
  sessions.forEach(s => {
    events.push({ t: new Date(s.startedAt).getTime(), delta: 1 })
    events.push({ t: s.endedAt ? new Date(s.endedAt).getTime() : Date.now(), delta: -1 })
  })
  events.sort((a, b) => a.t - b.t)

  let current = 0
  let peak = 0
  let peakTime: Date | null = null
  events.forEach(e => {
    current += e.delta
    if (current > peak) { peak = current; peakTime = new Date(e.t) }
  })

  const activeNow = sessions.filter(s => s.status === 'ACTIVE').length
  const color = peak <= 1 ? 'text-gray-400' : peak <= 3 ? 'text-blue-600' : peak <= 6 ? 'text-amber-500' : 'text-red-600'

  return (
    <KpiCard title="Sessões simultâneas">
      <div className="flex items-end gap-3 mb-4">
        <span className={`text-4xl font-bold ${color}`}>{peak}</span>
        <span className="text-sm text-gray-400 mb-1">pico histórico</span>
      </div>
      <div className="space-y-2 text-xs text-gray-500">
        <div className="flex justify-between">
          <span>Ativas agora</span>
          <span className={`font-semibold ${activeNow > 0 ? 'text-green-600' : 'text-gray-400'}`}>{activeNow}</span>
        </div>
        {peakTime && (
          <div className="flex justify-between">
            <span>Pico em</span>
            <span className="font-medium text-gray-700">
              {peakTime.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}
              {' '}às {peakTime.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>
        )}
        <div className="flex justify-between">
          <span>Total de sessões</span>
          <span className="font-medium text-gray-700">{sessions.length}</span>
        </div>
      </div>
    </KpiCard>
  )
}

// ─── Date filter bar ─────────────────────────────────────────────────────────
type Preset = '7d' | '30d' | 'month' | 'lastmonth' | 'all' | 'custom'

function toDateStr(d: Date) {
  return d.toISOString().slice(0, 10)
}

function DateFilterBar({
  from, to, onRange,
}: {
  from: string
  to: string
  onRange: (from: string, to: string) => void
}) {
  const [preset, setPreset] = useState<Preset>('30d')
  const [customFrom, setCustomFrom] = useState(from)
  const [customTo, setCustomTo] = useState(to)

  function applyPreset(p: Preset) {
    setPreset(p)
    const now = new Date()
    if (p === '7d') {
      const f = new Date(now); f.setDate(f.getDate() - 6)
      onRange(toDateStr(f), toDateStr(now))
    } else if (p === '30d') {
      const f = new Date(now); f.setDate(f.getDate() - 29)
      onRange(toDateStr(f), toDateStr(now))
    } else if (p === 'month') {
      const f = new Date(now.getFullYear(), now.getMonth(), 1)
      onRange(toDateStr(f), toDateStr(now))
    } else if (p === 'lastmonth') {
      const f = new Date(now.getFullYear(), now.getMonth() - 1, 1)
      const t = new Date(now.getFullYear(), now.getMonth(), 0)
      onRange(toDateStr(f), toDateStr(t))
    } else if (p === 'all') {
      onRange('', '')
    }
  }

  useEffect(() => { applyPreset('30d') }, [])

  const presets: { key: Preset; label: string }[] = [
    { key: '7d', label: '7 dias' },
    { key: '30d', label: '30 dias' },
    { key: 'month', label: 'Este mês' },
    { key: 'lastmonth', label: 'Mês passado' },
    { key: 'all', label: 'Desde o início' },
    { key: 'custom', label: 'Personalizado' },
  ]

  return (
    <div className="flex flex-wrap items-center gap-2">
      {presets.map(p => (
        <button
          key={p.key}
          onClick={() => applyPreset(p.key)}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
            preset === p.key
              ? 'bg-primary-600 text-white'
              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}
        >
          {p.label}
        </button>
      ))}
      {preset === 'custom' && (
        <div className="flex items-center gap-2 ml-1">
          <input
            type="date"
            value={customFrom}
            max={customTo}
            onChange={e => setCustomFrom(e.target.value)}
            className="px-2 py-1 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
          <span className="text-xs text-gray-400">até</span>
          <input
            type="date"
            value={customTo}
            min={customFrom}
            max={toDateStr(new Date())}
            onChange={e => setCustomTo(e.target.value)}
            className="px-2 py-1 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
          <button
            onClick={() => onRange(customFrom, customTo)}
            className="px-3 py-1 bg-primary-600 text-white text-xs rounded-lg hover:bg-primary-700"
          >
            Aplicar
          </button>
        </div>
      )}
      <span className="text-xs text-gray-400 ml-1">
        {preset === 'all' ? 'todos os dados' : `${from} → ${to}`}
      </span>
    </div>
  )
}

// ─── Export principal ────────────────────────────────────────────────────────
export default function KpiCards({ devices, commands, sessions, onFilterChange }: Props) {
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  const fromTs = from ? new Date(from).getTime() : 0
  const toTs = to ? new Date(to + 'T23:59:59').getTime() : Date.now()

  const filteredSessions = sessions.filter(s => {
    const t = new Date(s.startedAt).getTime()
    return t >= fromTs && t <= toTs
  })

  const filteredCommands = commands.filter(c => {
    const t = new Date((c as any).createdAt).getTime()
    return t >= fromTs && t <= toTs
  })

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-semibold text-gray-900">KPIs Operacionais</h2>
        <DateFilterBar
          from={from}
          to={to}
          onRange={(f, t) => { setFrom(f); setTo(t); onFilterChange?.(f, t) }}
        />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <HeartbeatCard devices={devices} />
        <NoPolicyCard devices={devices} />
        <AgentVersionCard devices={devices} />
        <KioskCard devices={devices} />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        <CommandSuccessCard commands={filteredCommands} />
        <AvgResponseCard commands={filteredCommands} />
        <PeakHourCard sessions={filteredSessions} />
        <TopDevicesCard sessions={filteredSessions} devices={devices} />
        <PeakConcurrentCard sessions={filteredSessions} />
      </div>
    </div>
  )
}

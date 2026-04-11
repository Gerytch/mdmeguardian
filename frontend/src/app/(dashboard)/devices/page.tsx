'use client'

import { useEffect, useState, useRef } from 'react'
import Link from 'next/link'
import { devicesApi, commandsApi, appsApi } from '@/lib/api'
import { getTenantId } from '@/lib/auth'
import { Device } from '@/types'
import { formatDistanceToNow } from 'date-fns'

export default function DevicesPage() {
  const [devices, setDevices] = useState<Device[]>([])
  const [loading, setLoading] = useState(true)

  // Agent update modal state
  const [showUpdateAgent, setShowUpdateAgent] = useState(false)
  const [agentApkUrl, setAgentApkUrl] = useState('')
  const [agentVersion, setAgentVersion] = useState('')
  const [agentUploading, setAgentUploading] = useState(false)
  const [agentDispatching, setAgentDispatching] = useState(false)
  const [agentResult, setAgentResult] = useState<{ dispatched: number } | null>(null)
  const [agentError, setAgentError] = useState('')
  const [agentTargetAll, setAgentTargetAll] = useState(true)
  const [agentSelectedIds, setAgentSelectedIds] = useState<string[]>([])
  const [showConfirmAll, setShowConfirmAll] = useState(false)
  const [agentApkLoading, setAgentApkLoading] = useState(false)
  const agentFileRef = useRef<HTMLInputElement>(null)

  const tenantId = getTenantId()

  const load = () => {
    if (!tenantId) return
    devicesApi.list(tenantId).then(r => setDevices(r.data)).finally(() => setLoading(false))
  }

  useEffect(load, [])

  const handleAgentApkUpload = async (file: File) => {
    if (!tenantId) return
    setAgentUploading(true)
    setAgentError('')
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await appsApi.uploadApk(tenantId, form as any)
      setAgentApkUrl(res.data.apkUrl)
      if (res.data.versionName) setAgentVersion(res.data.versionName)
    } catch {
      setAgentError('Erro ao fazer upload do APK.')
    } finally {
      setAgentUploading(false)
    }
  }

  const handleDispatchAgentUpdate = async () => {
    if (!tenantId || !agentApkUrl || !agentVersion) return
    setAgentDispatching(true)
    setAgentError('')
    setAgentResult(null)
    try {
      const deviceIds = agentTargetAll ? undefined : agentSelectedIds
      const res = await commandsApi.dispatchAgentUpdate(tenantId, { apkUrl: agentApkUrl, version: agentVersion, deviceIds })
      setAgentResult({ dispatched: res.data.dispatched })
    } catch {
      setAgentError('Erro ao despachar atualização.')
    } finally {
      setAgentDispatching(false)
    }
  }

  const openUpdateAgent = async () => {
    setShowUpdateAgent(true)
    if (!tenantId) return
    setAgentApkLoading(true)
    try {
      const res = await appsApi.getAgentApk(tenantId)
      if (res.data?.apkUrl) setAgentApkUrl(res.data.apkUrl)
      if (res.data?.version) setAgentVersion(res.data.version)
    } catch { /* ignore — user can still upload manually */ }
    finally { setAgentApkLoading(false) }
  }

  const closeUpdateAgent = () => {
    setShowUpdateAgent(false)
    setAgentApkUrl('')
    setAgentVersion('')
    setAgentResult(null)
    setAgentError('')
    setAgentTargetAll(true)
    setAgentSelectedIds([])
    setShowConfirmAll(false)
    if (agentFileRef.current) agentFileRef.current.value = ''
  }

  const statusColor = (s: Device['status']) =>
    s === 'ACTIVE'   ? 'bg-green-50 text-green-700' :
    s === 'PENDING'  ? 'bg-yellow-50 text-yellow-700' :
    s === 'LOST'     ? 'bg-red-50 text-red-700' :
    s === 'WIPED'    ? 'bg-gray-50 text-gray-500' :
    'bg-gray-50 text-gray-600'

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Dispositivos</h1>
          <p className="text-gray-500 mt-1">{devices.length} dispositivo{devices.length !== 1 ? 's' : ''} cadastrado{devices.length !== 1 ? 's' : ''}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={openUpdateAgent}
            className="border border-indigo-300 text-indigo-700 hover:bg-indigo-50 px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Atualizar Agente
          </button>
          <Link
            href="/enroll"
            className="bg-primary-600 hover:bg-primary-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Adicionar Dispositivo
          </Link>
        </div>
      </div>

      {/* Modal de atualização do agente */}
      {showUpdateAgent && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={closeUpdateAgent}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-gray-100">
              <div>
                <h3 className="font-semibold text-gray-900">Atualizar Agente E.Guardian</h3>
                <p className="text-xs text-gray-400 mt-0.5">Envia UPDATE_AGENT para os dispositivos selecionados</p>
              </div>
              <button onClick={closeUpdateAgent} className="text-gray-400 hover:text-gray-600 text-lg leading-none">✕</button>
            </div>

            <div className="px-6 py-5 space-y-4">
              {agentResult ? (
                <div className="flex flex-col items-center py-6 gap-3">
                  <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center">
                    <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <p className="font-semibold text-gray-900">Atualização despachada!</p>
                  <p className="text-sm text-gray-500">Comando enviado para <strong>{agentResult.dispatched}</strong> dispositivo{agentResult.dispatched !== 1 ? 's' : ''}.</p>
                  <p className="text-xs text-gray-400">O agente irá baixar e instalar silenciosamente.</p>
                  <button onClick={closeUpdateAgent} className="mt-2 px-5 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700">Fechar</button>
                </div>
              ) : (
                <>
                  {/* APK Upload */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">APK do Agente</label>
                    {agentApkLoading ? (
                      <p className="text-xs text-gray-400">Carregando APK armazenado...</p>
                    ) : agentApkUrl ? (
                      <div className="flex items-center justify-between bg-green-50 border border-green-200 rounded-lg px-3 py-2">
                        <p className="text-xs text-green-700 truncate flex-1">✓ APK armazenado: {agentApkUrl.split('/').pop()}</p>
                        <label className="ml-2 text-xs text-indigo-600 hover:text-indigo-800 cursor-pointer font-medium flex-shrink-0">
                          Trocar
                          <input ref={agentFileRef} type="file" accept=".apk" className="hidden" disabled={agentUploading}
                            onChange={e => e.target.files?.[0] && handleAgentApkUpload(e.target.files[0])} />
                        </label>
                      </div>
                    ) : (
                      <div className="flex gap-2">
                        <input type="text" placeholder="Faça upload do APK →" value={agentApkUrl}
                          onChange={e => setAgentApkUrl(e.target.value)}
                          className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
                        <label className={`px-3 py-2 border rounded-lg text-sm font-medium cursor-pointer transition-colors ${agentUploading ? 'bg-gray-100 text-gray-400' : 'border-indigo-300 text-indigo-700 hover:bg-indigo-50'}`}>
                          {agentUploading ? '...' : 'Upload'}
                          <input ref={agentFileRef} type="file" accept=".apk" className="hidden" disabled={agentUploading}
                            onChange={e => e.target.files?.[0] && handleAgentApkUpload(e.target.files[0])} />
                        </label>
                      </div>
                    )}
                  </div>

                  {/* Versão */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Versão (ex: 1.3.3)</label>
                    <input
                      type="text"
                      placeholder="1.3.3"
                      value={agentVersion}
                      onChange={e => setAgentVersion(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                    />
                  </div>

                  {/* Alvo */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Dispositivos alvo</label>
                    <div className="space-y-2">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input type="radio" checked={agentTargetAll} onChange={() => setAgentTargetAll(true)} className="accent-indigo-600" />
                        <span className="text-sm text-gray-700">Todos os dispositivos <span className="text-gray-400">({devices.length})</span></span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input type="radio" checked={!agentTargetAll} onChange={() => setAgentTargetAll(false)} className="accent-indigo-600" />
                        <span className="text-sm text-gray-700">Selecionar dispositivos</span>
                      </label>
                    </div>
                    {!agentTargetAll && (
                      <div className="mt-2 max-h-40 overflow-y-auto border border-gray-200 rounded-lg divide-y divide-gray-100">
                        {devices.map(d => (
                          <label key={d.id} className="flex items-center gap-3 px-3 py-2 hover:bg-gray-50 cursor-pointer">
                            <input
                              type="checkbox"
                              className="accent-indigo-600"
                              checked={agentSelectedIds.includes(d.id)}
                              onChange={e => setAgentSelectedIds(prev => e.target.checked ? [...prev, d.id] : prev.filter(x => x !== d.id))}
                            />
                            <div className={`w-2 h-2 rounded-full flex-shrink-0 ${d.isOnline ? 'bg-green-500' : 'bg-gray-300'}`} />
                            <span className="text-sm text-gray-700">{d.name}</span>
                            <span className="text-xs text-gray-400 ml-auto">{d.agentVersion ?? '—'}</span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>

                  {agentError && <p className="text-sm text-red-600">{agentError}</p>}

                  <div className="flex gap-2 pt-1">
                    <button onClick={closeUpdateAgent} className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50">Cancelar</button>
                    <button
                      onClick={() => agentTargetAll ? setShowConfirmAll(true) : handleDispatchAgentUpdate()}
                      disabled={agentDispatching || !agentApkUrl.trim() || !agentVersion.trim() || (!agentTargetAll && agentSelectedIds.length === 0)}
                      className="flex-1 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
                    >
                      {agentDispatching ? 'Despachando...' : 'Despachar Atualização'}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Popup de confirmação — atualizar TODOS */}
      {showConfirmAll && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60] p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0">
                <svg className="w-5 h-5 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                </svg>
              </div>
              <div>
                <h4 className="font-semibold text-gray-900">Atenção — Todos os dispositivos</h4>
                <p className="text-xs text-gray-400 mt-0.5">Esta ação afeta {devices.length} dispositivo{devices.length !== 1 ? 's' : ''}</p>
              </div>
            </div>
            <p className="text-sm text-gray-700">
              Você está prestes a enviar a atualização <strong className="text-indigo-700">{agentVersion}</strong> para <strong>todos</strong> os dispositivos deste ambiente.
            </p>
            <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-800">
              Verifique se você está no ambiente correto (<strong>homologação</strong> ou <strong>produção</strong>) antes de continuar.
            </div>
            <div className="flex gap-2 pt-1">
              <button
                onClick={() => setShowConfirmAll(false)}
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50"
              >
                Cancelar
              </button>
              <button
                onClick={() => { setShowConfirmAll(false); handleDispatchAgentUpdate() }}
                className="flex-1 px-4 py-2 bg-amber-600 text-white rounded-lg text-sm font-medium hover:bg-amber-700"
              >
                Confirmar e Despachar
              </button>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-600" />
        </div>
      ) : devices.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-xl border border-gray-100">
          <svg className="w-12 h-12 text-gray-300 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
          </svg>
          <p className="text-gray-700 font-medium mb-1">Nenhum dispositivo cadastrado</p>
          <p className="text-gray-400 text-sm mb-4">Instale o agente E.Guardian em um dispositivo Android para começar.</p>
          <Link
            href="/enroll"
            className="inline-flex items-center gap-2 px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium rounded-lg transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Como adicionar um dispositivo
          </Link>
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Dispositivo</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Bateria</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Última Vez Visto</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {devices.map(device => (
                <tr key={device.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${device.isOnline ? 'bg-green-500' : 'bg-gray-300'}`} />
                      <div>
                        <p className="font-medium text-gray-900 text-sm">{device.name}</p>
                        <p className="text-xs text-gray-400">{device.manufacturer} {device.model} · {device.serialNumber}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <span className={`text-xs px-2 py-1 rounded-full font-medium ${statusColor(device.status)}`}>
                      {device.status}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    {device.batteryLevel !== null ? (
                      <div className="flex items-center gap-2">
                        <div className="w-16 h-2 bg-gray-200 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${device.batteryLevel > 50 ? 'bg-green-500' : device.batteryLevel > 20 ? 'bg-yellow-500' : 'bg-red-500'}`}
                            style={{ width: `${device.batteryLevel}%` }}
                          />
                        </div>
                        <span className="text-xs text-gray-500">{device.batteryLevel}%</span>
                      </div>
                    ) : <span className="text-xs text-gray-400">—</span>}
                  </td>
                  <td className="px-6 py-4 text-xs text-gray-400">
                    {device.lastSeenAt ? formatDistanceToNow(new Date(device.lastSeenAt), { addSuffix: true }) : '—'}
                  </td>
                  <td className="px-6 py-4">
                    <Link href={`/devices/${device.id}`}
                      className="text-primary-600 hover:text-primary-700 text-xs font-medium">
                      Gerenciar →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

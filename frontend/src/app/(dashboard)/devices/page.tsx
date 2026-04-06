'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import QRCode from 'qrcode'
import { devicesApi } from '@/lib/api'
import { getTenantId } from '@/lib/auth'
import { Device } from '@/types'
import { formatDistanceToNow } from 'date-fns'

const BASE_URL = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1').replace(/\/api\/v1\/?$/, '')
const APK_URL = `${BASE_URL}/uploads/eguardian-agent.apk`

export default function DevicesPage() {
  const [devices, setDevices] = useState<Device[]>([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)

  // QR enrollment state
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  const [qrExpiresAt, setQrExpiresAt] = useState<Date | null>(null)
  const [qrLoading, setQrLoading] = useState(false)
  const [qrError, setQrError] = useState('')

  const tenantId = getTenantId()

  const load = () => {
    if (!tenantId) return
    devicesApi.list(tenantId).then(r => setDevices(r.data)).finally(() => setLoading(false))
  }

  useEffect(load, [])

  const generateQr = useCallback(async () => {
    if (!tenantId) return
    setQrLoading(true)
    setQrError('')
    setQrDataUrl(null)
    try {
      const res = await devicesApi.generateEnrollmentToken(tenantId)
      const { qrPayload, expiresAt } = res.data
      // Add serverUrl so the Android app knows which server to connect to
      const payload = JSON.stringify({ ...JSON.parse(qrPayload), serverUrl: BASE_URL })
      const dataUrl = await QRCode.toDataURL(payload, { width: 220, margin: 2, color: { dark: '#111827', light: '#ffffff' } })
      setQrDataUrl(dataUrl)
      setQrExpiresAt(new Date(expiresAt))
    } catch {
      setQrError('Erro ao gerar QR code. Tente novamente.')
    } finally {
      setQrLoading(false)
    }
  }, [tenantId])

  // Generate QR when modal opens
  useEffect(() => {
    if (showAdd) generateQr()
    else { setQrDataUrl(null); setQrExpiresAt(null); setQrError('') }
  }, [showAdd])

  // Check if QR is expired
  const qrExpired = qrExpiresAt ? new Date() > qrExpiresAt : false

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
        <button
          onClick={() => setShowAdd(true)}
          className="bg-primary-600 hover:bg-primary-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Adicionar Dispositivo
        </button>
      </div>

      {/* Modal de enrollment via QR */}
      {showAdd && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setShowAdd(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm" onClick={e => e.stopPropagation()}>

            {/* Header */}
            <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-gray-100">
              <div>
                <h3 className="font-semibold text-gray-900">Adicionar Dispositivo</h3>
                <p className="text-xs text-gray-400 mt-0.5">Escaneie o QR no agente E.Guardian</p>
              </div>
              <button onClick={() => setShowAdd(false)} className="text-gray-400 hover:text-gray-600 text-lg leading-none">✕</button>
            </div>

            <div className="px-6 py-5">
              {/* QR Code area */}
              <div className="flex flex-col items-center mb-5">
                {qrLoading && (
                  <div className="w-[220px] h-[220px] flex items-center justify-center bg-gray-50 rounded-xl border border-gray-100">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
                  </div>
                )}
                {qrError && (
                  <div className="w-[220px] h-[220px] flex flex-col items-center justify-center bg-red-50 rounded-xl border border-red-100 gap-2">
                    <p className="text-xs text-red-600 text-center px-4">{qrError}</p>
                    <button onClick={generateQr} className="text-xs text-red-700 font-medium underline">Tentar novamente</button>
                  </div>
                )}
                {qrDataUrl && !qrExpired && (
                  <img src={qrDataUrl} alt="QR Code de enrollment" className="rounded-xl border border-gray-100 shadow-sm" width={220} height={220} />
                )}
                {qrDataUrl && qrExpired && (
                  <div className="w-[220px] h-[220px] flex flex-col items-center justify-center bg-amber-50 rounded-xl border border-amber-100 gap-2">
                    <p className="text-xs text-amber-700 font-medium">QR expirado</p>
                    <button onClick={generateQr} className="text-xs text-amber-700 underline">Gerar novo QR</button>
                  </div>
                )}
                {qrExpiresAt && !qrExpired && (
                  <p className="text-xs text-gray-400 mt-2">
                    Válido por 1 hora · expira às {qrExpiresAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                  </p>
                )}
              </div>

              {/* Instruções */}
              <ol className="space-y-3 text-xs text-gray-600">
                <li className="flex gap-3">
                  <span className="w-5 h-5 rounded-full bg-primary-100 text-primary-700 font-bold flex items-center justify-center flex-shrink-0 text-[10px]">1</span>
                  <span>Instale o <strong>E.Guardian APK</strong> no dispositivo Android</span>
                </li>
                <li className="flex gap-3">
                  <span className="w-5 h-5 rounded-full bg-primary-100 text-primary-700 font-bold flex items-center justify-center flex-shrink-0 text-[10px]">2</span>
                  <span>Abra o app — toque em <strong>"Escanear QR"</strong></span>
                </li>
                <li className="flex gap-3">
                  <span className="w-5 h-5 rounded-full bg-primary-100 text-primary-700 font-bold flex items-center justify-center flex-shrink-0 text-[10px]">3</span>
                  <span>Aponte a câmera para este QR — o dispositivo será cadastrado automaticamente</span>
                </li>
              </ol>
            </div>

            {/* Footer */}
            <div className="px-6 pb-5 flex items-center justify-between border-t border-gray-50 pt-4">
              <a href={APK_URL} download className="flex items-center gap-1.5 text-xs text-primary-600 hover:text-primary-700 font-medium transition-colors">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                Baixar APK
              </a>
              <div className="flex gap-2">
                <button onClick={() => { load(); }} className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  Atualizar lista
                </button>
                <button onClick={() => setShowAdd(false)} className="px-4 py-1.5 border border-gray-300 rounded-lg text-xs font-medium text-gray-700 hover:bg-gray-50">
                  Fechar
                </button>
              </div>
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
          <button
            onClick={() => setShowAdd(true)}
            className="inline-flex items-center gap-2 px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium rounded-lg transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Como adicionar um dispositivo
          </button>
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

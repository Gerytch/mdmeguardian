'use client'

import { useEffect, useState, useCallback } from 'react'
import QRCode from 'qrcode'
import { devicesApi } from '@/lib/api'
import { getTenantId } from '@/lib/auth'

const BASE_URL = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1').replace(/\/api\/v1\/?$/, '')
const APK_URL = `${BASE_URL}/uploads/eguardian-agent.apk`

// Debug keystore SHA-256 → base64url (fixed for homolog build)
const PROVISIONING_CHECKSUM = 'dtXll4PyP9KysSoV_uxNAFytkiT0-14Z3Pzu2w-6eNM'
const PROVISIONING_COMPONENT = 'com.mdm.enterprise.homolog/com.mdm.enterprise.admin.MdmDeviceAdminReceiver'

export default function EnrollPage() {
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  const [expiresAt, setExpiresAt] = useState<Date | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [provisioningQr, setProvisioningQr] = useState<string | null>(null)
  const tenantId = getTenantId()

  const generate = useCallback(async () => {
    if (!tenantId) return
    setLoading(true)
    setError('')
    try {
      const res = await devicesApi.generateEnrollmentToken(tenantId)
      const { qrPayload, expiresAt: exp } = res.data
      const payload = JSON.stringify({ ...JSON.parse(qrPayload), serverUrl: BASE_URL })
      const dataUrl = await QRCode.toDataURL(payload, {
        width: 280,
        margin: 2,
        color: { dark: '#111827', light: '#ffffff' },
      })
      setQrDataUrl(dataUrl)
      setExpiresAt(new Date(exp))
    } catch {
      setError('Erro ao gerar QR code. Verifique a conexão com o servidor.')
    } finally {
      setLoading(false)
    }
  }, [tenantId])

  useEffect(() => { generate() }, [generate])

  // Generate provisioning QR (static — no API call)
  useEffect(() => {
    const payload = JSON.stringify({
      'android.app.extra.PROVISIONING_DEVICE_ADMIN_COMPONENT_NAME': PROVISIONING_COMPONENT,
      'android.app.extra.PROVISIONING_DEVICE_ADMIN_SIGNATURE_CHECKSUM': PROVISIONING_CHECKSUM,
      'android.app.extra.PROVISIONING_DEVICE_ADMIN_PACKAGE_DOWNLOAD_LOCATION': APK_URL,
      'android.app.extra.PROVISIONING_SKIP_ENCRYPTION': false,
      'android.app.extra.PROVISIONING_LEAVE_ALL_SYSTEM_APPS_ENABLED': true,
    })
    QRCode.toDataURL(payload, { width: 280, margin: 2, color: { dark: '#111827', light: '#ffffff' } })
      .then(setProvisioningQr)
  }, [])

  // Auto-regenerate 1 min before expiry
  useEffect(() => {
    if (!expiresAt) return
    const msUntilRegen = expiresAt.getTime() - Date.now() - 60_000
    if (msUntilRegen <= 0) return
    const t = setTimeout(generate, msUntilRegen)
    return () => clearTimeout(t)
  }, [expiresAt, generate])

  const expired = expiresAt ? new Date() > expiresAt : false
  const expiryStr = expiresAt
    ? expiresAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    : null

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Cadastrar Dispositivo</h1>
        <p className="text-gray-500 mt-1">Escaneie o QR code no app E.Guardian para registrar um novo dispositivo</p>
      </div>

      <div className="max-w-3xl grid grid-cols-1 md:grid-cols-2 gap-6">

        {/* QR Card */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 flex flex-col items-center gap-4">
          <h2 className="text-sm font-semibold text-gray-700 self-start">QR Code de Enrollment</h2>

          {loading && (
            <div className="w-[280px] h-[280px] flex items-center justify-center bg-gray-50 rounded-xl border border-gray-100">
              <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-600" />
            </div>
          )}

          {error && (
            <div className="w-[280px] h-[280px] flex flex-col items-center justify-center bg-red-50 rounded-xl border border-red-100 gap-3 px-6 text-center">
              <p className="text-sm text-red-700">{error}</p>
              <button onClick={generate} className="px-4 py-2 bg-red-600 text-white text-xs rounded-lg hover:bg-red-700">
                Tentar novamente
              </button>
            </div>
          )}

          {qrDataUrl && !expired && (
            <div className="border-4 border-gray-900 rounded-xl p-1.5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qrDataUrl} alt="QR Code de Enrollment" width={280} height={280} />
            </div>
          )}

          {qrDataUrl && expired && (
            <div className="w-[280px] h-[280px] flex flex-col items-center justify-center bg-amber-50 rounded-xl border border-amber-100 gap-3">
              <p className="text-sm font-medium text-amber-700">QR expirado</p>
              <button onClick={generate} className="px-4 py-2 bg-amber-600 text-white text-xs rounded-lg hover:bg-amber-700">
                Gerar novo QR
              </button>
            </div>
          )}

          {expiryStr && !expired && (
            <div className="text-center">
              <p className="text-xs text-gray-400">Válido por 1 hora — expira às <span className="font-medium text-gray-600">{expiryStr}</span></p>
              <p className="text-xs text-gray-300 mt-0.5">Renovado automaticamente 1 minuto antes de expirar</p>
            </div>
          )}

          <button
            onClick={generate}
            disabled={loading}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition-colors"
          >
            {loading ? 'Gerando...' : 'Gerar novo QR'}
          </button>
        </div>

        {/* Instructions Card */}
        <div className="flex flex-col gap-4">

          {/* Steps */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
            <h2 className="text-sm font-semibold text-gray-700 mb-4">Como cadastrar</h2>
            <ol className="space-y-4">
              {[
                { title: 'Instale o E.Guardian', desc: 'Baixe e instale o APK no dispositivo Android.' },
                { title: 'Abra o app', desc: 'Na tela inicial toque em "Escanear QR Code".' },
                { title: 'Aponte para o QR', desc: 'O dispositivo se cadastra e aparece na lista automaticamente.' },
              ].map((step, i) => (
                <li key={i} className="flex gap-3">
                  <span className="w-6 h-6 rounded-full bg-primary-600 text-white text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">
                    {i + 1}
                  </span>
                  <div>
                    <p className="text-sm font-medium text-gray-800">{step.title}</p>
                    <p className="text-xs text-gray-500 mt-0.5">{step.desc}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>

          {/* Download APK */}
          <div className="bg-primary-50 border border-primary-100 rounded-xl p-5">
            <p className="text-sm font-semibold text-primary-800 mb-1">Ainda não tem o app?</p>
            <p className="text-xs text-primary-600 mb-3">Baixe o agente E.Guardian e instale no dispositivo Android.</p>
            <a
              href={APK_URL}
              download
              className="inline-flex items-center gap-2 px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium rounded-lg transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Baixar E.Guardian APK
            </a>
          </div>

          {/* Server info */}
          <div className="bg-gray-50 border border-gray-100 rounded-xl p-4">
            <p className="text-xs font-medium text-gray-500 mb-1">Servidor configurado</p>
            <p className="text-xs font-mono text-gray-700 break-all">{BASE_URL}</p>
          </div>
        </div>
      </div>

      {/* Provisioning QR — for factory-reset devices */}
      <div className="max-w-3xl mt-8 border-t border-gray-100 pt-8">
        <h2 className="text-lg font-bold text-gray-900 mb-1">Provisionamento Empresarial</h2>
        <p className="text-sm text-gray-500 mb-6">
          Para dispositivos zerados (factory reset). Instala o app e configura como Device Owner automaticamente — sem precisar de ADB.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 flex flex-col items-center gap-4">
            <h3 className="text-sm font-semibold text-gray-700 self-start">QR de Provisionamento</h3>
            {provisioningQr ? (
              <div className="border-4 border-primary-600 rounded-xl p-1.5">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={provisioningQr} alt="QR de Provisionamento Empresarial" width={280} height={280} />
              </div>
            ) : (
              <div className="w-[280px] h-[280px] flex items-center justify-center bg-gray-50 rounded-xl border border-gray-100">
                <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-600" />
              </div>
            )}
            <p className="text-xs text-gray-400 text-center">
              Leia este QR na tela de configuração inicial do Android (toque 6× na tela de boas-vindas para ativar a câmera)
            </p>
          </div>
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
            <h3 className="text-sm font-semibold text-gray-700 mb-4">Como usar</h3>
            <ol className="space-y-4">
              {[
                { title: 'Factory reset no dispositivo', desc: 'Restaure o dispositivo para o padrão de fábrica e remova qualquer conta Google.' },
                { title: 'Toque 6× na tela de boas-vindas', desc: 'A câmera de provisionamento abre automaticamente.' },
                { title: 'Aponte para este QR', desc: 'O Android baixa e instala o E.Guardian, configura como Device Owner.' },
                { title: 'Escaneie o QR de Enrollment', desc: 'Use o QR acima para registrar o dispositivo no servidor.' },
              ].map((step, i) => (
                <li key={i} className="flex gap-3">
                  <span className="w-6 h-6 rounded-full bg-primary-600 text-white text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">
                    {i + 1}
                  </span>
                  <div>
                    <p className="text-sm font-medium text-gray-800">{step.title}</p>
                    <p className="text-xs text-gray-500 mt-0.5">{step.desc}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>
    </div>
  )
}

'use client'

import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { getTenantId } from '@/lib/auth'

export default function EnrollPage() {
  const [qrData, setQrData] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)
  const tenantId = getTenantId()

  const generate = async () => {
    setLoading(true)
    try {
      // Get current token from localStorage
      const token = localStorage.getItem('accessToken')
      if (!token) return

      const data = JSON.stringify({
        serverUrl: 'http://10.0.2.2:3002',
        tenantId,
        enrollmentToken: token,
        policyId: null,
      })
      setQrData(data)
    } finally {
      setLoading(false)
    }
  }

  const copy = () => {
    if (!qrData) return
    navigator.clipboard.writeText(qrData)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  useEffect(() => { generate() }, [])

  const qrUrl = qrData
    ? `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(qrData)}`
    : null

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Cadastrar Dispositivo</h1>
        <p className="text-gray-500 mt-1">Escaneie este QR code no dispositivo Android para cadastrá-lo</p>
      </div>

      <div className="max-w-2xl">
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-8">
          <div className="flex flex-col items-center gap-6">

            {qrUrl ? (
              <>
                <div className="border-4 border-gray-900 rounded-xl p-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={qrUrl} alt="Enrollment QR Code" width={300} height={300} />
                </div>

                <div className="text-center">
                  <p className="text-sm font-medium text-gray-700">Como cadastrar:</p>
                  <ol className="text-sm text-gray-500 mt-2 text-left list-decimal list-inside space-y-1">
                    <li>Abra o app <strong>E.Guardian MDM</strong> no dispositivo Android</li>
                    <li>Toque em <strong>"Escanear QR Code"</strong></li>
                    <li>Aponte a câmera para este QR code</li>
                    <li>O dispositivo será cadastrado automaticamente</li>
                  </ol>
                </div>

                <div className="w-full p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-xs text-yellow-800">
                  ⚠️ Este QR contém seu token de sessão — válido por <strong>15 minutos</strong>.
                  Clique em <strong>Atualizar QR</strong> se expirar.
                </div>

                <div className="flex gap-3 w-full">
                  <button
                    onClick={generate}
                    className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50"
                  >
                    Atualizar QR
                  </button>
                  <button
                    onClick={copy}
                    className="flex-1 px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700"
                  >
                    {copied ? '✓ Copiado!' : 'Copiar JSON'}
                  </button>
                </div>

                <details className="w-full">
                  <summary className="text-xs text-gray-400 cursor-pointer hover:text-gray-600">
                    Mostrar dados brutos do QR
                  </summary>
                  <pre className="mt-2 text-xs bg-gray-50 p-3 rounded-lg overflow-auto break-all whitespace-pre-wrap">
                    {JSON.stringify(JSON.parse(qrData!), null, 2)}
                  </pre>
                </details>
              </>
            ) : (
              <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-600" />
            )}
          </div>
        </div>

        <div className="mt-4 p-4 bg-blue-50 border border-blue-100 rounded-xl text-sm text-blue-800">
          <p className="font-medium mb-1">Nota para Emulador</p>
          <p>O QR usa <code className="bg-blue-100 px-1 rounded">10.0.2.2</code> como endereço do servidor — é assim que o emulador Android acessa o localhost da sua máquina. Para um dispositivo físico na mesma rede Wi-Fi, substitua pelo IP local da sua máquina.</p>
        </div>
      </div>
    </div>
  )
}

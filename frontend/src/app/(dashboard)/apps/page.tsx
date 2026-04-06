'use client'

import { useEffect, useRef, useState } from 'react'
import { appsApi } from '@/lib/api'
import { getTenantId } from '@/lib/auth'
import { App } from '@/types'

interface ApkUploadResult {
  apkUrl: string
  originalName: string
  sizeBytes: number
  packageName?: string
  versionName?: string
  appLabel?: string
}

export default function AppsPage() {
  const [apps, setApps] = useState<App[]>([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState({ name: '', packageName: '', version: '', description: '', apkUrl: '' })
  const [uploadResult, setUploadResult] = useState<ApkUploadResult | null>(null)
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const tenantId = getTenantId()

  const load = () => {
    if (!tenantId) return
    appsApi.list(tenantId).then(r => setApps(r.data)).finally(() => setLoading(false))
  }

  useEffect(load, [])

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    setError('')
    try {
      const { data } = await appsApi.uploadApk(tenantId, file) as { data: ApkUploadResult }
      setUploadResult(data)
      // Pre-fill form with extracted metadata
      setForm(f => ({
        ...f,
        apkUrl: data.apkUrl,
        packageName: data.packageName ?? f.packageName,
        version: data.versionName ?? f.version,
        name: data.appLabel ?? f.name,
      }))
    } catch (err: any) {
      const msg = err.response?.data?.message
      setError(Array.isArray(msg) ? msg.join(', ') : msg || 'Erro ao enviar APK')
    } finally {
      setUploading(false)
    }
  }

  const clearUpload = () => {
    setUploadResult(null)
    setForm(f => ({ ...f, apkUrl: '' }))
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const addApp = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      await appsApi.create(tenantId, {
        name: form.name,
        packageName: form.packageName,
        version: form.version,
        description: form.description || undefined,
        apkUrl: form.apkUrl || undefined,
      })
      setShowAdd(false)
      setForm({ name: '', packageName: '', version: '', description: '', apkUrl: '' })
      setUploadResult(null)
      load()
    } catch (err: any) {
      const msg = err.response?.data?.message
      setError(Array.isArray(msg) ? msg.join(', ') : msg || 'Erro ao adicionar aplicativo')
    } finally {
      setSaving(false)
    }
  }

  const closeModal = () => {
    setShowAdd(false)
    setForm({ name: '', packageName: '', version: '', description: '', apkUrl: '' })
    setUploadResult(null)
    setError('')
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const deleteApp = async (id: string) => {
    if (!confirm('Remover este aplicativo?')) return
    try { await appsApi.delete(tenantId, id); load() } catch {}
  }

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Aplicativos</h1>
          <p className="text-gray-500 mt-1">Gerencie aplicativos para seus dispositivos</p>
        </div>
        <button onClick={() => setShowAdd(true)}
          className="bg-primary-600 hover:bg-primary-700 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Adicionar App
        </button>
      </div>

      {showAdd && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-md">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-gray-900">Adicionar Aplicativo</h3>
              <button onClick={closeModal} className="text-gray-400 hover:text-gray-600">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {error && <div className="bg-red-50 text-red-700 text-sm p-3 rounded-lg mb-4">{error}</div>}

            {/* Step 1: APK Upload */}
            <div className="mb-4">
              <p className="text-sm font-medium text-gray-700 mb-1.5">Arquivo APK</p>
              {!uploadResult ? (
                <div
                  onClick={() => !uploading && fileInputRef.current?.click()}
                  className={`flex flex-col items-center justify-center gap-2 px-4 py-6 border-2 border-dashed rounded-xl cursor-pointer transition-colors ${uploading ? 'border-primary-300 bg-primary-50 cursor-wait' : 'border-gray-300 hover:border-primary-400 hover:bg-gray-50'}`}
                >
                  {uploading ? (
                    <>
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
                      <p className="text-sm text-primary-600 font-medium">Enviando e lendo metadados...</p>
                    </>
                  ) : (
                    <>
                      <svg className="w-10 h-10 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                      </svg>
                      <p className="text-sm text-gray-600 font-medium">Clique para selecionar o arquivo .apk ou .xapk</p>
                      <p className="text-xs text-gray-400">Package name e versão serão lidos automaticamente</p>
                    </>
                  )}
                </div>
              ) : (
                <div className="flex items-center gap-3 p-3 bg-green-50 border border-green-200 rounded-xl">
                  <svg className="w-8 h-8 text-green-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-green-800 truncate">{uploadResult.originalName}</p>
                    <p className="text-xs text-green-600">{(uploadResult.sizeBytes / 1024 / 1024).toFixed(1)} MB enviado</p>
                  </div>
                  <button type="button" onClick={clearUpload} className="text-green-400 hover:text-red-500 flex-shrink-0">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              )}
              <input ref={fileInputRef} type="file" accept=".apk,.xapk,application/vnd.android.package-archive"
                onChange={handleFileChange} className="hidden" />
            </div>

            <form onSubmit={addApp} className="space-y-3">
              {/* Fields pre-filled from APK or manual */}
              {[
                { key: 'name', label: 'Nome do App', placeholder: 'Meu Aplicativo', required: true },
                { key: 'packageName', label: 'Package Name', placeholder: 'com.empresa.app', required: true },
                { key: 'version', label: 'Versão', placeholder: '1.0.0', required: true },
                { key: 'description', label: 'Descrição (opcional)', placeholder: '', required: false },
              ].map(({ key, label, placeholder, required }) => (
                <div key={key}>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
                  <div className="relative">
                    <input
                      type="text"
                      placeholder={placeholder}
                      required={required}
                      value={form[key as keyof typeof form]}
                      onChange={e => setForm({ ...form, [key]: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 text-sm pr-8"
                    />
                    {/* Lock icon when auto-filled from APK */}
                    {uploadResult && (key === 'packageName' || key === 'version' || key === 'name') && form[key as keyof typeof form] && (
                      <span className="absolute right-2 top-1/2 -translate-y-1/2 text-green-500" title="Lido automaticamente do APK">
                        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                        </svg>
                      </span>
                    )}
                  </div>
                </div>
              ))}

              {/* URL fallback when no APK was uploaded */}
              {!uploadResult && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">URL do APK (opcional)</label>
                  <input type="url" placeholder="https://servidor/app.apk"
                    value={form.apkUrl}
                    onChange={e => setForm({ ...form, apkUrl: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 text-sm" />
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <button type="button" onClick={closeModal}
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50">Cancelar</button>
                <button type="submit" disabled={saving || uploading}
                  className="flex-1 px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 disabled:opacity-50">
                  {saving ? 'Salvando...' : 'Adicionar App'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-600" />
        </div>
      ) : apps.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-xl border border-gray-100">
          <p className="text-gray-500">Nenhum aplicativo adicionado</p>
          <button onClick={() => setShowAdd(true)} className="mt-3 text-primary-600 text-sm font-medium hover:underline">Adicione seu primeiro aplicativo</button>
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase">Aplicativo</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase">Pacote</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase">Versão</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase">APK</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase">Tipo</th>
                <th className="px-6 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {apps.map(app => (
                <tr key={app.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4">
                    <p className="text-sm font-medium text-gray-900">{app.name}</p>
                    {app.description && <p className="text-xs text-gray-400 mt-0.5">{app.description}</p>}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-500 font-mono">{app.packageName}</td>
                  <td className="px-6 py-4 text-sm text-gray-500">{app.version}</td>
                  <td className="px-6 py-4">
                    {app.apkUrl ? (
                      <span className="inline-flex items-center gap-1 text-xs text-green-700 bg-green-50 px-2 py-0.5 rounded-full">
                        <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                        </svg>
                        Disponível
                      </span>
                    ) : (
                      <span className="text-xs text-gray-400">Sem APK</span>
                    )}
                  </td>
                  <td className="px-6 py-4">
                    {app.isSystem && <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">Sistema</span>}
                    {app.isRequired && <span className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full ml-1">Obrigatório</span>}
                    {!app.isSystem && !app.isRequired && <span className="text-xs text-gray-400">Opcional</span>}
                  </td>
                  <td className="px-6 py-4 text-right">
                    {!app.isSystem && (
                      <button onClick={() => deleteApp(app.id)} title="Remover aplicativo" className="text-gray-300 hover:text-red-500 transition-colors">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    )}
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

'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { devicesApi } from '@/lib/api'
import { getTenantId } from '@/lib/auth'
import { Device } from '@/types'
import { formatDistanceToNow } from 'date-fns'

export default function DevicesPage() {
  const [devices, setDevices] = useState<Device[]>([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState({ name: '', serialNumber: '', manufacturer: '', model: '', androidVersion: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const tenantId = getTenantId()

  const load = () => {
    if (!tenantId) return
    devicesApi.list(tenantId).then(r => setDevices(r.data)).finally(() => setLoading(false))
  }

  useEffect(load, [])

  const addDevice = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      await devicesApi.create(tenantId, form)
      setShowAdd(false)
      setForm({ name: '', serialNumber: '', manufacturer: '', model: '', androidVersion: '' })
      load()
    } catch (err: any) {
      const msg = err.response?.data?.message
      setError(Array.isArray(msg) ? msg.join(', ') : msg || 'Failed to add device')
    } finally {
      setSaving(false)
    }
  }

  const statusColor = (s: Device['status']) =>
    s === 'ACTIVE' ? 'bg-green-50 text-green-700' :
    s === 'PENDING' ? 'bg-yellow-50 text-yellow-700' :
    s === 'LOST' ? 'bg-red-50 text-red-700' :
    s === 'WIPED' ? 'bg-gray-50 text-gray-500' :
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

      {showAdd && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-md">
            <h3 className="font-semibold text-gray-900 mb-4">Cadastrar Novo Dispositivo</h3>
            {error && <div className="bg-red-50 text-red-700 text-sm p-3 rounded-lg mb-4">{error}</div>}
            <form onSubmit={addDevice} className="space-y-3">
              {([
                ['name', 'Nome do Dispositivo', 'Samsung Galaxy S23'],
                ['serialNumber', 'Número de Série', 'SN-XXXX'],
                ['manufacturer', 'Fabricante', 'Samsung'],
                ['model', 'Modelo', 'Galaxy S23'],
                ['androidVersion', 'Versão Android', '13'],
              ] as [keyof typeof form, string, string][]).map(([key, label, placeholder]) => (
                <div key={key}>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
                  <input
                    type="text"
                    placeholder={placeholder}
                    required={key === 'name' || key === 'serialNumber'}
                    value={form[key]}
                    onChange={e => setForm({ ...form, [key]: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 text-sm"
                  />
                </div>
              ))}
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setShowAdd(false)}
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50">
                  Cancelar
                </button>
                <button type="submit" disabled={saving}
                  className="flex-1 px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 disabled:opacity-50">
                  {saving ? 'Cadastrando...' : 'Cadastrar Dispositivo'}
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
      ) : devices.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-xl border border-gray-100">
          <svg className="w-12 h-12 text-gray-300 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
          </svg>
          <p className="text-gray-500">Nenhum dispositivo cadastrado ainda</p>
          <button onClick={() => setShowAdd(true)} className="mt-3 text-primary-600 text-sm font-medium hover:underline">
            Cadastre seu primeiro dispositivo
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

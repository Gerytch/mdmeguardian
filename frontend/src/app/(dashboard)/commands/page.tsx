'use client'

import { useEffect, useState } from 'react'
import { commandsApi } from '@/lib/api'
import { getTenantId } from '@/lib/auth'
import { Command } from '@/types'
import { formatDistanceToNow } from 'date-fns'

export default function CommandsPage() {
  const [commands, setCommands] = useState<Command[]>([])
  const [loading, setLoading] = useState(true)
  const tenantId = getTenantId()

  const load = () => {
    if (!tenantId) return
    commandsApi.list(tenantId).then(r => setCommands(r.data)).finally(() => setLoading(false))
  }

  useEffect(load, [])

  const cancel = async (id: string) => {
    try { await commandsApi.cancel(tenantId, id); load() } catch {}
  }

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Comandos</h1>
        <p className="text-gray-500 mt-1">Todos os comandos enviados aos dispositivos</p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-600" />
        </div>
      ) : commands.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-xl border border-gray-100">
          <p className="text-gray-500">Nenhum comando enviado ainda</p>
          <p className="text-sm text-gray-400 mt-1">Acesse um dispositivo para enviar comandos</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase">Tipo</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase">Criado em</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase">Executado em</th>
                <th className="px-6 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {commands.map(cmd => (
                <tr key={cmd.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4">
                    <p className="text-sm font-medium text-gray-900">{cmd.type}</p>
                    <p className="text-xs text-gray-400 font-mono">{cmd.deviceId.slice(0, 8)}…</p>
                  </td>
                  <td className="px-6 py-4">
                    <span className={`text-xs px-2 py-1 rounded-full font-medium ${
                      cmd.status === 'EXECUTED' ? 'bg-green-50 text-green-700' :
                      cmd.status === 'FAILED' ? 'bg-red-50 text-red-700' :
                      cmd.status === 'PENDING' ? 'bg-yellow-50 text-yellow-700' :
                      'bg-blue-50 text-blue-700'
                    }`}>{cmd.status}</span>
                  </td>
                  <td className="px-6 py-4 text-xs text-gray-400">
                    {formatDistanceToNow(new Date(cmd.createdAt), { addSuffix: true })}
                  </td>
                  <td className="px-6 py-4 text-xs text-gray-400">
                    {cmd.executedAt ? formatDistanceToNow(new Date(cmd.executedAt), { addSuffix: true }) : '—'}
                  </td>
                  <td className="px-6 py-4 text-right">
                    {cmd.status === 'PENDING' && (
                      <button onClick={() => cancel(cmd.id)} className="text-xs text-red-500 hover:text-red-700 font-medium">
                        Cancelar
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

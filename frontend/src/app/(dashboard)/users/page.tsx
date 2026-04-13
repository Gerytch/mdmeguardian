'use client'

import { useEffect, useState } from 'react'
import { api } from '@/lib/api'

interface ItUser {
  id: string
  email: string
  firstName: string
  lastName: string
  role: string
  isActive: boolean
  canAccessDevices: boolean
  deviceUsername: string | null
  lastLoginAt: string | null
  createdAt: string
}

const ROLES = [
  { value: 'TENANT_ADMIN', label: 'Administrador' },
  { value: 'MANAGER', label: 'Gerente' },
  { value: 'VIEWER', label: 'Visualizador' },
]

function getRoleBadge(role: string) {
  const map: Record<string, string> = {
    TENANT_ADMIN: 'bg-purple-100 text-purple-800',
    MANAGER: 'bg-blue-100 text-blue-800',
    VIEWER: 'bg-gray-100 text-gray-700',
  }
  const labelMap: Record<string, string> = {
    TENANT_ADMIN: 'Administrador',
    MANAGER: 'Gerente',
    VIEWER: 'Visualizador',
  }
  return { cls: map[role] ?? 'bg-gray-100 text-gray-700', label: labelMap[role] ?? role }
}

export default function UsersPage() {
  const [users, setUsers] = useState<ItUser[]>([])
  const [loading, setLoading] = useState(true)
  const [tenantId, setTenantId] = useState<string | null>(null)

  const [showModal, setShowModal] = useState(false)
  const [editUser, setEditUser] = useState<ItUser | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // form state
  const [form, setForm] = useState({
    email: '',
    firstName: '',
    lastName: '',
    role: 'VIEWER',
    password: '',
    isActive: true,
    canAccessDevices: false,
    deviceUsername: '',
    devicePin: '',
  })

  useEffect(() => {
    const profile = JSON.parse(localStorage.getItem('userProfile') || '{}')
    const tid = profile?.tenantId
    if (tid) {
      setTenantId(tid)
      fetchUsers(tid)
    }
  }, [])

  async function fetchUsers(tid: string) {
    try {
      const { data } = await api.get(`/tenants/${tid}/users`)
      setUsers(data)
    } finally {
      setLoading(false)
    }
  }

  function openCreate() {
    setEditUser(null)
    setForm({ email: '', firstName: '', lastName: '', role: 'VIEWER', password: '', isActive: true, canAccessDevices: false, deviceUsername: '', devicePin: '' })
    setError('')
    setShowModal(true)
  }

  function openEdit(u: ItUser) {
    setEditUser(u)
    setForm({
      email: u.email,
      firstName: u.firstName,
      lastName: u.lastName,
      role: u.role,
      password: '',
      isActive: u.isActive,
      canAccessDevices: u.canAccessDevices,
      deviceUsername: u.deviceUsername ?? '',
      devicePin: '',
    })
    setError('')
    setShowModal(true)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!tenantId) return
    setSaving(true)
    setError('')
    try {
      const payload: Record<string, unknown> = {
        firstName: form.firstName,
        lastName: form.lastName,
        role: form.role,
        isActive: form.isActive,
        canAccessDevices: form.canAccessDevices,
      }
      if (form.canAccessDevices) {
        payload.deviceUsername = form.deviceUsername || form.email.split('@')[0]
        if (form.devicePin) payload.devicePin = form.devicePin
      } else {
        payload.deviceUsername = ''
        payload.devicePin = undefined
      }

      if (editUser) {
        await api.patch(`/tenants/${tenantId}/users/${editUser.id}`, payload)
      } else {
        if (!form.password) { setError('Senha obrigatória'); setSaving(false); return }
        await api.post(`/tenants/${tenantId}/users`, {
          ...payload,
          email: form.email,
          password: form.password,
        })
      }
      await fetchUsers(tenantId)
      setShowModal(false)
    } catch (err: any) {
      setError(err?.response?.data?.message ?? 'Erro ao salvar')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(u: ItUser) {
    if (!tenantId) return
    if (!confirm(`Remover ${u.firstName} ${u.lastName}?`)) return
    await api.delete(`/tenants/${tenantId}/users/${u.id}`)
    await fetchUsers(tenantId)
  }

  async function handleToggleActive(u: ItUser) {
    if (!tenantId) return
    await api.patch(`/tenants/${tenantId}/users/${u.id}`, { isActive: !u.isActive })
    await fetchUsers(tenantId)
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Equipe T.I.</h1>
          <p className="text-sm text-gray-500 mt-1">Usuários com acesso ao painel e/ou dispositivos</p>
        </div>
        <button
          onClick={openCreate}
          className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 transition-colors"
        >
          + Novo usuário
        </button>
      </div>

      {loading ? (
        <div className="text-center py-16 text-gray-400">Carregando...</div>
      ) : users.length === 0 ? (
        <div className="text-center py-16 text-gray-400">Nenhum usuário cadastrado</div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Nome</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">E-mail</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Perfil</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Acesso dispositivos</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {users.map((u) => {
                const { cls, label } = getRoleBadge(u.role)
                return (
                  <tr key={u.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 font-medium text-gray-900">
                      {u.firstName} {u.lastName}
                    </td>
                    <td className="px-4 py-3 text-gray-600">{u.email}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${cls}`}>
                        {label}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {u.canAccessDevices ? (
                        <div className="flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full bg-green-500 inline-block" />
                          <span className="text-gray-700">Sim</span>
                          {u.deviceUsername && (
                            <span className="text-gray-400 text-xs">({u.deviceUsername})</span>
                          )}
                        </div>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => handleToggleActive(u)}
                        className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium cursor-pointer ${
                          u.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                        }`}
                      >
                        {u.isActive ? 'Ativo' : 'Inativo'}
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2 justify-end">
                        <button
                          onClick={() => openEdit(u)}
                          className="text-gray-400 hover:text-primary-600 transition-colors"
                          title="Editar"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                          </svg>
                        </button>
                        <button
                          onClick={() => handleDelete(u)}
                          className="text-gray-400 hover:text-red-500 transition-colors"
                          title="Remover"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h3 className="font-semibold text-gray-900 text-lg">
                {editUser ? 'Editar usuário' : 'Novo usuário'}
              </h3>
              <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-gray-600">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <form onSubmit={handleSubmit} className="px-6 py-4 space-y-4">
              {!editUser && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">E-mail</label>
                  <input
                    type="email"
                    required
                    value={form.email}
                    onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Nome</label>
                  <input
                    required
                    value={form.firstName}
                    onChange={e => setForm(f => ({ ...f, firstName: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Sobrenome</label>
                  <input
                    required
                    value={form.lastName}
                    onChange={e => setForm(f => ({ ...f, lastName: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Perfil de acesso</label>
                <select
                  value={form.role}
                  onChange={e => setForm(f => ({ ...f, role: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                >
                  {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
              </div>

              {!editUser && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Senha</label>
                  <input
                    type="password"
                    value={form.password}
                    onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                    minLength={8}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                    placeholder="Mín. 8 caracteres"
                  />
                </div>
              )}

              {/* Device access section */}
              <div className="border border-gray-200 rounded-lg p-3 space-y-3">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={form.canAccessDevices}
                    onChange={e => setForm(f => ({ ...f, canAccessDevices: e.target.checked }))}
                    className="w-4 h-4 text-primary-600 rounded"
                  />
                  <span className="text-sm font-medium text-gray-700">Acesso a dispositivos (T.I.)</span>
                </label>

                {form.canAccessDevices && (
                  <div className="space-y-3 pt-1">
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">
                        Login no dispositivo
                        <span className="text-gray-400 font-normal ml-1">(padrão: prefixo do e-mail)</span>
                      </label>
                      <input
                        value={form.deviceUsername}
                        onChange={e => setForm(f => ({ ...f, deviceUsername: e.target.value }))}
                        placeholder={form.email ? form.email.split('@')[0] : 'usuario'}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">
                        PIN do dispositivo
                        {editUser && <span className="text-gray-400 font-normal ml-1">(deixe em branco para não alterar)</span>}
                      </label>
                      <input
                        type="password"
                        value={form.devicePin}
                        onChange={e => setForm(f => ({ ...f, devicePin: e.target.value }))}
                        minLength={4}
                        maxLength={16}
                        placeholder="4–16 dígitos"
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                      />
                    </div>
                  </div>
                )}
              </div>

              {error && <p className="text-sm text-red-600">{error}</p>}

              <div className="flex gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 disabled:opacity-50 transition-colors"
                >
                  {saving ? 'Salvando...' : editUser ? 'Salvar' : 'Criar usuário'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

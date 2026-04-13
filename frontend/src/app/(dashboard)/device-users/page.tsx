'use client'

import { useEffect, useState } from 'react'
import { deviceUsersApi } from '@/lib/api'
import { getTenantId } from '@/lib/auth'

type DeviceUser = {
  id: string
  tenantId: string
  fullName: string
  username: string
  jobTitle?: string
  department?: string
  photoUrl?: string
  isDeviceAdmin?: boolean
  status: 'ACTIVE' | 'INACTIVE'
  lastLoginAt?: string
  createdAt: string
}

const DEFAULT_FORM = {
  fullName: '',
  username: '',
  pin: '',
  jobTitle: '',
  department: '',
  photoUrl: '',
  isDeviceAdmin: false,
}
type FormState = typeof DEFAULT_FORM
type SetForm = (key: keyof FormState, value: string | boolean) => void

function Avatar({ name, photoUrl }: { name: string; photoUrl?: string }) {
  if (photoUrl) return <img src={photoUrl} alt={name} className="w-8 h-8 rounded-full object-cover" />
  const initials = name.split(' ').map(n => n[0]).filter(Boolean).slice(0, 2).join('').toUpperCase()
  return (
    <div className="w-8 h-8 rounded-full bg-primary-100 text-primary-700 flex items-center justify-center text-xs font-bold flex-shrink-0">
      {initials}
    </div>
  )
}

function StatusBadge({ status }: { status: 'ACTIVE' | 'INACTIVE' }) {
  if (status === 'ACTIVE') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-green-50 text-green-700">
        <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
        Ativo
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-500">
      <span className="w-1.5 h-1.5 rounded-full bg-gray-400" />
      Inativo
    </span>
  )
}

export default function DeviceUsersPage() {
  const [users, setUsers] = useState<DeviceUser[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')

  // Create/Edit modal
  const [showModal, setShowModal] = useState(false)
  const [editUser, setEditUser] = useState<DeviceUser | null>(null)
  const [form, setForm] = useState<FormState>(DEFAULT_FORM)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // PIN modal
  const [showPinModal, setShowPinModal] = useState(false)
  const [pinUser, setPinUser] = useState<DeviceUser | null>(null)
  const [newPin, setNewPin] = useState('')
  const [pinSaving, setPinSaving] = useState(false)
  const [pinError, setPinError] = useState('')

  const tenantId = getTenantId()
  const set: SetForm = (key, value) => setForm(f => ({ ...f, [key]: value }))

  const load = () => {
    if (!tenantId) return
    setLoading(true)
    deviceUsersApi.list(tenantId).then(r => setUsers(r.data?.data ?? r.data ?? [])).catch(() => setUsers([])).finally(() => setLoading(false))
  }

  useEffect(load, [])

  const openCreate = () => {
    setEditUser(null)
    setForm(DEFAULT_FORM)
    setError('')
    setShowModal(true)
  }

  const openEdit = (u: DeviceUser) => {
    setEditUser(u)
    setForm({
      fullName: u.fullName,
      username: u.username,
      pin: '',
      jobTitle: u.jobTitle ?? '',
      department: u.department ?? '',
      photoUrl: u.photoUrl ?? '',
      isDeviceAdmin: u.isDeviceAdmin ?? false,
    })
    setError('')
    setShowModal(true)
  }

  const closeModal = () => {
    setShowModal(false)
    setEditUser(null)
    setForm(DEFAULT_FORM)
    setError('')
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!tenantId) return
    setSaving(true)
    setError('')
    try {
      if (editUser) {
        const data: any = {
          fullName: form.fullName,
          username: form.username,
          isDeviceAdmin: form.isDeviceAdmin,
          jobTitle: form.jobTitle || undefined,
          department: form.department || undefined,
          photoUrl: form.photoUrl || undefined,
        }
        await deviceUsersApi.update(tenantId, editUser.id, data)
      } else {
        if (!form.pin) { setError('PIN é obrigatório'); setSaving(false); return }
        if (form.isDeviceAdmin && form.pin.length < 6) { setError('PIN de admin deve ter pelo menos 6 dígitos'); setSaving(false); return }
        const data: any = {
          fullName: form.fullName,
          username: form.username,
          pin: form.pin,
          isDeviceAdmin: form.isDeviceAdmin,
          jobTitle: form.jobTitle || undefined,
          department: form.department || undefined,
          photoUrl: form.photoUrl || undefined,
        }
        await deviceUsersApi.create(tenantId, data)
      }
      closeModal()
      load()
    } catch (err: any) {
      const msg = err.response?.data?.message
      setError(Array.isArray(msg) ? msg.join(', ') : msg || 'Erro ao salvar usuário')
    } finally {
      setSaving(false)
    }
  }

  const openPinModal = (u: DeviceUser) => {
    setPinUser(u)
    setNewPin('')
    setPinError('')
    setShowPinModal(true)
  }

  const closePinModal = () => {
    setShowPinModal(false)
    setPinUser(null)
    setNewPin('')
    setPinError('')
  }

  const handlePinSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!tenantId || !pinUser) return
    const minLen = pinUser.isDeviceAdmin ? 6 : 4
    if (newPin.length < minLen) { setPinError(`PIN deve ter pelo menos ${minLen} dígitos`); return }
    setPinSaving(true)
    setPinError('')
    try {
      await deviceUsersApi.updatePin(tenantId, pinUser.id, newPin)
      closePinModal()
    } catch (err: any) {
      const msg = err.response?.data?.message
      setPinError(Array.isArray(msg) ? msg.join(', ') : msg || 'Erro ao atualizar PIN')
    } finally {
      setPinSaving(false)
    }
  }

  const toggleStatus = async (u: DeviceUser) => {
    if (!tenantId) return
    const next = u.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE'
    try {
      await deviceUsersApi.updateStatus(tenantId, u.id, next)
      setUsers(prev => prev.map(x => x.id === u.id ? { ...x, status: next } : x))
    } catch {}
  }

  const deleteUser = async (u: DeviceUser) => {
    if (!tenantId) return
    if (!window.confirm(`Deseja excluir o usuário "${u.fullName}"?`)) return
    try {
      await deviceUsersApi.delete(tenantId, u.id)
      load()
    } catch {}
  }

  const filtered = users.filter(u => {
    const q = search.toLowerCase()
    const matchSearch = !q || u.fullName.toLowerCase().includes(q) || u.username.toLowerCase().includes(q)
    const matchStatus = !statusFilter || u.status === statusFilter
    return matchSearch && matchStatus
  })

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Usuários de Dispositivo</h1>
          <p className="text-gray-500 mt-1">Gerencie os usuários que fazem login em dispositivos compartilhados</p>
        </div>
        <button
          onClick={openCreate}
          className="bg-primary-600 hover:bg-primary-700 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Novo Usuário
        </button>
      </div>

      {/* Filters */}
      <div className="flex gap-3 mb-6">
        <div className="relative flex-1 max-w-xs">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            placeholder="Buscar por nome ou matrícula..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
        </div>
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white"
        >
          <option value="">Todos os status</option>
          <option value="ACTIVE">Ativo</option>
          <option value="INACTIVE">Inativo</option>
        </select>
      </div>

      {/* Create/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h3 className="font-semibold text-gray-900 text-lg">
                {editUser ? 'Editar Usuário' : 'Novo Usuário'}
              </h3>
              <button onClick={closeModal} className="text-gray-400 hover:text-gray-600 transition-colors">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <form onSubmit={handleSubmit} className="px-6 py-4 space-y-4">
              {error && (
                <div className="bg-red-50 text-red-700 text-sm p-3 rounded-lg">{error}</div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nome completo *</label>
                <input
                  type="text"
                  required
                  value={form.fullName}
                  onChange={e => set('fullName', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                  placeholder="Ex: João da Silva"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Usuário / Matrícula *</label>
                <input
                  type="text"
                  required
                  value={form.username}
                  onChange={e => set('username', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                  placeholder="Ex: joao.silva ou 123456"
                />
              </div>

              {!editUser && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">PIN *</label>
                  <input
                    type="password"
                    inputMode="numeric"
                    maxLength={6}
                    required
                    value={form.pin}
                    onChange={e => set('pin', e.target.value.replace(/\D/g, ''))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                    placeholder="4 a 6 dígitos"
                  />
                  <p className="text-xs text-gray-400 mt-1">O PIN será usado para login no dispositivo</p>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Cargo</label>
                <input
                  type="text"
                  value={form.jobTitle}
                  onChange={e => set('jobTitle', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                  placeholder="Ex: Operador de Caixa"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Departamento</label>
                <input
                  type="text"
                  value={form.department}
                  onChange={e => set('department', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                  placeholder="Ex: Vendas"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">URL da Foto</label>
                <input
                  type="url"
                  value={form.photoUrl}
                  onChange={e => set('photoUrl', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                  placeholder="https://..."
                />
              </div>

              {/* Admin toggle */}
              <div className={`rounded-lg border p-3 ${form.isDeviceAdmin ? 'border-amber-300 bg-amber-50' : 'border-gray-200'}`}>
                <label className="flex items-center gap-3 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={form.isDeviceAdmin as boolean}
                    onChange={e => set('isDeviceAdmin', e.target.checked)}
                    className="w-4 h-4 accent-amber-500 cursor-pointer"
                  />
                  <div>
                    <span className="text-sm font-medium text-gray-800">Administrador de Dispositivo</span>
                    <p className="text-xs text-gray-500 mt-0.5">
                      Pode acessar o dispositivo offline e bypass de restrições (kiosk, admin lock). PIN mínimo 6 dígitos.
                    </p>
                  </div>
                </label>
              </div>

              <div className="flex gap-3 pt-2 pb-2">
                <button
                  type="button"
                  onClick={closeModal}
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 disabled:opacity-50 transition-colors"
                >
                  {saving ? 'Salvando...' : editUser ? 'Salvar Alterações' : 'Criar Usuário'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* PIN Modal */}
      {showPinModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h3 className="font-semibold text-gray-900 text-lg">Redefinir PIN</h3>
              <button onClick={closePinModal} className="text-gray-400 hover:text-gray-600 transition-colors">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <form onSubmit={handlePinSubmit} className="px-6 py-4 space-y-4">
              {pinError && (
                <div className="bg-red-50 text-red-700 text-sm p-3 rounded-lg">{pinError}</div>
              )}
              <p className="text-sm text-gray-500">
                Definindo novo PIN para <span className="font-medium text-gray-800">{pinUser?.fullName}</span>
              </p>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Novo PIN</label>
                <input
                  type="password"
                  inputMode="numeric"
                  maxLength={6}
                  required
                  value={newPin}
                  onChange={e => setNewPin(e.target.value.replace(/\D/g, ''))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 text-center text-lg tracking-widest"
                  placeholder="••••"
                  autoFocus
                />
                <p className="text-xs text-gray-400 mt-1">Digite entre 4 e 6 dígitos numéricos</p>
              </div>
              <div className="flex gap-3 pt-1 pb-2">
                <button
                  type="button"
                  onClick={closePinModal}
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={pinSaving}
                  className="flex-1 px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 disabled:opacity-50 transition-colors"
                >
                  {pinSaving ? 'Salvando...' : 'Redefinir PIN'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-600" />
        </div>
      ) : users.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-xl border border-gray-100">
          <svg className="w-12 h-12 text-gray-300 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
          </svg>
          <p className="text-gray-700 font-medium">Nenhum usuário cadastrado</p>
          <p className="text-gray-400 text-sm mt-1">Crie o primeiro usuário de dispositivo para habilitar login em dispositivos compartilhados</p>
          <button
            onClick={openCreate}
            className="mt-4 text-primary-600 text-sm font-medium hover:underline"
          >
            Criar primeiro usuário
          </button>
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Usuário</th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Cargo / Depto</th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Status</th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Último Login</th>
                <th className="text-right px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={5} className="text-center py-10 text-gray-400 text-sm">
                    Nenhum usuário encontrado para os filtros selecionados
                  </td>
                </tr>
              ) : (
                filtered.map(u => (
                  <tr key={u.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <Avatar name={u.fullName} photoUrl={u.photoUrl} />
                        <div>
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-medium text-gray-900">{u.fullName}</p>
                            {u.isDeviceAdmin && (
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-semibold bg-amber-100 text-amber-700">
                                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                                  <path fillRule="evenodd" d="M2.166 4.999A11.954 11.954 0 0010 1.944 11.954 11.954 0 0017.834 5c.11.65.166 1.32.166 2.001 0 5.225-3.34 9.67-8 11.317C5.34 16.67 2 12.225 2 7c0-.682.057-1.35.166-2.001zm11.541 3.708a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                                </svg>
                                Admin
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-gray-400 font-mono">{u.username}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <p className="text-sm text-gray-700">{u.jobTitle || <span className="text-gray-300">—</span>}</p>
                      {u.department && <p className="text-xs text-gray-400">{u.department}</p>}
                    </td>
                    <td className="px-6 py-4">
                      <StatusBadge status={u.status} />
                    </td>
                    <td className="px-6 py-4">
                      <span className="text-sm text-gray-500">
                        {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString('pt-BR') : <span className="text-gray-300">—</span>}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => openPinModal(u)}
                          title="Redefinir PIN"
                          className="px-2.5 py-1.5 text-xs font-medium text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 hover:border-gray-300 transition-colors"
                        >
                          PIN
                        </button>
                        <button
                          onClick={() => toggleStatus(u)}
                          title={u.status === 'ACTIVE' ? 'Desativar usuário' : 'Ativar usuário'}
                          className={`px-2.5 py-1.5 text-xs font-medium border rounded-lg transition-colors ${
                            u.status === 'ACTIVE'
                              ? 'text-orange-600 border-orange-200 hover:bg-orange-50'
                              : 'text-green-600 border-green-200 hover:bg-green-50'
                          }`}
                        >
                          {u.status === 'ACTIVE' ? 'Desativar' : 'Ativar'}
                        </button>
                        <button
                          onClick={() => openEdit(u)}
                          title="Editar usuário"
                          className="text-gray-400 hover:text-primary-500 transition-colors p-1.5"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                          </svg>
                        </button>
                        <button
                          onClick={() => deleteUser(u)}
                          title="Excluir usuário"
                          className="text-gray-400 hover:text-red-500 transition-colors p-1.5"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

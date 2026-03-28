'use client'

import { useEffect, useState } from 'react'
import { deviceGroupsApi, policiesApi, devicesApi } from '@/lib/api'
import { getTenantId } from '@/lib/auth'

interface DeviceGroup {
  id: string
  name: string
  description?: string
  policyId: string | null
  deviceCount: number
}

interface GroupDevice {
  id: string
  name: string
  status: string
  isOnline: boolean
  [key: string]: any
}

interface SelectedGroup extends DeviceGroup {
  devices: GroupDevice[]
}

interface Policy {
  id: string
  name: string
}

export default function GroupsPage() {
  const [groups, setGroups] = useState<DeviceGroup[]>([])
  const [policies, setPolicies] = useState<Policy[]>([])
  const [devices, setDevices] = useState<any[]>([])
  const [selectedGroup, setSelectedGroup] = useState<SelectedGroup | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showEditModal, setShowEditModal] = useState(false)
  const [showAssignPolicyModal, setShowAssignPolicyModal] = useState(false)
  const [showAddDeviceModal, setShowAddDeviceModal] = useState(false)

  const [editingGroup, setEditingGroup] = useState<DeviceGroup | null>(null)
  const [form, setForm] = useState({ name: '', description: '' })
  const [selectedPolicyId, setSelectedPolicyId] = useState('')
  const [selectedDeviceId, setSelectedDeviceId] = useState('')

  const tenantId = getTenantId()

  const loadAll = () => {
    if (!tenantId) return
    setLoading(true)
    Promise.all([
      deviceGroupsApi.list(tenantId),
      policiesApi.list(tenantId),
      devicesApi.list(tenantId),
    ])
      .then(([g, p, d]) => {
        setGroups(g.data)
        setPolicies(p.data)
        setDevices(d.data)
      })
      .catch(() => setError('Erro ao carregar dados'))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    loadAll()
  }, [])

  const refreshSelectedGroup = async (groupId: string) => {
    if (!tenantId) return
    try {
      const res = await deviceGroupsApi.get(tenantId, groupId)
      setSelectedGroup(res.data)
    } catch {
      // non-critical
    }
  }

  const policyName = (policyId: string | null) =>
    policies.find(p => p.id === policyId)?.name ?? null

  const availableDevices = devices.filter(
    (d: any) => d.groupId !== selectedGroup?.id
  )

  // --- Create ---
  const openCreate = () => {
    setForm({ name: '', description: '' })
    setError('')
    setShowCreateModal(true)
  }

  const handleCreate = async () => {
    if (!tenantId || !form.name.trim()) return
    setSaving(true)
    setError('')
    try {
      await deviceGroupsApi.create(tenantId, {
        name: form.name.trim(),
        description: form.description.trim() || undefined,
      })
      setShowCreateModal(false)
      loadAll()
    } catch (err: any) {
      const msg = err.response?.data?.message
      setError(Array.isArray(msg) ? msg.join(', ') : msg || 'Erro ao criar grupo')
    } finally {
      setSaving(false)
    }
  }

  // --- Edit ---
  const openEdit = (group: DeviceGroup) => {
    setEditingGroup(group)
    setForm({ name: group.name, description: group.description ?? '' })
    setError('')
    setShowEditModal(true)
  }

  const handleEdit = async () => {
    if (!tenantId || !editingGroup || !form.name.trim()) return
    setSaving(true)
    setError('')
    try {
      await deviceGroupsApi.update(tenantId, editingGroup.id, {
        name: form.name.trim(),
        description: form.description.trim() || undefined,
      })
      setShowEditModal(false)
      setEditingGroup(null)
      loadAll()
      if (selectedGroup?.id === editingGroup.id) {
        await refreshSelectedGroup(editingGroup.id)
      }
    } catch (err: any) {
      const msg = err.response?.data?.message
      setError(Array.isArray(msg) ? msg.join(', ') : msg || 'Erro ao atualizar grupo')
    } finally {
      setSaving(false)
    }
  }

  // --- Delete ---
  const handleDelete = async (group: DeviceGroup) => {
    if (!tenantId) return
    if (!window.confirm(`Excluir o grupo "${group.name}"? Esta ação não pode ser desfeita.`)) return
    try {
      await deviceGroupsApi.delete(tenantId, group.id)
      if (selectedGroup?.id === group.id) setSelectedGroup(null)
      loadAll()
    } catch {
      alert('Erro ao excluir grupo')
    }
  }

  // --- Select group (expand) ---
  const handleSelectGroup = async (group: DeviceGroup) => {
    if (selectedGroup?.id === group.id) {
      setSelectedGroup(null)
      return
    }
    if (!tenantId) return
    try {
      const res = await deviceGroupsApi.get(tenantId, group.id)
      setSelectedGroup(res.data)
    } catch {
      alert('Erro ao carregar dispositivos do grupo')
    }
  }

  // --- Assign policy ---
  const openAssignPolicy = (group: DeviceGroup) => {
    setEditingGroup(group)
    setSelectedPolicyId(group.policyId ?? '')
    setError('')
    setShowAssignPolicyModal(true)
  }

  const handleAssignPolicy = async () => {
    if (!tenantId || !editingGroup || !selectedPolicyId) return
    setSaving(true)
    setError('')
    try {
      await deviceGroupsApi.assignPolicy(tenantId, editingGroup.id, selectedPolicyId)
      setShowAssignPolicyModal(false)
      setEditingGroup(null)
      loadAll()
      if (selectedGroup?.id === editingGroup.id) {
        await refreshSelectedGroup(editingGroup.id)
      }
    } catch (err: any) {
      const msg = err.response?.data?.message
      setError(Array.isArray(msg) ? msg.join(', ') : msg || 'Erro ao atribuir política')
    } finally {
      setSaving(false)
    }
  }

  const handleRemovePolicy = async (group: DeviceGroup) => {
    if (!tenantId) return
    if (!window.confirm('Remover a política deste grupo?')) return
    try {
      await deviceGroupsApi.removePolicy(tenantId, group.id)
      loadAll()
      if (selectedGroup?.id === group.id) {
        await refreshSelectedGroup(group.id)
      }
    } catch {
      alert('Erro ao remover política')
    }
  }

  // --- Add device ---
  const handleAddDevice = async () => {
    if (!tenantId || !selectedGroup || !selectedDeviceId) return
    setSaving(true)
    try {
      await deviceGroupsApi.addDevice(tenantId, selectedGroup.id, selectedDeviceId)
      setSelectedDeviceId('')
      setShowAddDeviceModal(false)
      await refreshSelectedGroup(selectedGroup.id)
      loadAll()
    } catch {
      alert('Erro ao adicionar dispositivo')
    } finally {
      setSaving(false)
    }
  }

  // --- Remove device ---
  const handleRemoveDevice = async (deviceId: string) => {
    if (!tenantId || !selectedGroup) return
    try {
      await deviceGroupsApi.removeDevice(tenantId, selectedGroup.id, deviceId)
      await refreshSelectedGroup(selectedGroup.id)
      loadAll()
    } catch {
      alert('Erro ao remover dispositivo')
    }
  }

  // --- Status badge ---
  const statusBadge = (status: string) => {
    const map: Record<string, string> = {
      active: 'bg-green-100 text-green-700',
      inactive: 'bg-gray-100 text-gray-500',
      lost: 'bg-red-100 text-red-700',
      maintenance: 'bg-yellow-100 text-yellow-700',
    }
    return map[status] ?? 'bg-gray-100 text-gray-500'
  }

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Grupos de Dispositivos</h1>
          <p className="text-gray-500 mt-1">Organize dispositivos e aplique políticas em lote</p>
        </div>
        <button
          onClick={openCreate}
          className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 flex items-center gap-2"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Novo Grupo
        </button>
      </div>

      {/* Create Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h3 className="font-semibold text-gray-900 text-lg">Novo Grupo</h3>
              <button onClick={() => setShowCreateModal(false)} className="text-gray-400 hover:text-gray-600">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="px-6 py-4 space-y-4">
              {error && <div className="bg-red-50 text-red-700 text-sm p-3 rounded-lg">{error}</div>}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nome *</label>
                <input
                  type="text"
                  required
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="Ex: Dispositivos de Vendas"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Descrição</label>
                <textarea
                  rows={3}
                  value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  placeholder="Descrição opcional do grupo..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none"
                />
              </div>
            </div>
            <div className="flex gap-3 px-6 py-4 border-t border-gray-100">
              <button
                onClick={() => setShowCreateModal(false)}
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50"
              >
                Cancelar
              </button>
              <button
                onClick={handleCreate}
                disabled={saving || !form.name.trim()}
                className="flex-1 px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 disabled:opacity-50"
              >
                {saving ? 'Criando...' : 'Criar Grupo'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {showEditModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h3 className="font-semibold text-gray-900 text-lg">Editar Grupo</h3>
              <button onClick={() => setShowEditModal(false)} className="text-gray-400 hover:text-gray-600">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="px-6 py-4 space-y-4">
              {error && <div className="bg-red-50 text-red-700 text-sm p-3 rounded-lg">{error}</div>}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nome *</label>
                <input
                  type="text"
                  required
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Descrição</label>
                <textarea
                  rows={3}
                  value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none"
                />
              </div>
            </div>
            <div className="flex gap-3 px-6 py-4 border-t border-gray-100">
              <button
                onClick={() => setShowEditModal(false)}
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50"
              >
                Cancelar
              </button>
              <button
                onClick={handleEdit}
                disabled={saving || !form.name.trim()}
                className="flex-1 px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 disabled:opacity-50"
              >
                {saving ? 'Salvando...' : 'Salvar Alterações'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Assign Policy Modal */}
      {showAssignPolicyModal && editingGroup && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h3 className="font-semibold text-gray-900 text-lg">Atribuir Política</h3>
              <button onClick={() => setShowAssignPolicyModal(false)} className="text-gray-400 hover:text-gray-600">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="px-6 py-4 space-y-4">
              {error && <div className="bg-red-50 text-red-700 text-sm p-3 rounded-lg">{error}</div>}
              <p className="text-sm text-gray-600">
                Grupo: <span className="font-medium text-gray-900">{editingGroup.name}</span>
              </p>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Política</label>
                <select
                  value={selectedPolicyId}
                  onChange={e => setSelectedPolicyId(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                >
                  <option value="">Selecione uma política...</option>
                  {policies.map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                <p className="text-xs text-amber-700">
                  Ao atribuir uma política ao grupo, ela será aplicada a todos os dispositivos do grupo imediatamente.
                </p>
              </div>
            </div>
            <div className="flex gap-3 px-6 py-4 border-t border-gray-100">
              <button
                onClick={() => setShowAssignPolicyModal(false)}
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50"
              >
                Cancelar
              </button>
              <button
                onClick={handleAssignPolicy}
                disabled={saving || !selectedPolicyId}
                className="flex-1 px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 disabled:opacity-50"
              >
                {saving ? 'Atribuindo...' : 'Confirmar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Device Modal */}
      {showAddDeviceModal && selectedGroup && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h3 className="font-semibold text-gray-900 text-lg">Adicionar Dispositivo</h3>
              <button onClick={() => setShowAddDeviceModal(false)} className="text-gray-400 hover:text-gray-600">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="px-6 py-4 space-y-4">
              <p className="text-sm text-gray-600">
                Adicionando ao grupo: <span className="font-medium text-gray-900">{selectedGroup.name}</span>
              </p>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Dispositivo</label>
                <select
                  value={selectedDeviceId}
                  onChange={e => setSelectedDeviceId(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                >
                  <option value="">Selecione um dispositivo...</option>
                  {availableDevices.map((d: any) => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
              </div>
              {availableDevices.length === 0 && (
                <p className="text-xs text-gray-400">Todos os dispositivos já estão neste grupo.</p>
              )}
            </div>
            <div className="flex gap-3 px-6 py-4 border-t border-gray-100">
              <button
                onClick={() => setShowAddDeviceModal(false)}
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50"
              >
                Cancelar
              </button>
              <button
                onClick={handleAddDevice}
                disabled={saving || !selectedDeviceId}
                className="flex-1 px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 disabled:opacity-50"
              >
                {saving ? 'Adicionando...' : 'Adicionar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main content */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-600" />
        </div>
      ) : groups.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-xl border border-gray-100">
          <svg className="w-14 h-14 text-gray-300 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          <p className="text-gray-700 font-medium mb-1">Nenhum grupo criado</p>
          <p className="text-gray-500 text-sm mb-4">Crie grupos para organizar dispositivos e aplicar políticas em lote</p>
          <button
            onClick={openCreate}
            className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700"
          >
            Criar primeiro grupo
          </button>
        </div>
      ) : (
        <>
          {/* Group cards grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
            {groups.map(group => {
              const policy = policyName(group.policyId)
              const isExpanded = selectedGroup?.id === group.id
              return (
                <div
                  key={group.id}
                  className={`bg-white rounded-xl shadow-sm border p-6 transition-all ${
                    isExpanded ? 'border-primary-300 ring-1 ring-primary-200' : 'border-gray-100'
                  }`}
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-gray-900 truncate">{group.name}</h3>
                      {group.description && (
                        <p className="text-sm text-gray-500 mt-0.5 line-clamp-2">{group.description}</p>
                      )}
                    </div>
                  </div>

                  {/* Badges */}
                  <div className="flex flex-wrap gap-2 mb-4">
                    <span className="text-xs px-2 py-1 rounded-full font-medium bg-gray-100 text-gray-600">
                      {group.deviceCount ?? 0} dispositivo{(group.deviceCount ?? 0) !== 1 ? 's' : ''}
                    </span>
                    {policy ? (
                      <span className="text-xs px-2 py-1 rounded-full font-medium bg-indigo-50 text-indigo-700">
                        {policy}
                      </span>
                    ) : (
                      <span className="text-xs px-2 py-1 rounded-full font-medium bg-gray-100 text-gray-400">
                        Sem política
                      </span>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-gray-50">
                    <button
                      onClick={() => handleSelectGroup(group)}
                      className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm hover:bg-gray-50 font-medium"
                    >
                      {isExpanded ? 'Fechar' : 'Ver dispositivos'}
                    </button>
                    <button
                      onClick={() => openAssignPolicy(group)}
                      className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm hover:bg-gray-50"
                    >
                      Atribuir política
                    </button>
                    {group.policyId && (
                      <button
                        onClick={() => handleRemovePolicy(group)}
                        className="text-sm text-red-500 hover:text-red-700 px-2"
                      >
                        Remover política
                      </button>
                    )}
                    <div className="flex items-center gap-1 ml-auto">
                      <button
                        onClick={() => openEdit(group)}
                        className="p-1.5 text-gray-400 hover:text-primary-600 rounded-lg hover:bg-gray-50 transition-colors"
                        title="Editar"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                      </button>
                      <button
                        onClick={() => handleDelete(group)}
                        className="p-1.5 text-gray-400 hover:text-red-500 rounded-lg hover:bg-gray-50 transition-colors"
                        title="Excluir"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Expanded group device panel */}
          {selectedGroup && (
            <div className="bg-white rounded-xl shadow-sm border border-primary-200 p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-lg font-semibold text-gray-900">
                    Dispositivos em {selectedGroup.name}
                  </h2>
                  <p className="text-sm text-gray-500 mt-0.5">
                    {selectedGroup.devices?.length ?? 0} dispositivo{(selectedGroup.devices?.length ?? 0) !== 1 ? 's' : ''}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      setSelectedDeviceId('')
                      setShowAddDeviceModal(true)
                    }}
                    className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 flex items-center gap-1.5"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                    Adicionar dispositivo
                  </button>
                  <button
                    onClick={() => setSelectedGroup(null)}
                    className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-50"
                    title="Fechar"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>

              {!selectedGroup.devices || selectedGroup.devices.length === 0 ? (
                <div className="text-center py-10 bg-gray-50 rounded-lg">
                  <svg className="w-10 h-10 text-gray-300 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
                  </svg>
                  <p className="text-gray-500 text-sm">Nenhum dispositivo neste grupo</p>
                  <button
                    onClick={() => {
                      setSelectedDeviceId('')
                      setShowAddDeviceModal(true)
                    }}
                    className="mt-2 text-primary-600 text-sm font-medium hover:underline"
                  >
                    Adicionar dispositivo
                  </button>
                </div>
              ) : (
                <div className="divide-y divide-gray-50">
                  {selectedGroup.devices.map(device => (
                    <div key={device.id} className="flex items-center justify-between py-3">
                      <div className="flex items-center gap-3">
                        <span
                          className={`w-2 h-2 rounded-full flex-shrink-0 ${
                            device.isOnline ? 'bg-green-500' : 'bg-gray-300'
                          }`}
                        />
                        <div>
                          <p className="text-sm font-medium text-gray-900">{device.name}</p>
                          <span
                            className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${statusBadge(device.status)}`}
                          >
                            {device.status}
                          </span>
                        </div>
                      </div>
                      <button
                        onClick={() => handleRemoveDevice(device.id)}
                        className="text-sm text-red-600 hover:text-red-800 font-medium px-2"
                      >
                        Remover
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}

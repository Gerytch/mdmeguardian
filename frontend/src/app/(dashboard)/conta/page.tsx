'use client'

import { useState } from 'react'
import { getUser, getTenantId } from '@/lib/auth'
import { usersApi } from '@/lib/api'

export default function ContaPage() {
  const user = getUser()
  const tenantId = getTenantId()

  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' })
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState('')
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setSuccess('')

    if (form.newPassword !== form.confirmPassword) {
      setError('A nova senha e a confirmação não coincidem.')
      return
    }
    if (form.newPassword.length < 8) {
      setError('A nova senha deve ter pelo menos 8 caracteres.')
      return
    }

    setLoading(true)
    try {
      await usersApi.changePassword(tenantId, user!.id, form.currentPassword, form.newPassword)
      setSuccess('Senha alterada com sucesso!')
      setForm({ currentPassword: '', newPassword: '', confirmPassword: '' })
    } catch (err: any) {
      const msg = err.response?.data?.message
      if (msg === 'Current password is incorrect') {
        setError('Senha atual incorreta.')
      } else {
        setError(msg || 'Erro ao alterar senha. Tente novamente.')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="p-8 max-w-2xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Minha Conta</h1>
        <p className="text-gray-500 mt-1">Informações do seu perfil e segurança</p>
      </div>

      {/* Perfil */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 mb-6">
        <h2 className="text-sm font-semibold text-gray-700 mb-4">Perfil</h2>
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-full bg-primary-600 flex items-center justify-center text-white text-lg font-bold flex-shrink-0">
            {user?.firstName?.[0]?.toUpperCase() ?? '?'}
          </div>
          <div>
            <p className="font-medium text-gray-900">{user?.firstName} {user?.lastName}</p>
            <p className="text-sm text-gray-500">{user?.email}</p>
            <span className="inline-block mt-1 text-xs px-2 py-0.5 rounded-full bg-primary-50 text-primary-700 font-medium capitalize">
              {user?.role}
            </span>
          </div>
        </div>
      </div>

      {/* Alterar Senha */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        <h2 className="text-sm font-semibold text-gray-700 mb-4">Alterar Senha</h2>

        {success && (
          <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg mb-4 text-sm">
            {success}
          </div>
        )}
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-4 text-sm">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Senha atual</label>
            <input
              type="password"
              required
              placeholder="••••••••"
              value={form.currentPassword}
              onChange={e => setForm({ ...form, currentPassword: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Nova senha</label>
            <input
              type="password"
              required
              placeholder="Mínimo 8 caracteres"
              value={form.newPassword}
              onChange={e => setForm({ ...form, newPassword: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Confirmar nova senha</label>
            <input
              type="password"
              required
              placeholder="Repita a nova senha"
              value={form.confirmPassword}
              onChange={e => setForm({ ...form, confirmPassword: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="px-6 py-2.5 bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Salvando...' : 'Alterar Senha'}
          </button>
        </form>
      </div>
    </div>
  )
}

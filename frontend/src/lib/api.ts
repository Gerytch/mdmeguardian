import axios from 'axios'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1'

export const api = axios.create({
  baseURL: API_URL,
  headers: { 'Content-Type': 'application/json' },
})

api.interceptors.request.use((config) => {
  if (typeof window !== 'undefined') {
    const token = localStorage.getItem('accessToken')
    if (token) config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const originalRequest = error.config
    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true
      const refreshToken = localStorage.getItem('refreshToken')
      if (refreshToken) {
        try {
          const { data } = await axios.post(`${API_URL}/auth/refresh`, { refreshToken })
          localStorage.setItem('accessToken', data.accessToken)
          originalRequest.headers.Authorization = `Bearer ${data.accessToken}`
          return api(originalRequest)
        } catch {
          localStorage.clear()
          window.location.href = '/login'
        }
      } else {
        localStorage.clear()
        window.location.href = '/login'
      }
    }
    return Promise.reject(error)
  }
)

export const authApi = {
  login: (email: string, password: string) =>
    api.post('/auth/login', { email, password }),
  register: (data: { companyName: string; companySlug: string; firstName: string; lastName: string; email: string; password: string }) =>
    api.post('/auth/register', data),
  me: () => api.get('/auth/me'),
}

export const devicesApi = {
  list: (tenantId: string) => api.get(`/tenants/${tenantId}/devices`),
  get: (tenantId: string, id: string) => api.get(`/tenants/${tenantId}/devices/${id}`),
  create: (tenantId: string, data: any) => api.post(`/tenants/${tenantId}/devices`, data),
  update: (tenantId: string, id: string, data: any) => api.patch(`/tenants/${tenantId}/devices/${id}`, data),
  delete: (tenantId: string, id: string) => api.delete(`/tenants/${tenantId}/devices/${id}`),
  commands: (tenantId: string, deviceId: string) => api.get(`/tenants/${tenantId}/commands?deviceId=${deviceId}`),
  sendCommand: (tenantId: string, deviceId: string, type: string, payload?: any) =>
    api.post(`/tenants/${tenantId}/commands`, { deviceId, type, payload: payload || {} }),
  generateEnrollmentToken: (tenantId: string, policyId?: string) =>
    api.post<{ token: string; expiresAt: string; qrPayload: string }>(
      `/tenants/${tenantId}/devices/enrollment-token${policyId ? `?policyId=${policyId}` : ''}`,
    ),
}

export const policiesApi = {
  list: (tenantId: string) => api.get(`/tenants/${tenantId}/policies`),
  get: (tenantId: string, id: string) => api.get(`/tenants/${tenantId}/policies/${id}`),
  create: (tenantId: string, data: any) => api.post(`/tenants/${tenantId}/policies`, data),
  update: (tenantId: string, id: string, data: any) => api.patch(`/tenants/${tenantId}/policies/${id}`, data),
  delete: (tenantId: string, id: string) => api.delete(`/tenants/${tenantId}/policies/${id}`),
  assign: (tenantId: string, policyId: string, deviceId: string) =>
    api.patch(`/tenants/${tenantId}/policies/${policyId}/assign/${deviceId}`),
}

export const appsApi = {
  list: (tenantId: string) => api.get(`/tenants/${tenantId}/apps`),
  create: (tenantId: string, data: any) => api.post(`/tenants/${tenantId}/apps`, data),
  update: (tenantId: string, id: string, data: any) => api.patch(`/tenants/${tenantId}/apps/${id}`, data),
  delete: (tenantId: string, id: string) => api.delete(`/tenants/${tenantId}/apps/${id}`),
  uploadApk: (tenantId: string, file: File) => {
    const form = new FormData()
    form.append('file', file)
    return api.post(`/tenants/${tenantId}/apps/upload`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
  },
}

export const commandsApi = {
  list: (tenantId: string) => api.get(`/tenants/${tenantId}/commands`),
  cancel: (tenantId: string, id: string) => api.patch(`/tenants/${tenantId}/commands/${id}/cancel`),
}

export const geolocationApi = {
  latestAll: (tenantId: string) => api.get(`/tenants/${tenantId}/geolocation/latest`),
  deviceHistory: (tenantId: string, deviceId: string) =>
    api.get(`/tenants/${tenantId}/geolocation/devices/${deviceId}/history`),
}

export const deviceUsersApi = {
  list: (tenantId: string, params?: { department?: string; status?: string; page?: number; limit?: number }) =>
    api.get(`/tenants/${tenantId}/device-users`, { params }),
  get: (tenantId: string, id: string) => api.get(`/tenants/${tenantId}/device-users/${id}`),
  create: (tenantId: string, data: any) => api.post(`/tenants/${tenantId}/device-users`, data),
  update: (tenantId: string, id: string, data: any) => api.patch(`/tenants/${tenantId}/device-users/${id}`, data),
  updatePin: (tenantId: string, id: string, pin: string) => api.patch(`/tenants/${tenantId}/device-users/${id}/pin`, { pin }),
  updateStatus: (tenantId: string, id: string, status: string) => api.patch(`/tenants/${tenantId}/device-users/${id}/status`, { status }),
  delete: (tenantId: string, id: string) => api.delete(`/tenants/${tenantId}/device-users/${id}`),
}

export const deviceSessionsApi = {
  list: (tenantId: string, params?: { deviceId?: string; deviceUserId?: string; status?: string; from?: string; to?: string; page?: number; limit?: number }) =>
    api.get(`/tenants/${tenantId}/device-sessions`, { params }),
  exportCsv: (tenantId: string, params?: any) =>
    api.get(`/tenants/${tenantId}/device-sessions/export`, { params, responseType: 'blob' }),
  close: (tenantId: string, sessionId: string) =>
    api.delete(`/tenants/${tenantId}/device-sessions/${sessionId}`),
}

export const deviceGroupsApi = {
  list: (tenantId: string) => api.get(`/tenants/${tenantId}/device-groups`),
  get: (tenantId: string, id: string) => api.get(`/tenants/${tenantId}/device-groups/${id}`),
  create: (tenantId: string, data: { name: string; description?: string }) =>
    api.post(`/tenants/${tenantId}/device-groups`, data),
  update: (tenantId: string, id: string, data: { name?: string; description?: string }) =>
    api.patch(`/tenants/${tenantId}/device-groups/${id}`, data),
  delete: (tenantId: string, id: string) => api.delete(`/tenants/${tenantId}/device-groups/${id}`),
  assignPolicy: (tenantId: string, groupId: string, policyId: string) =>
    api.patch(`/tenants/${tenantId}/device-groups/${groupId}/assign-policy/${policyId}`),
  removePolicy: (tenantId: string, groupId: string) =>
    api.delete(`/tenants/${tenantId}/device-groups/${groupId}/policy`),
  addDevice: (tenantId: string, groupId: string, deviceId: string) =>
    api.patch(`/tenants/${tenantId}/device-groups/${groupId}/devices/${deviceId}`),
  removeDevice: (tenantId: string, groupId: string, deviceId: string) =>
    api.delete(`/tenants/${tenantId}/device-groups/${groupId}/devices/${deviceId}`),
}

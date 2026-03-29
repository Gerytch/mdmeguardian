'use client'

import { useEffect, useRef } from 'react'
import 'leaflet/dist/leaflet.css'

interface DeviceLocation {
  id: string
  deviceId: string
  latitude: number
  longitude: number
  accuracy?: number
  timestamp: string
}

interface Device {
  id: string
  name: string
  isOnline: boolean
  manufacturer?: string
  model?: string
}

interface Props {
  locations: DeviceLocation[]
  devices: Device[]
}

export default function DeviceMap({ locations, devices }: Props) {
  const mapRef = useRef<HTMLDivElement>(null)
  const mapInstanceRef = useRef<any>(null)

  useEffect(() => {
    if (!mapRef.current) return

    const valid = locations.filter(l => l.latitude && l.longitude)
    let cancelled = false

    // Dynamically import leaflet (client-side only)
    import('leaflet').then(L => {
      if (cancelled || !mapRef.current) return
      // Fix default icon paths broken by webpack
      delete (L.Icon.Default.prototype as any)._getIconUrl
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
        iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
        shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
      })

      const center: [number, number] = valid.length > 0
        ? [valid[0].latitude, valid[0].longitude]
        : [-15.7801, -47.9292]

      const map = L.map(mapRef.current!, {
        center,
        zoom: valid.length === 1 ? 13 : 5,
        zoomControl: true,
      })

      mapInstanceRef.current = map

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }).addTo(map)

      valid.forEach(loc => {
        const device = devices.find(d => d.id === loc.deviceId)
        const name = device?.name ?? loc.deviceId.slice(0, 8)
        const isOnline = device?.isOnline ?? false

        const marker = L.circleMarker([loc.latitude, loc.longitude], {
          radius: 10,
          fillColor: isOnline ? '#16a34a' : '#6b7280',
          fillOpacity: 1,
          color: '#fff',
          weight: 2,
        }).addTo(map)

        marker.bindPopup(`
          <div style="min-width:160px;font-family:sans-serif">
            <div style="font-weight:600;font-size:14px;margin-bottom:4px">${name}</div>
            <div style="font-size:12px;color:${isOnline ? '#16a34a' : '#9ca3af'};margin-bottom:4px">
              ${isOnline ? '● Online' : '○ Offline'}
            </div>
            ${device?.manufacturer ? `<div style="font-size:11px;color:#6b7280;margin-bottom:2px">${device.manufacturer} ${device.model ?? ''}</div>` : ''}
            <div style="font-size:11px;color:#9ca3af;margin-bottom:2px">
              ${new Date(loc.timestamp).toLocaleString('pt-BR')}
            </div>
            <div style="font-size:11px;color:#9ca3af">
              ${loc.latitude.toFixed(5)}, ${loc.longitude.toFixed(5)}
            </div>
            ${loc.accuracy ? `<div style="font-size:11px;color:#9ca3af">Precisão: ${Math.round(loc.accuracy)}m</div>` : ''}
          </div>
        `)
      })

      // Fit bounds when multiple devices
      if (valid.length > 1) {
        const bounds = L.latLngBounds(valid.map(l => [l.latitude, l.longitude] as [number, number]))
        map.fitBounds(bounds, { padding: [40, 40] })
      }
    })

    return () => {
      cancelled = true
      mapInstanceRef.current?.remove()
      mapInstanceRef.current = null
    }
  }, [locations, devices])

  return <div ref={mapRef} style={{ height: 420, width: '100%' }} />
}

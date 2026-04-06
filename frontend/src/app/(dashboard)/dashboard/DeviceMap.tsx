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

// Cache reverse geocode results to avoid duplicate requests
const geocodeCache = new Map<string, string>()

async function reverseGeocode(lat: number, lng: number): Promise<string> {
  const key = `${lat.toFixed(4)},${lng.toFixed(4)}`
  if (geocodeCache.has(key)) return geocodeCache.get(key)!

  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&accept-language=pt-BR`,
      { headers: { 'User-Agent': 'EGuardianMDM/1.0' } },
    )
    const data = await res.json()
    const a = data.address ?? {}
    const parts = [
      a.road ?? a.pedestrian ?? a.path,
      a.house_number,
      a.suburb ?? a.neighbourhood ?? a.quarter,
      a.city ?? a.town ?? a.village ?? a.municipality,
      a.state,
    ].filter(Boolean)
    const address = parts.length > 0 ? parts.join(', ') : data.display_name ?? `${lat.toFixed(5)}, ${lng.toFixed(5)}`
    geocodeCache.set(key, address)
    return address
  } catch {
    return `${lat.toFixed(5)}, ${lng.toFixed(5)}`
  }
}

function buildClusters(
  valid: DeviceLocation[],
  map: any,
  geoMeters = 60,
  pixelThreshold = 40,
): DeviceLocation[][] {
  const used = new Set<number>()
  const clusters: DeviceLocation[][] = []
  for (let i = 0; i < valid.length; i++) {
    if (used.has(i)) continue
    const group: DeviceLocation[] = [valid[i]]
    used.add(i)
    const pi = map.latLngToContainerPoint([valid[i].latitude, valid[i].longitude])
    for (let j = i + 1; j < valid.length; j++) {
      if (used.has(j)) continue
      const geoDist = map.distance(
        [valid[i].latitude, valid[i].longitude],
        [valid[j].latitude, valid[j].longitude],
      )
      const pj = map.latLngToContainerPoint([valid[j].latitude, valid[j].longitude])
      const px = Math.sqrt((pi.x - pj.x) ** 2 + (pi.y - pj.y) ** 2)
      if (geoDist <= geoMeters || px < pixelThreshold) {
        group.push(valid[j])
        used.add(j)
      }
    }
    clusters.push(group)
  }
  return clusters
}

export default function DeviceMap({ locations, devices }: Props) {
  const mapRef = useRef<HTMLDivElement>(null)
  const mapInstanceRef = useRef<any>(null)
  const layerGroupRef = useRef<any>(null)

  useEffect(() => {
    if (!mapRef.current) return

    const valid = locations.filter(l => l.latitude && l.longitude)
    let cancelled = false

    import('leaflet').then(async L => {
      if (cancelled || !mapRef.current) return

      // Pre-fetch addresses for all unique positions (rate limit: 1/s)
      const addrMap = new Map<string, string>()
      for (const loc of valid) {
        const key = `${loc.latitude.toFixed(4)},${loc.longitude.toFixed(4)}`
        if (!addrMap.has(key)) {
          addrMap.set(key, await reverseGeocode(loc.latitude, loc.longitude))
          await new Promise(r => setTimeout(r, 250)) // respect Nominatim rate limit
        }
      }

      if (cancelled || !mapRef.current) return

      const getAddr = (loc: DeviceLocation) =>
        addrMap.get(`${loc.latitude.toFixed(4)},${loc.longitude.toFixed(4)}`) ?? `${loc.latitude.toFixed(5)}, ${loc.longitude.toFixed(5)}`

      const center: [number, number] = valid.length > 0
        ? [valid[0].latitude, valid[0].longitude]
        : [-15.7801, -47.9292]

      const map = L.map(mapRef.current!, {
        center,
        zoom: valid.length === 1 ? 13 : 5,
        zoomControl: true,
      })

      mapInstanceRef.current = map
      layerGroupRef.current = L.layerGroup().addTo(map)

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }).addTo(map)

      if (valid.length > 1) {
        const bounds = L.latLngBounds(valid.map(l => [l.latitude, l.longitude] as [number, number]))
        map.fitBounds(bounds, { padding: [40, 40] })
      }

      function renderClusters() {
        if (!map || !layerGroupRef.current) return
        layerGroupRef.current.clearLayers()
        const clusters = buildClusters(valid, map, 60, 40)

        clusters.forEach(group => {
          const lat = group.reduce((s, l) => s + l.latitude, 0) / group.length
          const lng = group.reduce((s, l) => s + l.longitude, 0) / group.length

          if (group.length === 1) {
            const loc = group[0]
            const device = devices.find(d => d.id === loc.deviceId)
            const name = device?.name ?? loc.deviceId.slice(0, 8)
            const isOnline = device?.isOnline ?? false
            const addr = getAddr(loc)

            const marker = L.circleMarker([loc.latitude, loc.longitude], {
              radius: 10,
              fillColor: isOnline ? '#16a34a' : '#6b7280',
              fillOpacity: 1,
              color: '#fff',
              weight: 2,
            })

            marker.bindPopup(`
              <div style="min-width:200px;font-family:sans-serif">
                <div style="font-weight:600;font-size:14px;margin-bottom:4px">${name}</div>
                <div style="font-size:12px;color:${isOnline ? '#16a34a' : '#9ca3af'};margin-bottom:6px">
                  ${isOnline ? '● Online' : '○ Offline'}
                </div>
                ${device?.manufacturer ? `<div style="font-size:11px;color:#6b7280;margin-bottom:4px">${device.manufacturer} ${device.model ?? ''}</div>` : ''}
                <div style="font-size:11px;color:#374151;margin-bottom:2px">
                  <span style="color:#9ca3af">📍</span> ${addr}
                </div>
                <div style="font-size:11px;color:#9ca3af;margin-bottom:2px">
                  ${new Date(loc.timestamp).toLocaleString('pt-BR')}
                </div>
                ${loc.accuracy ? `<div style="font-size:11px;color:#9ca3af">Precisão: ${Math.round(loc.accuracy)}m</div>` : ''}
              </div>
            `)

            layerGroupRef.current.addLayer(marker)
          } else {
            const onlineCount = group.filter(loc => devices.find(d => d.id === loc.deviceId)?.isOnline).length
            const allOnline = onlineCount === group.length
            const someOnline = onlineCount > 0
            const color = allOnline ? '#16a34a' : someOnline ? '#f59e0b' : '#6b7280'

            const icon = L.divIcon({
              html: `<div style="
                background:${color};color:#fff;border-radius:50%;
                width:36px;height:36px;
                display:flex;align-items:center;justify-content:center;
                font-weight:700;font-size:13px;
                border:3px solid #fff;
                box-shadow:0 2px 6px rgba(0,0,0,0.3);cursor:pointer;
              ">${group.length}</div>`,
              className: '',
              iconSize: [36, 36],
              iconAnchor: [18, 18],
            })

            // Group devices by address
            const byAddr = new Map<string, { loc: DeviceLocation; name: string; online: boolean }[]>()
            group.forEach(loc => {
              const d = devices.find(d => d.id === loc.deviceId)
              const addr = getAddr(loc)
              if (!byAddr.has(addr)) byAddr.set(addr, [])
              byAddr.get(addr)!.push({
                loc,
                name: d?.name ?? loc.deviceId.slice(0, 8),
                online: d?.isOnline ?? false,
              })
            })

            const multiAddr = byAddr.size > 1
            const addrSections = Array.from(byAddr.entries()).map(([addr, devs]) => {
              const devList = devs.map(({ name, online }) =>
                `<div style="padding:3px 0 3px ${multiAddr ? '12px' : '0'};font-size:12px">
                  <span style="color:${online ? '#16a34a' : '#9ca3af'}">${online ? '●' : '○'}</span>
                  <span style="margin-left:5px;font-weight:500">${name}</span>
                </div>`
              ).join('')
              return `
                <div style="margin-bottom:8px">
                  <div style="font-size:11px;color:#374151;margin-bottom:3px">
                    <span style="color:#9ca3af">📍</span> ${addr}
                  </div>
                  ${devList}
                </div>`
            }).join('<div style="border-top:1px solid #e5e7eb;margin:6px 0"></div>')

            const marker = L.marker([lat, lng], { icon } as any)
            marker.bindPopup(`
              <div style="min-width:220px;font-family:sans-serif">
                <div style="font-weight:700;font-size:13px;margin-bottom:8px;color:#374151;padding-bottom:6px;border-bottom:1px solid #e5e7eb">
                  ${group.length} dispositivos nesta área
                  <span style="font-weight:400;color:#9ca3af;margin-left:4px">(${onlineCount} online)</span>
                </div>
                ${addrSections}
                <div style="margin-top:6px;font-size:11px;color:#9ca3af;text-align:center">
                  Aproxime o mapa para ver individualmente
                </div>
              </div>
            `)

            layerGroupRef.current.addLayer(marker)
          }
        })
      }

      // Render immediately + on every zoom change
      map.on('zoomend', renderClusters)
      // Use setTimeout to ensure map container has correct pixel dimensions
      setTimeout(renderClusters, 100)
    })

    return () => {
      cancelled = true
      mapInstanceRef.current?.remove()
      mapInstanceRef.current = null
    }
  }, [locations, devices])

  return <div ref={mapRef} style={{ height: 420, width: '100%' }} />
}

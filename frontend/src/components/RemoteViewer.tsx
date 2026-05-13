'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

interface RemoteViewerProps {
  sessionId: string
  deviceName: string
  onClose: () => void
}

export default function RemoteViewer({ sessionId, deviceName, onClose }: RemoteViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const [connected, setConnected] = useState(false)
  const [deviceConnected, setDeviceConnected] = useState(false)
  const [fps, setFps] = useState(0)
  const frameCountRef = useRef(0)
  const dragStartRef = useRef<{ x: number; y: number } | null>(null)

  // FPS counter
  useEffect(() => {
    const iv = setInterval(() => {
      setFps(frameCountRef.current)
      frameCountRef.current = 0
    }, 1000)
    return () => clearInterval(iv)
  }, [])

  // WebSocket connection
  useEffect(() => {
    const token = localStorage.getItem('accessToken') || ''
    // Derive WebSocket URL from page origin — works behind any reverse proxy
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const host = window.location.host
    const wsUrl = protocol + '//' + host + '/remote'
      + `?role=viewer&sessionId=${sessionId}&token=${token}`

    const ws = new WebSocket(wsUrl)
    ws.binaryType = 'arraybuffer'
    wsRef.current = ws

    ws.onopen = () => {
      setConnected(true)
    }

    ws.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) {
        // Binary = JPEG frame
        renderFrame(event.data)
        frameCountRef.current++
      } else {
        // Text = JSON control message
        try {
          const msg = JSON.parse(event.data)
          switch (msg.type) {
            case 'device_connected':
              setDeviceConnected(true)
              break
            case 'device_disconnected':
              setDeviceConnected(false)
              break
            case 'device_info':
              break
            case 'session_ended':
              onCloseRef.current()
              break
          }
        } catch {}
      }
    }

    ws.onclose = () => {
      setConnected(false)
      setDeviceConnected(false)
    }

    ws.onerror = () => {
      setConnected(false)
    }

    return () => {
      ws.close()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId])

  const renderFrame = useCallback((data: ArrayBuffer) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Use createImageBitmap for flicker-free rendering
    const blob = new Blob([data], { type: 'image/jpeg' })
    createImageBitmap(blob).then((bmp) => {
      // Set canvas size only once on first frame
      if (canvas.width !== bmp.width || canvas.height !== bmp.height) {
        if (!canvas.dataset.sizeSet) {
          canvas.width = bmp.width
          canvas.height = bmp.height
          canvas.dataset.sizeSet = '1'
        }
      }
      ctx.drawImage(bmp, 0, 0)
      bmp.close()
    })
  }, [])

  // Convert canvas click position to normalized device coordinates (0-1)
  const getDeviceCoords = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    const scaleX = canvas.width / rect.width
    const scaleY = canvas.height / rect.height
    const canvasX = (e.clientX - rect.left) * scaleX
    const canvasY = (e.clientY - rect.top) * scaleY
    return {
      x: canvasX / canvas.width,
      y: canvasY / canvas.height,
    }
  }

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const coords = getDeviceCoords(e)
    if (!coords) return
    dragStartRef.current = coords
  }

  const handleMouseUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const end = getDeviceCoords(e)
    const start = dragStartRef.current
    dragStartRef.current = null
    if (!end || !start || !wsRef.current || wsRef.current.readyState !== 1) return

    // Distance threshold: < 2% of screen = tap, otherwise swipe
    const dist = Math.hypot(end.x - start.x, end.y - start.y)

    if (dist > 0.02) {
      wsRef.current.send(JSON.stringify({
        type: 'input_swipe',
        startX: start.x,
        startY: start.y,
        endX: end.x,
        endY: end.y,
        duration: 300,
      }))
    } else {
      wsRef.current.send(JSON.stringify({
        type: 'input_tap',
        x: start.x,
        y: start.y,
      }))
    }
  }

  const sendAction = (type: string) => {
    if (wsRef.current && wsRef.current.readyState === 1) {
      wsRef.current.send(JSON.stringify({ type }))
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-gray-900 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 bg-gray-800 text-white">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-semibold">Acesso Remoto — {deviceName}</h2>
          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
            deviceConnected ? 'bg-green-900 text-green-300' : 'bg-yellow-900 text-yellow-300'
          }`}>
            <span className={`w-1.5 h-1.5 rounded-full ${deviceConnected ? 'bg-green-400' : 'bg-yellow-400'}`} />
            {deviceConnected ? 'Conectado' : 'Aguardando dispositivo...'}
          </span>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-xs text-gray-400">{fps} FPS</span>
          <button
            onClick={() => {
              wsRef.current?.close()
              onClose()
            }}
            className="px-3 py-1 bg-red-600 hover:bg-red-700 text-white text-sm rounded transition-colors"
          >
            Encerrar
          </button>
        </div>
      </div>

      {/* Canvas area */}
      <div className="flex-1 flex items-center justify-center overflow-hidden bg-black">
        {!deviceConnected ? (
          <div className="text-center text-gray-400">
            <div className="animate-spin w-8 h-8 border-2 border-gray-600 border-t-white rounded-full mx-auto mb-3" />
            <p className="text-sm">Aguardando conexão do dispositivo...</p>
            <p className="text-xs text-gray-500 mt-1">O dispositivo será conectado em até 5 segundos</p>
          </div>
        ) : (
          <canvas
            ref={canvasRef}
            className="max-h-full max-w-full cursor-crosshair"
            style={{ objectFit: 'contain' }}
            onMouseDown={handleMouseDown}
            onMouseUp={handleMouseUp}
          />
        )}
      </div>

      {/* Navigation bar */}
      <div className="flex items-center justify-center gap-6 py-3 bg-gray-800">
        <button
          onClick={() => sendAction('input_back')}
          className="flex flex-col items-center gap-1 text-gray-400 hover:text-white transition-colors"
          title="Voltar"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          <span className="text-[10px]">Voltar</span>
        </button>
        <button
          onClick={() => sendAction('input_home')}
          className="flex flex-col items-center gap-1 text-gray-400 hover:text-white transition-colors"
          title="Home"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-4 0a1 1 0 01-1-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 01-1 1" />
          </svg>
          <span className="text-[10px]">Home</span>
        </button>
        <button
          onClick={() => sendAction('input_recents')}
          className="flex flex-col items-center gap-1 text-gray-400 hover:text-white transition-colors"
          title="Recentes"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16m-7 6h7" />
          </svg>
          <span className="text-[10px]">Recentes</span>
        </button>
      </div>
    </div>
  )
}

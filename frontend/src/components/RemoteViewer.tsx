'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

interface RemoteViewerProps {
  sessionId: string
  deviceName: string
  onClose: () => void
}

// H.264 frame type markers (must match backend/device constants)
const FRAME_CONFIG = 0x01
const FRAME_KEY = 0x02
const FRAME_DELTA = 0x03

export default function RemoteViewer({ sessionId, deviceName, onClose }: RemoteViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const [connected, setConnected] = useState(false)
  const [deviceConnected, setDeviceConnected] = useState(false)
  const [fps, setFps] = useState(0)
  const [streamMode, setStreamMode] = useState<'jpeg' | 'h264'>('jpeg')
  const frameCountRef = useRef(0)
  const dragStartRef = useRef<{ x: number; y: number } | null>(null)

  // H.264 decoder refs
  const decoderRef = useRef<VideoDecoder | null>(null)
  const codecConfigRef = useRef<Uint8Array | null>(null)
  const decoderReady = useRef(false)
  const timestampRef = useRef(0)

  // FPS counter
  useEffect(() => {
    const iv = setInterval(() => {
      setFps(frameCountRef.current)
      frameCountRef.current = 0
    }, 1000)
    return () => clearInterval(iv)
  }, [])

  // -- JPEG rendering ---------------------------------------------------
  const renderJpegFrame = useCallback((data: ArrayBuffer) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const blob = new Blob([data], { type: 'image/jpeg' })
    createImageBitmap(blob).then((bmp) => {
      if (!canvas.dataset.sizeSet) {
        canvas.width = bmp.width
        canvas.height = bmp.height
        canvas.dataset.sizeSet = '1'
      }
      ctx.drawImage(bmp, 0, 0)
      bmp.close()
    })
  }, [])

  // -- H.264 decoder setup ----------------------------------------------
  const initH264Decoder = useCallback((width: number, height: number) => {
    if (typeof VideoDecoder === 'undefined') {
      console.warn('WebCodecs not available — staying in JPEG mode')
      return
    }

    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    canvas.width = width
    canvas.height = height
    canvas.dataset.sizeSet = '1'

    const decoder = new VideoDecoder({
      output: (frame: VideoFrame) => {
        ctx.drawImage(frame, 0, 0)
        frame.close()
        frameCountRef.current++
      },
      error: (e: DOMException) => {
        console.error('VideoDecoder error:', e)
      },
    })

    decoderRef.current = decoder
    decoderReady.current = false
    timestampRef.current = 0
  }, [])

  const configureDecoder = useCallback((configData: Uint8Array) => {
    const decoder = decoderRef.current
    if (!decoder) return
    codecConfigRef.current = configData

    decoder.configure({
      codec: 'avc1.42E01F',
      description: configData,
    })
    decoderReady.current = true
  }, [])

  const decodeH264Frame = useCallback((frameData: Uint8Array, isKey: boolean) => {
    const decoder = decoderRef.current
    if (!decoder || !decoderReady.current) return
    if (decoder.state !== 'configured') return

    const chunk = new EncodedVideoChunk({
      type: isKey ? 'key' : 'delta',
      timestamp: timestampRef.current,
      data: frameData,
    })
    timestampRef.current += 50_000
    decoder.decode(chunk)
  }, [])

  // -- WebSocket connection ---------------------------------------------
  useEffect(() => {
    const token = localStorage.getItem('accessToken') || ''
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const host = window.location.host
    const wsUrl = `${protocol}//${host}/remote?role=viewer&sessionId=${sessionId}&token=${token}`

    const ws = new WebSocket(wsUrl)
    ws.binaryType = 'arraybuffer'
    wsRef.current = ws

    ws.onopen = () => setConnected(true)

    ws.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) {
        const bytes = new Uint8Array(event.data)
        if (bytes.length === 0) return

        if (decoderRef.current && decoderReady.current) {
          // H.264 mode
          const frameType = bytes[0]
          const payload = bytes.subarray(1)

          if (frameType === FRAME_CONFIG) {
            configureDecoder(payload)
          } else if (frameType === FRAME_KEY) {
            decodeH264Frame(payload, true)
          } else if (frameType === FRAME_DELTA) {
            decodeH264Frame(payload, false)
          }
        } else if (decoderRef.current && !decoderReady.current) {
          // Decoder initialised but waiting for config
          const frameType = bytes[0]
          if (frameType === FRAME_CONFIG) {
            configureDecoder(bytes.subarray(1))
          } else if (frameType === FRAME_KEY && codecConfigRef.current) {
            decodeH264Frame(bytes.subarray(1), true)
          }
        } else {
          // JPEG mode
          renderJpegFrame(event.data)
          frameCountRef.current++
        }
      } else {
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
            case 'stream_upgrade':
              if (msg.codec === 'h264') {
                setStreamMode('h264')
                initH264Decoder(msg.width || 720, msg.height || 1280)
              }
              break
            case 'session_ended':
              onCloseRef.current()
              break
          }
        } catch { /* ignore malformed messages */ }
      }
    }

    ws.onclose = () => {
      setConnected(false)
      setDeviceConnected(false)
    }

    ws.onerror = () => setConnected(false)

    return () => {
      ws.close()
      if (decoderRef.current && decoderRef.current.state !== 'closed') {
        decoderRef.current.close()
        decoderRef.current = null
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId])

  // -- Input handling ---------------------------------------------------
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
          <h2 className="text-sm font-semibold">Acesso Remoto &mdash; {deviceName}</h2>
          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
            deviceConnected ? 'bg-green-900 text-green-300' : 'bg-yellow-900 text-yellow-300'
          }`}>
            <span className={`w-1.5 h-1.5 rounded-full ${deviceConnected ? 'bg-green-400' : 'bg-yellow-400'}`} />
            {deviceConnected ? 'Conectado' : 'Aguardando dispositivo...'}
          </span>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-xs text-gray-400">
            {fps} FPS{' '}
            <span className={`ml-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${
              streamMode === 'h264'
                ? 'bg-green-900/50 text-green-400'
                : 'bg-gray-700 text-gray-400'
            }`}>
              {streamMode === 'h264' ? 'H.264' : 'JPEG'}
            </span>
          </span>
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
            <p className="text-sm">Aguardando conexao do dispositivo...</p>
            <p className="text-xs text-gray-500 mt-1">O dispositivo sera conectado em ate 5 segundos</p>
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

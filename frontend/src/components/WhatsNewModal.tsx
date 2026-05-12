'use client'

import { useEffect, useState } from 'react'
import { releaseNotes, CURRENT_VERSION, ReleaseNote } from '@/lib/release-notes'

const LS_KEY = 'eguardian_last_seen_version'

function typeBadge(type: ReleaseNote['type']) {
  const styles: Record<string, string> = {
    'Sistema':       'bg-blue-100 text-blue-700',
    'APK':           'bg-green-100 text-green-700',
    'Sistema + APK': 'bg-purple-100 text-purple-700',
  }
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${styles[type] || ''}`}>
      {type}
    </span>
  )
}

function itemIcon(text: string) {
  if (text.startsWith('Novo')) return <span className="text-emerald-500 flex-shrink-0">✦</span>
  if (text.startsWith('Corrigido')) return <span className="text-blue-500 flex-shrink-0">✓</span>
  return <span className="text-gray-400 flex-shrink-0">•</span>
}

function ItemList({ items }: { items: string[] }) {
  return (
    <ul className="space-y-1.5">
      {items.map((item, i) => (
        <li key={i} className="flex items-start gap-2 text-sm text-gray-600">
          <span className="mt-0.5">{itemIcon(item)}</span>
          <span>{item}</span>
        </li>
      ))}
    </ul>
  )
}

function SectionItems({ note }: { note: ReleaseNote }) {
  const hasSystem = note.systemItems && note.systemItems.length > 0
  const hasApk = note.apkItems && note.apkItems.length > 0
  const hasBoth = hasSystem && hasApk

  return (
    <div className="space-y-3">
      {hasSystem && (
        <div>
          {hasBoth && (
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-xs font-semibold text-blue-600 uppercase tracking-wider">Sistema</span>
              <div className="flex-1 border-t border-blue-100" />
            </div>
          )}
          <ItemList items={note.systemItems!} />
        </div>
      )}
      {hasApk && (
        <div>
          {hasBoth && (
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-xs font-semibold text-green-600 uppercase tracking-wider">
                APK {note.apkVersion ? `v${note.apkVersion}` : ''}
              </span>
              <div className="flex-1 border-t border-green-100" />
            </div>
          )}
          <ItemList items={note.apkItems!} />
        </div>
      )}
    </div>
  )
}

interface WhatsNewModalProps {
  externalOpen?: boolean
  onExternalClose?: () => void
}

export default function WhatsNewModal({ externalOpen, onExternalClose }: WhatsNewModalProps = {}) {
  const [autoOpen, setAutoOpen] = useState(false)
  const [dontShowAgain, setDontShowAgain] = useState(false)

  useEffect(() => {
    const lastSeen = localStorage.getItem(LS_KEY)
    if (lastSeen !== CURRENT_VERSION) {
      setAutoOpen(true)
    }
  }, [])

  const open = autoOpen || externalOpen

  const handleClose = () => {
    if (dontShowAgain) {
      localStorage.setItem(LS_KEY, CURRENT_VERSION)
    }
    setAutoOpen(false)
    onExternalClose?.()
  }

  if (!open) return null

  const [latest, ...older] = releaseNotes

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[9999] p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="p-6 border-b border-gray-100 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-primary-100 rounded-xl flex items-center justify-center text-lg">
              🚀
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Novidades do E.Guardian</h2>
              <p className="text-sm text-gray-500">Veja o que mudou na plataforma</p>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto flex-1 space-y-5">
          {/* Latest version - featured */}
          {latest && (
            <div className="bg-gray-50 rounded-xl p-4 border border-gray-100">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-sm font-bold text-gray-900">v{latest.version}</span>
                {typeBadge(latest.type)}
                <span className="text-xs text-gray-400 ml-auto">{latest.date}</span>
              </div>
              {latest.apkVersion && (
                <p className="text-xs text-green-600 font-medium mb-2">APK v{latest.apkVersion}</p>
              )}
              <h3 className="text-sm font-semibold text-gray-800 mb-3">{latest.title}</h3>
              <SectionItems note={latest} />
            </div>
          )}

          {/* Previous versions - compact with expandable details */}
          {older.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
                Versões anteriores
              </p>
              <div className="space-y-3">
                {older.map((note) => (
                  <details key={note.version} className="group pb-3 border-b border-gray-50 last:border-0">
                    <summary className="flex items-center gap-2 cursor-pointer list-none">
                      <svg className="w-3.5 h-3.5 text-gray-400 transition-transform group-open:rotate-90 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                      <span className="text-xs font-semibold text-gray-700">v{note.version}</span>
                      {typeBadge(note.type)}
                      {note.apkVersion && (
                        <span className="text-xs text-green-600">APK v{note.apkVersion}</span>
                      )}
                      <span className="text-xs text-gray-400 ml-auto">{note.date}</span>
                    </summary>
                    <div className="mt-2 ml-5">
                      <p className="text-xs font-medium text-gray-600 mb-2">{note.title}</p>
                      <SectionItems note={note} />
                    </div>
                  </details>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-gray-100 flex-shrink-0">
          <label className="flex items-center gap-2 mb-4 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={dontShowAgain}
              onChange={(e) => setDontShowAgain(e.target.checked)}
              className="w-4 h-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
            />
            <span className="text-sm text-gray-600">Mostrar somente na próxima atualização</span>
          </label>
          <button
            onClick={handleClose}
            className="w-full px-4 py-2.5 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 transition-colors"
          >
            Entendido
          </button>
        </div>
      </div>
    </div>
  )
}

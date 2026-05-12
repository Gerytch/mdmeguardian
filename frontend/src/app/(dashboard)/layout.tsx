'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Sidebar from '@/components/layout/Sidebar'
import WhatsNewModal from '@/components/WhatsNewModal'
import { isAuthenticated } from '@/lib/auth'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const [whatsNewOpen, setWhatsNewOpen] = useState(false)

  useEffect(() => {
    if (!isAuthenticated()) {
      router.replace('/login')
    }
  }, [router])

  return (
    <div className="flex h-screen bg-gray-50">
      <Sidebar onWhatsNew={() => setWhatsNewOpen(true)} />
      <main className="flex-1 ml-64 overflow-auto relative z-0">
        {children}
      </main>
      <WhatsNewModal externalOpen={whatsNewOpen} onExternalClose={() => setWhatsNewOpen(false)} />
    </div>
  )
}

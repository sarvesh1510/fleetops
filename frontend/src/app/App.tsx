import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useAuthStore } from '../stores/authStore'
import { useWSStore } from '../stores/wsStore'
import AppLayout from '../components/layout/AppLayout'
import LoginPage from '../pages/LoginPage'
import DashboardPage from '../pages/DashboardPage'
import FleetPage from '../pages/FleetPage'
import OrdersPage from '../pages/OrdersPage'
import IncidentsPage from '../pages/IncidentsPage'
import { OptimizationPage, AnalyticsPage, PredictionsPage } from '../pages/AnalyticsPages'

const qc = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 5000,
    },
  },
})

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuthStore()
  return isAuthenticated ? <>{children}</> : <Navigate to="/login" replace />
}

function AppInit({ children }: { children: React.ReactNode }) {
  const { loadFromStorage, isAuthenticated } = useAuthStore()
  const { connect, disconnect } = useWSStore()

  useEffect(() => {
    loadFromStorage()
  }, [loadFromStorage])

  useEffect(() => {
    if (isAuthenticated) {
      connect()
    } else {
      disconnect()
    }
  }, [isAuthenticated, connect, disconnect])

  return <>{children}</>
}

export default function App() {
  return (
    <QueryClientProvider client={qc}>
      <BrowserRouter>
        <AppInit>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/" element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
              <Route index element={<DashboardPage />} />
              <Route path="fleet" element={<FleetPage />} />
              <Route path="orders" element={<OrdersPage />} />
              <Route path="incidents" element={<IncidentsPage />} />
              <Route path="optimization" element={<OptimizationPage />} />
              <Route path="analytics" element={<AnalyticsPage />} />
              <Route path="predictions" element={<PredictionsPage />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </AppInit>
      </BrowserRouter>
    </QueryClientProvider>
  )
}

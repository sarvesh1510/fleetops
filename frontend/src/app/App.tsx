import { lazy, Suspense, useEffect } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { useAuthStore } from '../stores/authStore'
import { useWSStore } from '../stores/wsStore'
import { queryClient } from '../lib/queryClient'
import AppLayout from '../components/layout/AppLayout'
import LoginPage from '../pages/LoginPage'
import { LoadingRows } from '../components/ui'

// Route-level code splitting keeps the first load small (charts and the map load on demand)
const DashboardPage = lazy(() => import('../pages/DashboardPage'))
const FleetPage = lazy(() => import('../pages/FleetPage'))
const OrdersPage = lazy(() => import('../pages/OrdersPage'))
const IncidentsPage = lazy(() => import('../pages/IncidentsPage'))
const OptimizationPage = lazy(() => import('../pages/OptimizationPage'))
const AnalyticsPage = lazy(() => import('../pages/AnalyticsPage'))
const PredictionsPage = lazy(() => import('../pages/PredictionsPage'))

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore(s => s.isAuthenticated)
  return isAuthenticated ? <>{children}</> : <Navigate to="/login" replace />
}

/** Keeps the live socket open exactly while signed in. */
function LiveConnection() {
  const isAuthenticated = useAuthStore(s => s.isAuthenticated)
  const { connect, disconnect } = useWSStore()
  useEffect(() => {
    if (isAuthenticated) connect()
    else disconnect()
  }, [isAuthenticated, connect, disconnect])
  return null
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <LiveConnection />
        <Suspense fallback={<LoadingRows rows={8} />}>
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
        </Suspense>
      </BrowserRouter>
    </QueryClientProvider>
  )
}

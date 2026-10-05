import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Skeleton } from './components/common/States';
import { AppLayout } from './components/layout/AppLayout';
import LiveDashboard from './pages/LiveDashboard';

const PlaybackPage = lazy(() => import('./pages/PlaybackPage'));
const EventsPage = lazy(() => import('./pages/EventsPage'));
const IncidentsPage = lazy(() => import('./pages/IncidentsPage'));
const AnalyticsPage = lazy(() => import('./pages/AnalyticsPage'));
const CamerasPage = lazy(() => import('./pages/CamerasPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));

const PageFallback = () => (
  <div className="space-y-4">
    <Skeleton className="h-8 w-48" />
    <Skeleton className="h-80 rounded-2xl" />
  </div>
);

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppLayout />}>
          <Route index element={<Navigate to="/live" replace />} />
          <Route path="live" element={<LiveDashboard />} />
          <Route path="playback" element={<Suspense fallback={<PageFallback />}><PlaybackPage /></Suspense>} />
          <Route path="events" element={<Suspense fallback={<PageFallback />}><EventsPage /></Suspense>} />
          <Route path="incidents" element={<Suspense fallback={<PageFallback />}><IncidentsPage /></Suspense>} />
          <Route path="analytics" element={<Suspense fallback={<PageFallback />}><AnalyticsPage /></Suspense>} />
          <Route path="cameras" element={<Suspense fallback={<PageFallback />}><CamerasPage /></Suspense>} />
          <Route path="settings" element={<Suspense fallback={<PageFallback />}><SettingsPage /></Suspense>} />
          <Route path="*" element={<Navigate to="/live" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

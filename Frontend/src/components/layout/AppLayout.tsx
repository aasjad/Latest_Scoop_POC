import { LoaderCircle, WifiOff } from 'lucide-react';
import { Outlet } from 'react-router-dom';
import { useMediaQuery } from '@/hooks/useDom';
import { useLiveFeed } from '@/hooks/useLiveFeed';
import { useConnectionStore } from '@/store/connectionStore';
import { Toaster } from '../common/Toaster';
import { EventDrawer } from '../events/EventDrawer';
import { SystemDiagnosticsDrawer } from '../health/SystemHealth';
import { OccupancyDrawer } from '../kpi/OccupancyDrawer';
import { ShortcutsDrawer } from '../live/ShortcutsDrawer';
import { MobileNav, Sidebar } from './Sidebar';
import { TopHeader } from './TopHeader';

function ConnectionBanner() {
  const socket = useConnectionStore((s) => s.socket);
  if (socket === 'open' || socket === 'connecting') return null;
  return (
    <div role="status" className="flex animate-slide-in items-center justify-center gap-2 bg-amber-50 px-4 py-2 text-[13px] text-amber-800 ring-1 ring-amber-200">
      {socket === 'reconnecting' ? <LoaderCircle className="size-4 animate-spin" /> : <WifiOff className="size-4" />}
      {socket === 'reconnecting' ? 'Live connection lost — reconnecting. Counts will catch up automatically.' : 'Live updates are disconnected.'}
    </div>
  );
}

export function AppLayout() {
  useLiveFeed();
  const isWide = useMediaQuery('(min-width: 1280px)');

  return (
    <div className="flex h-full overflow-hidden">
      <Sidebar forceCollapsed={!isWide} />
      <MobileNav />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopHeader />
        <ConnectionBanner />
        <main className="scroll-thin flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[1680px] p-4 md:p-6">
            <Outlet />
          </div>
        </main>
      </div>
      <EventDrawer />
      <OccupancyDrawer />
      <SystemDiagnosticsDrawer />
      <ShortcutsDrawer />
      <Toaster />
    </div>
  );
}

import { Cctv, ChartColumn, CirclePlay, ListChecks, Radio, Settings, ShieldAlert, type LucideIcon } from 'lucide-react';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
}

export const NAV_ITEMS: NavItem[] = [
  { to: '/live', label: 'Live', icon: Radio },
  { to: '/playback', label: 'Playback', icon: CirclePlay },
  { to: '/events', label: 'Events', icon: ListChecks },
  { to: '/incidents', label: 'Incidents', icon: ShieldAlert },
  { to: '/analytics', label: 'Analytics', icon: ChartColumn },
  { to: '/cameras', label: 'Cameras', icon: Cctv },
  { to: '/settings', label: 'Settings', icon: Settings },
];

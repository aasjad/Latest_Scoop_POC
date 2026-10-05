/**
 * Single entry point for data access. The UI imports `api` and `socket` from here
 * and never knows whether it is talking to the mock or to FastAPI.
 * Toggle with VITE_USE_MOCK (see .env / .env.live).
 */
import { ENV } from '@/config/constants';
import { mockApi } from '@/mocks/mockApi';
import { mockSocket } from '@/mocks/mockSocket';
import { httpApi } from './http';
import { ReconnectingSocket } from './socket';
import type { BackendApi, LiveSocket } from './types';

// Inline env checks (not ENV.useMock) so the bundler can drop the mock in live builds.
export const api: BackendApi = import.meta.env.VITE_USE_MOCK === 'true' ? mockApi : httpApi;
export const socket: LiveSocket = import.meta.env.VITE_USE_MOCK === 'true' ? mockSocket : new ReconnectingSocket(ENV.wsUrl);

export { ApiError } from './types';
export type { BackendApi, LiveSocket } from './types';

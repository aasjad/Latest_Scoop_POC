/** MOCK ONLY — demo controls surfaced in Settings when VITE_USE_MOCK=true. */
import { mockSocket } from './mockSocket';
import { simulateBurst, simulateDegradation } from './simulator';

export const devtools = {
  degradeCamera: (cameraId: string) => simulateDegradation(cameraId, 20_000),
  dropConnection: () => mockSocket.simulateDrop(4000),
  visitorBurst: (cameraId: string) => simulateBurst(cameraId, 5),
};

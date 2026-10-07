// The bus carries messages between gateways: Redis pub/sub in production, an in-process hub for
// tests and single-process runs.
import { EventEmitter } from 'node:events'

export type BusHandler = (message: Uint8Array) => void

// Published when someone's access changes, so gateways re-check open connections straight away.
export interface AccessEvent {
  userId: string
  workspaceId: string
}

export interface Bus {
  // Called when the relay reconnects. Messages sent while it was down are gone (pub/sub does not
  // buffer), so rooms re-read the stored state.
  onResync(handler: () => void): () => void
  publishAccess(event: AccessEvent): void
  onAccess(handler: (event: AccessEvent) => void): () => void
  publish(docId: string, message: Uint8Array): void
  // only hears from other gateways
  subscribe(docId: string, handler: BusHandler): () => void
}

export class LocalHub {
  private ee = new EventEmitter().setMaxListeners(0)

  connect(gatewayId: string): Bus {
    return {
      onResync: (handler) => {
        this.ee.on('__resync', handler)
        return () => this.ee.off('__resync', handler)
      },
      publishAccess: (event) => this.ee.emit('__access', event),
      onAccess: (handler) => {
        this.ee.on('__access', handler)
        return () => this.ee.off('__access', handler)
      },
      publish: (docId, message) => this.ee.emit(docId, gatewayId, message),
      subscribe: (docId, handler) => {
        const listener = (from: string, message: Uint8Array) => {
          if (from !== gatewayId) handler(message)
        }
        this.ee.on(docId, listener)
        return () => this.ee.off(docId, listener)
      },
    }
  }
}

export class NoBus implements Bus {
  onResync() {
    return () => {}
  }
  publishAccess() {}
  onAccess() {
    return () => {}
  }
  publish() {}
  subscribe() {
    return () => {}
  }
}

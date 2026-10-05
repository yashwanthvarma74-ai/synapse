// The bus carries protocol messages between gateway instances.
// Production uses Redis pub/sub; LocalHub does the same job in one process,
// which lets tests run several "gateways" without Redis.
import { EventEmitter } from 'node:events'

export type BusHandler = (message: Uint8Array) => void

// Sent by the API when someone's access changes, so every gateway can re-check
// open sockets right away (revoking access must not wait for a reconnect).
export interface AccessEvent {
  userId: string
  workspaceId: string
}

export interface Bus {
  // Called when the relay connection comes back after being lost. Messages
  // published meanwhile are gone for good (pub/sub does not buffer), so rooms must
  // re-read the stored state.
  onResync(handler: () => void): () => void
  publishAccess(event: AccessEvent): void
  onAccess(handler: (event: AccessEvent) => void): () => void
  publish(docId: string, message: Uint8Array): void
  // handler only receives messages published by OTHER gateways
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

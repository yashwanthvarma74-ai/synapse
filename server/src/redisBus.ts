// Redis pub/sub implementation of Bus. Each room maps to one channel.
// Two connections are needed: a Redis connection that has subscribed can't
// run other commands, so publishing uses its own connection.
import { Redis } from 'ioredis'
import type { AccessEvent, Bus, BusHandler } from './bus.js'
import { m, observeGauge } from './telemetry.js'
import { logger } from './logger.js'

const channel = (docId: string) => `synapse:room:${docId}`
const ACCESS_CHANNEL = 'synapse:access'

export class RedisBus implements Bus {
  private pub: Redis
  private sub: Redis
  private handlers = new Map<string, Set<BusHandler>>() // docId -> handlers
  private idBytes: Buffer
  private accessHandlers = new Set<(e: AccessEvent) => void>()
  private resyncHandlers = new Set<() => void>()
  private subWasReady = false
  private stopUpGauge: () => void = () => {}

  constructor(
    url: string,
    private gatewayId: string,
  ) {
    this.pub = new Redis(url)
    this.sub = new Redis(url)
    this.pub.on('error', (e: Error) => this.onError(e))
    this.sub.on('error', (e: Error) => this.onError(e))
    this.idBytes = Buffer.from(gatewayId)
    // Wire format: [1 byte: id length][gateway id][protocol message]
    // The id lets a gateway ignore its own publishes.
    // The subscriber connection becomes "ready" again after every reconnect.
    // While it was down, relayed messages were lost, so tell the gateway to resync.
    this.sub.on('ready', () => {
      if (this.subWasReady) {
        m.relayReconnects.add(1)
        this.resyncHandlers.forEach((h) => h())
      }
      this.subWasReady = true
    })
    // 1 while both Redis connections are usable, 0 when the relay is down
    this.stopUpGauge = observeGauge('synapse_relay_up', '1 when the Redis relay is connected, 0 when it is not', () =>
      this.pub.status === 'ready' && this.sub.status === 'ready' ? 1 : 0)
    this.sub.subscribe(ACCESS_CHANNEL).catch(this.onError)
    this.sub.on('messageBuffer', (chan: Buffer, data: Buffer) => {
      if (chan.toString() === ACCESS_CHANNEL) {
        try {
          const event = JSON.parse(data.toString()) as AccessEvent
          this.accessHandlers.forEach((h) => h(event))
        } catch {
          /* ignore malformed */
        }
        return
      }
      const docId = chan.toString().slice('synapse:room:'.length)
      const idLen = data[0]
      const from = data.subarray(1, 1 + idLen).toString()
      if (from === this.gatewayId) return
      const message = new Uint8Array(data.subarray(1 + idLen))
      m.relayReceived.add(1)
      this.handlers.get(docId)?.forEach((h) => h(message))
    })
  }

  // A Redis hiccup must not crash the gateway: log it and carry on. Local
  // clients keep working, and cross-gateway relay resumes when Redis returns.
  private onError = (err: Error) => {
    m.relayErrors.add(1)
    logger.error({ err: err.message }, 'redis bus error')
  }

  onResync(handler: () => void) {
    this.resyncHandlers.add(handler)
    return () => void this.resyncHandlers.delete(handler)
  }

  publishAccess(event: AccessEvent) {
    this.pub.publish(ACCESS_CHANNEL, JSON.stringify(event)).catch(this.onError)
  }

  onAccess(handler: (e: AccessEvent) => void) {
    this.accessHandlers.add(handler)
    return () => void this.accessHandlers.delete(handler)
  }

  publish(docId: string, message: Uint8Array) {
    const frame = Buffer.concat([Buffer.from([this.idBytes.length]), this.idBytes, message])
    m.relayPublished.add(1)
    this.pub.publish(channel(docId), frame).catch(this.onError)
  }

  subscribe(docId: string, handler: BusHandler) {
    let set = this.handlers.get(docId)
    if (!set) {
      set = new Set()
      this.handlers.set(docId, set)
      this.sub.subscribe(channel(docId)).catch(this.onError)
    }
    set.add(handler)
    return () => {
      set.delete(handler)
      if (set.size === 0) {
        this.handlers.delete(docId)
        this.sub.unsubscribe(channel(docId)).catch(this.onError)
      }
    }
  }

  async close() {
    this.stopUpGauge()
    await Promise.all([this.pub.quit(), this.sub.quit()])
  }
}

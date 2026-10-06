// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import axe from 'axe-core'
import Chat from './Chat'
import { ChatStore, type Transport } from '@/lib/chatStore'
import type { ChatEvent, ChatMessage, Status } from '@/lib/provider'

const msg = (id: string, userId: string, name: string, text: string): ChatMessage => ({ id, userId, name, text, at: '2026-10-06T10:00:00.000Z' })

function setup(opts: { history?: ChatMessage[]; connected?: boolean; canWrite?: boolean } = {}) {
  let chat: ((e: ChatEvent) => void) | null = null
  const sent: Array<{ text: string; cid: string }> = []
  const status: Status = opts.connected === false ? 'offline' : 'connected'
  const transport: Transport = {
    onChat: (fn) => { chat = fn; return () => { chat = null } },
    sendChat: (text, cid) => { sent.push({ text, cid }); return true },
    subscribe: () => () => {},
    status,
  }
  const store = new ChatStore('me', transport, async () => opts.history ?? [], { newId: () => 'c1' })
  store.start()
  const ui = () => <Chat store={store} view={store.getSnapshot()} me="me" canWrite={opts.canWrite ?? true} connected={opts.connected ?? true} />
  const view = render(ui())
  store.subscribe(() => view.rerender(ui()))
  const push = (e: ChatEvent) => act(() => chat!(e))
  return { store, sent, push, view }
}

afterEach(cleanup)

describe('Chat', () => {
  it('shows saved history with names and times, and "You" for your own messages', async () => {
    setup({ history: [msg('1', 'ann', 'Ann', 'hello'), msg('2', 'me', 'Me', 'hi Ann')] })
    expect(await screen.findByText('hello')).toBeTruthy()
    const items = screen.getAllByRole('listitem')
    expect(items[0].textContent).toContain('Ann')
    expect(items[1].textContent).toContain('You')
    expect(items[1].className).toContain('mine')
  })

  it('shows a friendly empty state', async () => {
    setup({ history: [] })
    expect(await screen.findByText('No messages yet')).toBeTruthy()
  })

  it('sends with Enter, adds a new line with Shift+Enter, and clears the box', async () => {
    const { sent } = setup({ history: [msg('1', 'ann', 'Ann', 'x')] })
    await screen.findByText('x')
    const box = screen.getByLabelText('Message') as HTMLTextAreaElement
    fireEvent.change(box, { target: { value: 'hello world' } })
    fireEvent.keyDown(box, { key: 'Enter', shiftKey: true })
    expect(sent).toHaveLength(0) // Shift+Enter did not send
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(sent).toEqual([{ text: 'hello world', cid: 'c1' }])
    expect(box.value).toBe('')
    expect(screen.getByText('Sending…')).toBeTruthy()
  })

  it('sends with the Send button, which is off while the box is empty', async () => {
    const { sent } = setup({ history: [msg('1', 'ann', 'Ann', 'x')] })
    await screen.findByText('x')
    const button = screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'via button' } })
    expect(button.disabled).toBe(false)
    fireEvent.click(button)
    expect(sent[0].text).toBe('via button')
  })

  it('turns "sending" into a normal message when the server echoes it', async () => {
    const { push } = setup({ history: [msg('1', 'ann', 'Ann', 'x')] })
    await screen.findByText('x')
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'echo me' } })
    fireEvent.keyDown(screen.getByLabelText('Message'), { key: 'Enter' })
    push({ type: 'message', message: { ...msg('2', 'me', 'Me', 'echo me'), cid: 'c1' } })
    expect(screen.queryByText('Sending…')).toBeNull()
    expect(screen.getAllByText('echo me')).toHaveLength(1)
  })

  it('puts a refused message back in the box with a plain explanation, so nothing typed is lost', async () => {
    const { push } = setup({ history: [msg('1', 'ann', 'Ann', 'x')] })
    await screen.findByText('x')
    const box = screen.getByLabelText('Message') as HTMLTextAreaElement
    fireEvent.change(box, { target: { value: 'too quick' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    push({ type: 'error', cid: 'c1', code: 'rate' })
    expect((await screen.findByRole('alert')).textContent).toMatch(/too quickly/)
    expect(box.value).toBe('too quick')
  })

  it('does not overwrite something new the person has already started typing', async () => {
    const { push } = setup({ history: [msg('1', 'ann', 'Ann', 'x')] })
    await screen.findByText('x')
    const box = screen.getByLabelText('Message') as HTMLTextAreaElement
    fireEvent.change(box, { target: { value: 'first' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    fireEvent.change(box, { target: { value: 'second, typed meanwhile' } })
    push({ type: 'error', cid: 'c1', code: 'unavailable' })
    await screen.findByRole('alert')
    expect(box.value).toBe('second, typed meanwhile')
  })

  it('is read-only for viewers', async () => {
    setup({ history: [msg('1', 'ann', 'Ann', 'only reading')], canWrite: false })
    await screen.findByText('only reading')
    expect(screen.queryByLabelText('Message')).toBeNull()
    expect(screen.getByText(/can read the chat but can.t write/)).toBeTruthy()
  })

  it('disables writing while offline and explains why', async () => {
    setup({ history: [msg('1', 'ann', 'Ann', 'x')], connected: false })
    await screen.findByText('x')
    const box = screen.getByLabelText('Message') as HTMLTextAreaElement
    expect(box.disabled).toBe(true)
    expect(box.placeholder).toMatch(/offline/i)
    expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('loads earlier messages on request', async () => {
    const pages = vi.fn(async (before?: string) => (before ? [msg('0', 'ann', 'Ann', 'older one')] : Array.from({ length: 50 }, (_, i) => msg(String(100 + i), 'ann', 'Ann', `m${i}`))))
    const transport: Transport = { onChat: () => () => {}, sendChat: () => true, subscribe: () => () => {}, status: 'connected' }
    const store = new ChatStore('me', transport, pages as never)
    store.start()
    const ui = () => <Chat store={store} view={store.getSnapshot()} me="me" canWrite connected />
    const view = render(ui())
    store.subscribe(() => view.rerender(ui()))
    fireEvent.click(await screen.findByRole('button', { name: 'Load earlier messages' }))
    expect(await screen.findByText('older one')).toBeTruthy()
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Load earlier messages' })).toBeNull())
  })

  it('announces a new message from someone else politely, but not your own and not old history', async () => {
    const { push } = setup({ history: [msg('1', 'ann', 'Ann', 'old news')] })
    await screen.findByText('old news')
    const live = screen.getAllByRole('status').find((el) => el.getAttribute('aria-live') === 'polite')!
    expect(live.textContent).toBe('') // history is silent
    push({ type: 'message', message: msg('2', 'me', 'Me', 'my own') })
    expect(live.textContent).toBe('')
    push({ type: 'message', message: msg('3', 'bob', 'Bob', 'lunch?') })
    expect(live.textContent).toBe('Bob wrote: lunch?')
  })

  it('shows message text literally: markup is not interpreted', async () => {
    const { view } = setup({ history: [msg('1', 'ann', 'Ann', '<img src=x onerror=alert(1)><b>bold?</b>')] })
    await screen.findByText(/<img src=x/)
    expect(view.container.querySelector('img')).toBeNull()
    expect(view.container.querySelector('b')).toBeNull()
  })

  it('never takes keyboard focus when a message arrives', async () => {
    const { push } = setup({ history: [msg('1', 'ann', 'Ann', 'x')] })
    await screen.findByText('x')
    const box = screen.getByLabelText('Message') as HTMLTextAreaElement
    box.focus()
    push({ type: 'message', message: msg('2', 'bob', 'Bob', 'ping') })
    expect(document.activeElement).toBe(box)
  })

  it('has no accessibility violations (with messages, a refusal and the input)', async () => {
    const { view, push } = setup({ history: [msg('1', 'ann', 'Ann', 'hello'), msg('2', 'me', 'Me', 'hi')] })
    await screen.findByText('hello')
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'x' } })
    fireEvent.keyDown(screen.getByLabelText('Message'), { key: 'Enter' })
    push({ type: 'error', cid: 'c1', code: 'forbidden' })
    const r = await axe.run(view.container, { rules: { 'color-contrast': { enabled: false } } })
    expect(r.violations.map((v) => `${v.id}: ${v.nodes[0].html}`)).toEqual([])
  })
})

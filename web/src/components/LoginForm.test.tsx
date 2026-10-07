// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const replace = vi.fn()
let nextParam: string | null = null
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
  useSearchParams: () => ({ get: (k: string) => (k === 'next' ? nextParam : null) }),
}))
const apiMock = vi.fn<(...args: unknown[]) => Promise<unknown>>(() => Promise.reject(new Error('Wrong email or password')))
vi.mock('@/lib/api', () => ({ api: (...a: unknown[]) => apiMock(...a), tokenStore: { set: vi.fn() } }))
const startGuest = vi.fn()
vi.mock('@/lib/guest', () => ({ startGuest: () => startGuest() }))

import LoginForm from './LoginForm'
import { violationsIn } from '@/test/axe'

afterEach(() => {
  cleanup()
  nextParam = null
  replace.mockReset()
  startGuest.mockReset()
  apiMock.mockImplementation(() => Promise.reject(new Error('Wrong email or password')))
})

describe('LoginForm', () => {
  it('has no axe violations in either mode', async () => {
    const { container } = render(<LoginForm />)
    expect(await violationsIn(container)).toEqual([])
    fireEvent.click(screen.getByRole('button', { name: /create an account/i }))
    expect(await violationsIn(container)).toEqual([])
  })

  it('labels every field', () => {
    render(<LoginForm />)
    expect(screen.getByLabelText('Email')).toBeTruthy()
    expect(screen.getByLabelText('Password')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /create an account/i }))
    expect(screen.getByLabelText('Your name')).toBeTruthy()
  })

  it('announces a failed sign-in and ties the message to the form', async () => {
    render(<LoginForm />)
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@b.dev' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'whatever1' } })
    fireEvent.submit(screen.getByRole('button', { name: 'Sign in' }).closest('form')!)
    const alert = await waitFor(() => screen.getByRole('alert'))
    expect(alert.textContent).toBe('Wrong email or password')
    const form = alert.closest('form')!
    expect(form.getAttribute('aria-describedby')).toBe(alert.id)
  })

  it('autocompletes sensibly for password managers', () => {
    render(<LoginForm />)
    expect(screen.getByLabelText('Email').getAttribute('autocomplete')).toBe('email')
    expect(screen.getByLabelText('Password').getAttribute('autocomplete')).toBe('current-password')
  })

  it('after signing in, goes back to where the person was heading', async () => {
    nextParam = '/join/abc123'
    apiMock.mockResolvedValue({ token: 't', user: { id: '1', name: 'A', email: 'a@b.dev' } })
    render(<LoginForm />)
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@b.dev' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'whatever1' } })
    fireEvent.submit(screen.getByRole('button', { name: 'Sign in' }).closest('form')!)
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/join/abc123'))
  })

  it('never follows a "go back to" address that leaves the site', async () => {
    nextParam = '//evil.example.com/steal'
    apiMock.mockResolvedValue({ token: 't', user: { id: '1', name: 'A', email: 'a@b.dev' } })
    render(<LoginForm />)
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@b.dev' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'whatever1' } })
    fireEvent.submit(screen.getByRole('button', { name: 'Sign in' }).closest('form')!)
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/'))
  })

  it('offers to try the app with no account, and opens the Welcome document', async () => {
    startGuest.mockResolvedValue({ workspaceId: 'w', welcomeId: 'doc1', boardId: 'b' })
    render(<LoginForm />)
    fireEvent.click(screen.getByRole('button', { name: /just let me try it/i }))
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/doc/doc1'))
  })

  it('ignores the remembered page for a new guest: someone else\'s workspace or document is not theirs to open', async () => {
    startGuest.mockResolvedValue({ workspaceId: 'mine', welcomeId: 'mydoc', boardId: 'b' })
    nextParam = '/w/an-old-guests-workspace'
    render(<LoginForm />)
    fireEvent.click(screen.getByRole('button', { name: /just let me try it/i }))
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/doc/mydoc'))
    expect(replace).not.toHaveBeenCalledWith('/w/an-old-guests-workspace')
  })

  it('does send a new guest back to an invite link, so they can accept it', async () => {
    startGuest.mockResolvedValue({ workspaceId: 'w', welcomeId: 'doc1', boardId: 'b' })
    nextParam = '/join/abc123'
    render(<LoginForm />)
    fireEvent.click(screen.getByRole('button', { name: /just let me try it/i }))
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/join/abc123'))
  })

  it('creates only one guest however fast the button is clicked', async () => {
    startGuest.mockResolvedValue({ workspaceId: 'w', welcomeId: 'doc1', boardId: 'b' })
    render(<LoginForm />)
    const button = screen.getByRole('button', { name: /just let me try it/i })
    fireEvent.click(button)
    fireEvent.click(button)
    fireEvent.click(button)
    await waitFor(() => expect(replace).toHaveBeenCalledTimes(1))
    expect(startGuest).toHaveBeenCalledTimes(1)
  })

  it('lets the person try again after a failure', async () => {
    startGuest.mockRejectedValueOnce(new Error('Could not reach the server')).mockResolvedValueOnce({ workspaceId: 'w', welcomeId: 'doc1', boardId: 'b' })
    render(<LoginForm />)
    const button = screen.getByRole('button', { name: /just let me try it/i })
    fireEvent.click(button)
    expect((await screen.findByRole('alert')).textContent).toBe('Could not reach the server')
    fireEvent.click(button)
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/doc/doc1'))
  })
})

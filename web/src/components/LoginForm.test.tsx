// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn() }) }))
vi.mock('@/lib/api', () => ({
  api: vi.fn(() => Promise.reject(new Error('Wrong email or password'))),
  tokenStore: { set: vi.fn() },
}))

import LoginForm from './LoginForm'
import { violationsIn } from '@/test/axe'

afterEach(cleanup)

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
    expect(screen.getByLabelText('Name')).toBeTruthy()
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
})

import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'

const advance = (ms: number) => act(() => void vi.advanceTimersByTime(ms))

function startGame(seed = '1') {
  render(<App />)
  fireEvent.change(screen.getByLabelText(/Game seed/), { target: { value: seed } })
  fireEvent.click(screen.getByRole('button', { name: 'Start auction' }))
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(1_800_000_000_000)
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('the setup screen', () => {
  it('explains the game and lets you start', () => {
    render(<App />)
    expect(screen.getByRole('heading', { name: 'Auction Room' })).toBeTruthy()
    expect(screen.getByLabelText(/Your team name/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Start auction' })).toBeTruthy()
    expect(screen.getByText('Purse each')).toBeTruthy()
  })

  it('uses the team name you type', () => {
    render(<App />)
    fireEvent.change(screen.getByLabelText(/Your team name/), { target: { value: 'Thunder' } })
    fireEvent.click(screen.getByRole('button', { name: 'Start auction' }))
    advance(500)
    expect(within(screen.getByLabelText('My team')).getByText('Thunder')).toBeTruthy()
  })
})

describe('the auction room', () => {
  it('shows the lot on the block once the auction opens', () => {
    startGame()
    expect(screen.getByText(/about to begin/)).toBeTruthy()
    advance(2000)
    const lot = screen.getByLabelText('Current lot')
    expect(within(lot).getByText(/Lot 1 of 180/)).toBeTruthy()
    expect(within(lot).getByRole('button', { name: /^Bid/ })).toBeTruthy()
    expect(within(lot).getByRole('button', { name: 'Pass' })).toBeTruthy()
    expect(within(lot).getByRole('timer')).toBeTruthy()
  })

  it('lets you bid, and shows you as the leader', () => {
    startGame()
    advance(2000)
    const lot = screen.getByLabelText('Current lot')
    fireEvent.click(within(lot).getByRole('button', { name: /^Bid/ }))
    expect(within(screen.getByLabelText('Current lot')).getByText('You')).toBeTruthy()
    // You hold the highest bid, so the bid button is off and says why.
    expect(within(lot).getByRole('button', { name: /^Bid/ }).hasAttribute('disabled')).toBe(true)
    expect(within(lot).getByText(/highest bid/)).toBeTruthy()
  })

  it('lets you pass, and then you cannot bid on that player', () => {
    startGame()
    advance(2000)
    const lot = screen.getByLabelText('Current lot')
    fireEvent.click(within(lot).getByRole('button', { name: 'Pass' }))
    expect(within(lot).getByRole('button', { name: 'Pass' }).hasAttribute('disabled')).toBe(true)
    expect(within(lot).getByRole('button', { name: /^Bid/ }).hasAttribute('disabled')).toBe(true)
    expect(within(lot).getByText(/passed/)).toBeTruthy()
  })

  it('shows all ten teams, one sub-tab each', () => {
    startGame()
    advance(2000)
    const teams = screen.getByRole('tablist', { name: 'Teams' })
    expect(within(teams).getAllByRole('tab')).toHaveLength(10)
    fireEvent.click(within(teams).getByRole('tab', { name: 'Falcons' }))
    expect(screen.getByRole('heading', { name: /Falcons/ })).toBeTruthy()
  })

  it('lists upcoming, sold and unsold players', () => {
    startGame()
    advance(2000)
    fireEvent.click(screen.getByRole('tab', { name: /^Players/ }))
    const players = screen.getByRole('tablist', { name: 'Players' })
    expect(within(players).getByRole('tab', { name: /Upcoming/ })).toBeTruthy()
    expect(within(players).getByRole('tab', { name: /Sold/ })).toBeTruthy()
    expect(within(players).getByRole('tab', { name: /Unsold/ })).toBeTruthy()
    expect(screen.getAllByText(/^Base /).length).toBeGreaterThan(5)
    fireEvent.click(within(players).getByRole('tab', { name: /^Sold/ }))
    expect(screen.getByText('Nobody has been sold yet.')).toBeTruthy()
  })

  it('counts only the lots still to come as upcoming (not the one on the block)', () => {
    startGame()
    advance(2000)
    fireEvent.click(screen.getByRole('tab', { name: /^Players/ }))
    const players = screen.getByRole('tablist', { name: 'Players' })
    expect(within(players).getByRole('tab', { name: /Upcoming/ }).textContent).toContain('179')
  })

  it('announces results in the chat tab as lots close', () => {
    startGame()
    advance(2000)
    fireEvent.click(screen.getByRole('tab', { name: 'Chat' }))
    expect(screen.getByText(/Announcements appear here/)).toBeTruthy()
    advance(60_000)
    expect(screen.queryByText(/Announcements appear here/)).toBeNull()
    expect(screen.getAllByText(/sold to|went unsold|assigned to/).length).toBeGreaterThan(0)
  })
})

describe('privacy while lineups are chosen', () => {
  it('never shows another team its rivals\' lineups (the UI reads the public view)', { timeout: 120_000 }, () => {
    startGame('1')
    fireEvent.click(screen.getByLabelText('Fast CPUs'))
    let guard = 0
    while (!screen.queryByRole('tab', { name: /Lineup/ })) {
      advance(1000)
      if (++guard > 5000) throw new Error('never reached lineup selection')
    }
    advance(3000) // every CPU team has now submitted its lineup; the human has not
    fireEvent.click(screen.getByRole('tab', { name: 'Teams' }))
    const teams = screen.getByRole('tablist', { name: 'Teams' })
    fireEvent.click(within(teams).getByRole('tab', { name: 'Falcons' }))
    expect(screen.queryAllByText('XII')).toHaveLength(0)

    // Your own lineup is yours to see.
    fireEvent.click(screen.getByRole('tab', { name: /Lineup/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Auto-pick' }))
    fireEvent.click(screen.getByRole('button', { name: 'Submit lineup' }))
    // (The game ends once your lineup is in, so the results screen takes over.)
    expect(screen.getByRole('heading', { name: 'Auction complete' })).toBeTruthy()
  })
})

describe('a whole game', () => {
  it('runs from setup, through every lot and your lineup, to the results', { timeout: 120_000 }, () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    startGame('1')
    fireEvent.click(screen.getByLabelText('Fast CPUs'))

    let guard = 0
    while (!screen.queryByRole('tab', { name: /Lineup/ })) {
      advance(1000)
      if (++guard > 5000) throw new Error('never reached lineup selection')
    }
    expect(screen.getByText(/Choose your playing XII/)).toBeTruthy()

    // The lineup tab opens by itself; use the helper to fill it, then submit.
    fireEvent.click(screen.getByRole('button', { name: 'Auto-pick' }))
    const submit = screen.getByRole('button', { name: 'Submit lineup' })
    expect(submit.hasAttribute('disabled')).toBe(false)
    fireEvent.click(submit)
    advance(5000)

    expect(screen.getByRole('heading', { name: 'Auction complete' })).toBeTruthy()
    const rows = screen.getAllByRole('row')
    expect(rows).toHaveLength(1 + 10) // header + ten teams
    expect(screen.getByRole('button', { name: 'New game' })).toBeTruthy()
    expect(errors).not.toHaveBeenCalled() // no React warnings along the way
    errors.mockRestore()
  })

  it('"New game" goes back to the setup screen and stops the old auction', () => {
    startGame()
    advance(2000)
    fireEvent.click(screen.getByRole('button', { name: 'New game' }))
    expect(screen.getByRole('button', { name: 'Start auction' })).toBeTruthy()
    expect(vi.getTimerCount()).toBe(0)
  })
})

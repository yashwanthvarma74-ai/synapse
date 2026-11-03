import { describe, expect, it } from 'vitest'
import { filterSlashItems, slashItems } from './slashItems'

describe('slash menu filtering', () => {
  it('shows everything for a bare "/"', () => expect(filterSlashItems(slashItems, '')).toHaveLength(slashItems.length))
  it('matches by title prefix first', () => expect(filterSlashItems(slashItems, 'head')[0].id).toBe('h1'))
  it('finds items by their alias words', () => {
    expect(filterSlashItems(slashItems, 'hr')[0].id).toBe('divider')
    expect(filterSlashItems(slashItems, 'ol')[0].id).toBe('numbers')
  })
  it('puts prefix matches before loose matches', () => {
    const ids = filterSlashItems(slashItems, 'list').map((i) => i.id)
    expect(ids).toEqual(expect.arrayContaining(['bullets', 'numbers']))
  })
  it('returns nothing for gibberish', () => expect(filterSlashItems(slashItems, 'zzzz')).toEqual([]))
  it('every item has a unique id', () => expect(new Set(slashItems.map((i) => i.id)).size).toBe(slashItems.length))
})

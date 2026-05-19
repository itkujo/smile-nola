import { describe, expect, it } from 'vitest'
import { parsePlace, type RawPlace } from './places.ts'

const SAENGER: RawPlace = {
  id: 'ChIJR-XiLAqmIIYRIN-3cgL5chU',
  displayName: { text: 'Saenger Theatre', languageCode: 'en' },
  formattedAddress: '1111 Canal St, New Orleans, LA 70112, USA',
  addressComponents: [
    { longText: '1111', shortText: '1111', types: ['street_number'] },
    { longText: 'Canal Street', shortText: 'Canal St', types: ['route'] },
    {
      longText: 'New Orleans',
      shortText: 'New Orleans',
      types: ['locality', 'political'],
    },
    {
      longText: 'Louisiana',
      shortText: 'LA',
      types: ['administrative_area_level_1', 'political'],
    },
    {
      longText: 'United States',
      shortText: 'US',
      types: ['country', 'political'],
    },
    { longText: '70112', shortText: '70112', types: ['postal_code'] },
  ],
  location: { latitude: 29.9572, longitude: -90.0773 },
}

describe('parsePlace', () => {
  it('extracts the business name and full address from a complete place', () => {
    const result = parsePlace(SAENGER)
    expect(result).toEqual({
      name: 'Saenger Theatre',
      streetAddress: '1111 Canal St',
      city: 'New Orleans',
      state: 'LA',
      postalCode: '70112',
      country: 'US',
      latitude: 29.9572,
      longitude: -90.0773,
    })
  })

  it('falls back to sublocality when locality is absent (e.g. some boroughs)', () => {
    const place: RawPlace = {
      id: 'p1',
      displayName: { text: 'Test Spot', languageCode: 'en' },
      formattedAddress: 'unused',
      addressComponents: [
        {
          longText: 'Brooklyn',
          shortText: 'Brooklyn',
          types: ['sublocality_level_1', 'political'],
        },
        {
          longText: 'New York',
          shortText: 'NY',
          types: ['administrative_area_level_1'],
        },
      ],
      location: { latitude: 40.7, longitude: -73.9 },
    }
    expect(parsePlace(place).city).toBe('Brooklyn')
  })

  it('joins street_number + route into streetAddress', () => {
    const place: RawPlace = {
      id: 'p2',
      displayName: { text: 'X', languageCode: 'en' },
      formattedAddress: 'unused',
      addressComponents: [
        { longText: '42', shortText: '42', types: ['street_number'] },
        {
          longText: 'Bourbon Street',
          shortText: 'Bourbon St',
          types: ['route'],
        },
      ],
      location: { latitude: 0, longitude: 0 },
    }
    expect(parsePlace(place).streetAddress).toBe('42 Bourbon St')
  })

  it('returns route only when street_number is absent', () => {
    const place: RawPlace = {
      id: 'p3',
      displayName: { text: 'X', languageCode: 'en' },
      formattedAddress: 'unused',
      addressComponents: [
        {
          longText: 'Esplanade Avenue',
          shortText: 'Esplanade Ave',
          types: ['route'],
        },
      ],
      location: { latitude: 0, longitude: 0 },
    }
    expect(parsePlace(place).streetAddress).toBe('Esplanade Ave')
  })

  it('returns null for missing components rather than empty strings', () => {
    const minimal: RawPlace = {
      id: 'p4',
      displayName: { text: 'Mystery Spot', languageCode: 'en' },
      formattedAddress: 'unused',
      addressComponents: [],
      location: { latitude: 1, longitude: 2 },
    }
    const result = parsePlace(minimal)
    expect(result.name).toBe('Mystery Spot')
    expect(result.streetAddress).toBeNull()
    expect(result.city).toBeNull()
    expect(result.state).toBeNull()
    expect(result.postalCode).toBeNull()
    expect(result.country).toBeNull()
    expect(result.latitude).toBe(1)
    expect(result.longitude).toBe(2)
  })
})

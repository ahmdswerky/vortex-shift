import { describe, it } from 'vitest'

describe.skip('integration/retry behavior', () => {
  it('retries transfer failures and eventually succeeds when transient errors clear', async () => {
    // Integration environment setup required:
    // - controlled rsync failure injection
    // - assert retry attempts and final success
  })
})

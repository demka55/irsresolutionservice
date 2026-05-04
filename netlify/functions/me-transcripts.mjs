import { getUser } from '@netlify/identity'
import { getStore } from '@netlify/blobs'

const STORE = 'accounts'

export default async (req) => {
  const user = await getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const store = getStore(STORE)
  const prefix = `transcripts/${user.id}/`
  const { blobs } = await store.list({ prefix })

  const items = await Promise.all(
    blobs.map(async (b) => {
      const data = await store.get(b.key, { type: 'json' })
      return data
    })
  )

  const transcripts = items
    .filter(Boolean)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))

  return Response.json({ transcripts })
}

export const config = {
  path: '/api/me/transcripts',
  method: 'GET',
}

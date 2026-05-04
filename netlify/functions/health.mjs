export default async () => {
  return Response.json({ status: 'ok', timestamp: new Date().toISOString() })
}

export const config = {
  path: '/api/health',
  method: 'GET',
}

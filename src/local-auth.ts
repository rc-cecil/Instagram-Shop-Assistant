export async function getUser() { const response = await fetch('/api/auth/me'); if (!response.ok) throw new Error('Could not check owner sign-in'); return response.json() }
export async function login(email: string, password: string) { const response = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) }); if (!response.ok) throw new Error('Invalid owner credentials'); return response.json() }
export async function logout() { await fetch('/api/auth/logout', { method: 'POST' }) }
export async function handleAuthCallback(): Promise<{type?: string; token?: string} | null> { return null }
export async function requestPasswordRecovery(_email: string): Promise<void> { throw new Error('Local password reset is done through OWNER_PASSWORD_HASH in .env') }
export async function acceptInvite(_token: string, _password: string): Promise<void> { throw new Error('Invitations are not used in local mode') }
export async function updateUser(_value: { password: string }): Promise<void> { throw new Error('Set OWNER_PASSWORD_HASH in .env to change the local password') }

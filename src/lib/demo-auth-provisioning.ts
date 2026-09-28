const resetTokens = new Map<string, string>()

export const isDemoProvisioningEnabled = () =>
  process.env.NODE_ENV !== 'production' &&
  process.env.HDW_DEMO_PROVISION === 'true'

export const captureDemoResetToken = (email: string, token: string) => {
  if (!isDemoProvisioningEnabled()) {
    throw new Error('Demo credential provisioning is disabled')
  }

  resetTokens.set(email.toLowerCase(), token)
}

export const takeDemoResetToken = (email: string) => {
  const key = email.toLowerCase()
  const token = resetTokens.get(key)
  resetTokens.delete(key)

  if (!token) {
    throw new Error('Better Auth did not issue a demo reset token')
  }

  return token
}

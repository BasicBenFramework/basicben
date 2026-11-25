/**
 * Passkeys in the browser: the WebAuthn calls, with the conversion core's
 * webauthn module needs. Core sends challenges, user handles and credential
 * ids as base64url strings and expects the authenticator's answer back the
 * same way; the browser API speaks ArrayBuffers.
 */

function toBuffer(value: string): ArrayBuffer {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=')
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes.buffer
}

function toBase64Url(buffer: ArrayBuffer | null | undefined): string | undefined {
  if (!buffer) return undefined
  let binary = ''
  for (const byte of new Uint8Array(buffer)) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

type Descriptor = { type: string; id: string; transports?: string[] }

const descriptors = (list?: Descriptor[]) =>
  (list ?? []).map((d) => ({ ...d, id: toBuffer(d.id) })) as PublicKeyCredentialDescriptor[]

export function passkeysSupported(): boolean {
  return typeof window !== 'undefined' && typeof window.PublicKeyCredential === 'function' && Boolean(navigator.credentials)
}

/** A browser's refusal, in words a person can act on. */
export function passkeyError(err: unknown): string {
  const name = (err as { name?: string })?.name
  if (name === 'NotAllowedError') return 'The passkey request was cancelled or timed out.'
  if (name === 'InvalidStateError') return 'This device already has a passkey for your account.'
  if (name === 'SecurityError') return 'Passkeys need this site to be opened at its own address over HTTPS.'
  return (err as Error)?.message || 'The passkey did not work.'
}

/** navigator.credentials.create() with core's registration options. */
export async function createPasskey(options: any): Promise<Record<string, unknown>> {
  const credential = (await navigator.credentials.create({
    publicKey: {
      ...options,
      challenge: toBuffer(options.challenge),
      user: { ...options.user, id: toBuffer(options.user.id) },
      excludeCredentials: descriptors(options.excludeCredentials)
    }
  })) as PublicKeyCredential | null
  if (!credential) throw new Error('No passkey was created.')

  const response = credential.response as AuthenticatorAttestationResponse
  return {
    id: credential.id,
    rawId: toBase64Url(credential.rawId),
    type: credential.type,
    response: {
      clientDataJSON: toBase64Url(response.clientDataJSON),
      attestationObject: toBase64Url(response.attestationObject),
      transports: typeof response.getTransports === 'function' ? response.getTransports() : undefined
    }
  }
}

/** navigator.credentials.get() with core's authentication options. */
export async function signWithPasskey(options: any): Promise<Record<string, unknown>> {
  const credential = (await navigator.credentials.get({
    publicKey: {
      ...options,
      challenge: toBuffer(options.challenge),
      allowCredentials: descriptors(options.allowCredentials)
    }
  })) as PublicKeyCredential | null
  if (!credential) throw new Error('No passkey was used.')

  const response = credential.response as AuthenticatorAssertionResponse
  return {
    id: credential.id,
    rawId: toBase64Url(credential.rawId),
    type: credential.type,
    response: {
      clientDataJSON: toBase64Url(response.clientDataJSON),
      authenticatorData: toBase64Url(response.authenticatorData),
      signature: toBase64Url(response.signature),
      userHandle: toBase64Url(response.userHandle)
    }
  }
}

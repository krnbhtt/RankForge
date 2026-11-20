/**
 * Authorization header for calling a private Cloud Run service. On Cloud Run the metadata server issues a Google identity
 * token for the calling service account; anywhere else (local development) no header is needed.
 */
export async function serviceAuthHeaders(audience: string): Promise<Record<string, string>> {
  if (!process.env.K_SERVICE) return {};
  const url = `http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity?audience=${encodeURIComponent(audience)}`;
  const res = await fetch(url, { headers: { 'Metadata-Flavor': 'Google' }, signal: AbortSignal.timeout(3000) });
  if (!res.ok) throw new Error(`Identity token request failed with status ${res.status}`);
  return { Authorization: `Bearer ${await res.text()}` };
}

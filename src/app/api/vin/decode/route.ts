import { withAuth } from '@/lib/apiRoute';
import { apiError } from '@/lib/errors';
import { decodeVin } from '@/lib/vin';
import { parseRequestBody, vinSchema } from '@/lib/validation';

export async function POST(request: Request) {
  return withAuth(
    request,
    async () => {
      const parsed = await parseRequestBody(request, vinSchema);
      if ('error' in parsed) return parsed.error;

      const result = await decodeVin(parsed.data.vin);
      return result;
    },
    { rateLimitKey: 'vin.decode' }
  );
}
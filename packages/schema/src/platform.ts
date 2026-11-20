import { z } from 'zod';

export const PlatformTypeEnum = z.enum([
  'shopify',
  'woocommerce',
  'magento',
  'bigcommerce',
  'custom',
  'unknown',
]);
